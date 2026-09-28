import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateOwnerSession, revokeOwnerSession, authenticateSession, requireOwner } from './owner-auth.js';
import { getSessionSecret } from './session-secret.js';
import {
  getEmailConfigStatus,
  checkServerSecretsDiagnostic,
  testEmailTransport
} from './email-service.js';
import {
  normalizeAndValidateEmail,
  issueNormalUserOtp,
  resendNormalUserOtp,
  verifyAndConsumeNormalUserOtp
} from './email-verification.js';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const USERS_ACCOUNTS_PATH = path.join(DATA_DIR, 'users-accounts.json');
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
  theme?: string;
  passwordHash?: string;
  salt?: string;
  provider: 'email';
  role: 'user';
  isVerified?: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
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
const activeUserSessions: Map<string, UserSession> = new Map();
const verifiedAccountDeletions: Map<string, { userId: string; email: string; expiresAt: number }> = new Map();

export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'owner',
  'zenime',
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

  if (RESERVED_USERNAMES.has(norm) || norm === 'death197') {
    return { available: false, reason: 'This username is reserved by Zenime.' };
  }

  // Check against permanent user accounts
  for (const user of Object.values(usersCache)) {
    if (excludeUserId && user.id === excludeUserId) continue;

    if (user.username.trim().toLowerCase() === clean.toLowerCase() || normalizeUsername(user.username) === norm) {
      return { available: false, reason: 'This username is already taken. Please choose another.' };
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

function saveUserSessions() {
  try {
    const list = Array.from(activeUserSessions.values());
    fs.writeFileSync(USERS_SESSIONS_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[UserAuth DB] Error saving sessions:', err.message);
  }
}

loadUsersData();

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
  const cookieStr = `${name}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${secureFlags}; Max-Age=${maxAge}; Expires=${expires}`;

  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieStr]);
  } else if (Array.isArray(existing)) {
    const filtered = existing.filter(c => !String(c).startsWith(`${name}=`));
    res.setHeader('Set-Cookie', [...filtered, cookieStr]);
  } else {
    const existingStr = String(existing);
    if (existingStr.startsWith(`${name}=`)) {
      res.setHeader('Set-Cookie', [cookieStr]);
    } else {
      res.setHeader('Set-Cookie', [existingStr, cookieStr]);
    }
  }
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
      for (const user of Object.values(usersCache)) {
        if (user && user.email) {
          user.email = user.email.trim().toLowerCase();
        }
      }
    } else {
      usersCache = {};
    }
    if (fs.existsSync(USERS_SESSIONS_PATH)) {
      const list: UserSession[] = JSON.parse(fs.readFileSync(USERS_SESSIONS_PATH, 'utf-8'));
      const now = Date.now();
      activeUserSessions.clear();
      for (const s of list) {
        if (s.expiresAt > now) {
          activeUserSessions.set(s.sessionId, s);
        }
      }
    } else {
      activeUserSessions.clear();
    }
  } catch (err: any) {
    console.error('[UserAuth DB] Error reloading session state from disk:', err.message);
  }
}

export function validateUserSessionToken(sessionId: string | undefined | null): { session: UserSession; user: UserRecord } | null {
  if (!sessionId || typeof sessionId !== 'string') return null;
  reloadUserSessionsFromDisk();

  const session = activeUserSessions.get(sessionId);
  if (!session || session.revoked || session.expiresAt < Date.now()) {
    if (session && session.expiresAt < Date.now()) {
      activeUserSessions.delete(sessionId);
      saveUserSessions();
    }
    return null;
  }

  if (sessionId.includes('.')) {
    const decoded = verifyAndDecodeSessionToken(sessionId);
    if (!decoded || decoded.role !== 'user' || decoded.userId !== session.userId) {
      activeUserSessions.delete(sessionId);
      saveUserSessions();
      return null;
    }
  }

  const user = usersCache[session.userId];
  // Never recreate a missing or deleted account from a session token
  if (!user || (user as any).disabled || user.id === 'usr_owner' || (user.role as string) === 'owner') {
    activeUserSessions.delete(sessionId);
    saveUserSessions();
    return null;
  }

  if (user.email.trim().toLowerCase() !== session.email.trim().toLowerCase()) {
    activeUserSessions.delete(sessionId);
    saveUserSessions();
    return null;
  }

  const userCreatedMs = Date.parse(user.createdAt);
  if (!isNaN(userCreatedMs) && session.createdAt + 5000 < userCreatedMs) {
    activeUserSessions.delete(sessionId);
    saveUserSessions();
    return null;
  }

  return { session, user };
}

function sanitizeUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name || u.username,
    avatar: u.avatar || undefined,
    theme: u.theme || undefined,
    provider: u.provider || 'email',
    role: u.role || 'user',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  };
}

export function createUserAuthRouter() {
  const router = express.Router();

  // 1. Authentication Provider Status Check
  router.get('/status', (_req: Request, res: Response) => {
    const emailConfig = getEmailConfigStatus();
    const statusObj = {
      email: {
        configured: emailConfig.configured,
        missing: emailConfig.missing
      }
    };

    res.json({
      providers: statusObj,
      ...statusObj
    });
  });

  // 1a. Email Configuration Status (Owner-Only)
  router.get('/email-status', authenticateSession, requireOwner, (_req: Request, res: Response) => {
    const secretsDiag = checkServerSecretsDiagnostic();
    const configStatus = getEmailConfigStatus();
    res.json({
      configured: configStatus.configured,
      diagnostic: secretsDiag,
      ...secretsDiag
    });
  });

  // 1a-2. Controlled Email Transport Diagnostic Test (Owner-Only)
  router.get('/email-diagnostic', authenticateSession, requireOwner, async (req: Request, res: Response) => {
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

  // 1b. Live Username Availability Check
  router.get('/check-username', (req: Request, res: Response) => {
    reloadUserSessionsFromDisk();
    const rawUsername = typeof req.query.username === 'string' ? req.query.username : '';
    const excludeUserId = typeof req.query.excludeUserId === 'string' ? req.query.excludeUserId : undefined;
    const excludeEmail = typeof req.query.excludeEmail === 'string' ? req.query.excludeEmail : undefined;
    const result = isUsernameAvailable(rawUsername, excludeUserId, excludeEmail);
    const suggestedUsername = !result.available ? generateUniqueUsername(rawUsername || 'AnimeExplorer') : undefined;
    res.json({
      available: result.available,
      username: rawUsername.trim(),
      reason: result.reason,
      suggestedUsername
    });
  });

  // 2. Normal User Registration - Step 1: Validate & Send 6-Digit OTP to ANY Valid Email
  const handleRegisterInit = async (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { email, username, password } = req.body || {};

      // 1. Normalize & validate email (any valid email is allowed; never restricted to OWNER_EMAIL)
      const emailCheck = normalizeAndValidateEmail(email);
      if (!emailCheck.valid) {
        res.status(400).json({ error: emailCheck.error || 'Please enter a valid email address.' });
        return;
      }
      const normalizedEmail = emailCheck.normalizedEmail;

      // 2. Password validation
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      // 3. Max 2 accounts per email & distinct password check
      const existingAccounts = Object.values(usersCache).filter(
        u => u.email.toLowerCase() === normalizedEmail
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

      // 4. Username uniqueness and format validation against permanent verified accounts
      if (!username || typeof username !== 'string') {
        res.status(400).json({ error: 'Username is required.' });
        return;
      }
      let cleanUsername = username.trim();
      let availCheck = isUsernameAvailable(cleanUsername);
      if (!availCheck.available && normalizeUsername(cleanUsername) === 'animeexplorer') {
        cleanUsername = generateUniqueUsername('AnimeExplorer');
        availCheck = isUsernameAvailable(cleanUsername);
      }
      if (!availCheck.available) {
        res.status(400).json({
          error: availCheck.reason || 'Username already taken.'
        });
        return;
      }

      const { hash: passwordHash, salt } = hashPassword(password);

      const otpResult = await issueNormalUserOtp({
        purpose: 'user_register',
        email: normalizedEmail,
        payload: {
          email: normalizedEmail,
          username: cleanUsername,
          passwordHash,
          salt
        },
        subject: 'Verify your Zenime account',
        heading: 'Here is your Zenime verification code',
        description: `Use the 6-digit verification code below to verify ${normalizedEmail} and create your Zenime account (${cleanUsername}).`
      });

      res.json({
        success: true,
        requiresVerification: true,
        email: otpResult.normalizedEmail,
        username: cleanUsername,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: `A 6-digit verification code has been sent to ${otpResult.normalizedEmail}.`
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({
        error: err.message || 'Failed to initiate registration verification.',
        code: err.code
      });
    }
  };

  router.post('/register-init', handleRegisterInit);
  router.post('/register', handleRegisterInit);

  // 2b. Normal User Registration - Step 2: Verify 6-Digit OTP & Create Account
  router.post('/register-verify', async (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { email, code } = req.body || {};

      const verified = verifyAndConsumeNormalUserOtp<{
        email: string;
        username: string;
        passwordHash: string;
        salt: string;
      }>({
        purpose: 'user_register',
        email,
        code
      });

      const normalizedEmail = verified.normalizedEmail;
      let cleanUsername = verified.payload.username;

      // Final check against permanent accounts in case username was claimed while OTP was pending
      let availCheck = isUsernameAvailable(cleanUsername);
      if (!availCheck.available) {
        cleanUsername = generateUniqueUsername(cleanUsername);
        availCheck = isUsernameAvailable(cleanUsername);
        if (!availCheck.available) {
          res.status(400).json({ error: 'Chosen username is no longer available. Please register with a new username.' });
          return;
        }
      }

      const existingAccounts = Object.values(usersCache).filter(
        u => u.email.toLowerCase() === normalizedEmail
      );
      if (existingAccounts.length >= 2) {
        res.status(400).json({
          error: 'An account limit of 2 accounts per email address has been reached for this email.'
        });
        return;
      }

      const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
      const now = Date.now();
      const isoNow = new Date(now).toISOString();

      const newUser: UserRecord = {
        id: userId,
        email: normalizedEmail,
        username: cleanUsername,
        name: cleanUsername,
        passwordHash: verified.payload.passwordHash,
        salt: verified.payload.salt,
        provider: 'email',
        role: 'user',
        isVerified: true,
        createdAt: isoNow,
        updatedAt: isoNow,
        lastLoginAt: isoNow
      };

      usersCache[userId] = newUser;
      saveUsers();

      // Establish authenticated session
      const sessionExpires = now + 30 * 24 * 60 * 60 * 1000;
      const sessionId = generateSignedSessionToken(
        newUser.id,
        newUser.email,
        newUser.username,
        'user',
        'email',
        sessionExpires
      );
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

      setSessionCookie(res, 'anivault_owner_session', '', 0, req);
      setSessionCookie(res, 'anivault_user_session', sessionId, 2592000, req);

      res.json({
        success: true,
        message: 'Email verified! Your Zenime account has been created.',
        user: sanitizeUser(newUser),
        sessionToken: sessionId
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Verification failed.'
      });
    }
  });

  // 2c. Normal User Registration - Resend 6-Digit OTP
  const handleRegisterResend = async (req: Request, res: Response) => {
    try {
      const { email } = req.body || {};
      const result = await resendNormalUserOtp({
        purpose: 'user_register',
        email,
        subject: 'Verify your Zenime account (New Code)',
        heading: 'Here is your new Zenime verification code',
        description: 'A new 6-digit verification code was requested to verify your Zenime account. Any previous code is now invalid.'
      });

      res.json({
        success: true,
        email: result.normalizedEmail,
        cooldownSeconds: result.cooldownSeconds,
        message: `A new 6-digit verification code has been sent to ${result.normalizedEmail}.`
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to resend verification code.',
        code: err.code
      });
    }
  };

  router.post('/register-resend', handleRegisterResend);
  router.post('/resend-code', handleRegisterResend);

  // 3. Normal User Login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
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
            u => u.email.toLowerCase() === normalizedInput
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

      if ((user as any).disabled) {
        res.status(403).json({ error: 'This account has been disabled by the administrator.' });
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

      setSessionCookie(res, 'anivault_owner_session', '', 0, req);
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
      const validated = validateUserSessionToken(userHeader);
      if (validated) {
        res.json({
          authenticated: true,
          user: sanitizeUser(validated.user),
          sessionToken: validated.session.sessionId
        });
        return;
      }
      setSessionCookie(res, 'anivault_user_session', '', 0, req);
      res.json({ authenticated: false });
      return;
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

    const validatedUser = validateUserSessionToken(sessionId);
    if (validatedUser) {
      res.json({
        authenticated: true,
        user: sanitizeUser(validatedUser.user),
        sessionToken: validatedUser.session.sessionId
      });
      return;
    }

    // Fallback check: could sessionId be a valid owner session ID?
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
          role: 'owner',
          createdAt: ownerAcc.createdAt
        }
      });
      return;
    }

    setSessionCookie(res, 'anivault_user_session', '', 0, req);
    res.json({ authenticated: false });
  });

  // 7. Normal User Logout
  router.post('/logout', (req: Request, res: Response) => {
    reloadUserSessionsFromDisk();
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

    const validated = validateUserSessionToken(sessionId);
    if (!validated) {
      res.status(401).json({ error: 'Session expired or invalid.' });
      return;
    }

    const { session, user } = validated;

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

    const validated = validateUserSessionToken(sessionId);
    if (!validated) {
      res.status(401).json({ error: 'Session expired or invalid.' });
      return;
    }

    const { user } = validated;

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

  // 9b. Update Normal User Visual Theme
  router.post('/user/theme', (req: Request, res: Response) => {
    const cookies = parseCookies(req);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-anivault-user-session'] as string;
    const sessionId = cookies.anivault_user_session || bearerToken || customHeader;

    if (!sessionId) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const validated = validateUserSessionToken(sessionId);
    if (!validated) {
      res.status(401).json({ error: 'Session expired or invalid.' });
      return;
    }

    const { user } = validated;
    const { theme } = req.body || {};
    const validThemes = new Set([
      'dark',
      'light',
      'system',
      'zenime-signature',
      'cyber-neon',
      'calm-ocean',
      'modern-tech',
      'aurora',
      'midnight-premium',
      'pixel',
      'space',
      'golden-sunset'
    ]);

    if (typeof theme !== 'string' || !validThemes.has(theme)) {
      res.status(400).json({ error: 'Invalid theme selection.' });
      return;
    }

    user.theme = theme;
    user.updatedAt = new Date().toISOString();
    saveUsers();

    res.json({
      success: true,
      message: 'Theme updated successfully.',
      theme: user.theme
    });
  });

  // 10. Switch to Normal User Account
  router.post('/switch', (req: Request, res: Response) => {
    const { accountId, sessionToken } = req.body || {};
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'Account ID is required.' });
      return;
    }

    if (accountId === 'usr_owner') {
      res.status(403).json({ error: 'Cannot switch to Owner account via normal user switch endpoint.' });
      return;
    }

    reloadUserSessionsFromDisk();
    const user = usersCache[accountId];

    // Never recreate a missing or deleted account from client-supplied account data
    if (!user || user.id === 'usr_owner' || (user.role as string) === 'owner') {
      res.status(404).json({ error: 'Account not found. Please sign in.', requireLogin: true });
      return;
    }

    if ((user as any).disabled) {
      res.status(403).json({ error: 'This account has been disabled by the administrator.', requireLogin: true });
      return;
    }

    // Verify that the target account has an active, non-revoked session on the server
    // or that the caller presented a valid session token for this account
    const cookies = parseCookies(req);
    const userHeader = req.headers['x-anivault-user-session'] as string;
    const ownerHeader = req.headers['x-anivault-owner-session'] as string;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    const candidateUserToken =
      (typeof sessionToken === 'string' && sessionToken.trim()) ||
      userHeader ||
      cookies.anivault_user_session ||
      bearerToken;

    let authorizedToSwitch = false;
    let existingValidSession: UserSession | undefined;

    if (candidateUserToken) {
      const validated = validateUserSessionToken(candidateUserToken);
      if (validated && validated.user.id === user.id) {
        authorizedToSwitch = true;
        existingValidSession = validated.session;
      }
    }

    if (!authorizedToSwitch) {
      // Check if there is an active server-side session for this userId (e.g. multi-account switcher on same device)
      const now = Date.now();
      for (const s of activeUserSessions.values()) {
        if (s.userId === user.id && !s.revoked && s.expiresAt > now) {
          const userCreatedMs = Date.parse(user.createdAt);
          if (isNaN(userCreatedMs) || s.createdAt + 5000 >= userCreatedMs) {
            authorizedToSwitch = true;
            existingValidSession = s;
            break;
          }
        }
      }
    }

    if (!authorizedToSwitch) {
      res.status(401).json({
        error: 'Session expired or not found for this account. Please sign in.',
        requireLogin: true
      });
      return;
    }

    // End active Owner session/context immediately
    const ownerSessionId = cookies.anivault_owner_session || ownerHeader || (bearerToken && bearerToken.startsWith('owner_') ? bearerToken : null);
    if (ownerSessionId) {
      revokeOwnerSession(ownerSessionId);
    }
    setSessionCookie(res, 'anivault_owner_session', '', 0, req);

    const sessionExpires = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionId = existingValidSession
      ? existingValidSession.sessionId
      : generateSignedSessionToken(user.id, user.email, user.username, 'user', user.provider || 'email', sessionExpires);
    const sessionData: UserSession = {
      sessionId,
      userId: user.id,
      email: user.email,
      username: user.username,
      provider: user.provider,
      role: 'user',
      createdAt: existingValidSession ? existingValidSession.createdAt : Date.now(),
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

  // 11. Delete Account — Step 1: Send 6-Digit OTP to Account Email
  router.post('/delete-account-init', async (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { accountId } = req.body || {};

      const cookies = parseCookies(req);
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const userHeader = req.headers['x-anivault-user-session'] as string;
      const sessionId = cookies.anivault_user_session || userHeader || bearerToken;

      const validated = sessionId ? validateUserSessionToken(sessionId) : null;
      const targetAccountId = accountId && typeof accountId === 'string' ? accountId : validated?.user.id;

      if (!targetAccountId || !validated || validated.user.id !== targetAccountId) {
        res.status(401).json({ error: 'Unauthorized: Valid session required to delete this account.' });
        return;
      }

      const user = usersCache[targetAccountId];
      if (!user) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      if (user.role === ('owner' as any) || user.id === 'usr_owner') {
        res.status(403).json({ error: 'The permanent Owner account cannot be deleted.' });
        return;
      }

      const otpResult = await issueNormalUserOtp({
        purpose: 'user_delete_account',
        email: user.email,
        payload: {
          userId: user.id,
          email: user.email,
          username: user.username
        },
        subject: 'Confirm Zenime account deletion',
        heading: 'Confirm account deletion',
        description: `Use this 6-digit verification code to confirm permanent deletion of your Zenime account (${user.username}).`
      });

      res.json({
        success: true,
        email: otpResult.normalizedEmail,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: 'A 6-digit verification code has been sent to your account email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      res.status(statusCode).json({
        error: err.message || 'Failed to send deletion verification code.',
        code: err.code
      });
    }
  });

  // 11b. Delete Account — Resend 6-Digit OTP
  router.post('/delete-account-resend', async (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { accountId } = req.body || {};

      const cookies = parseCookies(req);
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const userHeader = req.headers['x-anivault-user-session'] as string;
      const sessionId = cookies.anivault_user_session || userHeader || bearerToken;

      const validated = sessionId ? validateUserSessionToken(sessionId) : null;
      const targetAccountId = accountId && typeof accountId === 'string' ? accountId : validated?.user.id;

      if (!targetAccountId || !validated || validated.user.id !== targetAccountId) {
        res.status(401).json({ error: 'Unauthorized: Valid session required.' });
        return;
      }

      const user = usersCache[targetAccountId];
      if (!user) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      const otpResult = await resendNormalUserOtp({
        purpose: 'user_delete_account',
        email: user.email,
        subject: 'Confirm Zenime account deletion (New Code)',
        heading: 'Confirm account deletion',
        description: `Use this new 6-digit verification code to confirm permanent deletion of your Zenime account (${user.username}).`
      });

      res.json({
        success: true,
        email: otpResult.normalizedEmail,
        cooldownSeconds: otpResult.cooldownSeconds,
        message: 'A new 6-digit verification code has been sent to your email.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Failed to resend deletion verification code.',
        code: err.code
      });
    }
  });

  // 11c. Delete Account — Step 2: Verify 6-Digit OTP
  router.post('/delete-account-verify', (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { accountId, code } = req.body || {};

      const cookies = parseCookies(req);
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const userHeader = req.headers['x-anivault-user-session'] as string;
      const sessionId = cookies.anivault_user_session || userHeader || bearerToken;

      const validated = sessionId ? validateUserSessionToken(sessionId) : null;
      const targetAccountId = accountId && typeof accountId === 'string' ? accountId : validated?.user.id;

      if (!targetAccountId || !validated || validated.user.id !== targetAccountId) {
        res.status(401).json({ error: 'Unauthorized: Valid session required.' });
        return;
      }

      const user = usersCache[targetAccountId];
      if (!user) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      verifyAndConsumeNormalUserOtp({
        purpose: 'user_delete_account',
        email: user.email,
        code
      });

      verifiedAccountDeletions.set(targetAccountId, {
        userId: targetAccountId,
        email: user.email,
        expiresAt: Date.now() + 5 * 60 * 1000
      });

      res.json({
        success: true,
        verified: true,
        message: 'Verification code confirmed. You may now permanently delete your account.'
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      res.status(statusCode).json({
        error: err.message || 'Invalid or expired verification code.'
      });
    }
  });

  // 11d. Delete Account — Step 3: Final Confirmed Deletion (Requires Verified OTP Grant)
  const handleDeleteAccount = (req: Request, res: Response) => {
    try {
      reloadUserSessionsFromDisk();
      const { accountId } = req.body || {};

      const cookies = parseCookies(req);
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const userHeader = req.headers['x-anivault-user-session'] as string;
      const sessionId = cookies.anivault_user_session || userHeader || bearerToken;

      const validated = sessionId ? validateUserSessionToken(sessionId) : null;
      const targetAccountId = (accountId && typeof accountId === 'string') ? accountId : validated?.user.id;

      if (!targetAccountId) {
        res.status(400).json({ error: 'Account ID is required.' });
        return;
      }

      if (!validated || validated.user.id !== targetAccountId) {
        res.status(401).json({ error: 'Unauthorized: Valid session required to delete this account.' });
        return;
      }

      const grant = verifiedAccountDeletions.get(targetAccountId);
      if (!grant || grant.expiresAt < Date.now()) {
        verifiedAccountDeletions.delete(targetAccountId);
        res.status(403).json({
          error: 'Email OTP verification is required before deleting your account.'
        });
        return;
      }

      const user = usersCache[targetAccountId];
      if (!user) {
        verifiedAccountDeletions.delete(targetAccountId);
        res.status(404).json({ error: 'Account not found or already deleted.' });
        return;
      }

      if (user.role === ('owner' as any) || user.id === 'usr_owner') {
        res.status(403).json({ error: 'The permanent Owner account cannot be deleted.' });
        return;
      }

      verifiedAccountDeletions.delete(targetAccountId);

      // 1. Delete user record permanently
      delete usersCache[targetAccountId];
      saveUsers();

      // 2. Remove all active sessions for this user immediately
      for (const [sid, session] of activeUserSessions.entries()) {
        if (session.userId === targetAccountId) {
          activeUserSessions.delete(sid);
        }
      }
      saveUserSessions();

      // 3. Clear cookie
      setSessionCookie(res, 'anivault_user_session', '', 0, req);

      console.log(`[UserAuth DB] Account permanently deleted: ${targetAccountId} (${user.username}, ${user.email})`);

      res.json({
        success: true,
        message: 'Your Zenime account has been permanently deleted.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete account.' });
    }
  };

  router.post('/delete-account-confirm', handleDeleteAccount);
  router.post('/delete-account', handleDeleteAccount);

  return router;
}
