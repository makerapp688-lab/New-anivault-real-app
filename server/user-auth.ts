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
import { validateOwnerSession, revokeOwnerSession } from './owner-auth.js';
import { getSessionSecret } from './session-secret.js';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const USERS_ACCOUNTS_PATH = path.join(DATA_DIR, 'users-accounts.json');
const USERS_TEMP_VERIFICATIONS_PATH = path.join(DATA_DIR, 'users-temp-verifications.json');
const USERS_SESSIONS_PATH = path.join(DATA_DIR, 'users-sessions.json');

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
  provider: 'email';
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

// In-memory caches with persistent disk backing
let usersCache: Record<string, UserRecord> = {};
let tempVerificationsCache: Record<string, TempUserVerification> = {};
const activeUserSessions: Map<string, UserSession> = new Map();

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'owner',
  'anivex',
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
  if (!username) return '';
  return username.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isUsernameAvailable(
  username: string,
  excludeUserId?: string,
  excludeEmail?: string
): { available: boolean; reason?: string } {
  if (!username || typeof username !== 'string') {
    return { available: false, reason: 'Username is required.' };
  }

  const clean = username.trim();
  if (clean.length < 2 || clean.length > 30) {
    return { available: false, reason: 'Username must be between 2 and 30 characters.' };
  }

  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(clean)) {
    return { available: false, reason: 'Only letters, numbers, hyphens, and underscores are allowed.' };
  }

  const norm = normalizeUsername(clean);
  if (norm.length < 2) {
    return { available: false, reason: 'Username must contain at least 2 alphanumeric characters.' };
  }

  if (RESERVED_USERNAMES.has(norm)) {
    return { available: false, reason: 'This username is reserved by Anivex.' };
  }

  // Check against permanent user accounts
  for (const user of Object.values(usersCache)) {
    if (excludeUserId && user.id === excludeUserId) continue;
    if (excludeEmail && user.email.toLowerCase() === excludeEmail.toLowerCase()) continue;

    if (user.username.trim().toLowerCase() === clean.toLowerCase() || normalizeUsername(user.username) === norm) {
      return { available: false, reason: 'This username is already taken. Please choose another.' };
    }
  }

  // Check against pending verifications
  const now = Date.now();
  for (const temp of Object.values(tempVerificationsCache)) {
    if (temp.expiresAt > now) {
      if (excludeEmail && temp.email.toLowerCase() === excludeEmail.toLowerCase()) continue;
      if (temp.username.trim().toLowerCase() === clean.toLowerCase() || normalizeUsername(temp.username) === norm) {
        return { available: false, reason: 'This username is currently pending verification. Try another.' };
      }
    }
  }

  return { available: true };
}

export function generateUniqueUsername(baseSeed: string = 'AnimeExplorer'): string {
  let base = baseSeed.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (base.length < 2) base = 'AnimeExplorer';
  if (base.length > 20) base = base.slice(0, 20);

  let candidate = base;
  let counter = 1;

  while (!isUsernameAvailable(candidate).available) {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    candidate = `${base}_${randomSuffix}`;
    counter++;
    if (counter > 50) {
      candidate = `Explorer_${crypto.randomBytes(3).toString('hex')}`;
      break;
    }
  }

  return candidate;
}

function auditAndIndexUsernames() {
  const seen: Map<string, string> = new Map();
  const conflicts: Array<{ norm: string; userIds: string[]; usernames: (string | undefined)[] }> = [];

  for (const [id, user] of Object.entries(usersCache)) {
    if (!user || !user.username) continue;
    const norm = normalizeUsername(user.username);
    if (seen.has(norm)) {
      const existingId = seen.get(norm)!;
      conflicts.push({
        norm,
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

loadUsersData();

// Clean up expired temp verifications periodically
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
    provider: u.provider || 'email',
    isVerified: u.isVerified,
    role: u.role || 'user',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
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

    const statusObj = {
      email: {
        configured: emailStatus.configured,
        missing: emailStatus.missing
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
      res.status(500).json({ error: err.message || 'Diagnostic failed' });
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
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(
          normalizedEmail,
          code,
          'Verify your Anivex account',
          origin
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

      // Final check for username availability before committing
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
        message: 'Account successfully verified and created! Welcome to Anivex.',
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
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(
          normalizedEmail,
          code,
          'Verify your Anivex account',
          origin
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
          error: 'Invalid authentication credentials.'
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

    // Prioritize user session if client explicitly provided user header
    if (userHeader) {
      reloadUserSessionsFromDisk();
      let session = activeUserSessions.get(userHeader);
      if (!session || session.revoked || session.expiresAt < Date.now()) {
        const decoded = verifyAndDecodeSessionToken(userHeader);
        if (decoded && decoded.role === 'user') {
          session = {
            sessionId: userHeader,
            userId: decoded.userId,
            email: decoded.email,
            username: decoded.username,
            provider: decoded.provider,
            role: 'user',
            createdAt: decoded.expiresAt - 30 * 24 * 60 * 60 * 1000,
            expiresAt: decoded.expiresAt
          };
          activeUserSessions.set(userHeader, session);
          saveUserSessions();
        }
      }
      if (session && !session.revoked && session.expiresAt > Date.now()) {
        const user = usersCache[session.userId];
        if (user) {
          res.json({
            authenticated: true,
            user: sanitizeUser(user),
            sessionToken: session.sessionId
          });
          return;
        }
      }
    }

    // 1. Check Owner session if owner session ID provided or present
    if (ownerSessionId) {
      const ownerAcc = validateOwnerSession(ownerSessionId);
      if (ownerAcc) {
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
    }

    // 2. Check User session
    const sessionId = userSessionId || ownerSessionId;
    if (!sessionId) {
      res.json({ authenticated: false });
      return;
    }

    // Always reload from disk to ensure persistent storage is the absolute source of truth
    reloadUserSessionsFromDisk();

    let session = activeUserSessions.get(sessionId);
    if (!session || session.revoked || session.expiresAt < Date.now()) {
      // Decode cryptographic token fallback
      const decoded = verifyAndDecodeSessionToken(sessionId);
      if (decoded && decoded.role === 'user') {
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
        // Fallback check: could sessionId be an owner session ID?
        const ownerAcc = validateOwnerSession(sessionId);
        if (ownerAcc) {
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
        res.json({ authenticated: false });
        return;
      }
    }

    // Load account record from permanent account storage
    const cleanSessionEmail = session.email ? session.email.trim().toLowerCase() : '';
    let user = usersCache[session.userId] || Object.values(usersCache).find(u => u.email && u.email.trim().toLowerCase() === cleanSessionEmail);
    if (!user) {
      const isoNow = new Date().toISOString();
      user = {
        id: session.userId,
        email: session.email,
        username: session.username,
        name: session.username,
        provider: 'email',
        isVerified: true,
        role: 'user',
        createdAt: isoNow,
        updatedAt: isoNow,
        lastLoginAt: isoNow
      };
      usersCache[session.userId] = user;
      saveUsers();
    }

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
    if (avatar) {
      if (typeof avatar !== 'string') {
        res.status(400).json({ error: 'Invalid avatar data format.' });
        return;
      }
      
      const match = avatar.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (!match) {
        res.status(400).json({ error: 'Invalid image format. Must be a base64-encoded image.' });
        return;
      }
      
      const mimeType = match[1].toLowerCase();
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimeTypes.includes(mimeType)) {
        res.status(400).json({ error: 'Unsupported image format. Only JPEG, PNG, and WebP are allowed.' });
        return;
      }
      
      // Calculate approximate size in bytes
      const approxSizeBytes = (avatar.length - avatar.indexOf(',') - 1) * 0.75;
      const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
      if (approxSizeBytes > MAX_SIZE_BYTES) {
        res.status(400).json({ error: 'Uploaded profile photo exceeds the 20MB limit.' });
        return;
      }
    }

    user.avatar = typeof avatar === 'string' && avatar.trim() ? avatar : undefined;
    user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({
      success: true,
      message: 'Avatar updated successfully.',
      avatar: user.avatar
    });
  });

  // 10. Switch to Normal User Account
  router.post('/switch', (req: Request, res: Response) => {
    const { accountId, account } = req.body;
    if (!accountId) {
      res.status(400).json({ error: 'Account ID is required.' });
      return;
    }

    loadUsersData();
    let user = usersCache[accountId] || Object.values(usersCache).find(u => u.id === accountId);
    if (!user && account && account.id === accountId) {
      if (account.id !== 'usr_owner' && account.role !== 'owner') {
        user = {
          id: account.id,
          email: (account.email || '').trim().toLowerCase(),
          username: account.username || 'AnimeExplorer',
          provider: account.provider || 'email',
          isVerified: true,
          role: 'user',
          createdAt: account.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };
        usersCache[user.id] = user;
        saveUsers();
      }
    }

    if (!user) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    // End active Owner session/context immediately
    const cookies = parseCookies(req);
    const ownerHeader = req.headers['x-anivault-owner-session'] as string;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const ownerSessionId = cookies.anivault_owner_session || ownerHeader || (bearerToken && bearerToken.startsWith('owner_') ? bearerToken : null);
    if (ownerSessionId) {
      revokeOwnerSession(ownerSessionId);
    }
    setSessionCookie(res, 'anivault_owner_session', '', 0, req);

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

  // 11. Delete Account - Step 1: Request Deletion OTP
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
        const origin = req.protocol + '://' + req.get('host');
        await sendVerificationEmail(
          user.email,
          code,
          'Verify your Anivex account deletion',
          origin
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

  // 12. Delete Account - Step 2: Verify Deletion OTP
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

  // 13. Delete Account - Step 3: Resend Deletion OTP
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

      const origin = req.protocol + '://' + req.get('host');
      await sendVerificationEmail(
        user.email,
        code,
        'Verify your Anivex account deletion',
        origin
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

  // 14. Delete Account - Step 4: Final Confirmation & Complete Removal
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

  return router;
}
