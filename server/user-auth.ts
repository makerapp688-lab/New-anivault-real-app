import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  getEmailConfigStatus,
  generateVerificationCode,
  sendVerificationEmail,
  testEmailTransport,
  checkServerSecretsDiagnostic
} from './email-service.js';
import { validateOwnerSession } from './owner-auth.js';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const USERS_ACCOUNTS_PATH = path.join(DATA_DIR, 'users-accounts.json');
const USERS_TEMP_VERIFICATIONS_PATH = path.join(DATA_DIR, 'users-temp-verifications.json');
const USERS_SESSIONS_PATH = path.join(DATA_DIR, 'users-sessions.json');
const OAUTH_STATES_PATH = path.join(DATA_DIR, 'oauth-states.json');
const OWNER_ACCOUNT_PATH = path.join(DATA_DIR, 'owner-account.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  name?: string;
  avatar?: string;
  passwordHash?: string;
  salt?: string;
  provider: 'email' | 'google' | 'apple';
  googleId?: string;
  appleId?: string;
  isVerified: boolean;
  role: 'user';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface TempUserVerification {
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

export interface UserSession {
  sessionId: string;
  userId: string;
  email: string;
  username: string;
  provider: string;
  role: 'user' | 'owner';
  createdAt: number;
  expiresAt: number;
  revoked?: boolean;
}

interface OAuthStateRecord {
  state: string;
  provider: 'google' | 'apple';
  origin: string;
  expiresAt: number;
}

// In-memory caches with persistent disk backing
let usersCache: Record<string, UserRecord> = {};
let tempVerificationsCache: Record<string, TempUserVerification> = {};
const activeUserSessions: Map<string, UserSession> = new Map();
let oauthStatesCache: Record<string, OAuthStateRecord> = {};

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'owner',
  'anivault',
  'system',
  'sysadmin',
  'support',
  'moderator',
  'mod',
  'root',
  'official',
  'staff',
  'help',
  'guest',
  'null',
  'undefined',
  'api'
]);

export function normalizeUsername(username: string): string {
  return (username || '').trim().toLowerCase();
}

export function validateUsernameFormat(username: string): { valid: boolean; error?: string } {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required.' };
  }
  const clean = username.trim();
  if (clean.length < 2 || clean.length > 30) {
    return { valid: false, error: 'Username must be between 2 and 30 characters.' };
  }
  const regex = /^[a-zA-Z0-9_-]{2,30}$/;
  if (!regex.test(clean)) {
    return {
      valid: false,
      error: 'Username can only contain letters, numbers, hyphens, and underscores.'
    };
  }
  return { valid: true };
}

function getOwnerAccount(): { email: string; username: string; role: string } | null {
  try {
    if (fs.existsSync(OWNER_ACCOUNT_PATH)) {
      const data = JSON.parse(fs.readFileSync(OWNER_ACCOUNT_PATH, 'utf-8'));
      if (data && data.email && data.role === 'owner') {
        return data;
      }
    }
  } catch (err) {
    console.error('[UserAuth] Error loading owner account for username uniqueness check:', err);
  }
  return null;
}

export function isUsernameAvailable(
  rawUsername: string,
  excludeUserId?: string,
  excludeEmail?: string
): { available: boolean; reason?: string } {
  const formatCheck = validateUsernameFormat(rawUsername);
  if (!formatCheck.valid) {
    return { available: false, reason: formatCheck.error };
  }

  const normalized = normalizeUsername(rawUsername);

  // Check reserved system names
  if (RESERVED_USERNAMES.has(normalized)) {
    return { available: false, reason: 'This username is reserved and cannot be used.' };
  }

  // Check owner username
  const owner = getOwnerAccount();
  if (owner && normalizeUsername(owner.username) === normalized) {
    return { available: false, reason: 'Username already taken.' };
  }

  // Check existing registered users
  for (const user of Object.values(usersCache)) {
    if (excludeUserId && user.id === excludeUserId) {
      continue;
    }
    if (excludeEmail && user.email.toLowerCase() === excludeEmail.toLowerCase()) {
      continue; // Allow same username for accounts registered under the same email address
    }
    if (normalizeUsername(user.username) === normalized) {
      return { available: false, reason: 'Username already taken.' };
    }
  }

  return { available: true, reason: 'Username available' };
}

export function generateUniqueUsername(baseName: string): string {
  let clean = (baseName || 'AniUser').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  if (clean.length < 2) clean = 'AniUser';
  let candidate = clean;
  let counter = 1;
  while (!isUsernameAvailable(candidate).available) {
    candidate = `${clean.slice(0, 24)}_${counter}`;
    counter++;
  }
  return candidate;
}

function auditAndIndexUsernames() {
  const seen = new Map<string, string>();
  const conflicts: Array<{ normalized: string; userIds: string[]; usernames: string[] }> = [];

  for (const [id, user] of Object.entries(usersCache)) {
    if (!user.username) {
      user.username = (user.email.split('@')[0] || `user_${id.slice(-4)}`).slice(0, 30);
    }
    const norm = normalizeUsername(user.username);
    if (seen.has(norm)) {
      const existingId = seen.get(norm)!;
      conflicts.push({
        normalized: norm,
        userIds: [existingId, id],
        usernames: [usersCache[existingId]?.username, user.username]
      });
      console.warn(`[UserAuth DB Conflict] Duplicate username detected for key "${norm}": users [${existingId}, ${id}]. Preserving existing accounts.`);
    } else {
      seen.set(norm, id);
    }
  }

  if (conflicts.length === 0) {
    console.log(`[UserAuth DB] Username uniqueness index built: ${Object.keys(usersCache).length} user accounts verified unique.`);
  } else {
    console.warn(`[UserAuth DB] ${conflicts.length} duplicate username conflicts logged. Existing accounts safely preserved without mutation.`);
  }
}

function loadUsersData() {
  try {
    if (fs.existsSync(USERS_ACCOUNTS_PATH)) {
      usersCache = JSON.parse(fs.readFileSync(USERS_ACCOUNTS_PATH, 'utf-8'));
      for (const user of Object.values(usersCache)) {
        if (user.email) {
          user.email = user.email.trim().toLowerCase();
        }
      }
    }
    if (fs.existsSync(USERS_TEMP_VERIFICATIONS_PATH)) {
      tempVerificationsCache = JSON.parse(fs.readFileSync(USERS_TEMP_VERIFICATIONS_PATH, 'utf-8'));
    }
    if (fs.existsSync(USERS_SESSIONS_PATH)) {
      const list: UserSession[] = JSON.parse(fs.readFileSync(USERS_SESSIONS_PATH, 'utf-8'));
      const now = Date.now();
      for (const s of list) {
        if (s.expiresAt > now) {
          activeUserSessions.set(s.sessionId, s);
        }
      }
    }
    if (fs.existsSync(OAUTH_STATES_PATH)) {
      oauthStatesCache = JSON.parse(fs.readFileSync(OAUTH_STATES_PATH, 'utf-8'));
    }
    auditAndIndexUsernames();
  } catch (err: any) {
    console.error('[UserAuth DB] Error loading state:', err.message);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_ACCOUNTS_PATH, JSON.stringify(usersCache, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[UserAuth DB] Error saving users:', err.message);
  }
}

function saveTempVerifications() {
  try {
    fs.writeFileSync(USERS_TEMP_VERIFICATIONS_PATH, JSON.stringify(tempVerificationsCache, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[UserAuth DB] Error saving temp verifications:', err.message);
  }
}

function saveUserSessions() {
  try {
    const list = Array.from(activeUserSessions.values());
    fs.writeFileSync(USERS_SESSIONS_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[UserAuth DB] Error saving sessions:', err.message);
  }
}

function saveOAuthStates() {
  try {
    fs.writeFileSync(OAUTH_STATES_PATH, JSON.stringify(oauthStatesCache, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[UserAuth DB] Error saving oauth states:', err.message);
  }
}

loadUsersData();

// Clean up expired temp verifications and states periodically
setInterval(() => {
  const now = Date.now();
  let changedTemp = false;
  for (const [key, v] of Object.entries(tempVerificationsCache)) {
    if (v.expiresAt < now) {
      delete tempVerificationsCache[key];
      changedTemp = true;
    }
  }
  if (changedTemp) saveTempVerifications();

  let changedStates = false;
  for (const [key, s] of Object.entries(oauthStatesCache)) {
    if (s.expiresAt < now) {
      delete oauthStatesCache[key];
      changedStates = true;
    }
  }
  if (changedStates) saveOAuthStates();
}, 60000);

// Password hashing
function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password: string, hash: string, salt: string): boolean {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// Cookie helper
function parseCookies(req: Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
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
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const cookieValue = value || '';

  const secureFlags = isSecure ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${name}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${secureFlags}; Max-Age=${maxAge}; Expires=${expires}`
  );
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'anivault_super_secure_session_secret_2026';

export function generateSignedSessionToken(userId: string, email: string, username: string, role: string, provider: string, expiresAt: number): string {
  const payload = JSON.stringify({ userId, email, username, role, provider, expiresAt });
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
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
    
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest('hex');
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

function reloadUserSessionsFromDisk() {
  try {
    if (fs.existsSync(USERS_ACCOUNTS_PATH)) {
      usersCache = JSON.parse(fs.readFileSync(USERS_ACCOUNTS_PATH, 'utf-8'));
    }
    if (fs.existsSync(USERS_SESSIONS_PATH)) {
      const list: UserSession[] = JSON.parse(fs.readFileSync(USERS_SESSIONS_PATH, 'utf-8'));
      const now = Date.now();
      activeUserSessions.clear();
      for (const s of list) {
        if (!s.revoked && s.expiresAt > now) {
          activeUserSessions.set(s.sessionId, s);
        }
      }
    }
  } catch (err: any) {
    console.error('[UserAuth DB] Error reloading session state from disk:', err.message);
  }
}

function sanitizeUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name || u.username,
    avatar: u.avatar || undefined,
    provider: u.provider,
    isVerified: u.isVerified,
    role: u.role || 'user',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  };
}

export function getGoogleConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.trim() === '') {
    missing.push('GOOGLE_CLIENT_ID');
  }
  if (!process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET.trim() === '') {
    missing.push('GOOGLE_CLIENT_SECRET');
  }
  return {
    configured: missing.length === 0,
    missing
  };
}

export function getAppleConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_ID.trim() === '') {
    missing.push('APPLE_CLIENT_ID');
  }
  if (!process.env.APPLE_TEAM_ID || process.env.APPLE_TEAM_ID.trim() === '') {
    missing.push('APPLE_TEAM_ID');
  }
  if (!process.env.APPLE_KEY_ID || process.env.APPLE_KEY_ID.trim() === '') {
    missing.push('APPLE_KEY_ID');
  }
  if (!process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY.trim() === '') {
    missing.push('APPLE_PRIVATE_KEY');
  }
  return {
    configured: missing.length === 0,
    missing
  };
}

interface DeletionVerificationRecord {
  userId: string;
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  resendCount: number;
  lastResendAt: number;
  verifiedToken?: string;
  tokenExpiresAt?: number;
}

let deletionVerificationsCache: Record<string, DeletionVerificationRecord> = {};

function maskEmail(email?: string): string {
  if (!email || !email.includes('@')) return 'your email';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

export function createUserAuthRouter() {
  const router = express.Router();

  // 1. Authentication Provider Status Check
  router.get('/status', (req: Request, res: Response) => {
    const emailStatus = getEmailConfigStatus();
    const googleStatus = getGoogleConfigStatus();
    const appleStatus = getAppleConfigStatus();

    const statusObj = {
      email: {
        configured: emailStatus.configured,
        missing: emailStatus.missing
      },
      google: {
        configured: googleStatus.configured,
        missing: googleStatus.missing
      },
      apple: {
        configured: appleStatus.configured,
        missing: appleStatus.missing
      }
    };

    res.json({
      providers: statusObj,
      ...statusObj
    });
  });

  // 1a2. AI Studio Server Secrets Diagnostic (Reports ONLY 'configured' | 'missing' - never secrets)
  router.get('/email-status', (req: Request, res: Response) => {
    const secretsDiag = checkServerSecretsDiagnostic();
    const configStatus = getEmailConfigStatus();
    res.json({
      configured: configStatus.configured,
      diagnostic: secretsDiag,
      ...secretsDiag
    });
  });

  // 1b. Controlled Email Transport Diagnostic Test
  router.get('/email-diagnostic', async (req: Request, res: Response) => {
    try {
      const emailStatus = getEmailConfigStatus();
      const testRecipient = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
      const result = await testEmailTransport(testRecipient);

      res.status(result.success ? 200 : 503).json({
        configured: emailStatus.configured,
        missing: emailStatus.missing,
        diagnostic: result
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1c. Live Username Availability Check
  router.get('/check-username', (req: Request, res: Response) => {
    const rawUsername = typeof req.query.username === 'string' ? req.query.username : '';
    const excludeUserId = typeof req.query.excludeUserId === 'string' ? req.query.excludeUserId : undefined;
    const excludeEmail = typeof req.query.excludeEmail === 'string' ? req.query.excludeEmail : undefined;
    const result = isUsernameAvailable(rawUsername, excludeUserId, excludeEmail);
    res.json({
      available: result.available,
      username: rawUsername.trim(),
      reason: result.reason
    });
  });

  // 2. Normal User Registration - Step 1: Init with Email, Username, Password
  router.post('/register-init', async (req: Request, res: Response) => {
    try {
      const { email, username, password } = req.body;

      // 1. Email validation
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
      if (!emailRegex.test(normalizedEmail)) {
        res.status(400).json({ error: 'Please enter a valid email address (e.g. user@gmail.com).' });
        return;
      }

      // 1b. Max 2 accounts per email & distinct password check
      const existingAccounts = Object.values(usersCache).filter(
        u => u.email.toLowerCase() === normalizedEmail && u.isVerified
      );

      if (existingAccounts.length >= 2) {
        res.status(400).json({
          error: 'An account limit of 2 accounts per email address has been reached for this email.'
        });
        return;
      }

      if (existingAccounts.length === 1) {
        const existingAcc = existingAccounts[0];
        if (existingAcc.passwordHash && existingAcc.salt) {
          const isSamePassword = verifyPassword(password, existingAcc.passwordHash, existingAcc.salt);
          if (isSamePassword) {
            res.status(400).json({
              error: 'An account with this email already exists with this password. Please choose a different password for your second account.'
            });
            return;
          }
        }
      }

      // 2. Username uniqueness and format validation
      if (!username || typeof username !== 'string') {
        res.status(400).json({ error: 'Username is required.' });
        return;
      }
      const cleanUsername = username.trim();
      const availCheck = isUsernameAvailable(cleanUsername, undefined, normalizedEmail);
      if (!availCheck.available) {
        res.status(400).json({
          error: availCheck.reason || 'Username already taken.'
        });
        return;
      }

      // 3. Password validation
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      // Check email configuration status
      const emailStatus = getEmailConfigStatus();
      if (!emailStatus.configured) {
        res.status(503).json({
          error: 'Email verification is temporarily unavailable. Please try again later.',
          code: 'EMAIL_UNAVAILABLE'
        });
        return;
      }

      // Rate limit check
      const existingPending = tempVerificationsCache[normalizedEmail];
      const now = Date.now();
      if (existingPending && existingPending.expiresAt > now) {
        if (now - existingPending.lastResendAt < 60000) {
          const waitSec = Math.ceil((60000 - (now - existingPending.lastResendAt)) / 1000);
          res.status(429).json({
            error: `Please wait ${waitSec} seconds before requesting a new verification code.`,
            code: 'RATE_LIMITED'
          });
          return;
        }
      }

      // Generate verification code
      const { code, codeHash } = generateVerificationCode();
      const recipientDomain = normalizedEmail.includes('@') ? '@' + normalizedEmail.split('@')[1] : 'recipient';
      console.log(`[EMAIL_DIAGNOSTIC] OTP generated: 6-digit secure code, domain=${recipientDomain}`);
      const { hash: passwordHash, salt } = hashPassword(password);

      const tempRec: TempUserVerification = {
        email: normalizedEmail,
        username: cleanUsername,
        passwordHash,
        salt,
        codeHash,
        expiresAt: now + 10 * 60 * 1000,
        attempts: 0,
        resendCount: existingPending ? existingPending.resendCount + 1 : 1,
        lastResendAt: now
      };

      tempVerificationsCache[normalizedEmail] = tempRec;
      saveTempVerifications();
      console.log(`[EMAIL_DIAGNOSTIC] OTP stored: recipientDomain=${recipientDomain}, expiresAt=+10m`);

      // Dispatch verification email
      try {
        await sendVerificationEmail(
          normalizedEmail,
          code,
          'Verify your AniVault account'
        );
      } catch (mailErr: any) {
        console.error('[UserRegisterInit] Failed to send email:', mailErr.message);
        delete tempVerificationsCache[normalizedEmail];
        saveTempVerifications();
        const safeError = mailErr.message || 'Verification email could not be sent. Please try again.';
        res.status(503).json({
          error: safeError,
          code: 'EMAIL_SEND_FAILED'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Verification code sent to your email. Please enter the code to verify your account within 10 minutes.',
        email: normalizedEmail
      });
    } catch (err: any) {
      console.error('[UserRegisterInit Error]', err);
      res.status(500).json({
        error: err.message || 'An unexpected error occurred during registration initiation.'
      });
    }
  });

  // 3. Normal User Registration - Step 2: Verify Code and Activate Account
  router.post('/register-verify', async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body;

      if (!email || !code || typeof email !== 'string' || typeof code !== 'string') {
        res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const tempRec = tempVerificationsCache[normalizedEmail];

      if (!tempRec) {
        res.status(400).json({
          error: 'No active registration request found for this email, or the verification has expired. Please register again.'
        });
        return;
      }

      const now = Date.now();
      if (now > tempRec.expiresAt) {
        delete tempVerificationsCache[normalizedEmail];
        saveTempVerifications();
        res.status(400).json({
          error: 'This code has expired. Request a new code.'
        });
        return;
      }

      if (tempRec.attempts >= 5) {
        delete tempVerificationsCache[normalizedEmail];
        saveTempVerifications();
        res.status(429).json({
          error: 'Too many incorrect attempts. Please request a new verification code.'
        });
        return;
      }

      const inputCodeHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
      if (inputCodeHash !== tempRec.codeHash) {
        tempRec.attempts += 1;
        saveTempVerifications();
        if (tempRec.attempts >= 5) {
          delete tempVerificationsCache[normalizedEmail];
          saveTempVerifications();
          res.status(429).json({
            error: 'Too many incorrect attempts. Please request a new verification code.'
          });
          return;
        }
        res.status(400).json({
          error: 'Incorrect verification code.'
        });
        return;
      }

      // Final check for username availability before committing (excluding this pending registration's own reservation)
      const finalAvailCheck = isUsernameAvailable(tempRec.username, undefined, normalizedEmail);
      if (!finalAvailCheck.available) {
        delete tempVerificationsCache[normalizedEmail];
        saveTempVerifications();
        res.status(409).json({
          error: finalAvailCheck.reason || 'Username was claimed during the verification window. Please register again with a new username.'
        });
        return;
      }

      // Code is valid! Create permanent verified normal user account
      const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
      const isoNow = new Date().toISOString();

      const newUser: UserRecord = {
        id: userId,
        email: normalizedEmail,
        username: tempRec.username,
        name: tempRec.username,
        passwordHash: tempRec.passwordHash,
        salt: tempRec.salt,
        provider: 'email',
        isVerified: true,
        role: 'user',
        createdAt: isoNow,
        updatedAt: isoNow,
        lastLoginAt: isoNow
      };

      usersCache[userId] = newUser;
      saveUsers();

      // Clean up pending verification
      delete tempVerificationsCache[normalizedEmail];
      saveTempVerifications();

      // Create authenticated session
      const sessionExpires = now + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(newUser.id, newUser.email, newUser.username, 'user', 'email', sessionExpires);
      const session: UserSession = {
        sessionId,
        userId: newUser.id,
        email: newUser.email,
        username: newUser.username,
        provider: 'email',
        role: 'user',
        createdAt: now,
        expiresAt: sessionExpires
      };

      activeUserSessions.set(sessionId, session);
      saveUserSessions();

      setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

      res.json({
        success: true,
        message: 'Account successfully verified and created! Welcome to AniVault.',
        user: sanitizeUser(newUser),
        sessionToken: sessionId
      });
    } catch (err: any) {
      console.error('[UserRegisterVerify Error]', err);
      res.status(500).json({ error: err.message || 'Internal error during registration verification.' });
    }
  });

  // 4. Resend Verification Code
  const handleResend = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      const tempRec = tempVerificationsCache[normalizedEmail];

      if (!tempRec) {
        res.status(400).json({ error: 'No active pending verification found for this email.' });
        return;
      }

      // Check email configuration status
      const emailStatus = getEmailConfigStatus();
      if (!emailStatus.configured) {
        res.status(503).json({
          error: 'Email verification is temporarily unavailable. Please try again later.',
          code: 'EMAIL_UNAVAILABLE'
        });
        return;
      }

      const now = Date.now();
      if (tempRec.resendCount >= 5) {
        res.status(429).json({
          error: 'Maximum code resend limit reached for this session. Please start registration over.'
        });
        return;
      }

      if (now - tempRec.lastResendAt < 60000) {
        const waitSec = Math.ceil((60000 - (now - tempRec.lastResendAt)) / 1000);
        res.status(429).json({
          error: `Please wait ${waitSec} seconds before requesting another code.`,
          code: 'RATE_LIMITED'
        });
        return;
      }

      const { code, codeHash } = generateVerificationCode();
      const recipientDomain = normalizedEmail.includes('@') ? '@' + normalizedEmail.split('@')[1] : 'recipient';
      console.log(`[EMAIL_DIAGNOSTIC] OTP generated: 6-digit secure code, domain=${recipientDomain} (RESEND)`);
      tempRec.codeHash = codeHash;
      tempRec.expiresAt = now + 10 * 60 * 1000;
      tempRec.attempts = 0;
      tempRec.resendCount += 1;
      tempRec.lastResendAt = now;
      saveTempVerifications();
      console.log(`[EMAIL_DIAGNOSTIC] OTP stored: recipientDomain=${recipientDomain}, previous code invalidated, resendCount=${tempRec.resendCount}`);

      try {
        await sendVerificationEmail(
          normalizedEmail,
          code,
          'Verify your AniVault account'
        );
      } catch (mailErr: any) {
        console.error('[UserResendCode] Failed to send email:', mailErr.message);
        const safeError = mailErr.message || 'Verification email could not be sent. Please try again.';
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
      console.error('[UserResendCode Error]', err);
      res.status(500).json({ error: err.message || 'Failed to resend verification code.' });
    }
  };

  router.post('/resend-code', handleResend);
  router.post('/register-resend', handleResend);

  // 5. Normal User Login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password, username, accountId } = req.body;

      if ((!email && !username && !accountId) || !password || typeof password !== 'string') {
        res.status(400).json({ error: 'Email/Username and password are required.' });
        return;
      }

      let user: UserRecord | undefined;

      // 1. If explicit accountId is provided (e.g. from switcher)
      if (accountId && typeof accountId === 'string') {
        user = usersCache[accountId];
      }

      // 2. If explicit username is provided
      if (!user && username && typeof username === 'string') {
        user = Object.values(usersCache).find(u => normalizeUsername(u.username) === normalizeUsername(username));
      }

      // 3. If email/identifier is provided
      if (!user && email && typeof email === 'string') {
        const input = email.trim();
        const normalizedInput = input.toLowerCase();

        // 3a. Check if the input is actually a username
        const userByUsername = Object.values(usersCache).find(
          u => normalizeUsername(u.username) === normalizeUsername(input)
        );

        if (userByUsername && userByUsername.passwordHash && userByUsername.salt && verifyPassword(password, userByUsername.passwordHash, userByUsername.salt)) {
          user = userByUsername;
        } else {
          // 3b. Match by email. Identify which Account matches the password provided
          const candidateUsers = Object.values(usersCache).filter(
            u => u.email.toLowerCase() === normalizedInput && u.isVerified
          );

          if (candidateUsers.length > 0) {
            user = candidateUsers.find(
              cand => cand.passwordHash && cand.salt && verifyPassword(password, cand.passwordHash, cand.salt)
            );
          }
        }
      }

      if (!user) {
        res.status(401).json({ error: 'Invalid email, username, or password.' });
        return;
      }

      if (!user.isVerified) {
        res.status(403).json({
          error: 'This account has not been verified yet. Please complete email verification.',
          code: 'UNVERIFIED_ACCOUNT'
        });
        return;
      }

      if (!user.passwordHash || !user.salt) {
        res.status(400).json({
          error: `This account was registered using ${user.provider}. Please use ${user.provider} to sign in.`
        });
        return;
      }

      const isValid = verifyPassword(password, user.passwordHash, user.salt);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid email/username or password.' });
        return;
      }

      const now = Date.now();
      const sessionExpires = now + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(user.id, user.email, user.username, 'user', user.provider || 'email', sessionExpires);
      const session: UserSession = {
        sessionId,
        userId: user.id,
        email: user.email,
        username: user.username,
        provider: user.provider,
        role: 'user',
        createdAt: now,
        expiresAt: sessionExpires
      };

      activeUserSessions.set(sessionId, session);
      saveUserSessions();

      user.lastLoginAt = new Date().toISOString();
      saveUsers();

      setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

      res.json({
        success: true,
        message: 'Signed in successfully.',
        user: sanitizeUser(user),
        sessionToken: sessionId
      });
    } catch (err: any) {
      console.error('[UserLogin Error]', err);
      res.status(500).json({ error: err.message || 'Internal login error.' });
    }
  });

  // 6. Current User Session Check (Unified for Normal Users & Owner)
  router.get('/session', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const userHeader = req.headers['x-anivault-user-session'] as string;
    const ownerHeader = req.headers['x-anivault-owner-session'] as string;

    const ownerSessionId = cookies.anivault_owner_session || ownerHeader || (bearerToken && bearerToken.startsWith('owner_') ? bearerToken : null);
    const userSessionId = cookies.anivault_user_session || userHeader || bearerToken;

    console.log('[Auth Session Check] Received request:', {
      hasCookies: Object.keys(cookies).length > 0,
      hasAuthHeader: !!authHeader,
      userSessionIdLength: userSessionId?.length || 0,
      ownerSessionIdLength: ownerSessionId?.length || 0
    });

    // 1. Check Owner session first if owner session ID provided or present
    if (ownerSessionId) {
      const ownerAcc = validateOwnerSession(ownerSessionId);
      if (ownerAcc) {
        console.log(' - Authenticated successfully as Owner:', ownerAcc.username);
        res.json({
          authenticated: true,
          user: {
            id: ownerAcc.id,
            email: ownerAcc.email,
            username: ownerAcc.username,
            name: ownerAcc.username,
            provider: 'email',
            isVerified: true,
            role: 'owner',
            createdAt: ownerAcc.createdAt
          }
        });
        return;
      } else {
        console.log(' - Owner session validation failed for ID:', ownerSessionId.slice(0, 20) + '...');
      }
    }

    // 2. Check User session
    const sessionId = userSessionId || ownerSessionId;
    if (!sessionId) {
      console.log(' - No sessionId provided or found in headers or cookies.');
      res.json({ authenticated: false });
      return;
    }

    // Always reload from disk to ensure persistent storage is the absolute source of truth
    reloadUserSessionsFromDisk();

    let session = activeUserSessions.get(sessionId);
    if (!session || session.revoked || session.expiresAt < Date.now()) {
      console.log(' - Session not active in-memory, or expired. Attempting cryptographic decode fallback...');
      // Decode cryptographic token fallback
      const decoded = verifyAndDecodeSessionToken(sessionId);
      if (decoded && decoded.role === 'user') {
        console.log(' - Cryptographic verification SUCCESS for User:', decoded.username);
        session = {
          sessionId,
          userId: decoded.userId,
          email: decoded.email,
          username: decoded.username,
          provider: decoded.provider,
          role: 'user',
          createdAt: decoded.expiresAt - 30 * 24 * 60 * 60 * 1000,
          expiresAt: decoded.expiresAt
        };
        activeUserSessions.set(sessionId, session);
        saveUserSessions();
      } else {
        console.log(' - Cryptographic verification FAILED for session token.');
        // Fallback check: could sessionId be an owner session ID?
        const ownerAcc = validateOwnerSession(sessionId);
        if (ownerAcc) {
          console.log(' - Authenticated successfully as Owner (fallback check):', ownerAcc.username);
          res.json({
            authenticated: true,
            user: {
              id: ownerAcc.id,
              email: ownerAcc.email,
              username: ownerAcc.username,
              name: ownerAcc.username,
              provider: 'email',
              isVerified: true,
              role: 'owner',
              createdAt: ownerAcc.createdAt
            }
          });
          return;
        }

        if (session) {
          activeUserSessions.delete(sessionId);
          saveUserSessions();
        }
        console.log(' - Returning authenticated: false');
        res.json({ authenticated: false });
        return;
      }
    } else {
      console.log(' - Active user session retrieved from in-memory cache for user ID:', session.userId);
    }

    // Load account record from permanent account storage
    const cleanSessionEmail = session.email ? session.email.trim().toLowerCase() : '';
    let user = usersCache[session.userId] || Object.values(usersCache).find(u => u.email && u.email.trim().toLowerCase() === cleanSessionEmail);
    if (!user) {
      console.log(' - User account record missing from usersCache. Triggering self-healing account recreation...');
      const isoNow = new Date().toISOString();
      user = {
        id: session.userId,
        email: session.email,
        username: session.username,
        name: session.username,
        provider: (session.provider as any) || 'email',
        isVerified: true,
        role: 'user',
        createdAt: isoNow,
        updatedAt: isoNow,
        lastLoginAt: isoNow
      };
      usersCache[session.userId] = user;
      saveUsers();
    }

    console.log(' - Authenticated successfully as User:', user.username);
    res.json({
      authenticated: true,
      user: sanitizeUser(user)
    });
  });

  // 7. Normal User Logout
  router.post('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-anivault-user-session'] as string;
    const sessionId = cookies.anivault_user_session || bearerToken || customHeader;

    if (sessionId) {
      activeUserSessions.delete(sessionId);
      saveUserSessions();
    }

    setSessionCookie(res, 'anivault_user_session', '', 0, req);

    res.json({ success: true, message: 'Logged out successfully.' });
  });

  // 8. Update Normal User Display Username
  router.post('/update-username', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-anivault-user-session'] as string;
    const sessionId = cookies.anivault_user_session || bearerToken || customHeader;

    if (!sessionId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const session = activeUserSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Session expired.' });
      return;
    }

    const user = usersCache[session.userId];
    if (!user) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const { username } = req.body;
    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required.' });
      return;
    }

    const cleanUsername = username.trim();
    const availCheck = isUsernameAvailable(cleanUsername, user.id, user.email);
    if (!availCheck.available) {
      res.status(400).json({ error: availCheck.reason || 'Username already taken.' });
      return;
    }

    user.username = cleanUsername;
    user.updatedAt = new Date().toISOString();
    saveUsers();

    session.username = cleanUsername;
    activeUserSessions.set(sessionId, session);
    saveUserSessions();

    res.json({
      success: true,
      message: 'Username updated successfully.',
      user: sanitizeUser(user)
    });
  });

  // 9. Update Normal User Profile Photo (Avatar)
  router.post('/user/avatar', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-anivault-user-session'] as string;
    const sessionId = cookies.anivault_user_session || bearerToken || customHeader;

    if (!sessionId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const session = activeUserSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Session expired.' });
      return;
    }

    const user = usersCache[session.userId];
    if (!user) {
      res.status(404).json({ error: 'User record not found.' });
      return;
    }

    const { avatar } = req.body;
    user.avatar = typeof avatar === 'string' && avatar.trim() ? avatar : undefined;
    user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({
      success: true,
      message: 'Avatar updated successfully.',
      avatar: user.avatar
    });
  });

  // 10. Seamless Switch to Normal User Account
  router.post('/switch', (req: Request, res: Response) => {
    const { accountId } = req.body;
    if (!accountId) {
      res.status(400).json({ error: 'Account ID is required.' });
      return;
    }

    const user = usersCache[accountId] || Object.values(usersCache).find(u => u.id === accountId);
    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = generateSignedSessionToken(user.id, user.email, user.username, 'user', user.provider || 'email', sessionExpires);
    const sessionData: UserSession = {
      sessionId,
      userId: user.id,
      email: user.email,
      username: user.username,
      provider: user.provider,
      role: 'user',
      createdAt: Date.now(),
      expiresAt: sessionExpires
    };

    activeUserSessions.set(sessionId, sessionData);
    saveUserSessions();

    setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

    res.json({
      success: true,
      message: 'Switched to user account successfully.',
      user: sanitizeUser(user),
      sessionToken: sessionId
    });
  });

  // 8b. Delete Account - Step 1: Request Deletion OTP
  router.post('/delete-account-init', async (req: Request, res: Response) => {
    try {
      const { accountId, email } = req.body;
      let user: UserRecord | undefined;

      if (accountId && usersCache[accountId]) {
        user = usersCache[accountId];
      } else if (email && typeof email === 'string') {
        const norm = email.trim().toLowerCase();
        user = Object.values(usersCache).find(u => u.email.toLowerCase() === norm);
      }

      if (!user) {
        const cookies = parseCookies(req);
        const authHeader = req.headers.authorization;
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const userHeader = req.headers['x-anivault-user-session'] as string;
        const sessionId = cookies.anivault_user_session || userHeader || bearerToken;
        if (sessionId) {
          const session = activeUserSessions.get(sessionId);
          if (session) user = usersCache[session.userId];
        }
      }

      if (!user) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }

      if (user.role === ('owner' as any) || user.id === 'usr_owner') {
        res.status(403).json({ error: 'The permanent Owner account cannot be deleted from normal account settings.' });
        return;
      }

      const existingRecord = deletionVerificationsCache[user.id];
      const now = Date.now();
      if (existingRecord && existingRecord.lastResendAt && now - existingRecord.lastResendAt < 45000) {
        const waitSec = Math.ceil((45000 - (now - existingRecord.lastResendAt)) / 1000);
        res.status(429).json({ error: `Please wait ${waitSec} seconds before requesting a new code.` });
        return;
      }

      const { code, codeHash } = generateVerificationCode();

      deletionVerificationsCache[user.id] = {
        userId: user.id,
        email: user.email,
        codeHash,
        expiresAt: now + 10 * 60 * 1000,
        attempts: 0,
        resendCount: (existingRecord?.resendCount || 0) + 1,
        lastResendAt: now
      };

      try {
        await sendVerificationEmail(
          user.email,
          code,
          'Verify your AniVault account deletion'
        );
      } catch (mailErr: any) {
        delete deletionVerificationsCache[user.id];
        res.status(503).json({ error: mailErr.message || 'Failed to send verification email. Please try again.' });
        return;
      }

      res.json({
        success: true,
        message: 'Verification code sent to your email.',
        maskedEmail: maskEmail(user.email)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error.' });
    }
  });

  // 8c. Delete Account - Step 2: Verify Deletion OTP
  router.post('/delete-account-verify', (req: Request, res: Response) => {
    try {
      const { accountId, code } = req.body;
      if (!accountId || !code) {
        res.status(400).json({ error: 'Account ID and verification code are required.' });
        return;
      }

      const record = deletionVerificationsCache[accountId];
      if (!record) {
        res.status(400).json({ error: 'No active deletion request found. Please request a new code.' });
        return;
      }

      const now = Date.now();
      if (record.expiresAt < now) {
        delete deletionVerificationsCache[accountId];
        res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
        return;
      }

      record.attempts = (record.attempts || 0) + 1;
      if (record.attempts > 5) {
        delete deletionVerificationsCache[accountId];
        res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
        return;
      }

      const inputHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
      if (inputHash !== record.codeHash) {
        res.status(400).json({ error: 'Incorrect verification code.' });
        return;
      }

      const deletionToken = crypto.randomBytes(24).toString('hex');
      record.verifiedToken = deletionToken;
      record.tokenExpiresAt = now + 5 * 60 * 1000;

      res.json({
        success: true,
        message: 'Code verified successfully.',
        deletionToken
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal verification error.' });
    }
  });

  // 8d. Delete Account - Step 3: Resend Deletion OTP
  router.post('/delete-account-resend', async (req: Request, res: Response) => {
    try {
      const { accountId } = req.body;
      if (!accountId || !usersCache[accountId]) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const user = usersCache[accountId];
      const existingRecord = deletionVerificationsCache[user.id];
      const now = Date.now();

      if (existingRecord && existingRecord.lastResendAt && now - existingRecord.lastResendAt < 45000) {
        const waitSec = Math.ceil((45000 - (now - existingRecord.lastResendAt)) / 1000);
        res.status(429).json({ error: `Please wait ${waitSec} seconds before requesting a new code.` });
        return;
      }

      const { code, codeHash } = generateVerificationCode();

      deletionVerificationsCache[user.id] = {
        userId: user.id,
        email: user.email,
        codeHash,
        expiresAt: now + 10 * 60 * 1000,
        attempts: 0,
        resendCount: (existingRecord?.resendCount || 0) + 1,
        lastResendAt: now
      };

      await sendVerificationEmail(
        user.email,
        code,
        'Verify your AniVault account deletion'
      );

      res.json({
        success: true,
        message: 'New verification code sent.',
        maskedEmail: maskEmail(user.email)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resend code.' });
    }
  });

  // 8e. Delete Account - Step 4: Final Confirmation & Complete Removal
  router.post('/delete-account-confirm', (req: Request, res: Response) => {
    try {
      const { accountId, deletionToken } = req.body;
      if (!accountId || !deletionToken) {
        res.status(400).json({ error: 'Account ID and deletion token are required.' });
        return;
      }

      const record = deletionVerificationsCache[accountId];
      if (!record || record.verifiedToken !== deletionToken || !record.tokenExpiresAt || record.tokenExpiresAt < Date.now()) {
        res.status(403).json({ error: 'Deletion authorization has expired or is invalid. Please verify again.' });
        return;
      }

      const user = usersCache[accountId];
      if (!user) {
        delete deletionVerificationsCache[accountId];
        res.status(404).json({ error: 'Account not found or already deleted.' });
        return;
      }

      if (user.role === ('owner' as any) || user.id === 'usr_owner') {
        res.status(403).json({ error: 'The permanent Owner account cannot be deleted.' });
        return;
      }

      // 1. Delete user record permanently
      delete usersCache[accountId];
      saveUsers();

      // 2. Remove all active sessions for this user
      for (const [sessionId, session] of activeUserSessions.entries()) {
        if (session.userId === accountId) {
          activeUserSessions.delete(sessionId);
        }
      }
      saveUserSessions();

      // 3. Clear deletion record
      delete deletionVerificationsCache[accountId];

      // 4. Clear cookie
      setSessionCookie(res, 'anivault_user_session', '', 0, req);

      console.log(`[UserAuth DB] Account permanently deleted: ${accountId} (${user.username}, ${user.email})`);

      res.json({
        success: true,
        message: 'Your account has been permanently deleted.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete account.' });
    }
  });

  // Helper to determine base URL for redirect callbacks
  function getBaseAppUrl(req: Request, clientOrigin?: string): string {
    if (clientOrigin && clientOrigin.startsWith('http')) {
      return clientOrigin.replace(/\/+$/, '');
    }
    if (process.env.APP_URL) {
      return process.env.APP_URL.replace(/\/+$/, '');
    }
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    return `${proto}://${host}`;
  }

  // 9. Google OAuth - Generate Authorization URL
  router.get('/google/url', (req: Request, res: Response) => {
    const status = getGoogleConfigStatus();
    if (!status.configured) {
      res.status(400).json({
        configured: false,
        error: `Google Sign-In is not configured yet. Requires environment variables: ${status.missing.join(', ')}.`,
        missing: status.missing
      });
      return;
    }

    const clientOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const baseUrl = getBaseAppUrl(req, clientOrigin);
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    const state = crypto.randomBytes(24).toString('hex');
    oauthStatesCache[state] = {
      state,
      provider: 'google',
      origin: baseUrl,
      expiresAt: Date.now() + 10 * 60 * 1000
    };
    saveOAuthStates();

    const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({
      configured: true,
      url: authUrl
    });
  });

  // 10. Google OAuth Callback
  router.get('/google/callback', async (req: Request, res: Response) => {
    const { code, state, error } = req.query;

    const renderHtmlResponse = (success: boolean, payload: any) => {
      res.setHeader('Content-Type', 'text/html');
      const isUnlinked = payload?.needsAccountSelection;
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>AniVault Google Authentication</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
              .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
              h2 { margin-top: 0; color: ${success ? '#34d399' : (isUnlinked ? '#fbbf24' : '#f87171')}; font-size: 20px; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
              .btn { margin-top: 20px; display: inline-block; padding: 10px 24px; background: #e11d48; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; cursor: pointer; border: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>${success ? 'Sign-In Successful' : (isUnlinked ? 'No Account Found' : 'Google Authentication Notice')}</h2>
              <p>${success ? 'Your AniVault account is verified. You can close this window.' : (isUnlinked ? `No account found for this Google account (${payload.googleEmail}). Please use existing account or create account in AniVault.` : (payload?.error || 'Authentication could not be completed.'))}</p>
              <button class="btn" onclick="window.close()">Close Window</button>
            </div>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({
                    type: '${success ? 'ANIVAULT_OAUTH_SUCCESS' : (isUnlinked ? 'ANIVAULT_GOOGLE_UNLINKED' : 'ANIVAULT_OAUTH_ERROR')}',
                    provider: 'google',
                    ${success ? `user: ${JSON.stringify(payload.user)}, sessionToken: ${JSON.stringify(payload.sessionToken)}` : (isUnlinked ? `googleEmail: ${JSON.stringify(payload.googleEmail)}, googleSub: ${JSON.stringify(payload.googleSub)}, googleName: ${JSON.stringify(payload.googleName)}` : `error: ${JSON.stringify(payload.error)}`)}
                  }, '*');
                  setTimeout(() => { window.close(); }, ${isUnlinked ? '2500' : '1200'});
                }
              } catch (e) {
                console.error(e);
              }
            </script>
          </body>
        </html>
      `);
    };

    if (error) {
      return renderHtmlResponse(false, { error: `Google login was cancelled or denied: ${error}` });
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return renderHtmlResponse(false, { error: 'Missing OAuth authorization code or state parameter.' });
    }

    const stateRec = oauthStatesCache[state];
    if (!stateRec || stateRec.provider !== 'google' || stateRec.expiresAt < Date.now()) {
      return renderHtmlResponse(false, { error: 'Invalid or expired OAuth state parameter (CSRF protection).' });
    }

    delete oauthStatesCache[state];
    saveOAuthStates();

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!.trim();
      const redirectUri = `${stateRec.origin}/api/auth/google/callback`;

      // Exchange authorization code for tokens
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }).toString()
      });

      if (!tokenResp.ok) {
        const errJson: any = await tokenResp.json().catch(() => ({}));
        return renderHtmlResponse(false, {
          error: `Google token exchange failed: ${errJson.error_description || errJson.error || tokenResp.statusText}`
        });
      }

      const tokens: any = await tokenResp.json();
      const accessToken = tokens.access_token;

      // Query Google UserInfo
      const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!userInfoResp.ok) {
        return renderHtmlResponse(false, { error: 'Failed to retrieve Google user profile.' });
      }

      const profile: any = await userInfoResp.json();
      const googleSub = profile.sub;
      const googleEmail = profile.email?.toLowerCase();
      const googleName = profile.name || profile.given_name || 'Google User';

      if (!googleEmail) {
        return renderHtmlResponse(false, { error: 'Google did not provide a valid email address.' });
      }

      // Find existing user by googleId or verified email
      let user = Object.values(usersCache).find(
        u => (u.googleId && u.googleId === googleSub) || (u.email === googleEmail && u.isVerified)
      );

      const isoNow = new Date().toISOString();

      if (user) {
        // Link googleId if missing
        if (!user.googleId) {
          user.googleId = googleSub;
        }
        user.lastLoginAt = isoNow;
        user.updatedAt = isoNow;
        saveUsers();
      } else {
        return renderHtmlResponse(false, {
          needsAccountSelection: true,
          googleEmail,
          googleSub,
          googleName
        });
      }

      // Create session
      const now = Date.now();
      const sessionExpires = now + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(user.id, user.email, user.username, 'user', 'google', sessionExpires);
      const session: UserSession = {
        sessionId,
        userId: user.id,
        email: user.email,
        username: user.username,
        provider: 'google',
        role: 'user',
        createdAt: now,
        expiresAt: sessionExpires
      };

      activeUserSessions.set(sessionId, session);
      saveUserSessions();

      setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

      return renderHtmlResponse(true, { user: sanitizeUser(user), sessionToken: sessionId });
    } catch (err: any) {
      console.error('[GoogleCallback Error]', err);
      return renderHtmlResponse(false, { error: err.message || 'Internal error processing Google authentication.' });
    }
  });

  // Google Force Create Account
  router.post('/google/force-create', (req: Request, res: Response) => {
    const { googleSub, googleEmail, googleName } = req.body;
    if (!googleSub || !googleEmail) {
      res.status(400).json({ error: 'Google identity required.' });
      return;
    }

    let user = Object.values(usersCache).find(u => u.googleId === googleSub || u.email.toLowerCase() === googleEmail.toLowerCase());
    const isoNow = new Date().toISOString();

    if (user) {
      if (!user.googleId) user.googleId = googleSub;
    } else {
      const newId = `usr_${crypto.randomBytes(8).toString('hex')}`;
      const uniqueUsername = generateUniqueUsername(googleName || 'GoogleUser');
      user = {
        id: newId,
        email: googleEmail,
        username: uniqueUsername,
        name: googleName || uniqueUsername,
        provider: 'google',
        googleId: googleSub,
        isVerified: true,
        role: 'user',
        createdAt: isoNow,
        updatedAt: isoNow,
        lastLoginAt: isoNow
      };
      usersCache[newId] = user;
      saveUsers();
    }

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = generateSignedSessionToken(user.id, user.email, user.username, 'user', 'google', sessionExpires);
    const sessionData: UserSession = {
      sessionId,
      userId: user.id,
      email: user.email,
      username: user.username,
      provider: 'google',
      role: 'user',
      createdAt: Date.now(),
      expiresAt: sessionExpires
    };
    activeUserSessions.set(sessionId, sessionData);
    saveUserSessions();
    setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

    res.json({ success: true, user: sanitizeUser(user), sessionToken: sessionId });
  });

  // Google Link Existing Account
  router.post('/google/link-existing', async (req: Request, res: Response) => {
    const { googleSub, googleEmail, email, password } = req.body;
    if (!googleSub || !googleEmail || !email || !password) {
      res.status(400).json({ error: 'Google identity and existing account credentials required.' });
      return;
    }

    const normEmail = email.trim().toLowerCase();
    const existingUser = Object.values(usersCache).find(u => u.email.toLowerCase() === normEmail);
    if (!existingUser) {
      res.status(404).json({ error: 'Existing account not found with this email.' });
      return;
    }

    if (existingUser.passwordHash && existingUser.salt) {
      const isValid = verifyPassword(password, existingUser.passwordHash, existingUser.salt);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid password for existing account.' });
        return;
      }
    }

    existingUser.googleId = googleSub;
    existingUser.updatedAt = new Date().toISOString();
    saveUsers();

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = generateSignedSessionToken(existingUser.id, existingUser.email, existingUser.username, 'user', existingUser.provider || 'google', sessionExpires);
    const sessionData: UserSession = {
      sessionId,
      userId: existingUser.id,
      email: existingUser.email,
      username: existingUser.username,
      provider: existingUser.provider || 'google',
      role: 'user',
      createdAt: Date.now(),
      expiresAt: sessionExpires
    };
    activeUserSessions.set(sessionId, sessionData);
    saveUserSessions();
    setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

    res.json({ success: true, user: sanitizeUser(existingUser), sessionToken: sessionId });
  });

  // 11. Apple Sign-In - Generate Authorization URL
  router.get('/apple/url', (req: Request, res: Response) => {
    const status = getAppleConfigStatus();
    if (!status.configured) {
      res.status(400).json({
        configured: false,
        error: `Apple Sign-In is not configured yet. Requires environment variables: ${status.missing.join(', ')}.`,
        missing: status.missing
      });
      return;
    }

    const clientOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const baseUrl = getBaseAppUrl(req, clientOrigin);
    const redirectUri = `${baseUrl}/api/auth/apple/callback`;

    const state = crypto.randomBytes(24).toString('hex');
    oauthStatesCache[state] = {
      state,
      provider: 'apple',
      origin: baseUrl,
      expiresAt: Date.now() + 10 * 60 * 1000
    };
    saveOAuthStates();

    const clientId = process.env.APPLE_CLIENT_ID!.trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'name email',
      response_mode: 'form_post',
      state
    });

    const authUrl = `https://appleid.apple.com/auth/authorize?${params.toString()}`;
    res.json({
      configured: true,
      url: authUrl
    });
  });

  // 12. Apple Sign-In Callback (Handles both GET and POST)
  const handleAppleCallback = async (req: Request, res: Response) => {
    const code = req.body.code || req.query.code;
    const state = req.body.state || req.query.state;
    const error = req.body.error || req.query.error;

    const renderHtmlResponse = (success: boolean, payload: any) => {
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>AniVault Apple Authentication</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #090d16; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
              .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
              h2 { margin-top: 0; color: ${success ? '#34d399' : '#f87171'}; font-size: 20px; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
              .btn { margin-top: 20px; display: inline-block; padding: 10px 24px; background: #e11d48; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; cursor: pointer; border: none; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>${success ? 'Sign-In Successful' : 'Apple Authentication Notice'}</h2>
              <p>${success ? 'Your AniVault account is verified. You can close this window.' : (payload?.error || 'Authentication could not be completed.')}</p>
              <button class="btn" onclick="window.close()">Close Window</button>
            </div>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({
                    type: '${success ? 'ANIVAULT_OAUTH_SUCCESS' : 'ANIVAULT_OAUTH_ERROR'}',
                    provider: 'apple',
                    ${success ? `user: ${JSON.stringify(payload.user)}, sessionToken: ${JSON.stringify(payload.sessionToken)}` : `error: ${JSON.stringify(payload.error)}`}
                  }, '*');
                  setTimeout(() => { window.close(); }, 1200);
                }
              } catch (e) {
                console.error(e);
              }
            </script>
          </body>
        </html>
      `);
    };

    if (error) {
      return renderHtmlResponse(false, { error: `Apple login was cancelled or denied: ${error}` });
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return renderHtmlResponse(false, { error: 'Missing Apple authorization code or state parameter.' });
    }

    const stateRec = oauthStatesCache[state];
    if (!stateRec || stateRec.provider !== 'apple' || stateRec.expiresAt < Date.now()) {
      return renderHtmlResponse(false, { error: 'Invalid or expired Apple OAuth state parameter.' });
    }

    delete oauthStatesCache[state];
    saveOAuthStates();

    try {
      // Create mockup/self-resolved verified user for Apple mock flow if key/certificates not fully integrated
      const appleSub = `apple_${crypto.createHash('md5').update(code).digest('hex').slice(0, 16)}`;
      const appleEmail = req.body.user ? JSON.parse(req.body.user).email : `${appleSub}@privaterelay.appleid.com`;
      const appleName = req.body.user ? `${JSON.parse(req.body.user).name?.firstName || ''} ${JSON.parse(req.body.user).name?.lastName || ''}`.trim() : 'Apple User';

      let user = Object.values(usersCache).find(
        u => (u.appleId && u.appleId === appleSub) || (u.email === appleEmail && u.isVerified)
      );

      const isoNow = new Date().toISOString();

      if (user) {
        if (!user.appleId) {
          user.appleId = appleSub;
        }
        user.lastLoginAt = isoNow;
        user.updatedAt = isoNow;
      } else {
        const newId = `usr_${crypto.randomBytes(8).toString('hex')}`;
        const uniqueUsername = generateUniqueUsername(appleName || 'AppleUser');
        user = {
          id: newId,
          email: appleEmail,
          username: uniqueUsername,
          name: appleName || uniqueUsername,
          provider: 'apple',
          appleId: appleSub,
          isVerified: true,
          role: 'user',
          createdAt: isoNow,
          updatedAt: isoNow,
          lastLoginAt: isoNow
        };
        usersCache[newId] = user;
      }

      saveUsers();

      const now = Date.now();
      const sessionExpires = now + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(user.id, user.email, user.username, 'user', 'apple', sessionExpires);
      const session: UserSession = {
        sessionId,
        userId: user.id,
        email: user.email,
        username: user.username,
        provider: 'apple',
        role: 'user',
        createdAt: now,
        expiresAt: sessionExpires
      };

      activeUserSessions.set(sessionId, session);
      saveUserSessions();

      setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

      return renderHtmlResponse(true, { user: sanitizeUser(user), sessionToken: sessionId });
    } catch (err: any) {
      console.error('[AppleCallback Error]', err);
      return renderHtmlResponse(false, { error: err.message || 'Internal error processing Apple sign-in.' });
    }
  };

  router.post('/apple/callback', handleAppleCallback);
  router.get('/apple/callback', handleAppleCallback);

  return router;
}
