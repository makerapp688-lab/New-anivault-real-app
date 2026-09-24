import crypto from 'crypto';

let _ephemeralDevSecret: string | null = null;

/**
 * Resolves the server session secret.
 * Requires process.env.SESSION_SECRET to be configured on the server.
 * In development, if SESSION_SECRET is not configured, generates an ephemeral cryptographic runtime key.
 * Never falls back to any hardcoded, predictable, or known source-code secret.
 */
export function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length > 0) {
    return envSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('[CRITICAL SECURITY ERROR] SESSION_SECRET environment variable is missing on the server.');
    throw new Error('SESSION_SECRET environment variable must be configured on the server in production.');
  }

  if (!_ephemeralDevSecret) {
    _ephemeralDevSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] SESSION_SECRET not set in environment. Generated cryptographically random ephemeral secret for this session.');
  }

  return _ephemeralDevSecret;
}
