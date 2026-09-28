import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getSessionSecret } from './session-secret.js';
import { sendOtpVerificationEmail, getEmailConfigStatus } from './email-service.js';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const USER_OTP_STORE_PATH = path.join(DATA_DIR, 'zenime-user-otp.json');
const OWNER_OTP_STORE_PATH = path.join(DATA_DIR, 'zenime-owner-otp.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export type NormalUserOtpPurpose =
  | 'user_register'
  | 'user_delete_account'
  | 'user_login_verify';

export type OwnerOtpPurpose =
  | 'owner_setup'
  | 'owner_login'
  | 'owner_change_email'
  | 'owner_delete_account';

export interface OtpRecord<TPayload = Record<string, any>> {
  id: string;
  scope: 'user' | 'owner';
  purpose: string;
  email: string; // Always normalized (trimmed, lowercase)
  codeHash: string;
  codeSalt: string;
  createdAt: number;
  expiresAt: number;
  lastSentAt: number;
  resendCount: number;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
  payload: TPayload;
}

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_RESEND_COUNT = 5;
const USER_RESEND_COOLDOWN_MS = 20 * 1000; // 20 seconds cooldown
const OWNER_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown

const EMAIL_SYNTAX_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Normalizes and validates an email address safely:
 * - trims whitespace
 * - normalizes case to lowercase
 * - validates syntax
 */
export function normalizeAndValidateEmail(rawEmail: unknown): {
  valid: boolean;
  normalizedEmail: string;
  error?: string;
} {
  if (typeof rawEmail !== 'string') {
    return { valid: false, normalizedEmail: '', error: 'Email address is required.' };
  }
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (!normalizedEmail) {
    return { valid: false, normalizedEmail: '', error: 'Email address is required.' };
  }
  if (normalizedEmail.length > 254 || !EMAIL_SYNTAX_REGEX.test(normalizedEmail)) {
    return {
      valid: false,
      normalizedEmail,
      error: 'Please enter a valid email address (e.g. user@gmail.com).'
    };
  }
  return { valid: true, normalizedEmail };
}

/**
 * Generates a cryptographically random 6-digit OTP and its salted HMAC-SHA256 hash.
 * Never exposes or stores the plaintext OTP in persistent state.
 */
export function generateSecureSixDigitOtp(): {
  code: string;
  codeHash: string;
  codeSalt: string;
} {
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeSalt = crypto.randomBytes(16).toString('hex');
  const codeHash = computeOtpHash(code, codeSalt);
  return { code, codeHash, codeSalt };
}

function computeOtpHash(code: string, codeSalt: string): string {
  const secret = getSessionSecret();
  return crypto
    .createHmac('sha256', `${secret}:${codeSalt}`)
    .update(code.trim())
    .digest('hex');
}

function verifyOtpHashTimingSafe(candidateCode: string, expectedHash: string, codeSalt: string): boolean {
  if (!/^\d{6}$/.test(candidateCode.trim())) {
    return false;
  }
  const candidateHash = computeOtpHash(candidateCode.trim(), codeSalt);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function loadStore(filePath: string): Record<string, OtpRecord<any>> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const now = Date.now();
    const cleaned: Record<string, OtpRecord<any>> = {};
    let mutated = false;
    for (const [key, rec] of Object.entries(raw as Record<string, OtpRecord<any>>)) {
      if (rec && !rec.consumed && rec.expiresAt > now && rec.attempts < rec.maxAttempts) {
        cleaned[key] = rec;
      } else {
        mutated = true;
      }
    }
    if (mutated) {
      saveStore(filePath, cleaned);
    }
    return cleaned;
  } catch {
    return {};
  }
}

function saveStore(filePath: string, data: Record<string, OtpRecord<any>>): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[EmailVerification] Failed to persist OTP store:', err.message);
  }
}

function makeKey(purpose: string, normalizedEmail: string): string {
  return `${purpose}::${normalizedEmail}`;
}

// ============================================================================
// PATH A: NORMAL USER EMAIL OTP VERIFICATION (ANY VALID EMAIL)
// Completely independent from OWNER_EMAIL.
// ============================================================================

export async function issueNormalUserOtp<TPayload = Record<string, any>>(params: {
  purpose: NormalUserOtpPurpose;
  email: string;
  payload: TPayload;
  subject: string;
  heading: string;
  description: string;
}): Promise<{
  normalizedEmail: string;
  expiresAt: number;
  cooldownSeconds: number;
}> {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const emailConfig = getEmailConfigStatus();
  if (!emailConfig.configured) {
    const err: any = new Error('Email verification service is not configured.');
    err.statusCode = 503;
    err.code = 'EMAIL_UNAVAILABLE';
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;
  const store = loadStore(USER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const existing = store[key];
  const now = Date.now();

  if (existing && !existing.consumed && existing.expiresAt > now) {
    const elapsed = now - existing.lastSentAt;
    if (elapsed < USER_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((USER_RESEND_COOLDOWN_MS - elapsed) / 1000);
      const err: any = new Error(`Please wait ${waitSec} seconds before requesting another verification code.`);
      err.statusCode = 429;
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (existing.resendCount >= MAX_RESEND_COUNT) {
      const err: any = new Error('Maximum verification code resend limit reached. Please wait a few minutes and try again.');
      err.statusCode = 429;
      err.code = 'MAX_RESENDS_EXCEEDED';
      throw err;
    }
  }

  const { code, codeHash, codeSalt } = generateSecureSixDigitOtp();
  const expiresAt = now + OTP_EXPIRY_MS;

  const record: OtpRecord<TPayload> = {
    id: `uotp_${crypto.randomBytes(8).toString('hex')}`,
    scope: 'user',
    purpose: params.purpose,
    email: normalizedEmail,
    codeHash,
    codeSalt,
    createdAt: existing ? existing.createdAt : now,
    expiresAt,
    lastSentAt: now,
    resendCount: existing ? existing.resendCount + 1 : 1,
    attempts: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
    consumed: false,
    payload: params.payload
  };

  store[key] = record;
  saveStore(USER_OTP_STORE_PATH, store);

  try {
    await sendOtpVerificationEmail({
      recipientEmail: normalizedEmail,
      code,
      subject: params.subject,
      heading: params.heading,
      description: params.description,
      expiryMinutes: 10
    });
  } catch (sendErr: any) {
    delete store[key];
    saveStore(USER_OTP_STORE_PATH, store);
    const err: any = new Error(sendErr.message || 'Failed to send verification email.');
    err.statusCode = 503;
    err.code = 'EMAIL_SEND_FAILED';
    throw err;
  }

  return {
    normalizedEmail,
    expiresAt,
    cooldownSeconds: Math.floor(USER_RESEND_COOLDOWN_MS / 1000)
  };
}

export async function resendNormalUserOtp(params: {
  purpose: NormalUserOtpPurpose;
  email: string;
  subject: string;
  heading: string;
  description: string;
}): Promise<{
  normalizedEmail: string;
  expiresAt: number;
  cooldownSeconds: number;
}> {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;
  const store = loadStore(USER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const existing = store[key];

  if (!existing || existing.consumed) {
    const err: any = new Error('No pending verification request found for this email. Please start again.');
    err.statusCode = 400;
    throw err;
  }

  return issueNormalUserOtp({
    purpose: params.purpose,
    email: normalizedEmail,
    payload: existing.payload,
    subject: params.subject,
    heading: params.heading,
    description: params.description
  });
}

export function verifyAndConsumeNormalUserOtp<TPayload = Record<string, any>>(params: {
  purpose: NormalUserOtpPurpose;
  email: string;
  code: string;
}): {
  normalizedEmail: string;
  payload: TPayload;
} {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const cleanCode = typeof params.code === 'string' ? params.code.trim() : '';
  if (!/^\d{6}$/.test(cleanCode)) {
    const err: any = new Error('Please enter a valid 6-digit verification code.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;
  const store = loadStore(USER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const record = store[key];

  if (!record || record.consumed) {
    const err: any = new Error('No active verification code found for this email. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  if (now > record.expiresAt) {
    delete store[key];
    saveStore(USER_OTP_STORE_PATH, store);
    const err: any = new Error('This verification code has expired. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  if (record.attempts >= record.maxAttempts) {
    delete store[key];
    saveStore(USER_OTP_STORE_PATH, store);
    const err: any = new Error('Too many incorrect verification attempts. Please request a new code.');
    err.statusCode = 429;
    throw err;
  }

  const isMatch = verifyOtpHashTimingSafe(cleanCode, record.codeHash, record.codeSalt);
  if (!isMatch) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      delete store[key];
      saveStore(USER_OTP_STORE_PATH, store);
      const err: any = new Error('Too many incorrect verification attempts. Please request a new code.');
      err.statusCode = 429;
      throw err;
    }
    store[key] = record;
    saveStore(USER_OTP_STORE_PATH, store);
    const err: any = new Error('Incorrect verification code. Please check the 6-digit code and try again.');
    err.statusCode = 400;
    throw err;
  }

  // Single-use: consume and delete immediately
  record.consumed = true;
  delete store[key];
  saveStore(USER_OTP_STORE_PATH, store);

  return {
    normalizedEmail,
    payload: record.payload as TPayload
  };
}

export function getPendingNormalUserOtp<TPayload = Record<string, any>>(
  purpose: NormalUserOtpPurpose,
  email: string
): OtpRecord<TPayload> | null {
  const emailCheck = normalizeAndValidateEmail(email);
  if (!emailCheck.valid) return null;
  const store = loadStore(USER_OTP_STORE_PATH);
  const key = makeKey(purpose, emailCheck.normalizedEmail);
  const rec = store[key];
  if (!rec || rec.consumed || rec.expiresAt <= Date.now()) return null;
  return rec as OtpRecord<TPayload>;
}

// ============================================================================
// PATH B: OWNER EMAIL OTP VERIFICATION (CONFIGURED OWNER_EMAIL ONLY)
// Strictly enforces isAuthorizedOwnerEmail before any OTP generation or send.
// ============================================================================

export async function issueOwnerOtp<TPayload = Record<string, any>>(params: {
  purpose: OwnerOtpPurpose;
  email: string;
  isAuthorizedOwnerEmail: (normalizedEmail: string) => boolean;
  payload: TPayload;
  subject: string;
  heading: string;
  description: string;
}): Promise<{
  normalizedEmail: string;
  expiresAt: number;
  cooldownSeconds: number;
}> {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;

  // STRICT OWNER AUTHORIZATION CHECK
  if (!params.isAuthorizedOwnerEmail(normalizedEmail)) {
    const err: any = new Error('Unauthorised email');
    err.statusCode = 403;
    err.code = 'UNAUTHORISED_EMAIL';
    throw err;
  }

  const emailConfig = getEmailConfigStatus();
  if (!emailConfig.configured) {
    const err: any = new Error('Email verification service is not configured.');
    err.statusCode = 503;
    err.code = 'EMAIL_UNAVAILABLE';
    throw err;
  }

  const store = loadStore(OWNER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const existing = store[key];
  const now = Date.now();

  if (existing && !existing.consumed && existing.expiresAt > now) {
    const elapsed = now - existing.lastSentAt;
    if (elapsed < OWNER_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OWNER_RESEND_COOLDOWN_MS - elapsed) / 1000);
      const err: any = new Error(`Please wait ${waitSec} seconds before requesting another verification code.`);
      err.statusCode = 429;
      err.code = 'RATE_LIMITED';
      throw err;
    }
    if (existing.resendCount >= MAX_RESEND_COUNT) {
      const err: any = new Error('Maximum verification code resend limit reached. Please restart Owner verification.');
      err.statusCode = 429;
      err.code = 'MAX_RESENDS_EXCEEDED';
      throw err;
    }
  }

  const { code, codeHash, codeSalt } = generateSecureSixDigitOtp();
  const expiresAt = now + OTP_EXPIRY_MS;

  const record: OtpRecord<TPayload> = {
    id: `ootp_${crypto.randomBytes(8).toString('hex')}`,
    scope: 'owner',
    purpose: params.purpose,
    email: normalizedEmail,
    codeHash,
    codeSalt,
    createdAt: existing ? existing.createdAt : now,
    expiresAt,
    lastSentAt: now,
    resendCount: existing ? existing.resendCount + 1 : 1,
    attempts: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
    consumed: false,
    payload: params.payload
  };

  store[key] = record;
  saveStore(OWNER_OTP_STORE_PATH, store);

  try {
    await sendOtpVerificationEmail({
      recipientEmail: normalizedEmail,
      code,
      subject: params.subject,
      heading: params.heading,
      description: params.description,
      expiryMinutes: 10
    });
  } catch (sendErr: any) {
    delete store[key];
    saveStore(OWNER_OTP_STORE_PATH, store);
    const err: any = new Error(sendErr.message || 'Failed to send Owner verification email.');
    err.statusCode = 503;
    err.code = 'EMAIL_SEND_FAILED';
    throw err;
  }

  return {
    normalizedEmail,
    expiresAt,
    cooldownSeconds: Math.floor(OWNER_RESEND_COOLDOWN_MS / 1000)
  };
}

export async function resendOwnerOtp(params: {
  purpose: OwnerOtpPurpose;
  email: string;
  isAuthorizedOwnerEmail: (normalizedEmail: string) => boolean;
  subject: string;
  heading: string;
  description: string;
}): Promise<{
  normalizedEmail: string;
  expiresAt: number;
  cooldownSeconds: number;
}> {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;
  if (!params.isAuthorizedOwnerEmail(normalizedEmail)) {
    const err: any = new Error('Unauthorised email');
    err.statusCode = 403;
    err.code = 'UNAUTHORISED_EMAIL';
    throw err;
  }

  const store = loadStore(OWNER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const existing = store[key];

  if (!existing || existing.consumed) {
    const err: any = new Error('No pending Owner verification session found. Please start again.');
    err.statusCode = 400;
    throw err;
  }

  return issueOwnerOtp({
    purpose: params.purpose,
    email: normalizedEmail,
    isAuthorizedOwnerEmail: params.isAuthorizedOwnerEmail,
    payload: existing.payload,
    subject: params.subject,
    heading: params.heading,
    description: params.description
  });
}

export function verifyAndConsumeOwnerOtp<TPayload = Record<string, any>>(params: {
  purpose: OwnerOtpPurpose;
  email: string;
  code: string;
  isAuthorizedOwnerEmail: (normalizedEmail: string) => boolean;
}): {
  normalizedEmail: string;
  payload: TPayload;
} {
  const emailCheck = normalizeAndValidateEmail(params.email);
  if (!emailCheck.valid) {
    const err: any = new Error(emailCheck.error || 'Invalid email address.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = emailCheck.normalizedEmail;
  if (!params.isAuthorizedOwnerEmail(normalizedEmail)) {
    const err: any = new Error('Unauthorised email');
    err.statusCode = 403;
    err.code = 'UNAUTHORISED_EMAIL';
    throw err;
  }

  const cleanCode = typeof params.code === 'string' ? params.code.trim() : '';
  if (!/^\d{6}$/.test(cleanCode)) {
    const err: any = new Error('Please enter a valid 6-digit verification code.');
    err.statusCode = 400;
    throw err;
  }

  const store = loadStore(OWNER_OTP_STORE_PATH);
  const key = makeKey(params.purpose, normalizedEmail);
  const record = store[key];

  if (!record || record.consumed) {
    const err: any = new Error('No active Owner verification code found. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  const now = Date.now();
  if (now > record.expiresAt) {
    delete store[key];
    saveStore(OWNER_OTP_STORE_PATH, store);
    const err: any = new Error('This verification code has expired. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  if (record.attempts >= record.maxAttempts) {
    delete store[key];
    saveStore(OWNER_OTP_STORE_PATH, store);
    const err: any = new Error('Too many incorrect verification attempts. Please request a new code.');
    err.statusCode = 429;
    throw err;
  }

  const isMatch = verifyOtpHashTimingSafe(cleanCode, record.codeHash, record.codeSalt);
  if (!isMatch) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      delete store[key];
      saveStore(OWNER_OTP_STORE_PATH, store);
      const err: any = new Error('Too many incorrect verification attempts. Please request a new code.');
      err.statusCode = 429;
      throw err;
    }
    store[key] = record;
    saveStore(OWNER_OTP_STORE_PATH, store);
    const err: any = new Error('Incorrect verification code.');
    err.statusCode = 400;
    throw err;
  }

  // Single-use: consume and delete immediately
  record.consumed = true;
  delete store[key];
  saveStore(OWNER_OTP_STORE_PATH, store);

  return {
    normalizedEmail,
    payload: record.payload as TPayload
  };
}
