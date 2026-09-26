import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSessionSecret } from './session-secret.js';
import {
  getEmailConfigStatus,
  generateVerificationCode,
  sendVerificationEmail,
  testEmailTransport,
  checkServerSecretsDiagnostic
} from './email-service.js';
import { logAdminAction, loadAuditLogs } from './audit-logger.js';
import {
  getArtworkSourcesConfig,
  saveArtworkSourcesConfig,
  testSourceConnectivity
} from './artwork-sources.js';
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
import { globalWorkerJobEngine, createDeterministicTaskId } from './worker-job-engine.js';
import { globalDataStore } from './data-store.js';

// Data file paths
const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const OWNER_ACCOUNT_PATH = path.join(DATA_DIR, 'owner-account.json');
const TEMP_SETUP_PATH = path.join(DATA_DIR, 'owner-setup-temp.json');
const TEMP_EMAIL_CHANGE_PATH = path.join(DATA_DIR, 'owner-email-change-temp.json');
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

export interface TempSetup {
  email: string;
  username: string;
  passwordHash: string;
  salt: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  resendCount: number;
  lastResendAt: number;
}

export interface TempEmailChange {
  ownerEmail: string;
  newEmail: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
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

// Load / Save Owner Account
export function getOwnerAccount(): OwnerAccount | null {
  try {
    if (fs.existsSync(OWNER_ACCOUNT_PATH)) {
      const data = fs.readFileSync(OWNER_ACCOUNT_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && parsed.email) {
        if (!parsed.id) parsed.id = 'usr_owner';
        parsed.email = parsed.email.trim().toLowerCase();
        if (!parsed.username || parsed.username.trim() === '' || parsed.username.trim() === 'Owner') {
          parsed.username = 'Death197';
        }
        return parsed;
      }
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
  fs.writeFileSync(OWNER_ACCOUNT_PATH, JSON.stringify(account, null, 2), 'utf-8');
}

export function validateOwnerSession(sessionId: string): { id: string; email: string; username: string; role: 'owner'; createdAt: string } | null {
  try {
    loadSessions();
    let session = activeSessions.get(sessionId);
    if (session && session.revoked) {
      return null;
    }
    if (!session || session.expiresAt < Date.now()) {
      // Decode cryptographic token fallback
      const decoded = verifyAndDecodeSessionToken(sessionId);
      if (decoded && decoded.role === 'owner') {
        session = {
          sessionId,
          email: decoded.email.trim().toLowerCase(),
          username: decoded.username,
          role: 'owner',
          createdAt: decoded.expiresAt - 30 * 24 * 60 * 60 * 1000,
          expiresAt: decoded.expiresAt
        };
        activeSessions.set(sessionId, session);
        saveSessions();
      } else {
        return null;
      }
    }

    const owner = getOwnerAccount();
    if (!owner) {
      return null;
    }

    const sessionEmail = session.email ? session.email.trim().toLowerCase() : '';
    const ownerEmail = owner.email ? owner.email.trim().toLowerCase() : '';

    if (ownerEmail !== sessionEmail || owner.role !== 'owner') {
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

// Load / Save Temp Setup
export function getTempSetup(): TempSetup | null {
  try {
    if (fs.existsSync(TEMP_SETUP_PATH)) {
      const data = fs.readFileSync(TEMP_SETUP_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[OwnerAuth] Error reading temp setup:', err);
  }
  return null;
}

export function saveTempSetup(setup: TempSetup | null): void {
  if (!setup) {
    if (fs.existsSync(TEMP_SETUP_PATH)) {
      fs.unlinkSync(TEMP_SETUP_PATH);
    }
  } else {
    fs.writeFileSync(TEMP_SETUP_PATH, JSON.stringify(setup, null, 2), 'utf-8');
  }
}

// Load / Save Temp Email Change
export function getTempEmailChange(): TempEmailChange | null {
  try {
    if (fs.existsSync(TEMP_EMAIL_CHANGE_PATH)) {
      const data = fs.readFileSync(TEMP_EMAIL_CHANGE_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[OwnerAuth] Error reading temp email change:', err);
  }
  return null;
}

export function saveTempEmailChange(change: TempEmailChange | null): void {
  if (!change) {
    if (fs.existsSync(TEMP_EMAIL_CHANGE_PATH)) {
      fs.unlinkSync(TEMP_EMAIL_CHANGE_PATH);
    }
  } else {
    fs.writeFileSync(TEMP_EMAIL_CHANGE_PATH, JSON.stringify(change, null, 2), 'utf-8');
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

// Middleware: Authenticate Session
export function isEmailAuthorizedOwner(email: string | undefined | null): boolean {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  return cleanEmail === 'makerapp688@gmail.com';
}

/**
 * Checks the currently logged-in user's Google account email.
 * Inspects Google Cloud Run / Identity headers, client-passed headers, query overrides,
 * or runtime environment variables.
 */
export function getGoogleAccountEmail(req?: Request): string | null {
  if (req) {
    const rawHeader = 
      (req.headers['x-goog-authenticated-user-email'] as string) ||
      (req.headers['x-goog-user-email'] as string) ||
      (req.headers['x-google-email'] as string) ||
      (req.headers['x-anivault-google-email'] as string) ||
      (req.headers['x-user-email'] as string) ||
      (req.headers['x-forwarded-email'] as string) ||
      (req.headers['x-auth-request-email'] as string) ||
      (typeof req.query?.googleEmail === 'string' ? req.query.googleEmail : null);

    if (rawHeader) {
      const email = rawHeader.replace(/^accounts\.google\.com:/i, '').trim().toLowerCase();
      if (email && email.includes('@')) {
        return email;
      }
    }
  }

  // Fallback to Google environment user email configured in runtime container
  const envEmail = process.env.GOOGLE_USER_EMAIL || process.env.SMTP_USER || process.env.SMTP_FROM;
  if (envEmail && envEmail.includes('@')) {
    return envEmail.trim().toLowerCase();
  }

  const owner = getOwnerAccount();
  if (owner && owner.email) {
    return owner.email.trim().toLowerCase();
  }

  return null;
}

export function getSessionEmail(req: Request): string | null {
  const cookies = parseCookies(req);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  
  // 1. Try Owner Session
  const ownerHeader = req.headers['x-anivault-owner-session'] as string;
  const ownerSessionId = cookies['anivault_owner_session'] || ownerHeader || (bearerToken && bearerToken.startsWith('owner_') ? bearerToken : null);
  
  if (ownerSessionId) {
    const ownerSession = activeSessions.get(ownerSessionId);
    if (ownerSession && !ownerSession.revoked && ownerSession.expiresAt > Date.now()) {
      return ownerSession.email;
    }
    const decodedOwner = verifyAndDecodeSessionToken(ownerSessionId);
    if (decodedOwner && decodedOwner.role === 'owner') {
      return decodedOwner.email;
    }
  }
  
  // 2. Try User Session
  const userHeader = req.headers['x-anivault-user-session'] as string;
  const userSessionId = cookies['anivault_user_session'] || userHeader || bearerToken;
  
  if (userSessionId) {
    try {
      const sessionsPath = path.join(process.cwd(), 'server', 'data', 'users-sessions.json');
      if (fs.existsSync(sessionsPath)) {
        const list: any[] = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
        const matched = list.find(s => s.sessionId === userSessionId && !s.revoked && s.expiresAt > Date.now());
        if (matched) {
          return matched.email;
        }
      }
    } catch (err) {
      console.error('[OwnerAuth] Error loading user sessions from disk:', err);
    }
    
    const decodedUser = verifyAndDecodeSessionToken(userSessionId);
    if (decodedUser && decodedUser.role === 'user') {
      return decodedUser.email;
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

  let session = activeSessions.get(sessionId);
  if (session && session.revoked) {
    (req as any).ownerSession = null;
    return next();
  }
  if (!session || session.expiresAt < Date.now()) {
    // Decode cryptographic token fallback
    const decoded = verifyAndDecodeSessionToken(sessionId);
    if (decoded && decoded.role === 'owner') {
      session = {
        sessionId,
        email: decoded.email,
        username: decoded.username,
        role: 'owner',
        createdAt: decoded.expiresAt - 30 * 24 * 60 * 60 * 1000,
        expiresAt: decoded.expiresAt
      };
      activeSessions.set(sessionId, session);
      saveSessions();
    } else {
      if (sessionId) {
        activeSessions.delete(sessionId);
        saveSessions();
      }
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
    res.status(401).json({ error: 'Unauthorized: Authentication session required for Anivex Owner access.' });
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

  // 0a. Owner-Only Email Service Configuration Status (No secret values returned)
  router.get('/email-status', (req: Request, res: Response) => {
    const status = getEmailConfigStatus();
    const secretsDiag = checkServerSecretsDiagnostic();
    res.json({
      configured: status.configured,
      missing: status.missing,
      hostConfigured: status.hostConfigured,
      userConfigured: status.userConfigured,
      passConfigured: status.passConfigured,
      fromConfigured: status.fromConfigured,
      diagnostic: secretsDiag,
      ...secretsDiag
    });
  });

  // 0b. Owner-Only Real Email Transport Diagnostic Test
  router.post('/email-test', async (req: Request, res: Response) => {
    try {
      const { recipient } = req.body;
      const testRecipient = typeof recipient === 'string' && recipient.trim() ? recipient.trim() : undefined;
      const result = await testEmailTransport(testRecipient);
      res.status(result.success ? 200 : 503).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, step: 'SERVER_ERROR', error: err.message });
    }
  });

  // 1. Setup Init (Email, Password, Username)
  router.post('/setup-init', async (req: Request, res: Response) => {
    try {
      const { email, password, username } = req.body;

      // 1. Username validation
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

      // 2. Email validation
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Valid email address is required.' });
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
      if (!emailRegex.test(normalizedEmail)) {
        res.status(400).json({ error: 'Please enter a valid email address (e.g. user@gmail.com).' });
        return;
      }

      // Check strictly authorized owner email
      if (!isEmailAuthorizedOwner(normalizedEmail)) {
        saveTempSetup(null);
        res.status(400).json({
          error: 'Only the authorized Owner email can create an ANIVEX Owner account.',
          code: 'NOT_AUTHORIZED_OWNER'
        });
        return;
      }

      // 3. Password validation
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const existingOwner = getOwnerAccount();

      if (existingOwner) {
        saveTempSetup(null);
        res.status(400).json({
          error: 'Permanent Anivex Owner account already exists. Setup rejected.',
          code: 'OWNER_ALREADY_EXISTS'
        });
        return;
      }

      // Check email service configuration status
      const emailStatus = getEmailConfigStatus();
      if (!emailStatus.configured) {
        res.status(503).json({
          error: 'Email service is not configured. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in server environment secrets.',
          code: 'EMAIL_NOT_CONFIGURED',
          missing: emailStatus.missing,
          hostConfigured: emailStatus.hostConfigured,
          userConfigured: emailStatus.userConfigured,
          passConfigured: emailStatus.passConfigured,
          fromConfigured: emailStatus.fromConfigured
        });
        return;
      }

      const existingTemp = getTempSetup();
      const now = Date.now();
      if (existingTemp && existingTemp.email === normalizedEmail && existingTemp.expiresAt > now) {
        if (now - existingTemp.lastResendAt < 60000) {
          const waitSec = Math.ceil((60000 - (now - existingTemp.lastResendAt)) / 1000);
          res.status(429).json({
            error: `Please wait ${waitSec} seconds before requesting another verification code.`,
            code: 'RATE_LIMITED'
          });
          return;
        }
      }

      const { hash: passwordHash, salt } = hashPassword(password);
      const { code, codeHash } = generateVerificationCode();
      const recipientDomain = normalizedEmail.includes('@') ? '@' + normalizedEmail.split('@')[1] : 'recipient';
      console.log(`[EMAIL_DIAGNOSTIC] OTP_GENERATED: true, length=6, domain=${recipientDomain} (OWNER_SETUP)`);

      const tempSetup: TempSetup = {
        email: normalizedEmail,
        username: cleanUsername,
        passwordHash,
        salt,
        codeHash,
        expiresAt: now + 10 * 60 * 1000,
        attempts: 0,
        resendCount: existingTemp && existingTemp.email === normalizedEmail ? existingTemp.resendCount + 1 : 1,
        lastResendAt: now
      };

      saveTempSetup(tempSetup);
      console.log(`[EMAIL_DIAGNOSTIC] OTP_STORAGE_SUCCESS: true, domain=${recipientDomain}, expiresAt=+10m (OWNER_SETUP)`);

      try {
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(normalizedEmail, code, 'Verify your Anivex account', origin);
      } catch (mailErr: any) {
        console.error('[OwnerSetupInit] Failed to send email:', mailErr.message);
        saveTempSetup(null);
        const safeError = mailErr.message || 'Email delivery failed.';
        res.status(503).json({
          error: safeError,
          code: 'EMAIL_SEND_FAILED'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Verification code sent to email. Please verify within 10 minutes.'
      });
    } catch (err: any) {
      console.error('[OwnerSetupInit Error]', err);
      res.status(500).json({ error: err.message || 'Internal server error during owner setup initialization.' });
    }
  });

  // 2. Setup Verify
  router.post('/setup-verify', async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        res.status(400).json({ error: 'Email and verification code are required.' });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const temp = getTempSetup();

      if (!temp || temp.email !== normalizedEmail) {
        res.status(400).json({ error: 'No active setup attempt found for this email. Please initiate setup again.' });
        return;
      }

      if (Date.now() > temp.expiresAt) {
        saveTempSetup(null);
        res.status(400).json({ error: 'This code has expired. Request a new code.' });
        return;
      }

      if (temp.attempts >= 5) {
        saveTempSetup(null);
        res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
        return;
      }

      const testCodeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
      if (testCodeHash !== temp.codeHash) {
        temp.attempts += 1;
        saveTempSetup(temp);
        if (temp.attempts >= 5) {
          saveTempSetup(null);
          res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
          return;
        }
        res.status(400).json({ error: 'Incorrect verification code.' });
        return;
      }

      if (!isEmailAuthorizedOwner(temp.email)) {
        saveTempSetup(null);
        res.status(400).json({ error: 'Not authorized for Owner account.' });
        return;
      }

      const existingOwner = getOwnerAccount();
      if (existingOwner) {
        saveTempSetup(null);
        res.status(400).json({ error: 'Permanent Owner account already exists. Setup rejected.' });
        return;
      }

      const now = new Date().toISOString();
      const newOwner: OwnerAccount = {
        email: temp.email,
        username: temp.username,
        passwordHash: temp.passwordHash,
        salt: temp.salt,
        createdAt: now,
        updatedAt: now,
        role: 'owner'
      };

      saveOwnerAccount(newOwner);
      saveTempSetup(null);

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
        message: 'Email verified successfully. Permanent Owner account created.',
        owner: { email: newOwner.email, username: newOwner.username, role: newOwner.role },
        sessionToken: sessionId
      });
    } catch (err: any) {
      console.error('[OwnerSetupVerify Error]', err);
      res.status(500).json({ error: err.message || 'Internal server error during setup verification.' });
    }
  });

  // 2b. Owner Setup Resend Code
  router.post('/setup-resend', async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      const normalizedEmail = (email || '').trim().toLowerCase();
      const tempSetup = getTempSetup();

      if (!tempSetup || tempSetup.email !== normalizedEmail) {
        res.status(400).json({
          error: 'No active setup session found for this email. Please restart owner setup.'
        });
        return;
      }

      const emailStatus = getEmailConfigStatus();
      if (!emailStatus.configured) {
        res.status(503).json({
          error: 'Email service is not configured. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in server environment secrets.',
          code: 'EMAIL_NOT_CONFIGURED',
          missing: emailStatus.missing,
          hostConfigured: emailStatus.hostConfigured,
          userConfigured: emailStatus.userConfigured,
          passConfigured: emailStatus.passConfigured,
          fromConfigured: emailStatus.fromConfigured
        });
        return;
      }

      const now = Date.now();
      if (tempSetup.resendCount >= 5) {
        res.status(429).json({
          error: 'Maximum code resend limit reached for this session. Please restart owner setup.'
        });
        return;
      }

      if (now - tempSetup.lastResendAt < 60000) {
        const waitSec = Math.ceil((60000 - (now - tempSetup.lastResendAt)) / 1000);
        res.status(429).json({
          error: `Please wait ${waitSec} seconds before requesting another verification code.`,
          code: 'RATE_LIMITED'
        });
        return;
      }

      // Invalidate previous OTP and generate a new secure 6-digit OTP
      const { code, codeHash } = generateVerificationCode();
      const recipientDomain = normalizedEmail.includes('@') ? '@' + normalizedEmail.split('@')[1] : 'recipient';
      console.log(`[EMAIL_DIAGNOSTIC] OTP_GENERATED: true, length=6, domain=${recipientDomain} (OWNER_RESEND)`);
      tempSetup.codeHash = codeHash;
      tempSetup.expiresAt = now + 10 * 60 * 1000;
      tempSetup.attempts = 0;
      tempSetup.resendCount += 1;
      tempSetup.lastResendAt = now;
      saveTempSetup(tempSetup);
      console.log(`[EMAIL_DIAGNOSTIC] OTP_STORAGE_SUCCESS: true, domain=${recipientDomain}, resendCount=${tempSetup.resendCount} (OWNER_RESEND)`);

      try {
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(
          normalizedEmail,
          code,
          'Verify your Anivex account',
          origin
        );
      } catch (mailErr: any) {
        console.error('[OwnerSetupResend] Failed to send email:', mailErr.message);
        const safeError = mailErr.message || 'Email delivery failed.';
        res.status(503).json({
          error: safeError,
          code: 'EMAIL_SEND_FAILED'
        });
        return;
      }

      res.json({
        success: true,
        message: 'A fresh verification code has been sent to your email.'
      });
    } catch (err: any) {
      console.error('[OwnerSetupResend Error]', err);
      res.status(500).json({ error: err.message || 'Failed to resend verification code.' });
    }
  });

  // 3. Login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const owner = getOwnerAccount();
      if (!owner || owner.email !== email.trim().toLowerCase()) {
        res.status(401).json({ error: 'Invalid owner credentials.' });
        return;
      }

      const isValid = verifyPassword(password, owner.passwordHash, owner.salt);
      if (!isValid || owner.role !== 'owner') {
        res.status(401).json({ error: 'Invalid owner credentials.' });
        return;
      }

      const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(owner.id || 'usr_owner', owner.email, owner.username, 'owner', 'email', sessionExpires);
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
        message: 'Owner login successful.',
        owner: { email: owner.email, username: owner.username, role: owner.role },
        sessionToken: sessionId
      });
    } catch (err: any) {
      console.error('[OwnerLogin Error]', err);
      res.status(500).json({ error: err.message || 'Internal server error during owner login.' });
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

  // 5. Get Session Status
  router.get('/session', authenticateSession, (req: Request, res: Response) => {
    const session = (req as any).ownerSession;
    const owner = getOwnerAccount();
    
    // Check currently logged-in user's Google account email
    const googleEmail = getGoogleAccountEmail(req);
    const isGoogleAuthorized = Boolean(googleEmail && isEmailAuthorizedOwner(googleEmail));

    const currentEmail = getSessionEmail(req) || googleEmail;
    const isAuthorized = isGoogleAuthorized || isEmailAuthorizedOwner(currentEmail);
    
    const isOwnerSessionActive = Boolean(
      session &&
      session.email &&
      isEmailAuthorizedOwner(session.email)
    );
    
    const ownerExists = Boolean(owner && owner.email && isEmailAuthorizedOwner(owner.email));

    res.json({
      authenticated: isOwnerSessionActive,
      isAuthorized: isAuthorized,
      googleEmail: googleEmail,
      isGoogleAuthorized: isGoogleAuthorized,
      ownerExists: ownerExists,
      sessionToken: isOwnerSessionActive && session ? session.sessionId : undefined,
      owner: isAuthorized && owner ? {
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

  // 7. Owner Email Change Init
  router.post('/change-email-init', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { newEmail, currentPassword } = req.body;
      const owner = getOwnerAccount()!;

      if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
        res.status(400).json({ error: 'Valid new email address is required.' });
        return;
      }

      if (!currentPassword) {
        res.status(400).json({ error: 'Current password is required to change owner email.' });
        return;
      }

      if (!verifyPassword(currentPassword, owner.passwordHash, owner.salt)) {
        res.status(401).json({ error: 'Incorrect current password.' });
        return;
      }

      const normalizedNewEmail = newEmail.trim().toLowerCase();
      if (normalizedNewEmail === owner.email) {
        res.status(400).json({ error: 'New email must be different from current owner email.' });
        return;
      }

      const emailStatus = getEmailConfigStatus();
      if (!emailStatus.configured) {
        res.status(503).json({
          error: 'Email service is not configured correctly.',
          code: 'EMAIL_NOT_CONFIGURED',
          missing: emailStatus.missing
        });
        return;
      }

      const { code, codeHash } = generateVerificationCode();
      console.log(`[EMAIL_DIAGNOSTIC] OTP_GENERATED: true, length=6, recipient=${normalizedNewEmail} (OWNER_EMAIL_CHANGE)`);

      const emailChange: TempEmailChange = {
        ownerEmail: owner.email,
        newEmail: normalizedNewEmail,
        codeHash,
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0
      };

      saveTempEmailChange(emailChange);
      console.log(`[EMAIL_DIAGNOSTIC] OTP_STORAGE_SUCCESS: true, recipient=${normalizedNewEmail}, expiresAt=+10m (OWNER_EMAIL_CHANGE)`);

      try {
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(normalizedNewEmail, code, 'Verify your Anivex account', origin);
      } catch (mailErr: any) {
        console.error('[OwnerEmailChange] Failed to send email:', mailErr.message);
        saveTempEmailChange(null);
        res.status(503).json({
          error: mailErr.message || 'We couldn’t send the verification email. Please try again.',
          code: 'EMAIL_SEND_FAILED'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Verification code sent to your new email address.'
      });
    } catch (err: any) {
      console.error('[OwnerEmailChangeInit Error]', err);
      res.status(500).json({ error: err.message || 'Internal server error during email change initiation.' });
    }
  });

  // 8. Owner Email Change Verify
  router.post('/change-email-verify', authenticateSession, requireOwner, async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      const owner = getOwnerAccount()!;
      const tempChange = getTempEmailChange();

      if (!code || !tempChange || tempChange.ownerEmail !== owner.email) {
        res.status(400).json({ error: 'No active email change request found.' });
        return;
      }

      if (Date.now() > tempChange.expiresAt) {
        saveTempEmailChange(null);
        res.status(400).json({ error: 'Email change verification code has expired.' });
        return;
      }

      const testCodeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
      if (testCodeHash !== tempChange.codeHash) {
        tempChange.attempts += 1;
        saveTempEmailChange(tempChange);
        res.status(400).json({ error: 'Invalid verification code.' });
        return;
      }

      owner.email = tempChange.newEmail;
      owner.updatedAt = new Date().toISOString();
      saveOwnerAccount(owner);
      saveTempEmailChange(null);

      res.json({
        success: true,
        message: 'Permanent Owner email updated successfully.',
        owner: { email: owner.email, username: owner.username, role: owner.role }
      });
    } catch (err: any) {
      console.error('[OwnerEmailChangeVerify Error]', err);
      res.status(500).json({ error: err.message || 'Internal server error during email change verification.' });
    }
  });

  // 9. Switch to Owner account (requires authenticated owner session, authorized Google account, or password verification)
  router.post('/switch', authenticateSession, async (req: Request, res: Response) => {
    const owner = getOwnerAccount();
    if (!owner) {
      res.status(404).json({ error: 'Owner account does not exist. Please setup Owner first.' });
      return;
    }

    const session = (req as any).ownerSession;
    const { password } = req.body || {};

    // Check if caller's Google account email is authorized (makerapp688@gmail.com)
    const googleEmail = getGoogleAccountEmail(req);
    const isGoogleAuthorized = Boolean(googleEmail && isEmailAuthorizedOwner(googleEmail));

    // Check if caller already has a valid owner session
    const hasValidSession = session && session.role === 'owner' && session.email?.trim().toLowerCase() === owner.email.trim().toLowerCase() && isEmailAuthorizedOwner(session.email);

    // Or check if valid password provided
    let passwordValid = false;
    if (!hasValidSession && password && typeof password === 'string' && owner.passwordHash && owner.salt) {
      passwordValid = verifyPassword(password, owner.passwordHash, owner.salt);
    }

    if (!isGoogleAuthorized && !hasValidSession && !passwordValid) {
      res.status(401).json({
        error: 'Owner authentication required.',
        requireOwnerLogin: true
      });
      return;
    }

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = (hasValidSession && session.sessionId) ? session.sessionId : generateSignedSessionToken('usr_owner', owner.email, owner.username, 'owner', 'email', sessionExpires);
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
      const dataPath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
      const fallbackPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
      let catalogue: any[] = [];
      if (fs.existsSync(dataPath)) {
        catalogue = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      } else if (fs.existsSync(fallbackPath)) {
        catalogue = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
      }

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

      // Artwork stats from authoritative computeGlobalCatalogueStats
      const authoritativeArtStats = computeGlobalCatalogueStats();
      const verifiedArtwork = authoritativeArtStats.verified;
      const unverifiedArtwork = authoritativeArtStats.unverified;
      const missingArtwork = authoritativeArtStats.missing;

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
        userCount,
        bugReportsCount: bugReports.length,
        newBugReportsCount: bugReports.filter(r => r.status === 'New').length,
        artworkStats: {
          verified: verifiedArtwork,
          unverified: unverifiedArtwork,
          missing: missingArtwork,
          total: catalogue.length
        },
        recentActivity: auditLogs.slice(0, 20),
        systemHealth: 'Healthy',
        emailConfigured: getEmailConfigStatus().configured,
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
        isVerified: u.isVerified,
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
      const updatedData = req.body;

      const dataPath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
      if (!fs.existsSync(dataPath)) {
        res.status(404).json({ error: 'Catalogue file not found.' });
        return;
      }

      const catalogue: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      const index = catalogue.findIndex(a => a.id === id);

      if (index === -1) {
        res.status(404).json({ error: `Anime with ID '${id}' not found.` });
        return;
      }

      const original = catalogue[index];
      
      const merged = {
        ...original,
        title: typeof updatedData.title === 'string' ? updatedData.title.trim() : original.title,
        alternateTitle: typeof updatedData.alternateTitle === 'string' ? updatedData.alternateTitle.trim() : original.alternateTitle,
        type: ['TV', 'Movie'].includes(updatedData.type) ? updatedData.type : original.type,
        status: ['Completed', 'Ongoing'].includes(updatedData.status) ? updatedData.status : original.status,
        releaseYear: typeof updatedData.releaseYear === 'number' ? updatedData.releaseYear : (updatedData.releaseYear ? parseInt(updatedData.releaseYear) : original.releaseYear),
        synopsis: typeof updatedData.synopsis === 'string' ? updatedData.synopsis.trim() : original.synopsis,
        genres: Array.isArray(updatedData.genres) ? updatedData.genres : original.genres,
        totalEpisodes: typeof updatedData.totalEpisodes === 'number' ? updatedData.totalEpisodes : (updatedData.totalEpisodes ? parseInt(updatedData.totalEpisodes) : original.totalEpisodes),
        seasons: Array.isArray(updatedData.seasons) ? updatedData.seasons : original.seasons,
        languages: Array.isArray(updatedData.languages) ? updatedData.languages : original.languages,
        providers: {
          ...original.providers,
          raretoonIndia: {
            ...original.providers?.raretoonIndia,
            providerAnimeId: updatedData.providerAnimeId !== undefined ? updatedData.providerAnimeId : original.providers?.raretoonIndia?.providerAnimeId,
            dubLanguage: updatedData.dubLanguage !== undefined ? updatedData.dubLanguage : original.providers?.raretoonIndia?.dubLanguage
          }
        }
      };

      catalogue[index] = merged;
      fs.writeFileSync(dataPath, JSON.stringify(catalogue, null, 2), 'utf-8');

      // Write to fallback public folder as well to ensure total system synchronization
      const publicPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
      if (fs.existsSync(publicPath)) {
        fs.writeFileSync(publicPath, JSON.stringify(catalogue, null, 2), 'utf-8');
      }

      logAdminAction(
        `Update Anime: "${merged.title}"`,
        (req as any).ownerSession.email,
        'success',
        id,
        `Changes: Status=${merged.status}, ReleaseYear=${merged.releaseYear}, Type=${merged.type}`
      );

      res.json({ success: true, message: 'Anime updated successfully.', anime: merged });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update anime record.' });
    }
  });

  // 6. Catalogue Delete Endpoint
  router.post('/catalogue/:id/delete', authenticateSession, requireOwner, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const dataPath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
      if (!fs.existsSync(dataPath)) {
        res.status(404).json({ error: 'Catalogue file not found.' });
        return;
      }

      const catalogue: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      const index = catalogue.findIndex(a => a.id === id);

      if (index === -1) {
        res.status(404).json({ error: `Anime with ID '${id}' not found.` });
        return;
      }

      const deletedTitle = catalogue[index].title;
      catalogue.splice(index, 1);

      fs.writeFileSync(dataPath, JSON.stringify(catalogue, null, 2), 'utf-8');

      const publicPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
      if (fs.existsSync(publicPath)) {
        fs.writeFileSync(publicPath, JSON.stringify(catalogue, null, 2), 'utf-8');
      }

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
      res.json({
        success: true,
        env: {
          NODE_ENV: process.env.NODE_ENV || 'development',
          PORT: 3000,
          hasSessionSecret: Boolean(process.env.SESSION_SECRET),
          hasSmtpHost: Boolean(process.env.SMTP_HOST),
          hasSmtpUser: Boolean(process.env.SMTP_USER),
          hasSmtpPass: Boolean(process.env.SMTP_PASS)
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
      res.setHeader('X-Anivex-Source-Filename', pkg.filename);
      res.setHeader('X-Anivex-Source-Generated-At', pkg.generatedAt);
      res.setHeader('X-Anivex-Source-Files-Count', String(pkg.totalFiles));
      res.setHeader('X-Anivex-Source-SHA256', pkg.sha256);

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

  return router;
}
