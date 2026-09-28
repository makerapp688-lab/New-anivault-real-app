import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSessionSecret } from './session-secret.js';
import { logAdminAction, loadAuditLogs } from './audit-logger.js';
import {
  getEmailConfigStatus,
  checkServerSecretsDiagnostic,
  testEmailTransport
} from './email-service.js';
import {
  normalizeAndValidateEmail,
  issueOwnerOtp,
  resendOwnerOtp,
  verifyAndConsumeOwnerOtp
} from './email-verification.js';
import {
  getArtworkSourcesConfig,
  saveArtworkSourcesConfig,
  testSourceConnectivity
} from './artwork-sources.js';
import { hasConfiguredTmdbApiKey } from './source-gateway.js';
import {
  getWatchOrderSourcesConfig,
  saveWatchOrderSourcesConfig,
  loadWatchOrderRecords,
  testWatchOrderSourceConnectivity,
  resolveAndCompareFranchiseWatchOrder,
  validateAndApplyWatchOrder
} from './watch-order-sources.js';
import {
  inspectLatestAppSourceMetadata,
  buildLatestAppSourceArchive,
  updateLatestAppSourceArchive,
  getLatestOrBuildAppSourceArchive,
  validateZipArchiveBuffer,
  getArchiveDiskPath
} from './source-packager.js';
import {
  loadVerificationRecords,
  saveVerificationRecords,
  loadFakeAnimeIssues,
  saveFakeAnimeIssues,
  loadArtworkHistory,
  saveArtworkHistory,
  verifyAnimeEntry,
  inspectArtworkImage,
  isPlaceholderArtworkUrl,
  applyArtworkUpdate,
  revertArtwork,
  markCatalogueAnimeVerified
} from './artwork-verifier.js';
import { artworkScanner, computeGlobalCatalogueStats } from './artwork-scanner.js';
import { infoManager } from './info-manager.js';
import {
  globalWorkerJobEngine,
  createDeterministicTaskId,
  HEARTBEAT_INTERVAL_MS,
  LEASE_DURATION_MS
} from './worker-job-engine.js';
import { globalDataStore } from './data-store.js';

// Data file paths
const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const OWNER_ACCOUNT_PATH = path.join(DATA_DIR, 'owner-account.json');
const OWNER_DELETED_STATE_PATH = path.join(DATA_DIR, 'owner-account-deleted.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'owner-sessions.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Interfaces
export interface OwnerAccount {
  id?: string;
  email: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
  role: 'owner';
}

export interface SessionData {
  sessionId: string;
  userId?: string;
  email: string;
  username: string;
  role: 'owner';
  createdAt: number;
  expiresAt: number;
  revoked?: boolean;
}

// Password hashing using Node.js crypto (pbkdf2)
function hashPassword(password: string, salt: string = crypto.randomBytes(16).toString('hex')): { hash: string; salt: string } {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  if (!hash || !salt || typeof hash !== 'string' || typeof salt !== 'string') return false;
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    const testHashBuffer = Buffer.from(testHash, 'hex');
    if (hashBuffer.length !== testHashBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashBuffer, testHashBuffer);
  } catch (err) {
    console.error('[verifyPassword] Error during verification:', err);
    return false;
  }
}

function isValidCredentialHex(value: unknown, minHexLength: number): boolean {
  return (
    typeof value === 'string' &&
    value.length >= minHexLength &&
    value.toLowerCase() !== 'test' &&
    /^[0-9a-f]+$/i.test(value)
  );
}

let runtimeEnvOwnerCache: {
  fingerprint: string;
  account: OwnerAccount;
} | null = null;

// Load / Save Owner Account from runtime storage or environment configuration
export function getOwnerAccount(): OwnerAccount | null {
  try {
    if (fs.existsSync(OWNER_ACCOUNT_PATH)) {
      const data = fs.readFileSync(OWNER_ACCOUNT_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && parsed.email) {
        const normalizedEmail = String(parsed.email).trim().toLowerCase();
        // Reject fake/test credentials or unauthorized emails
        if (
          !isEmailAuthorizedOwner(normalizedEmail) ||
          !isValidCredentialHex(parsed.passwordHash, 64) ||
          !isValidCredentialHex(parsed.salt, 16)
        ) {
          try {
            fs.unlinkSync(OWNER_ACCOUNT_PATH);
          } catch {}
          return null;
        }
        if (!parsed.id) parsed.id = 'usr_owner';
        parsed.email = normalizedEmail;
        const configuredUsername = (process.env.OWNER_USERNAME || 'Death197').trim().replace(/^["']|["']$/g, '').trim() || 'Death197';
        if (!parsed.username || parsed.username.trim() === '' || parsed.username.trim() === 'Owner') {
          parsed.username = configuredUsername;
        }
        parsed.role = 'owner';

        const configuredPassword = (process.env.OWNER_PASSWORD || '').trim().replace(/^["']|["']$/g, '').trim();
        if (
          parsed.managedByEnv &&
          configuredPassword &&
          configuredPassword.toLowerCase() !== 'test' &&
          !/^(YOUR_OWNER_PASSWORD_HERE|MY_OWNER_PASSWORD|CHANGE_ME)$/i.test(configuredPassword)
        ) {
          let changed = false;
          if (parsed.username !== configuredUsername) {
            parsed.username = configuredUsername;
            changed = true;
          }
          if (!verifyPassword(configuredPassword, parsed.passwordHash, parsed.salt)) {
            const { hash, salt } = hashPassword(configuredPassword);
            parsed.passwordHash = hash;
            parsed.salt = salt;
            parsed.updatedAt = new Date().toISOString();
            changed = true;
          }
          if (changed) {
            saveOwnerAccount(parsed);
          }
        }

        return parsed;
      }
    }

    // Do NOT auto-recreate a new Owner account if the Owner account was explicitly deleted/reset
    if (fs.existsSync(OWNER_DELETED_STATE_PATH)) {
      runtimeEnvOwnerCache = null;
      return null;
    }

    // Server-side generation and storage of Owner password hash & salt from OWNER_PASSWORD
    const envPlainPassword = (process.env.OWNER_PASSWORD || '').trim().replace(/^["']|["']$/g, '').trim();
    const envEmail = getAuthorizedOwnerEmail();
    const envUsername = (process.env.OWNER_USERNAME || 'Death197').trim().replace(/^["']|["']$/g, '').trim() || 'Death197';

    if (
      isEmailAuthorizedOwner(envEmail) &&
      envPlainPassword &&
      envPlainPassword.length > 0 &&
      envPlainPassword.toLowerCase() !== 'test' &&
      !/^(YOUR_OWNER_PASSWORD_HERE|MY_OWNER_PASSWORD|CHANGE_ME)$/i.test(envPlainPassword)
    ) {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${envEmail}|${envUsername}|${envPlainPassword}`)
        .digest('hex');
      if (!runtimeEnvOwnerCache || runtimeEnvOwnerCache.fingerprint !== fingerprint) {
        const { hash, salt } = hashPassword(envPlainPassword);
        const now = new Date(0).toISOString();
        const generatedAccount: OwnerAccount & { managedByEnv?: boolean } = {
          id: 'usr_owner',
          email: envEmail,
          username: envUsername,
          passwordHash: hash,
          salt,
          createdAt: now,
          updatedAt: now,
          role: 'owner',
          managedByEnv: true
        };
        try {
          saveOwnerAccount(generatedAccount);
        } catch {}
        runtimeEnvOwnerCache = {
          fingerprint,
          account: generatedAccount
        };
      }
      return { ...runtimeEnvOwnerCache.account };
    }
  } catch (err) {
    console.error('[OwnerAuth] Error reading owner account:', err);
  }
  return null;
}

export function saveOwnerAccount(account: OwnerAccount): void {
  if (!account.id) {
    account.id = 'usr_owner';
  }
  if (!account.username || account.username.trim() === '' || account.username.trim() === 'Owner') {
    account.username = 'Death197';
  }
  if (account.email) {
    account.email = account.email.trim().toLowerCase();
  }
  if (fs.existsSync(OWNER_DELETED_STATE_PATH)) {
    try {
      fs.unlinkSync(OWNER_DELETED_STATE_PATH);
    } catch {}
  }
  fs.writeFileSync(OWNER_ACCOUNT_PATH, JSON.stringify(account, null, 2), 'utf-8');
}

export function validateOwnerSession(sessionId: string): { id: string; email: string; username: string; role: 'owner'; createdAt: string } | null {
  try {
    if (!sessionId || typeof sessionId !== 'string') return null;
    loadSessions();
    const session = activeSessions.get(sessionId);
    if (!session || session.revoked || session.expiresAt < Date.now()) {
      if (session && session.expiresAt < Date.now()) {
        activeSessions.delete(sessionId);
        saveSessions();
      }
      return null;
    }

    // Verify cryptographic token signature if signed token format
    if (sessionId.includes('.')) {
      const decoded = verifyAndDecodeSessionToken(sessionId);
      if (!decoded || decoded.role !== 'owner') {
        activeSessions.delete(sessionId);
        saveSessions();
        return null;
      }
    }

    const owner = getOwnerAccount();
    if (!owner) {
      activeSessions.delete(sessionId);
      saveSessions();
      return null;
    }

    const sessionEmail = session.email ? session.email.trim().toLowerCase() : '';
    const ownerEmail = owner.email ? owner.email.trim().toLowerCase() : '';

    if (ownerEmail !== sessionEmail || owner.role !== 'owner' || !isEmailAuthorizedOwner(ownerEmail)) {
      activeSessions.delete(sessionId);
      saveSessions();
      return null;
    }

    const ownerCreatedMs = Date.parse(owner.createdAt);
    if (!isNaN(ownerCreatedMs) && session.createdAt + 5000 < ownerCreatedMs) {
      activeSessions.delete(sessionId);
      saveSessions();
      return null;
    }

    return {
      id: owner.id || 'usr_owner',
      email: owner.email,
      username: owner.username,
      role: 'owner',
      createdAt: owner.createdAt
    };
  } catch (err) {
    console.error('[OwnerAuth] Error in validateOwnerSession:', err);
    return null;
  }
}

// Sessions management
const activeSessions: Map<string, SessionData> = new Map();

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_PATH)) {
      const list: SessionData[] = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
      const now = Date.now();
      activeSessions.clear();
      for (const s of list) {
        if (s.expiresAt > now) {
          activeSessions.set(s.sessionId, s);
        }
      }
    }
  } catch (err) {
    console.error('[OwnerAuth] Error loading sessions:', err);
  }
}

export function revokeOwnerSession(sessionId: string): void {
  if (!sessionId) return;
  loadSessions();
  activeSessions.set(sessionId, {
    sessionId,
    email: '',
    username: '',
    role: 'owner',
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    revoked: true
  });
  saveSessions();
}

function saveSessions() {
  try {
    const list = Array.from(activeSessions.values());
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('[OwnerAuth] Error saving sessions:', err);
  }
}

// Session store loaded
loadSessions();

// Cookie helper
function parseCookies(req: Request): Record<string, string> {
  const list: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      list[name] = decodeURIComponent(value);
    }
  });
  return list;
}

function setSessionCookie(res: Response, name: string, value: string, maxAgeSeconds: number, req?: Request): void {
  const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : true;
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  const expiresString = new Date(Date.now() + maxAge * 1000).toUTCString();
  const cookieValue = value || '';

  const secureFlags = isSecure ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${name}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${secureFlags}; Max-Age=${maxAge}; Expires=${expiresString}`
  );
}

export function generateSignedSessionToken(userId: string, email: string, username: string, role: string, provider: string, expiresAt: number): string {
  const payload = JSON.stringify({ userId, email, username, role, provider, expiresAt });
  const secret = getSessionSecret();
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const base64url = Buffer.from(payload).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return base64url + '.' + hmac;
}

export function verifyAndDecodeSessionToken(token: string): { userId: string; email: string; username: string; role: string; provider: string; expiresAt: number } | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    let base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const payloadStr = Buffer.from(base64, 'base64').toString('utf8');
    const signature = parts[1];
    
    const secret = getSessionSecret();
    const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
    if (signature !== hmac) {
      return null;
    }
    
    const decoded = JSON.parse(payloadStr);
    if (decoded.expiresAt < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// Authoritative Owner email resolution from OWNER_EMAIL environment variable
export function getAuthorizedOwnerEmail(): string {
  const raw = (process.env.OWNER_EMAIL || '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (raw && raw.includes('@') && !/^(my_|your_|placeholder|change_me)/i.test(raw)) {
    return raw;
  }
  return 'makerapp688@gmail.com';
}

export function isEmailAuthorizedOwner(email: string | undefined | null): boolean {
  if (!email || typeof email !== 'string') return false;
  const cleanEmail = email.trim().toLowerCase();
  return cleanEmail === getAuthorizedOwnerEmail();
}

/**
 * Google OAuth is not configured on this server.
 * Never trust client-controlled headers, query parameters, SMTP variables, or fallback Owner records.
 */
export function getGoogleAccountEmail(_req?: Request): string | null {
  return null;
}

export function getSessionEmail(req: Request): string | null {
  const cookies = parseCookies(req);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  
  // 1. Try Owner Session (must be validated against authoritative server-side session store)
  const ownerHeader = req.headers['x-anivault-owner-session'] as string;
  const ownerSessionId = cookies['anivault_owner_session'] || ownerHeader || bearerToken;
  
  if (ownerSessionId) {
    const validatedOwner = validateOwnerSession(ownerSessionId);
    if (validatedOwner) {
      return validatedOwner.email;
    }
  }
  
  // 2. Try User Session (must exist in authoritative users-sessions.json and users-accounts.json)
  const userHeader = req.headers['x-anivault-user-session'] as string;
  const userSessionId = cookies['anivault_user_session'] || userHeader || bearerToken;
  
  if (userSessionId) {
    try {
      const sessionsPath = path.join(process.cwd(), 'server', 'data', 'users-sessions.json');
      const usersPath = path.join(process.cwd(), 'server', 'data', 'users-accounts.json');
      if (fs.existsSync(sessionsPath) && fs.existsSync(usersPath)) {
        const list: any[] = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
        const users: Record<string, any> = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
        const matched = list.find(s => s.sessionId === userSessionId && !s.revoked && s.expiresAt > Date.now());
        if (matched && matched.userId && users[matched.userId] && !users[matched.userId].disabled) {
          return users[matched.userId].email;
        }
      }
    } catch (err) {
      console.error('[OwnerAuth] Error loading user sessions from disk:', err);
    }
  }
  
  return null;
}

export function authenticateSession(req: Request, res: Response, next: NextFunction): void {
  loadSessions();
  const cookies = parseCookies(req);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const customOwnerHeader = (req.headers['x-anivault-owner-session'] || req.headers['x-owner-session']) as string;
  const customUserHeader = req.headers['x-anivault-user-session'] as string;
  const rawPathToken = (req.params?.ownerToken) as string;
  const pathToken = rawPathToken ? decodeURIComponent(rawPathToken).replace(/_dot_/g, '.') : '';
  const queryToken = (req.query.token || req.query.ownerToken || pathToken) as string;

  // Detect if caller is explicitly using a normal user session
  if (customUserHeader && !customOwnerHeader) {
    (req as any).isNormalUserRequest = true;
    (req as any).ownerSession = null;
    return next();
  }

  if (bearerToken) {
    const decodedBearer = verifyAndDecodeSessionToken(bearerToken);
    if (decodedBearer && decodedBearer.role === 'user') {
      (req as any).isNormalUserRequest = true;
      (req as any).ownerSession = null;
      return next();
    }
  }

  if (queryToken) {
    const decodedQuery = verifyAndDecodeSessionToken(queryToken);
    if (decodedQuery && decodedQuery.role === 'user') {
      (req as any).isNormalUserRequest = true;
      (req as any).ownerSession = null;
      return next();
    }
  }

  // If no explicit owner token header/query was provided and a normal user session cookie is active without an owner cookie
  if (!bearerToken && !customOwnerHeader && !queryToken && cookies['anivault_user_session'] && !cookies['anivault_owner_session']) {
    (req as any).isNormalUserRequest = true;
    (req as any).ownerSession = null;
    return next();
  }

  const sessionId = bearerToken || customOwnerHeader || queryToken || cookies['anivault_owner_session'];

  if (!sessionId) {
    (req as any).ownerSession = null;
    return next();
  }

  const session = activeSessions.get(sessionId);
  if (!session || session.revoked || session.expiresAt < Date.now()) {
    if (session && session.expiresAt < Date.now()) {
      activeSessions.delete(sessionId);
      saveSessions();
    }
    (req as any).ownerSession = null;
    return next();
  }

  if (sessionId.includes('.')) {
    const decoded = verifyAndDecodeSessionToken(sessionId);
    if (!decoded || decoded.role !== 'owner') {
      activeSessions.delete(sessionId);
      saveSessions();
      (req as any).ownerSession = null;
      return next();
    }
  }

  const owner = getOwnerAccount();
  if (
    !owner ||
    owner.role !== 'owner' ||
    owner.email.trim().toLowerCase() !== session.email.trim().toLowerCase() ||
    !isEmailAuthorizedOwner(owner.email)
  ) {
    activeSessions.delete(sessionId);
    saveSessions();
    (req as any).ownerSession = null;
    return next();
  }

  const ownerCreatedMs = Date.parse(owner.createdAt);
  if (!isNaN(ownerCreatedMs) && session.createdAt + 5000 < ownerCreatedMs) {
    activeSessions.delete(sessionId);
    saveSessions();
    (req as any).ownerSession = null;
    return next();
  }

  session.username = owner.username;
  (req as any).ownerSession = session;
  next();
}

// Middleware: Require Owner
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const session = (req as any).ownerSession;

  if (!session) {
    if ((req as any).isNormalUserRequest) {
      res.status(403).json({ error: 'Forbidden: Access denied. Only the authenticated Owner account can access this resource.' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized: Authentication session required for Zenime Owner access.' });
    return;
  }

  if (session.role !== 'owner') {
    res.status(403).json({ error: 'Forbidden: Owner role required.' });
    return;
  }

  const owner = getOwnerAccount();
  if (!owner || owner.email.trim().toLowerCase() !== session.email.trim().toLowerCase() || !isEmailAuthorizedOwner(session.email)) {
    res.status(403).json({ error: 'Forbidden: Owner account mismatch or unauthorized.' });
    return;
  }

  next();
}

// Setup Express Router for Owner API
export function createOwnerRouter(): express.Router {
  const router = express.Router();

  // 0. Owner Email Service Status & Test Endpoints
  router.get('/email-status', authenticateSession, requireOwner, (_req: Request, res: Response) => {
    const status = getEmailConfigStatus();
    const secretsDiag = checkServerSecretsDiagnostic();
    res.json({
      ...status,
      secrets: secretsDiag
    });
  });

  router.post('/email-test', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const testRecipient = typeof req.body?.to === 'string' ? req.body.to.trim() : undefined;
      const result = await testEmailTransport(testRecipient);
      res.status(result.success ? 200 : 503).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Email transport test failed.' });
    }
  });

  // 1. Setup / Create Owner Account — Step 1: Validate & Send 6-Digit OTP to Configured OWNER_EMAIL
  const handleOwnerSetupInit = async (req: Request, res: Response) => {
    try {
      const { email, password, username } = req.body || {};

      // 1. Email validation & strict Owner authorization check FIRST
      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Valid email address is required.' });
        return;
      }
      const normalizedEmail = emailCheck.normalizedEmail;

      if (!isEmailAuthorizedOwner(normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      // 2. Username validation
      if (!username || typeof username !== 'string') {
        res.status(400).json({ error: 'Owner username is required.' });
        return;
      }
      const cleanUsername = username.trim();
      const usernameRegex = /^[a-zA-Z0-9_-]{2,30}$/;
      if (!usernameRegex.test(cleanUsername)) {
        res.status(400).json({
          error: 'Username must be between 2 and 30 characters and can only contain letters, numbers, hyphens, and underscores.'
        });
        return;
      }

      // 3. Password validation
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      if (fs.existsSync(OWNER_ACCOUNT_PATH)) {
        const existingOwner = getOwnerAccount();
        if (existingOwner && !(existingOwner as any).managedByEnv) {
          res.status(400).json({
            error: 'Permanent Zenime Owner account already exists. Setup rejected.',
            code: 'OWNER_ALREADY_EXISTS'
          });
          return;
        }
      }

      const { hash: passwordHash, salt } = hashPassword(password);

      const otpResult = await issueOwnerOtp({
        purpose: 'owner_setup',
        email: normalizedEmail,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        payload: {
          email: normalizedEmail,
          username: cleanUsername,
          passwordHash,
          salt
        },
        subject: 'Verify your Zenime Owner account setup',
        heading: 'Verify Zenime Owner Setup',
        description: `Use this 6-digit verification code to verify ${normalizedEmail} and complete setup of the permanent Zenime Owner account (${cleanUsername}).`
      });

      res.json({
        success: true,
        requiresVerification: true,
        email: otpResult.normalizedEmail,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: 'A 6-digit verification code has been sent to your authorized Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({
        error: err.message || 'Internal server error during owner setup.',
        code: err.code
      });
    }
  };

  router.post('/setup', handleOwnerSetupInit);
  router.post('/setup-init', handleOwnerSetupInit);

  // 2. Owner Setup — Step 2: Verify 6-Digit OTP & Create Permanent Owner Account
  router.post('/setup-verify', async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body || {};

      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Email address is required.' });
        return;
      }
      if (!isEmailAuthorizedOwner(emailCheck.normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      const verified = verifyAndConsumeOwnerOtp<{
        email: string;
        username: string;
        passwordHash: string;
        salt: string;
      }>({
        purpose: 'owner_setup',
        email: emailCheck.normalizedEmail,
        code,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner
      });

      const now = new Date().toISOString();
      const newOwner: OwnerAccount = {
        id: 'usr_owner',
        email: verified.normalizedEmail,
        username: verified.payload.username,
        passwordHash: verified.payload.passwordHash,
        salt: verified.payload.salt,
        createdAt: now,
        updatedAt: now,
        role: 'owner'
      };

      saveOwnerAccount(newOwner);

      // Invalidate any stale sessions from prior setups
      activeSessions.clear();

      const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken('usr_owner', newOwner.email, newOwner.username, 'owner', 'email', sessionExpires);
      const sessionData: SessionData = {
        sessionId,
        email: newOwner.email,
        username: newOwner.username,
        role: 'owner',
        createdAt: Date.now(),
        expiresAt: sessionExpires
      };

      activeSessions.set(sessionId, sessionData);
      saveSessions();

      setSessionCookie(res, 'anivault_owner_session', sessionId, 2592000, req);

      res.json({
        success: true,
        message: 'Email verified successfully. Permanent Zenime Owner account created.',
        owner: { email: newOwner.email, username: newOwner.username, role: newOwner.role },
        sessionToken: sessionId
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Owner setup verification failed.',
        code: err.code
      });
    }
  });

  // 2b. Owner Setup — Resend 6-Digit OTP
  router.post('/setup-resend', async (req: Request, res: Response) => {
    try {
      const { email } = req.body || {};
      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Email address is required.' });
        return;
      }
      if (!isEmailAuthorizedOwner(emailCheck.normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      const result = await resendOwnerOtp({
        purpose: 'owner_setup',
        email: emailCheck.normalizedEmail,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        subject: 'Verify your Zenime Owner account setup (New Code)',
        heading: 'Verify Zenime Owner Setup',
        description: 'A new 6-digit verification code was requested for your Zenime Owner setup. Any previous code is now invalid.'
      });

      res.json({
        success: true,
        email: result.normalizedEmail,
        cooldownSeconds: result.cooldownSeconds,
        message: 'A new 6-digit verification code has been sent to your Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to resend Owner setup verification code.',
        code: err.code
      });
    }
  });

  // 3. Owner Login — Step 1: Validate Authorized Owner Email & Password -> Send 6-Digit OTP
  const handleOwnerLoginInit = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body || {};

      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }

      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Please enter a valid email address.' });
        return;
      }

      const normalizedEmail = emailCheck.normalizedEmail;
      if (!isEmailAuthorizedOwner(normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      if (!password || typeof password !== 'string') {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const owner = getOwnerAccount();
      if (!owner || owner.email !== normalizedEmail) {
        res.status(401).json({ error: 'Invalid owner credentials.' });
        return;
      }

      const isValid = verifyPassword(password, owner.passwordHash, owner.salt);
      if (!isValid || owner.role !== 'owner') {
        res.status(401).json({ error: 'Invalid owner credentials.' });
        return;
      }

      const otpResult = await issueOwnerOtp({
        purpose: 'owner_login',
        email: normalizedEmail,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        payload: {
          email: owner.email,
          username: owner.username
        },
        subject: 'Zenime Owner Login Verification Code',
        heading: 'Verify Zenime Owner Sign-In',
        description: `Use this 6-digit verification code to complete sign-in to the Zenime Owner account (${owner.username}).`
      });

      res.json({
        success: true,
        requiresVerification: true,
        email: owner.email,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: 'A 6-digit verification code has been sent to your authorized Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({
        error: err.message || 'Internal server error during owner login.',
        code: err.code
      });
    }
  };

  router.post('/login', handleOwnerLoginInit);
  router.post('/login-init', handleOwnerLoginInit);

  // 3b. Owner Login — Step 2: Verify 6-Digit OTP & Establish Owner Session
  router.post('/login-verify', async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body || {};

      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Email address is required.' });
        return;
      }
      if (!isEmailAuthorizedOwner(emailCheck.normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      verifyAndConsumeOwnerOtp({
        purpose: 'owner_login',
        email: emailCheck.normalizedEmail,
        code,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner
      });

      const owner = getOwnerAccount();
      if (!owner || owner.email !== emailCheck.normalizedEmail || owner.role !== 'owner') {
        res.status(401).json({ error: 'Owner account not found or unauthorized.' });
        return;
      }

      const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(
        owner.id || 'usr_owner',
        owner.email,
        owner.username,
        'owner',
        'email',
        sessionExpires
      );
      const sessionData: SessionData = {
        sessionId,
        email: owner.email,
        username: owner.username,
        role: 'owner',
        createdAt: Date.now(),
        expiresAt: sessionExpires
      };

      activeSessions.set(sessionId, sessionData);
      saveSessions();

      setSessionCookie(res, 'anivault_owner_session', sessionId, 2592000, req);

      res.json({
        success: true,
        message: 'Owner login verified.',
        owner: { email: owner.email, username: owner.username, role: owner.role },
        sessionToken: sessionId
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Owner verification failed.',
        code: err.code
      });
    }
  });

  // 3c. Owner Login — Resend 6-Digit OTP
  router.post('/login-resend', async (req: Request, res: Response) => {
    try {
      const { email } = req.body || {};
      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Email address is required.' });
        return;
      }
      if (!isEmailAuthorizedOwner(emailCheck.normalizedEmail)) {
        res.status(403).json({
          error: 'Unauthorised email',
          code: 'UNAUTHORISED_EMAIL'
        });
        return;
      }

      const result = await resendOwnerOtp({
        purpose: 'owner_login',
        email: emailCheck.normalizedEmail,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        subject: 'Zenime Owner Login Verification Code (New Code)',
        heading: 'Verify Zenime Owner Sign-In',
        description: 'A new 6-digit verification code was requested to complete your Zenime Owner login. Any previous code is now invalid.'
      });

      res.json({
        success: true,
        email: result.normalizedEmail,
        cooldownSeconds: result.cooldownSeconds,
        message: 'A new 6-digit verification code has been sent to your Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to resend Owner verification code.',
        code: err.code
      });
    }
  });

  // 4. Logout
  router.post('/logout', authenticateSession, (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-anivault-owner-session'] as string;
    const sessionId = cookies['anivault_owner_session'] || bearerToken || customHeader;

    if (sessionId) {
      revokeOwnerSession(sessionId);
    }

    setSessionCookie(res, 'anivault_owner_session', '', 0, req);

    res.json({ success: true, message: 'Logged out successfully.' });
  });

  // 4b. Delete Owner Account (Strictly deletes/resets ONLY the Owner authentication account and invalidates all Owner sessions)
  const pendingOwnerDeletionGrants = new Map<string, { email: string; sessionId: string; verifiedAt: number; expiresAt: number }>();

  router.post('/delete-account-init', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const owner = getOwnerAccount();
      const session = (req as any).ownerSession;
      if (!owner || !session || !isEmailAuthorizedOwner(owner.email)) {
        res.status(401).json({ error: 'Unauthorized: Valid Owner session required.' });
        return;
      }

      const { password } = req.body || {};
      if (!password || typeof password !== 'string') {
        res.status(400).json({ error: 'Please enter your current Owner password to verify account ownership.' });
        return;
      }

      const passwordValid = verifyPassword(password, owner.passwordHash, owner.salt);
      if (!passwordValid) {
        res.status(401).json({ error: 'Invalid Owner password. Please enter your current Owner password.' });
        return;
      }

      const otpResult = await issueOwnerOtp({
        purpose: 'owner_delete_account',
        email: owner.email,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        payload: {
          email: owner.email,
          username: owner.username,
          sessionId: session.sessionId
        },
        subject: 'Zenime Owner Account Deletion Verification Code',
        heading: 'Verify Zenime Owner Account Deletion',
        description: `Use this 6-digit verification code to confirm deletion of the Zenime Owner authentication account (${owner.username}). Catalogue, artwork, user accounts, and application data will NOT be deleted.`
      });

      res.json({
        success: true,
        requiresVerification: true,
        email: owner.email,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: 'A 6-digit verification code has been sent to your authorized Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to initiate Owner account deletion.',
        code: err.code
      });
    }
  });

  router.post('/delete-account-resend', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const owner = getOwnerAccount();
      if (!owner || !isEmailAuthorizedOwner(owner.email)) {
        res.status(401).json({ error: 'Unauthorized: Valid Owner session required.' });
        return;
      }

      const result = await resendOwnerOtp({
        purpose: 'owner_delete_account',
        email: owner.email,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner,
        subject: 'Zenime Owner Account Deletion Verification Code (New Code)',
        heading: 'Verify Zenime Owner Account Deletion',
        description: `A new 6-digit verification code was requested to confirm deletion of the Zenime Owner authentication account (${owner.username}). Any previous code is now invalid.`
      });

      res.json({
        success: true,
        email: result.normalizedEmail,
        cooldownSeconds: result.cooldownSeconds,
        message: 'A new 6-digit verification code has been sent to your Owner email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to resend verification code.',
        code: err.code
      });
    }
  });

  router.post('/delete-account-verify', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const owner = getOwnerAccount();
      const session = (req as any).ownerSession;
      if (!owner || !session || !isEmailAuthorizedOwner(owner.email)) {
        res.status(401).json({ error: 'Unauthorized: Valid Owner session required.' });
        return;
      }

      const { code } = req.body || {};
      verifyAndConsumeOwnerOtp({
        purpose: 'owner_delete_account',
        email: owner.email,
        code,
        isAuthorizedOwnerEmail: isEmailAuthorizedOwner
      });

      pendingOwnerDeletionGrants.set(owner.email.trim().toLowerCase(), {
        email: owner.email.trim().toLowerCase(),
        sessionId: session.sessionId,
        verifiedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000
      });

      res.json({
        success: true,
        verified: true,
        message: 'Verification code confirmed. Complete the final confirmation step to delete the Owner account.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Invalid verification code.',
        code: err.code
      });
    }
  });

  router.post('/delete-account-confirm', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const owner = getOwnerAccount();
      const session = (req as any).ownerSession;
      if (!owner || !session || !isEmailAuthorizedOwner(owner.email)) {
        res.status(401).json({ error: 'Unauthorized: Valid Owner session required.' });
        return;
      }

      const normalizedOwnerEmail = owner.email.trim().toLowerCase();
      const grant = pendingOwnerDeletionGrants.get(normalizedOwnerEmail);
      if (!grant || grant.sessionId !== session.sessionId || grant.expiresAt < Date.now()) {
        pendingOwnerDeletionGrants.delete(normalizedOwnerEmail);
        res.status(403).json({
          error: 'Owner deletion verification has expired or was not completed. Please verify your password and 6-digit OTP code first.'
        });
        return;
      }

      const { confirmText } = req.body || {};
      const normalizedConfirm = String(confirmText || '').trim().toUpperCase();
      if (normalizedConfirm !== 'DELETE OWNER ACCOUNT' && normalizedConfirm !== 'DELETE') {
        res.status(400).json({
          error: 'Please type DELETE OWNER ACCOUNT to confirm permanent deletion of the Owner account.'
        });
        return;
      }

      // 1. Mark Owner account as explicitly deleted so it is NOT auto-recreated from environment variables
      fs.writeFileSync(
        OWNER_DELETED_STATE_PATH,
        JSON.stringify(
          {
            deleted: true,
            deletedAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf-8'
      );

      // 2. Delete ONLY the Owner account record file and clear in-memory Owner cache
      if (fs.existsSync(OWNER_ACCOUNT_PATH)) {
        try {
          fs.unlinkSync(OWNER_ACCOUNT_PATH);
        } catch {}
      }
      runtimeEnvOwnerCache = null;
      pendingOwnerDeletionGrants.clear();

      // 3. Invalidate ALL active Owner sessions immediately and clear session persistence
      activeSessions.clear();
      saveSessions();
      setSessionCookie(res, 'anivault_owner_session', '', 0, req);

      // 4. Clear any pending Owner OTP records
      const ownerOtpPath = path.join(DATA_DIR, 'zenime-owner-otp.json');
      if (fs.existsSync(ownerOtpPath)) {
        try {
          fs.writeFileSync(ownerOtpPath, '{}', 'utf-8');
        } catch {}
      }

      res.json({
        success: true,
        deleted: true,
        message: 'Owner account deleted and all active Owner sessions invalidated.'
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Failed to delete Owner account.'
      });
    }
  });

  // 5. Get Session Status
  router.get('/session', authenticateSession, (req: Request, res: Response) => {
    const session = (req as any).ownerSession;
    const owner = getOwnerAccount();

    const isOwnerSessionActive = Boolean(
      session &&
      session.role === 'owner' &&
      session.email &&
      owner &&
      owner.email.trim().toLowerCase() === session.email.trim().toLowerCase() &&
      isEmailAuthorizedOwner(session.email)
    );

    const ownerExists = Boolean(owner && owner.email && isEmailAuthorizedOwner(owner.email));

    res.json({
      authenticated: isOwnerSessionActive,
      isAuthorized: isOwnerSessionActive,
      googleEmail: null,
      isGoogleAuthorized: false,
      ownerExists: ownerExists,
      sessionToken: isOwnerSessionActive && session ? session.sessionId : undefined,
      owner: isOwnerSessionActive && owner ? {
        email: owner.email,
        username: owner.username,
        role: 'owner'
      } : null
    });
  });

  // 6. Protected Owner Status Endpoint
  router.get('/status', authenticateSession, requireOwner, (req: Request, res: Response) => {
    const owner = getOwnerAccount();
    res.json({
      status: 'secure',
      owner: {
        email: owner?.email,
        username: owner?.username,
        role: owner?.role,
        createdAt: owner?.createdAt,
        updatedAt: owner?.updatedAt
      },
      activeSessionsCount: activeSessions.size
    });
  });

  // 9. Switch to Owner account (strictly requires an active verified Owner session or valid Owner password)
  router.post('/switch', authenticateSession, async (req: Request, res: Response) => {
    const owner = getOwnerAccount();
    if (!owner) {
      res.status(401).json({
        error: 'Owner authentication required.',
        requireOwnerLogin: true
      });
      return;
    }

    const session = (req as any).ownerSession;
    const { password } = req.body || {};

    // Check if caller already has a valid authenticated server-side Owner session
    const hasValidSession = Boolean(
      session &&
      session.role === 'owner' &&
      session.email?.trim().toLowerCase() === owner.email.trim().toLowerCase() &&
      isEmailAuthorizedOwner(session.email)
    );

    // Or check if valid Owner password was explicitly provided and verified
    let passwordValid = false;
    if (!hasValidSession && password && typeof password === 'string' && owner.passwordHash && owner.salt) {
      passwordValid = verifyPassword(password, owner.passwordHash, owner.salt);
    }

    if (!hasValidSession && !passwordValid) {
      const statusCode = (req as any).isNormalUserRequest && !password ? 403 : 401;
      res.status(statusCode).json({
        error: 'Owner authentication required.',
        requireOwnerLogin: true
      });
      return;
    }

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = (hasValidSession && session.sessionId)
      ? session.sessionId
      : generateSignedSessionToken('usr_owner', owner.email, owner.username, 'owner', 'email', sessionExpires);
    const sessionData: SessionData = {
      sessionId,
      email: owner.email,
      username: owner.username,
      role: 'owner',
      createdAt: hasValidSession && session.createdAt ? session.createdAt : Date.now(),
      expiresAt: sessionExpires
    };

    activeSessions.set(sessionId, sessionData);
    saveSessions();

    setSessionCookie(res, 'anivault_owner_session', sessionId, 2592000, req);
    setSessionCookie(res, 'anivault_user_session', '', 0, req);

    res.json({
      success: true,
      message: 'Switched to Owner account successfully.',
      owner: {
        id: 'usr_owner',
        email: owner.email,
        username: owner.username,
        role: 'owner',
        createdAt: owner.createdAt
      },
      sessionToken: sessionId
    });
  });

  // ==========================================
  // PHASE 5 — OWNER SYSTEM ADMINISTRATION API ENDPOINTS
  // ==========================================

  // 1. Dashboard Overview Stats
  router.get('/admin-stats', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const catalogue: any[] = globalDataStore.getAllCatalogueAnime();

      // Bug reports count
      const bugPath = path.join(process.cwd(), 'server', 'data', 'bug-reports.json');
      let bugReports: any[] = [];
      if (fs.existsSync(bugPath)) {
        bugReports = JSON.parse(fs.readFileSync(bugPath, 'utf-8'));
      }

      // User accounts count
      const userPath = path.join(process.cwd(), 'server', 'data', 'users-accounts.json');
      let users: any = {};
      if (fs.existsSync(userPath)) {
        users = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
      }
      const userCount = Object.keys(users).length;

      // Artwork & Information stats from authoritative stores
      const authoritativeArtStats = computeGlobalCatalogueStats();
      const authoritativeInfoStats = infoManager.computeGlobalStats();
      const workerSnapshot = globalWorkerJobEngine.getSnapshot();

      const verifiedArtwork = authoritativeArtStats.verified;
      const unverifiedArtwork = authoritativeArtStats.unverified;
      const missingArtwork = authoritativeArtStats.missing;
      const needsReviewArtwork = authoritativeArtStats.needsReview;

      // Audit logs (recent activities)
      const auditLogs = loadAuditLogs();

      // Last Sync Timestamp
      const statsPath = path.join(process.cwd(), 'server', 'data', 'sync-report.json');
      let lastSync = 'Never';
      if (fs.existsSync(statsPath)) {
        try {
          const syncRep = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
          if (syncRep.lastSync) {
            lastSync = new Date(syncRep.lastSync).toLocaleString();
          }
        } catch {
          // quiet catch
        }
      }

      const owner = getOwnerAccount();

      res.json({
        success: true,
        owner: owner ? {
          id: owner.id || 'usr_owner',
          email: owner.email,
          username: owner.username || 'Death197',
          role: 'owner'
        } : {
          id: 'usr_owner',
          email: 'makerapp688@gmail.com',
          username: 'Death197',
          role: 'owner'
        },
        catalogueCount: catalogue.length,
        totalSeasons: authoritativeInfoStats.totalSeasons,
        totalAuthoritativeEpisodes: authoritativeInfoStats.totalAuthoritativeEpisodes,
        totalImportedEpisodes: authoritativeInfoStats.totalImportedEpisodes,
        userCount,
        bugReportsCount: bugReports.length,
        newBugReportsCount: bugReports.filter(r => r.status === 'New').length,
        artworkStats: {
          verified: verifiedArtwork,
          needsReview: needsReviewArtwork,
          unverified: unverifiedArtwork,
          missing: missingArtwork,
          total: catalogue.length
        },
        infoStats: authoritativeInfoStats,
        workerStates: {
          status: workerSnapshot.status,
          workerCount: workerSnapshot.workerCount,
          architectureCapacity: workerSnapshot.architectureCapacity,
          totalTasks: workerSnapshot.totalTasks,
          queuedCount: workerSnapshot.queuedCount,
          claimedCount: workerSnapshot.claimedCount,
          retryingCount: workerSnapshot.retryingCount,
          completedCount: workerSnapshot.completedCount,
          failedCount: workerSnapshot.failedCount,
          processedCount: workerSnapshot.processedCount
        },
        recentActivity: auditLogs.slice(0, 20),
        systemHealth: 'Healthy',
        lastSync
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch administrative stats.' });
    }
  });

  // 2. User Management: List All Accounts
  router.get('/users', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const userPath = path.join(process.cwd(), 'server', 'data', 'users-accounts.json');
      let users: Record<string, any> = {};
      if (fs.existsSync(userPath)) {
        users = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
      }

      const sanitizedUsers = Object.values(users).map(u => ({
        id: u.id,
        email: u.email,
        username: u.username,
        name: u.name,
        avatar: u.avatar,
        provider: u.provider,
        role: u.role,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        lastLoginAt: u.lastLoginAt,
        disabled: u.disabled || false
      }));

      res.json({ success: true, users: sanitizedUsers });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list users.' });
    }
  });

  // 3. User Management: Toggle Account Access
  router.post('/users/:id/toggle-access', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userPath = path.join(process.cwd(), 'server', 'data', 'users-accounts.json');
      let users: Record<string, any> = {};
      if (fs.existsSync(userPath)) {
        users = JSON.parse(fs.readFileSync(userPath, 'utf-8'));
      }

      const user = users[id];
      if (!user) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (user.role === 'owner' || id === 'usr_owner') {
        res.status(403).json({ error: 'Cannot modify access status of the Owner account.' });
        return;
      }

      user.disabled = !user.disabled;
      user.updatedAt = new Date().toISOString();
      users[id] = user;

      fs.writeFileSync(userPath, JSON.stringify(users, null, 2), 'utf-8');

      logAdminAction(
        `Toggle user access to ${user.disabled ? 'DISABLED' : 'ENABLED'}`,
        (req as any).ownerSession.email,
        'success',
        id,
        `User: ${user.username} (${user.email})`
      );

      res.json({ success: true, disabled: user.disabled, message: `User account has been ${user.disabled ? 'disabled' : 'enabled'}.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to toggle user access.' });
    }
  });

  // 4. Audit Logs Retrieval
  router.get('/audit-logs', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const logs = loadAuditLogs();
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
  });

  // 5. Catalogue Edit Endpoint
  router.post('/catalogue/:id/update', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updatedData = req.body || {};

      const existing = globalDataStore.getCatalogueAnime(id);
      if (!existing) {
        res.status(404).json({ error: `Anime with ID '${id}' not found.` });
        return;
      }

      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.applyMetadataUpdate(
        id,
        updatedData,
        email,
        'Updated via Owner Catalogue Editor',
        'Owner Catalogue Editor',
        'verified'
      );

      if (!result.success) {
        res.status(400).json({ error: result.error || 'Failed to update anime record.' });
        return;
      }

      res.json({ success: true, message: 'Anime updated successfully.', anime: result.anime });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update anime record.' });
    }
  });

  // 6. Catalogue Delete Endpoint
  router.post('/catalogue/:id/delete', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = globalDataStore.getCatalogueAnime(id);
      if (!existing) {
        res.status(404).json({ error: `Anime with ID '${id}' not found.` });
        return;
      }

      const deletedTitle = existing.title;
      const ok = globalDataStore.deleteCatalogueAnime(id);
      if (!ok) {
        res.status(500).json({ error: 'Failed to delete anime record.' });
        return;
      }
      globalDataStore.flushCatalogueSync();

      logAdminAction(
        `Delete Anime: "${deletedTitle}"`,
        (req as any).ownerSession.email,
        'success',
        id,
        `Permanently deleted title from catalogue.`
      );

      res.json({ success: true, message: 'Anime deleted successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete anime record.' });
    }
  });

  // 7. Artwork Management: Replace/Update Artwork URL
  router.post('/artwork/:id/update', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { verifiedArtworkUrl, verificationStatus } = req.body;
      const email = (req as any).ownerSession?.email || 'Owner';

      const anime = globalDataStore.getCatalogueAnime(id);
      if (!anime) {
        res.status(404).json({ error: `Anime with ID '${id}' not found.` });
        return;
      }

      const targetUrl = verifiedArtworkUrl !== undefined ? String(verifiedArtworkUrl).trim() : (anime.artwork?.verifiedArtworkUrl || '');
      const targetStatus = verificationStatus === 'verified' ? 'verified' : 'unverified';

      if (targetStatus === 'verified') {
        if (!targetUrl || isPlaceholderArtworkUrl(targetUrl)) {
          res.status(400).json({ error: 'Cannot mark placeholder or empty URL as verified artwork.' });
          return;
        }
        const check = await inspectArtworkImage(targetUrl, true);
        if (!check.usable || check.isBlankOrPlaceholder) {
          res.status(400).json({ error: `Artwork URL validation failed: ${check.error || 'Unreachable or invalid image response'}` });
          return;
        }
      }

      const prevUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;
      globalDataStore.applyCatalogueArtworkUpdate(
        id,
        targetUrl,
        targetStatus,
        prevUrl,
        'manual_owner',
        undefined,
        `Manual artwork update by Owner (${email})`,
        email
      );
      globalDataStore.flushCatalogueSync();

      const updatedAnime = globalDataStore.getCatalogueAnime(id);

      logAdminAction(
        `Update Artwork for "${anime.title}"`,
        email,
        'success',
        id,
        `Artwork updated. Verified URL: "${targetUrl}". Verification Status: ${targetStatus}`
      );

      res.json({ success: true, message: 'Artwork updated successfully.', anime: updatedAnime });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update artwork.' });
    }
  });

  // ==========================================
  // ARTWORK MANAGER (Owner-Only Automated Catalogue Verification Engine)
  // ==========================================

  // 1. Dashboard summary stats & current state
  router.get('/artwork-manager/dashboard', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const stats = computeGlobalCatalogueStats();
      const scanState = artworkScanner.getJobState();
      const sources = getArtworkSourcesConfig();
      const watchOrderSources = getWatchOrderSourcesConfig();
      const watchOrderRecords = Object.values(loadWatchOrderRecords());

      res.json({
        success: true,
        totalAnime: stats.total,
        scanState,
        sources,
        watchOrderSources,
        watchOrderRecords,
        stats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load Artwork Manager dashboard.' });
    }
  });

  // 2. Paginated catalogue anime list with verification metadata
  router.get('/artwork-manager/anime', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const catalogue: any[] = globalDataStore.getAllCatalogueAnime();
      const records = loadVerificationRecords();
      const fakeIssues = loadFakeAnimeIssues();
      const fakeMap = new Map(fakeIssues.map(f => [f.catalogueId, f]));

      const { search, status, page = '1', limit = '40' } = req.query;
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 40));

      let list = catalogue.map(anime => {
        const rec = records[anime.id];
        const fakeIssue = fakeMap.get(anime.id);
        const rawUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;
        const isMissing = isPlaceholderArtworkUrl(rawUrl);

        let computedStatus = 'unverified';
        if (fakeIssue && fakeIssue.status === 'active') {
          computedStatus = 'possible_fake';
        } else if (isMissing) {
          computedStatus = rec?.status === 'needs_review' || rec?.status === 'unable_to_verify' ? rec.status : 'missing';
        } else if (rec) {
          computedStatus = rec.status;
        } else if (anime.artwork?.verificationStatus === 'verified') {
          computedStatus = 'verified';
        }

        return {
          id: anime.id,
          title: anime.title,
          alternateTitle: anime.alternateTitle || null,
          releaseYear: anime.releaseYear || null,
          type: anime.type || 'TV',
          currentArtworkUrl: isMissing ? null : rawUrl,
          hasMissingArtwork: isMissing,
          source: rec?.source || anime.artwork?.verificationSource || anime.provider || 'RareToon India',
          verificationStatus: computedStatus,
          confidence: rec?.confidence ? Math.round(rec.confidence * 100) : (computedStatus === 'verified' ? 95 : 0),
          dimensions: rec?.dimensions || 'HD (3:4)',
          lastVerifiedAt: rec?.lastVerifiedAt || null,
          issue: rec?.issue || (fakeIssue ? fakeIssue.reason : (isMissing ? 'Missing or placeholder artwork' : null)),
          candidates: rec?.candidates || [],
          evidence: rec?.evidence || fakeIssue?.evidence || [],
          sourcesChecked: Array.isArray(rec?.sourcesChecked) && rec.sourcesChecked.length > 0
            ? rec.sourcesChecked
            : (rec ? ['AniList', 'TVmaze', 'TheTVDB'] : []),
          attempts: typeof rec?.attempts === 'number' ? rec.attempts : (rec ? 1 : 0),
          retries: typeof rec?.retries === 'number' ? rec.retries : 0,
          seasonsCount: Array.isArray(anime.seasons) ? anime.seasons.length : 1,
          seasonResults: rec?.seasonResults || null,
          aniListMatch: rec?.aniListMatch || null,
          jikanMatch: rec?.jikanMatch || null,
          providerUrl: anime.providers?.raretoonIndia?.canonicalUrl || null
        };
      });

      // Filter by search query
      if (typeof search === 'string' && search.trim()) {
        const q = search.trim().toLowerCase();
        list = list.filter(a => a.title.toLowerCase().includes(q) || (a.alternateTitle && a.alternateTitle.toLowerCase().includes(q)));
      }

      // Filter by status (matching authoritative counters in computeGlobalCatalogueStats)
      if (typeof status === 'string' && status !== 'all') {
        if (status === 'missing') {
          list = list.filter(a => a.hasMissingArtwork);
        } else if (status === 'verified') {
          list = list.filter(a => !a.hasMissingArtwork && (a.verificationStatus === 'verified' || a.verificationStatus === 'auto_fixed'));
        } else if (status === 'unverified') {
          list = list.filter(a => a.verificationStatus === 'unverified' || a.verificationStatus === 'missing');
        } else {
          list = list.filter(a => a.verificationStatus === status);
        }
      }

      const total = list.length;
      const totalPages = Math.ceil(total / limitNum) || 1;
      const offset = (pageNum - 1) * limitNum;
      const paginated = list.slice(offset, offset + limitNum);

      res.json({
        success: true,
        anime: paginated,
        total,
        page: pageNum,
        totalPages,
        limit: limitNum
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list anime for Artwork Manager.' });
    }
  });

  // 3. Start full catalogue verification (Verify All, Verify Unverified, or Fix Missing)
  router.post('/artwork-manager/start', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const mode = (req.body?.mode === 'unverified' ? 'unverified' : req.body?.mode === 'fix_missing' ? 'fix_missing' : 'all') as 'all' | 'unverified' | 'fix_missing';
      const limit = req.body?.limit ? parseInt(String(req.body.limit), 10) : undefined;
      const result = artworkScanner.startScan(email, mode, limit);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to start artwork verification.' });
    }
  });

  // 3b. Inspect All catalogue (Non-destructive inspection)
  router.post('/artwork-manager/inspect-all', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const report = await artworkScanner.inspectAll();
      res.json({ success: true, report });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to inspect catalogue.' });
    }
  });

  // 4. Pause active verification scan
  router.post('/artwork-manager/pause', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.pauseScan(email);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to pause verification.' });
    }
  });

  // 5. Resume paused scan
  router.post('/artwork-manager/resume', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.resumeScan(email);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resume verification.' });
    }
  });

  // 6. Stop active scan
  router.post('/artwork-manager/stop', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.stopScan(email);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to stop verification.' });
    }
  });

  // 7. Reset scan progress to 0
  router.post('/artwork-manager/reset', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.resetScan(email);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to reset verification state.' });
    }
  });

  // 8. Get live scanner status and metrics
  router.get('/artwork-manager/status', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const state = artworkScanner.getJobState();
      res.json({ success: true, state, job: state, stats: state.globalStats });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get scanner status.' });
    }
  });

  // 8b. Live Server-Sent Events (SSE) stream for real-time worker & progress telemetry
  router.get('/artwork-manager/stream', authenticateSession, requireOwner, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    let closed = false;
    let lastSentMs = 0;
    let pendingTimer: NodeJS.Timeout | null = null;

    const pushSnapshot = () => {
      if (closed) return;
      try {
        lastSentMs = Date.now();
        const state = artworkScanner.getJobState();
        res.write(`data: ${JSON.stringify({ state, stats: state.globalStats })}\n\n`);
      } catch {}
    };

    // Send initial authoritative snapshot immediately
    pushSnapshot();

    const unsubscribe = globalWorkerJobEngine.onStateChange(() => {
      if (closed) return;
      const now = Date.now();
      const elapsed = now - lastSentMs;
      if (elapsed >= 150) {
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        pushSnapshot();
      } else if (!pendingTimer) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          pushSnapshot();
        }, 150 - elapsed);
      }
    });

    const heartbeatInterval = setInterval(() => {
      if (closed) return;
      pushSnapshot();
    }, 1000);

    req.on('close', () => {
      closed = true;
      unsubscribe();
      clearInterval(heartbeatInterval);
      if (pendingTimer) clearTimeout(pendingTimer);
    });
  });

  // 9. Single-anime re-verification via real shared backend worker queue
  router.post('/artwork-manager/verify-single/:id', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const anime = globalDataStore.getCatalogueAnime(id);

      if (!anime) {
        res.status(404).json({ error: `Anime '${id}' not found.` });
        return;
      }

      const email = (req as any).ownerSession?.email || 'Owner';
      const taskId = createDeterministicTaskId('RETRY_VERIFICATION', id);
      artworkScanner.enqueueReverification([id], email);

      // Wait for the coordinated worker pool to finish this specific task (up to 10s)
      const startWait = Date.now();
      while (Date.now() - startWait < 10000) {
        const snap = globalWorkerJobEngine.getSnapshot();
        const stillClaimed = snap.activeWorkers.some(w => w.currentTaskId === taskId || w.currentAnimeId === id);
        const stillLocked = snap.activeAnimeLocks.some(l => l.animeId === id);
        if (!stillClaimed && !stillLocked && (snap.completedCount > 0 || snap.failedCount > 0 || snap.status === 'completed')) {
          break;
        }
        await new Promise(r => setTimeout(r, 80));
      }

      const record = globalDataStore.getVerificationRecord(id);
      const updatedAnime = globalDataStore.getCatalogueAnime(id);
      const state = artworkScanner.getJobState();

      res.json({
        success: true,
        result: record || {
          animeId: id,
          animeTitle: anime.title,
          status: updatedAnime?.artwork?.verificationStatus || 'needs_review',
          confidence: 0.9,
          currentArtworkUrl: updatedAnime?.artwork?.verifiedArtworkUrl || updatedAnime?.artwork?.originalArtworkUrl || null,
          issue: null,
          candidates: [],
          evidence: []
        },
        stats: state.globalStats,
        scanState: state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to verify single anime entry.' });
    }
  });

  // 10. Apply candidate artwork from Needs Review / Inspect Drawer
  router.post('/artwork-manager/anime/:id/apply-candidate', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { candidateUrl, source = 'manual_review' } = req.body;

      if (!candidateUrl || typeof candidateUrl !== 'string') {
        res.status(400).json({ error: 'candidateUrl is required.' });
        return;
      }

      const cleanUrl = candidateUrl.trim();
      const inspection = await inspectArtworkImage(cleanUrl);
      if (!inspection.usable || inspection.isBlankOrPlaceholder) {
        res.status(400).json({ error: `Candidate image is unreachable or invalid (${inspection.error || 'failed validation'}).` });
        return;
      }

      const email = (req as any).ownerSession?.email || 'Owner';
      const success = applyArtworkUpdate(id, cleanUrl, 'verified', null, source);

      if (!success) {
        res.status(500).json({ error: 'Failed to apply replacement artwork.' });
        return;
      }

      const anime = globalDataStore.getCatalogueAnime(id);
      const records = loadVerificationRecords();
      records[id] = {
        ...(records[id] || {}),
        animeId: id,
        animeTitle: anime?.title || records[id]?.animeTitle || id,
        status: 'verified',
        confidence: 1.0,
        currentArtworkUrl: cleanUrl,
        replacedArtworkUrl: cleanUrl,
        source,
        issue: null,
        lastVerifiedAt: new Date().toISOString(),
        candidates: records[id]?.candidates || [],
        evidence: [...(records[id]?.evidence || []), `Candidate artwork from ${source} validated and applied by Owner (${email})`]
      };
      saveVerificationRecords(records);

      globalDataStore.flushCatalogueSync();
      globalDataStore.flushRecordsSync();

      globalWorkerJobEngine.resolveManualAnimeAction(
        id,
        anime?.title || id,
        'Choose Replacement',
        `Applied validated candidate artwork from ${source}`
      );

      logAdminAction(
        `Apply Candidate Artwork for ${id}`,
        email,
        'success',
        id,
        `Applied replacement artwork from ${source}: ${cleanUrl}`
      );

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: 'Candidate artwork applied and marked verified.',
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to apply candidate artwork.' });
    }
  });

  // Configure worker pool capacity (1 to 50 workers)
  router.post('/artwork-manager/pool-config', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { currentWorkers, concurrencyLimit } = req.body;
      const email = (req as any).ownerSession?.email || 'Owner';

      const updated = globalWorkerJobEngine.setWorkerPoolConfig({
        currentWorkers: typeof currentWorkers === 'number' ? currentWorkers : undefined,
        concurrencyLimit: typeof concurrencyLimit === 'number' ? concurrencyLimit : undefined
      });

      logAdminAction(
        'Update Worker Pool Config',
        email,
        'success',
        undefined,
        `Set worker pool config to ${updated.currentWorkers} active workers.`
      );

      res.json({
        success: true,
        message: `Worker pool updated to ${updated.currentWorkers} active workers (max 50).`,
        poolConfig: updated,
        scanState: artworkScanner.getJobState()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update pool config.' });
    }
  });

  // --- NEEDS REVIEW WORKSPACE ENDPOINTS ---

  // Action 1: Re-verify (Queue high-priority worker task)
  router.post('/artwork-manager/needs-review/reverify', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { animeIds } = req.body;
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        res.status(400).json({ error: 'animeIds array is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      artworkScanner.enqueueReverification(animeIds, email);

      if (animeIds.length <= 10) {
        const startWait = Date.now();
        while (Date.now() - startWait < 10000) {
          const snap = globalWorkerJobEngine.getSnapshot();
          const stillActive = animeIds.some(id =>
            snap.activeWorkers.some(w => w.currentAnimeId === id) ||
            snap.activeAnimeLocks.some(l => l.animeId === id)
          );
          if (!stillActive && snap.queuedCount === 0) break;
          await new Promise(r => setTimeout(r, 60));
        }
      }

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Processed ${animeIds.length} items via high-priority worker re-verification.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to enqueue re-verification.' });
    }
  });

  // Action 2: Search Again (Enqueue high-priority worker task)
  router.post('/artwork-manager/needs-review/search-again', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { animeIds } = req.body;
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        res.status(400).json({ error: 'animeIds array is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      artworkScanner.enqueueSearchAgain(animeIds, email);

      if (animeIds.length <= 10) {
        const startWait = Date.now();
        while (Date.now() - startWait < 10000) {
          const snap = globalWorkerJobEngine.getSnapshot();
          const stillActive = animeIds.some(id =>
            snap.activeWorkers.some(w => w.currentAnimeId === id) ||
            snap.activeAnimeLocks.some(l => l.animeId === id)
          );
          if (!stillActive && snap.queuedCount === 0) break;
          await new Promise(r => setTimeout(r, 60));
        }
      }

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Processed ${animeIds.length} items via worker search again.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to perform search again.' });
    }
  });

  // Action 3: Fix Artwork (Enqueue high-priority worker task)
  router.post('/artwork-manager/needs-review/fix-artwork', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { animeIds } = req.body;
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        res.status(400).json({ error: 'animeIds array is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      artworkScanner.enqueueFixArtwork(animeIds, email);

      if (animeIds.length <= 10) {
        const startWait = Date.now();
        while (Date.now() - startWait < 10000) {
          const snap = globalWorkerJobEngine.getSnapshot();
          const stillActive = animeIds.some(id =>
            snap.activeWorkers.some(w => w.currentAnimeId === id) ||
            snap.activeAnimeLocks.some(l => l.animeId === id)
          );
          if (!stillActive && snap.queuedCount === 0) break;
          await new Promise(r => setTimeout(r, 60));
        }
      }

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Processed ${animeIds.length} items via worker artwork fix.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fix artwork.' });
    }
  });

  // Action 3B: Retry All Needs Review
  router.post('/artwork-manager/needs-review/retry-all', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.enqueueRetryAllNeedsReview(email);

      res.json({
        success: result.success,
        message: result.message,
        count: result.count,
        stats: computeGlobalCatalogueStats(),
        scanState: result.scanState || artworkScanner.getJobState()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retry all unresolved records.' });
    }
  });

  // Action 3C: Search All Needs Review
  router.post('/artwork-manager/needs-review/search-all', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = artworkScanner.enqueueSearchAllNeedsReview(email);

      res.json({
        success: result.success,
        message: result.message,
        count: result.count,
        stats: computeGlobalCatalogueStats(),
        scanState: result.scanState || artworkScanner.getJobState()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to search all unresolved records.' });
    }
  });

  // Action 4: Approve Current Artwork
  router.post('/artwork-manager/needs-review/approve-current', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { animeIds } = req.body;
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        res.status(400).json({ error: 'animeIds array is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      const records = loadVerificationRecords();

      for (const id of animeIds) {
        const anime = globalDataStore.getCatalogueAnime(id);
        let artUrl = anime?.artwork?.verifiedArtworkUrl || anime?.artwork?.originalArtworkUrl || null;

        // Placeholders or missing URLs must NEVER count as Verified
        if (isPlaceholderArtworkUrl(artUrl)) {
          const topCand = records[id]?.candidates?.find((c: any) => c.imageUrl && !isPlaceholderArtworkUrl(c.imageUrl));
          if (topCand?.imageUrl) {
            const insp = await inspectArtworkImage(topCand.imageUrl);
            if (insp.usable && !insp.isBlankOrPlaceholder) {
              applyArtworkUpdate(id, topCand.imageUrl, 'verified', artUrl, topCand.source || 'owner_approval');
              artUrl = topCand.imageUrl;
            }
          }
        }

        if (isPlaceholderArtworkUrl(artUrl)) {
          res.status(400).json({
            error: `Cannot approve "${anime?.title || id}" as Verified because its artwork is missing or a placeholder. Use Fix Artwork or Choose Replacement first.`
          });
          return;
        }

        const checkArt = await inspectArtworkImage(artUrl);
        if (!checkArt.usable || checkArt.isBlankOrPlaceholder) {
          res.status(400).json({
            error: `Cannot approve "${anime?.title || id}" as Verified because its artwork URL is unreachable or invalid (${checkArt.error || 'failed validation'}).`
          });
          return;
        }

        markCatalogueAnimeVerified(id, 'verified');

        records[id] = {
          animeId: id,
          animeTitle: anime?.title || id,
          status: 'verified',
          confidence: 1.0,
          currentArtworkUrl: artUrl,
          source: 'owner_approval',
          issue: null,
          lastVerifiedAt: new Date().toISOString(),
          candidates: records[id]?.candidates || [],
          evidence: [...(records[id]?.evidence || []), `Approved by Owner (${email}) on ${new Date().toLocaleDateString()}`]
        };

        globalWorkerJobEngine.resolveManualAnimeAction(
          id,
          anime?.title || id,
          'Approve Current',
          `Owner approved current artwork for "${anime?.title || id}"`
        );
      }

      saveVerificationRecords(records);
      globalDataStore.flushCatalogueSync();
      globalDataStore.flushRecordsSync();

      logAdminAction(
        'Approve Current Artwork',
        email,
        'success',
        undefined,
        `Approved current artwork for ${animeIds.length} items.`
      );

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Approved current artwork for ${animeIds.length} items.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to approve current artwork.' });
    }
  });

  // Action 5: Choose Replacement Candidate
  router.post('/artwork-manager/needs-review/choose-replacement', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { animeId, selectedCandidateUrl, source = 'owner_choice' } = req.body;
      if (!animeId || !selectedCandidateUrl) {
        res.status(400).json({ error: 'animeId and selectedCandidateUrl are required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      const cleanUrl = selectedCandidateUrl.trim();

      const inspection = await inspectArtworkImage(cleanUrl);
      if (!inspection.usable || inspection.isBlankOrPlaceholder) {
        res.status(400).json({ error: `Selected candidate artwork is unreachable or invalid (${inspection.error || 'failed validation'}).` });
        return;
      }

      applyArtworkUpdate(animeId, cleanUrl, 'verified', null, source);

      const anime = globalDataStore.getCatalogueAnime(animeId);
      const records = loadVerificationRecords();
      const current = records[animeId] || {};
      records[animeId] = {
        ...current,
        animeId,
        animeTitle: anime?.title || current.animeTitle || animeId,
        status: 'verified',
        confidence: 1.0,
        currentArtworkUrl: cleanUrl,
        replacedArtworkUrl: cleanUrl,
        source,
        issue: null,
        lastVerifiedAt: new Date().toISOString(),
        evidence: [...(current.evidence || []), `Manually chosen replacement artwork from ${source} by Owner (${email})`]
      };

      saveVerificationRecords(records);
      globalDataStore.flushCatalogueSync();
      globalDataStore.flushRecordsSync();

      globalWorkerJobEngine.resolveManualAnimeAction(
        animeId,
        anime?.title || animeId,
        'Choose Replacement',
        `Owner selected verified replacement artwork from ${source}`
      );

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: 'Replacement artwork applied and marked verified.',
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to choose replacement artwork.' });
    }
  });

  // Action 6: Mark Unable to Verify (Preserves issue history without endless retries)
  router.post('/artwork-manager/needs-review/mark-unable', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { animeIds } = req.body;
      if (!Array.isArray(animeIds) || animeIds.length === 0) {
        res.status(400).json({ error: 'animeIds array is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      const records = loadVerificationRecords();

      for (const id of animeIds) {
        const anime = globalDataStore.getCatalogueAnime(id);
        const current = records[id] || {};
        markCatalogueAnimeVerified(id, 'unable_to_verify');
        records[id] = {
          ...current,
          animeId: id,
          animeTitle: anime?.title || current.animeTitle || id,
          status: 'unable_to_verify',
          confidence: 0,
          currentArtworkUrl: current.currentArtworkUrl || anime?.artwork?.verifiedArtworkUrl || anime?.artwork?.originalArtworkUrl || null,
          source: current.source || 'none',
          issue: 'Marked unable to verify by Owner',
          lastVerifiedAt: new Date().toISOString(),
          evidence: [...(current.evidence || []), `Marked unable to verify by Owner (${email})`]
        };

        globalWorkerJobEngine.resolveManualAnimeAction(
          id,
          anime?.title || id,
          'Mark Unable to Verify',
          `Owner marked "${anime?.title || id}" as Unable to Verify`
        );
      }

      saveVerificationRecords(records);
      globalDataStore.flushCatalogueSync();
      globalDataStore.flushRecordsSync();

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Marked ${animeIds.length} items as Unable to Verify.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to mark items as unable to verify.' });
    }
  });

  // 11. Revert auto-fixed artwork to previous backup
  router.post('/artwork-manager/anime/:id/revert', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = revertArtwork(id);

      if (result.success) {
        logAdminAction(
          `Revert Artwork for ${id}`,
          email,
          'success',
          id,
          result.message
        );
        const scanState = artworkScanner.getJobState();
        res.json({
          ...result,
          stats: scanState.globalStats,
          scanState
        });
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to revert artwork.' });
    }
  });

  // 12. Manually mark anime verification status
  router.post('/artwork-manager/anime/:id/mark-status', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const email = (req as any).ownerSession?.email || 'Owner';

      if (!['verified', 'needs_review', 'unverified'].includes(status)) {
        res.status(400).json({ error: 'Invalid status.' });
        return;
      }

      markCatalogueAnimeVerified(id, status);

      const records = loadVerificationRecords();
      if (records[id]) {
        records[id].status = status as any;
        records[id].issue = status === 'verified' ? null : records[id].issue;
        records[id].lastVerifiedAt = new Date().toISOString();
        saveVerificationRecords(records);
      }

      logAdminAction(
        `Mark Status ${status} for ${id}`,
        email,
        'success',
        id,
        `Manually updated verification status to '${status}'.`
      );

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Status updated to ${status}.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update status.' });
    }
  });

  // 13. Possible Fake Anime Issues list
  router.get('/artwork-manager/fake-issues', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const issues = loadFakeAnimeIssues();
      res.json({ success: true, issues });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load fake anime issues.' });
    }
  });

  // 14. Resolve/Dismiss Possible Fake Anime Issue
  router.post('/artwork-manager/fake-issues/:id/resolve', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body; // 'dismiss' | 'manual_verified'
      const email = (req as any).ownerSession?.email || 'Owner';

      const issues = loadFakeAnimeIssues();
      const issue = issues.find(i => i.id === id || i.catalogueId === id);

      if (!issue) {
        res.status(404).json({ error: 'Fake anime issue not found.' });
        return;
      }

      issue.status = action === 'manual_verified' ? 'manual_verified' : 'dismissed';
      saveFakeAnimeIssues(issues);

      if (action === 'manual_verified') {
        markCatalogueAnimeVerified(issue.catalogueId, 'verified');
        const records = loadVerificationRecords();
        if (records[issue.catalogueId]) {
          records[issue.catalogueId].status = 'verified';
          records[issue.catalogueId].issue = 'Manually verified by Owner.';
          saveVerificationRecords(records);
        }
      }

      logAdminAction(
        `Resolve Fake Anime Issue (${action})`,
        email,
        'success',
        issue.catalogueId,
        `Resolved fake anime issue '${id}' with action: ${action}.`
      );

      const scanState = artworkScanner.getJobState();
      res.json({
        success: true,
        message: `Issue resolved as ${action}.`,
        stats: scanState.globalStats,
        scanState
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve fake anime issue.' });
    }
  });

  // 15. Artwork History & Backup Audit Log
  router.get('/artwork-manager/history', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const history = loadArtworkHistory();
      res.json({ success: true, history });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load artwork history.' });
    }
  });

  // 16. Artwork Source Configuration (Owner-only)
  router.get('/artwork-manager/sources', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const sources = getArtworkSourcesConfig();
      res.json({ success: true, sources });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get artwork sources.' });
    }
  });

  // 17. Update Artwork Sources Configuration
  router.post('/artwork-manager/sources', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { sources } = req.body;
      if (!Array.isArray(sources)) {
        res.status(400).json({ error: 'sources must be an array.' });
        return;
      }

      saveArtworkSourcesConfig(sources);
      const email = (req as any).ownerSession?.email || 'Owner';
      logAdminAction(
        'Update Artwork Sources Configuration',
        email,
        'success',
        undefined,
        `Updated configuration for ${sources.length} artwork sources.`
      );

      res.json({ success: true, message: 'Artwork sources configuration updated successfully.', sources });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update artwork sources.' });
    }
  });

  // 18. Test Source Connectivity
  router.post('/artwork-manager/sources/:id/test', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await testSourceConnectivity(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to test source connectivity.' });
    }
  });

  // ==========================================
  // WATCH ORDER SOURCES SYSTEM (Separate from Artwork Verification)
  // ==========================================

  // 19. Get Watch Order Sources & Stored Franchise Watch-Order Records
  router.get('/artwork-manager/watch-order/sources', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const sources = getWatchOrderSourcesConfig();
      const recordsMap = loadWatchOrderRecords();
      const records = Object.values(recordsMap).sort((a, b) =>
        (b.lastCheckedAt || '').localeCompare(a.lastCheckedAt || '')
      );
      res.json({ success: true, sources, records });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load watch order sources.' });
    }
  });

  // 20. Test Watch Order Source Connectivity (Real live test for Watchordr & The Anime Order)
  router.post('/artwork-manager/watch-order/sources/:id/test', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await testWatchOrderSourceConnectivity(id);
      const sources = getWatchOrderSourcesConfig();
      res.json({ ...result, sources });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to test watch order source connectivity.' });
    }
  });

  // 21. Resolve & Compare Franchise Watch Order from Watchordr & The Anime Order (Read-only on catalogue)
  router.post('/artwork-manager/watch-order/resolve', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { query, queries } = req.body || {};
      const email = (req as any).ownerSession?.email || 'Death197';

      if (Array.isArray(queries) && queries.length > 0) {
        const results = [];
        for (const q of queries) {
          if (typeof q === 'string' && q.trim()) {
            const rec = await resolveAndCompareFranchiseWatchOrder(q.trim());
            results.push(rec);
          }
        }
        logAdminAction(
          `Batch Watch Order Check (${results.length} franchises)`,
          email,
          'success',
          undefined,
          `Compared Watchordr & The Anime Order for: ${queries.join(', ')}`
        );
        const records = Object.values(loadWatchOrderRecords());
        const sources = getWatchOrderSourcesConfig();
        res.json({ success: true, results, records, sources });
        return;
      }

      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'Franchise title query is required.' });
        return;
      }

      const record = await resolveAndCompareFranchiseWatchOrder(query.trim());
      logAdminAction(
        `Check Watch Order: "${record.canonicalTitle}"`,
        email,
        'success',
        record.id,
        `Status: ${record.confidenceLabel} (${record.confidenceScore}%). Watchordr: ${record.watchordr.entries.length} entries, The Anime Order: ${record.theAnimeOrder.entries.length} entries.`
      );

      const records = Object.values(loadWatchOrderRecords());
      const sources = getWatchOrderSourcesConfig();
      res.json({ success: true, record, records, sources });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve franchise watch order.' });
    }
  });

  // 22. Validate & Apply Watch Order to Catalogue (Only modifies catalogue after Owner validation)
  router.post('/artwork-manager/watch-order/validate', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { franchiseKey, sourceChoice = 'consensus' } = req.body || {};
      if (!franchiseKey) {
        res.status(400).json({ error: 'franchiseKey is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Death197';
      const result = validateAndApplyWatchOrder(franchiseKey, sourceChoice, email);
      if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
      }

      logAdminAction(
        `Validate Watch Order: "${result.record?.canonicalTitle}"`,
        email,
        'success',
        result.record?.id,
        `${result.message}`
      );

      const records = Object.values(loadWatchOrderRecords());
      res.json({
        success: true,
        message: result.message,
        record: result.record,
        records
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to validate watch order.' });
    }
  });

  // 8. System Environment Settings Diagnostics (Strictly no secret credentials exposed)
  router.get('/settings-diagnostics', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const emailConfig = getEmailConfigStatus();
      const secretsDiag = checkServerSecretsDiagnostic();

      res.json({
        success: true,
        env: {
          NODE_ENV: process.env.NODE_ENV || 'development',
          PORT: 3000,
          hasSessionSecret: Boolean(process.env.SESSION_SECRET)
        },
        emailService: {
          configured: emailConfig.configured,
          missing: emailConfig.missing,
          secrets: secretsDiag
        },
        security: {
          rateLimitStatus: 'Enabled (100 requests per 15 mins)',
          sessionExpiration: '30 Days (Persistent Owner Session)',
          cookieSameSite: 'Lax',
          cookieHttpOnly: true,
          cookieSecure: process.env.NODE_ENV === 'production',
          protectedEndpoints: [
            '/api/owner/*',
            '/api/owner/source-package/download',
            '/api/bug-reports/owner/*',
            '/api/auth/session',
            '/api/auth/update-username'
          ]
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch settings diagnostics.' });
    }
  });

  // 9. Owner-Only Live Source Package Metadata Inspection
  router.get('/source-package/info', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const session = (req as any).ownerSession;
      const ownerUsername = session?.username || 'Death197';
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      // Ensure a verified archive file exists on disk ready for immediate download
      getLatestOrBuildAppSourceArchive(ownerUsername, false);
      const metadata = inspectLatestAppSourceMetadata();
      res.json({
        success: true,
        metadata,
        sessionToken: session?.sessionId
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message || 'Failed to inspect live project source state.'
      });
    }
  });

  // 9b. Owner-Only Rebuild & Update Latest App Source Download Package
  router.post('/source-package/update', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const session = (req as any).ownerSession;
      const ownerUsername = session?.username || 'Death197';
      const ownerEmail = session?.email || 'makerapp688@gmail.com';

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const pkg = updateLatestAppSourceArchive(ownerUsername);
      const metadata = inspectLatestAppSourceMetadata();

      logAdminAction(
        'Update Latest App Source Package',
        ownerEmail,
        'success',
        pkg.filename,
        `Rebuilt & updated latest website source package (${pkg.totalFiles} files, ${(pkg.compressedBytes / (1024 * 1024)).toFixed(2)} MB compressed, SHA-256: ${pkg.sha256.slice(0, 16)}...)`
      );

      res.json({
        success: true,
        message: `Latest website source package rebuilt and updated (${pkg.totalFiles} files, ${(pkg.compressedBytes / (1024 * 1024)).toFixed(2)} MB). Ready for download.`,
        sessionToken: session?.sessionId,
        package: {
          filename: pkg.filename,
          generatedAt: pkg.generatedAt,
          sha256: pkg.sha256,
          compressedBytes: pkg.compressedBytes,
          uncompressedBytes: pkg.uncompressedBytes,
          totalFiles: pkg.totalFiles,
          excludedSensitiveItems: pkg.excludedSensitiveItems
        },
        metadata
      });
    } catch (err: any) {
      console.error('[OwnerSourceUpdate Error]', err);
      res.status(500).json({
        error: err.message || 'Failed to update latest application source package.'
      });
    }
  });

  // 10. Owner-Only Live Source Package Generator & Download (supports both /source-package/download and /source-package/download/:filename)
  const handleOwnerSourcePackageDownload = (req: Request, res: Response) => {
    try {
      const session = (req as any).ownerSession;
      const ownerUsername = session?.username || 'Death197';
      const ownerEmail = session?.email || 'makerapp688@gmail.com';

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      if (req.query.check === 'true') {
        const meta = inspectLatestAppSourceMetadata();
        res.json({
          success: true,
          available: meta.available,
          packageName: meta.packageName,
          totalFiles: meta.totalFiles,
          totalUncompressedBytes: meta.totalUncompressedBytes,
          excludedSensitiveItems: meta.excludedSensitiveItems,
          generatedAt: meta.generatedAt
        });
        return;
      }

      const forceFresh = req.query.fresh === 'true' || req.query.fresh === '1';
      const pkg = getLatestOrBuildAppSourceArchive(ownerUsername, forceFresh);

      // Explicitly verify the archive exists on disk, is readable, and is a valid ZIP archive before returning
      const archiveDiskPath = getArchiveDiskPath();
      if (!fs.existsSync(archiveDiskPath)) {
        throw new Error('Generated source archive file does not exist on disk.');
      }
      fs.accessSync(archiveDiskPath, fs.constants.R_OK);
      const diskStat = fs.statSync(archiveDiskPath);
      if (diskStat.size < 22) {
        throw new Error('Generated source archive file on disk is empty or corrupted.');
      }
      validateZipArchiveBuffer(pkg.buffer, pkg.totalFiles);

      if (req.query.preload !== '1') {
        logAdminAction(
          'Download Latest App Source',
          ownerEmail,
          'success',
          pkg.filename,
          `Generated live .zip source package (${pkg.totalFiles} files, ${(pkg.compressedBytes / (1024 * 1024)).toFixed(2)} MB compressed, SHA-256: ${pkg.sha256.slice(0, 16)}...)`
        );
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(pkg.compressedBytes));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${pkg.filename}"; filename*=UTF-8''${encodeURIComponent(pkg.filename)}`
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Zenime-Source-Filename', pkg.filename);
      res.setHeader('X-Zenime-Source-Generated-At', pkg.generatedAt);
      res.setHeader('X-Zenime-Source-Files-Count', String(pkg.totalFiles));
      res.setHeader('X-Zenime-Source-SHA256', pkg.sha256);

      res.status(200).end(pkg.buffer);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to generate live application source .zip package.';
      console.error('[OwnerSourceDownload Error]', err);
      try {
        const session = (req as any).ownerSession;
        logAdminAction(
          'Download Latest App Source',
          session?.email || 'makerapp688@gmail.com',
          'failure',
          undefined,
          `Archive generation failed: ${errorMessage}`
        );
      } catch {}
      res.status(500).json({
        error: errorMessage,
        code: 'ARCHIVE_GENERATION_FAILED'
      });
    }
  };

  router.get('/source-package/download', authenticateSession, requireOwner, handleOwnerSourcePackageDownload);
  router.get('/source-package/download/t/:ownerToken', authenticateSession, requireOwner, handleOwnerSourcePackageDownload);
  router.get('/source-package/download/t/:ownerToken/:requestedFilename', authenticateSession, requireOwner, handleOwnerSourcePackageDownload);
  router.get('/source-package/download/:requestedFilename', authenticateSession, requireOwner, handleOwnerSourcePackageDownload);

  // ==========================================
  // ISOLATED ARTWORK & METADATA SOURCES DIAGNOSTICS (Owner-only)
  // ==========================================
  function getSourcePurposeLabel(id: string): string {
    switch (id) {
      case 'anilist':
        return 'Artwork / Metadata / Verification';
      case 'jikan':
        return 'Metadata / Verification';
      case 'anidb':
        return 'Metadata / Verification';
      case 'tmdb':
        return 'Artwork / Metadata';
      case 'tvmaze':
        return 'Artwork / Metadata';
      case 'thetvdb':
        return 'Artwork / Metadata';
      case 'watchordr':
        return 'Metadata / Verification';
      case 'theanimeorder':
        return 'Metadata / Verification';
      default:
        return 'Artwork / Metadata';
    }
  }

  function mapRawStatusToDisplay(enabled: boolean, rawStatus?: string): 'Operational' | 'Failed' | 'Disabled' {
    if (!enabled || rawStatus === 'disabled') {
      return 'Disabled';
    }
    if (rawStatus === 'operational') {
      return 'Operational';
    }
    return 'Failed';
  }

  function buildUnifiedSourcesRegistry() {
    const artworkSources = [...getArtworkSourcesConfig()].sort((a, b) => a.priority - b.priority);
    const watchOrderSources = [...getWatchOrderSourcesConfig()].sort((a, b) => a.priority - b.priority);
    const tmdbConfigured = hasConfiguredTmdbApiKey();

    const unified = [
      ...artworkSources.map(s => {
        const canToggle = s.id !== 'jikan' && (s.id !== 'tmdb' || tmdbConfigured);
        const displayStatus = mapRawStatusToDisplay(s.enabled, s.status);
        return {
          id: s.id,
          name: s.name,
          group: 'artwork' as const,
          purpose: getSourcePurposeLabel(s.id),
          priority: s.priority,
          enabled: Boolean(s.enabled),
          canToggle,
          toggleReason:
            s.id === 'jikan'
              ? 'Permanently disabled per artwork specification'
              : s.id === 'tmdb' && !tmdbConfigured
                ? 'Optional source (TMDB_API_KEY not configured)'
                : null,
          rawStatus: s.status,
          status: displayStatus,
          lastTested: s.lastChecked || null,
          responseTimeMs: typeof s.lastLatencyMs === 'number' ? s.lastLatencyMs : null,
          lastMessage: s.lastMessage || null,
          lastError: s.lastError || null,
          description: s.description
        };
      }),
      ...watchOrderSources.map(s => {
        const displayStatus = mapRawStatusToDisplay(s.enabled, s.status);
        return {
          id: s.id,
          name: s.name,
          group: 'watch_order' as const,
          purpose: getSourcePurposeLabel(s.id),
          priority: s.priority,
          enabled: Boolean(s.enabled),
          canToggle: true,
          toggleReason: null,
          rawStatus: s.status,
          status: displayStatus,
          lastTested: s.lastChecked || null,
          responseTimeMs: typeof s.lastLatencyMs === 'number' ? s.lastLatencyMs : null,
          lastMessage: s.lastMessage || null,
          lastError: s.lastError || null,
          description: s.description
        };
      })
    ];

    const passed = unified.filter(s => s.status === 'Operational').length;
    const failed = unified.filter(s => s.status === 'Failed').length;
    const disabled = unified.filter(s => s.status === 'Disabled').length;
    const totalTested = passed + failed;

    return {
      sources: unified,
      summary: {
        passed,
        failed,
        disabled,
        totalTested,
        totalConfigured: unified.length
      }
    };
  }

  async function runSingleUnifiedSourceTest(sourceId: string) {
    if (sourceId === 'watchordr' || sourceId === 'theanimeorder') {
      return await testWatchOrderSourceConnectivity(sourceId);
    }
    return await testSourceConnectivity(sourceId);
  }

  router.get('/sources-registry', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const payload = buildUnifiedSourcesRegistry();
      res.json({ success: true, ...payload });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load configured sources registry.' });
    }
  });

  router.post('/sources-registry/:id/test', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await runSingleUnifiedSourceTest(id);
      const payload = buildUnifiedSourcesRegistry();
      res.json({
        success: true,
        testResult: result,
        ...payload
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to test source.' });
    }
  });

  router.post('/sources-registry/test-all', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const initial = buildUnifiedSourcesRegistry();
      const results: Record<string, any> = {};
      for (const src of initial.sources) {
        results[src.id] = await runSingleUnifiedSourceTest(src.id);
      }
      const payload = buildUnifiedSourcesRegistry();
      res.json({
        success: true,
        results,
        ...payload
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to test all configured sources.' });
    }
  });

  router.post('/sources-registry/retry-failed', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const initial = buildUnifiedSourcesRegistry();
      const failedSources = initial.sources.filter(s => s.status === 'Failed' && s.enabled);
      const results: Record<string, any> = {};
      for (const src of failedSources) {
        results[src.id] = await runSingleUnifiedSourceTest(src.id);
      }
      const payload = buildUnifiedSourcesRegistry();
      res.json({
        success: true,
        retriedCount: failedSources.length,
        results,
        ...payload
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retry failed sources.' });
    }
  });

  router.post('/sources-registry/:id/toggle', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled boolean is required.' });
        return;
      }

      if (id === 'jikan') {
        res.status(400).json({ error: 'Jikan API is permanently disabled per artwork specification.' });
        return;
      }

      if (id === 'tmdb' && !hasConfiguredTmdbApiKey()) {
        res.status(400).json({ error: 'TMDB requires TMDB_API_KEY to be configured before enabling.' });
        return;
      }

      if (id === 'watchordr' || id === 'theanimeorder') {
        const woSources = getWatchOrderSourcesConfig();
        const idx = woSources.findIndex(s => s.id === id);
        if (idx === -1) {
          res.status(404).json({ error: `Unknown source: ${id}` });
          return;
        }
        woSources[idx].enabled = enabled;
        woSources[idx].status = enabled ? 'operational' : 'disabled';
        saveWatchOrderSourcesConfig(woSources);
      } else {
        const artSources = getArtworkSourcesConfig();
        const idx = artSources.findIndex(s => s.id === id);
        if (idx === -1) {
          res.status(404).json({ error: `Unknown source: ${id}` });
          return;
        }
        artSources[idx].enabled = enabled;
        artSources[idx].status = enabled ? 'operational' : 'disabled';
        saveArtworkSourcesConfig(artSources);
      }

      const payload = buildUnifiedSourcesRegistry();
      res.json({
        success: true,
        ...payload
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update source state.' });
    }
  });

  // ==========================================
  // OWNER-ONLY INFORMATION MANAGER ENDPOINTS
  // ==========================================
  router.get('/info-manager/status', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const state = infoManager.getJobState();
      res.json({
        success: true,
        state,
        stats: state.globalStats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load Information Manager status.' });
    }
  });

  router.get('/info-manager/anime', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const {
        filter = 'all',
        search = '',
        page = '1',
        limit = '30'
      } = req.query as Record<string, string>;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
      const q = (search || '').trim().toLowerCase();

      const catalogue = globalDataStore.getAllCatalogueAnime();
      const duplicateMap = infoManager.buildDuplicateIndex(catalogue);
      const records = infoManager.getAllRecords();

      let items = catalogue.map((anime: any) => {
        const rec = records[anime.id] || null;
        const dupIds = duplicateMap.get(anime.id) || [];
        const seasonsCount = anime.totalSeasons ?? anime.seasonsCount ?? (Array.isArray(anime.seasons) ? anime.seasons.length : 0);
        const seasonEpSum = Array.isArray(anime.seasons)
          ? anime.seasons.reduce((acc: number, s: any) => acc + (s.episodeCount || (Array.isArray(s.episodes) ? s.episodes.length : 0)), 0)
          : 0;

        return {
          ...anime,
          infoRecord: rec,
          duplicateIds: dupIds,
          computedSeasonsCount: seasonsCount,
          computedSeasonEpisodesSum: seasonEpSum
        };
      });

      if (q) {
        items = items.filter((item: any) => {
          const titleMatch = (item.title || '').toLowerCase().includes(q);
          const altMatch = (item.alternateTitle || '').toLowerCase().includes(q);
          const jpMatch = (item.japaneseTitle || '').toLowerCase().includes(q);
          const idMatch = (item.id || '').toLowerCase().includes(q);
          const genreMatch = Array.isArray(item.genres) && item.genres.some((g: string) => g.toLowerCase().includes(q));
          const yearMatch = String(item.releaseYear || '').includes(q);
          const typeMatch = (item.type || '').toLowerCase().includes(q);
          return titleMatch || altMatch || jpMatch || idMatch || genreMatch || yearMatch || typeMatch;
        });
      }

      if (filter !== 'all') {
        items = items.filter((item: any) => {
          const rec = item.infoRecord;
          if (filter === 'duplicates') {
            return item.duplicateIds.length > 0 || rec?.status === 'duplicate';
          }
          if (filter === 'suspected_fake') {
            return (
              rec?.status === 'suspected_fake' ||
              rec?.status === 'confirmed_fake' ||
              rec?.checkedFields?.suspectedFake === 'mismatch'
            );
          }
          if (filter === 'conflict') {
            return rec?.status === 'conflict' || rec?.checkedFields?.conflictingInformation === 'mismatch';
          }
          if (filter === 'needs_review') {
            return (
              rec?.status === 'needs_review' ||
              rec?.status === 'conflict' ||
              rec?.status === 'duplicate' ||
              rec?.status === 'suspected_fake' ||
              rec?.status === 'confirmed_fake' ||
              (rec?.discrepancies?.length || 0) > 0
            );
          }
          if (filter === 'missing_info') {
            return (
              rec?.status === 'missing_info' ||
              !item.synopsis ||
              item.synopsis.trim().length < 30 ||
              !Array.isArray(item.genres) ||
              item.genres.length === 0
            );
          }
          if (filter === 'episode_mismatch') {
            return (
              !item.totalEpisodes ||
              item.totalEpisodes <= 0 ||
              (item.computedSeasonEpisodesSum > 0 && item.totalEpisodes !== item.computedSeasonEpisodesSum) ||
              rec?.checkedFields?.totalEpisodes !== 'ok' ||
              rec?.checkedFields?.seasonEpisodes !== 'ok' ||
              rec?.checkedFields?.seasonsCount !== 'ok'
            );
          }
          if (filter === 'verified') {
            return rec?.status === 'verified' || rec?.status === 'correct' || rec?.status === 'auto_fixed';
          }
          if (filter === 'auto_fixed') {
            return rec?.status === 'auto_fixed';
          }
          if (filter === 'unverified') {
            return !rec || rec.status === 'unverified';
          }
          return true;
        });
      }

      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / limitNum));
      const offset = (pageNum - 1) * limitNum;
      const paginated = items.slice(offset, offset + limitNum);

      res.json({
        success: true,
        anime: paginated,
        total,
        page: pageNum,
        totalPages,
        limit: limitNum,
        stats: infoManager.computeGlobalStats()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list anime for Information Manager.' });
    }
  });

  router.get('/info-manager/history', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const history = infoManager.getHistory();
      res.json({
        success: true,
        history,
        total: history.length
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load Information Manager history.' });
    }
  });

  router.post('/info-manager/inspect-all', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.inspectAllCatalogue(email);
      res.json({
        success: true,
        message: `Audited ${result.inspectedCount} anime entries across all 12 information categories.`,
        stats: result.stats,
        state: infoManager.getJobState()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to inspect catalogue information.' });
    }
  });

  router.post('/info-manager/start', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const mode =
        req.body?.mode === 'unverified'
          ? 'unverified'
          : req.body?.mode === 'fix_missing'
            ? 'fix_missing'
            : 'all';
      const limit = req.body?.limit ? parseInt(String(req.body.limit), 10) : undefined;
      const state = infoManager.startScan(email, mode, limit);
      res.json({
        success: true,
        state,
        stats: state.globalStats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to start Information Manager scan.' });
    }
  });

  router.post('/info-manager/pause', authenticateSession, requireOwner, (req: Request, res: Response) => {
    const state = infoManager.pauseScan();
    res.json({ success: true, state, stats: state.globalStats });
  });

  router.post('/info-manager/resume', authenticateSession, requireOwner, (req: Request, res: Response) => {
    const state = infoManager.resumeScan();
    res.json({ success: true, state, stats: state.globalStats });
  });

  router.post('/info-manager/stop', authenticateSession, requireOwner, (req: Request, res: Response) => {
    const state = infoManager.stopScan();
    res.json({ success: true, state, stats: state.globalStats });
  });

  router.post('/info-manager/reset', authenticateSession, requireOwner, (req: Request, res: Response) => {
    const state = infoManager.resetScan();
    res.json({ success: true, state, stats: state.globalStats });
  });

  router.post('/info-manager/verify-single/:id', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const autoFix = Boolean(req.body?.autoFix);
      const email = (req as any).ownerSession?.email || 'Owner';
      const record = await infoManager.verifySingleAnime(id, autoFix, email);
      if (!record) {
        res.status(404).json({ error: `Anime '${id}' not found.` });
        return;
      }
      const updatedAnime = globalDataStore.getCatalogueAnime(id);
      const state = infoManager.getJobState();
      res.json({
        success: true,
        record,
        anime: updatedAnime,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to verify anime information.' });
    }
  });

  router.post('/info-manager/anime/:id/update', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { updates, reason, source } = req.body || {};
      if (!updates || typeof updates !== 'object') {
        res.status(400).json({ error: 'updates object is required.' });
        return;
      }
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.applyMetadataUpdate(
        id,
        updates,
        email,
        reason || 'Manual correction via Information Manager',
        source || 'Owner Manual Correction',
        'verified'
      );
      if (!result.success) {
        res.status(404).json({ error: result.error || 'Failed to update anime information.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        message: `Updated and verified "${result.anime?.title}".`,
        anime: result.anime,
        record: result.record,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to save information update.' });
    }
  });

  router.post('/info-manager/anime/:id/approve', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.applyMetadataUpdate(
        id,
        {},
        email,
        'Owner approved current anime information as Verified',
        'Owner Approval',
        'verified'
      );
      if (!result.success) {
        res.status(404).json({ error: result.error || 'Anime not found.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        message: `"${result.anime?.title}" marked as Verified.`,
        anime: result.anime,
        record: result.record,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to approve anime information.' });
    }
  });

  router.post('/info-manager/history/:historyId/revert', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { historyId } = req.params;
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.revertHistoryEntry(historyId, email);
      if (!result.success) {
        res.status(404).json({ error: result.error || 'Failed to revert history entry.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        message: `Reverted metadata for "${result.anime?.title}".`,
        anime: result.anime,
        history: infoManager.getHistory(),
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to revert change.' });
    }
  });

  router.post('/info-manager/anime/:id/delete-duplicate', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.deleteDuplicateEntry(id, email);
      if (!result.success) {
        res.status(404).json({ error: result.error || 'Failed to delete duplicate entry.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        message: `Removed duplicate anime entry "${result.deletedTitle}".`,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete duplicate entry.' });
    }
  });

  router.post('/info-manager/anime/:id/resolve-fake', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rawAction = req.body?.action;
      const action: 'dismiss' | 'confirm_fake' | 'confirm_delete' =
        rawAction === 'confirm_delete'
          ? 'confirm_delete'
          : rawAction === 'confirm_fake'
            ? 'confirm_fake'
            : 'dismiss';
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.resolveSuspectedFake(id, action, email);
      if (!result.success) {
        res.status(400).json({ error: result.error || 'Failed to resolve suspected fake entry.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        deleted: result.deleted,
        anime: result.anime,
        record: result.record,
        message: result.message,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve suspected fake entry.' });
    }
  });

  router.post('/info-manager/retry-all-review', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.retryAllNeedsReview(email);
      res.json({
        success: true,
        queuedCount: result.queuedCount,
        message:
          result.queuedCount > 0
            ? `Queued ${result.queuedCount} Needs Review items onto the shared worker pool.`
            : 'No Needs Review items required queuing.',
        state: result.state,
        stats: result.state.globalStats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retry Needs Review items.' });
    }
  });

  router.post('/info-manager/fix-all-high-confidence', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.fixAllHighConfidence(email);
      res.json({
        success: true,
        fixedCount: result.fixedCount,
        skippedHumanReviewCount: result.skippedHumanReviewCount,
        message: `Auto-resolved ${result.fixedCount} high-confidence items (${result.skippedHumanReviewCount} items requiring human judgment kept for individual review).`,
        state: result.state,
        stats: result.state.globalStats
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to execute Fix All High-Confidence.' });
    }
  });

  router.post('/info-manager/anime/:id/resolve-review', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rawAction = req.body?.action;
      const action: 'approve_suggestions' | 'mark_verified' | 'reject_suggestions' | 'skip_ignore' | 'mark_needs_review' =
        rawAction === 'approve_suggestions' ||
        rawAction === 'reject_suggestions' ||
        rawAction === 'skip_ignore' ||
        rawAction === 'mark_needs_review'
          ? rawAction
          : 'mark_verified';
      const email = (req as any).ownerSession?.email || 'Owner';
      const result = infoManager.resolveReviewItem(id, action, email, req.body?.reason);
      if (!result.success) {
        res.status(400).json({ error: result.error || 'Failed to resolve review item.' });
        return;
      }
      const state = infoManager.getJobState();
      res.json({
        success: true,
        anime: result.anime,
        record: result.record,
        message: result.message,
        stats: state.globalStats,
        state
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve review item.' });
    }
  });

  // ==========================================
  // CENTRAL SHARED WORKERS ADMINISTRATION ENDPOINTS (Owner-only)
  // ==========================================
  router.get('/workers/status', authenticateSession, requireOwner, (_req: Request, res: Response) => {
    try {
      const sharedSnapshot = globalWorkerJobEngine.getSnapshot();
      const artworkSnapshot = globalWorkerJobEngine.getSnapshot('ARTWORK_VERIFICATION');
      const infoSnapshot = globalWorkerJobEngine.getSnapshot('INFORMATION_VERIFICATION');
      const artworkStats = computeGlobalCatalogueStats();
      const infoStats = infoManager.computeGlobalStats();

      res.json({
        success: true,
        sharedSnapshot,
        artworkSnapshot,
        infoSnapshot,
        artworkStats,
        infoStats,
        awaitingReviewTotal: (artworkStats.needsReview || 0) + (infoStats.needsReview || 0),
        healthMetrics: {
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          leaseDurationMs: LEASE_DURATION_MS,
          stalledDetectionEnabled: true,
          autoRecoveryEnabled: true,
          duplicateJobProtection: 'Deterministic Task IDs + Per-Anime / Per-Season Atomic Leases',
          backoffStrategy: 'Exponential Backoff with Jitter (2s → 4s → 8s → 16s)',
          gracefulShutdownSupported: true,
          queuePersistenceEnabled: true
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load shared worker pool telemetry.' });
    }
  });

  router.post('/workers/control', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { action, jobSystem } = req.body || {};
      const email = (req as any).ownerSession?.email || 'Owner';
      const sysFilter =
        jobSystem === 'ARTWORK_VERIFICATION' || jobSystem === 'INFORMATION_VERIFICATION'
          ? jobSystem
          : undefined;

      if (action === 'pause') {
        globalWorkerJobEngine.pauseJob();
      } else if (action === 'resume') {
        globalWorkerJobEngine.resumeJob();
      } else if (action === 'stop') {
        globalWorkerJobEngine.stopJob(sysFilter);
      } else if (action === 'reset') {
        globalWorkerJobEngine.resetJob(sysFilter);
      } else if (action === 'retry_failed') {
        globalWorkerJobEngine.retryFailedTasks();
      } else {
        res.status(400).json({ error: 'Invalid worker control action.' });
        return;
      }

      logAdminAction(
        `Shared Worker Pool Control: ${String(action).toUpperCase()}${sysFilter ? ` (${sysFilter})` : ''}`,
        email,
        'success',
        undefined,
        `Executed ${action} on shared worker infrastructure.`
      );

      res.json({
        success: true,
        message: `Worker pool action "${action}" executed.`,
        sharedSnapshot: globalWorkerJobEngine.getSnapshot(),
        artworkSnapshot: globalWorkerJobEngine.getSnapshot('ARTWORK_VERIFICATION'),
        infoSnapshot: globalWorkerJobEngine.getSnapshot('INFORMATION_VERIFICATION')
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to execute worker control action.' });
    }
  });

  return router;
}
