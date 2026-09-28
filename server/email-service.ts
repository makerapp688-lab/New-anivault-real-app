import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ quiet: true });

export interface EmailConfigStatus {
  configured: boolean;
  missing: string[];
  hostConfigured: boolean;
  portConfigured: boolean;
  userConfigured: boolean;
  passConfigured: boolean;
  fromConfigured: boolean;
}

export interface ServerSecretsDiagnostic {
  SESSION_SECRET: 'configured' | 'missing';
  SMTP_HOST: 'configured' | 'missing';
  SMTP_PORT: 'configured' | 'missing';
  SMTP_USER: 'configured' | 'missing';
  SMTP_PASS: 'configured' | 'missing';
  SMTP_FROM: 'configured' | 'missing';
  OWNER_EMAIL: 'configured' | 'missing';
  OWNER_USERNAME: 'configured' | 'missing';
  OWNER_PASSWORD: 'configured' | 'missing';
}

function cleanEnvValue(val: string | undefined): string {
  const cleaned = (val || '').trim().replace(/^["']|["']$/g, '').trim();
  if (/^(YOUR_[A-Z0-9_]+_HERE|MY_[A-Z0-9_]+|CHANGE_ME)$/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function parseSmtpPort(rawPort: string): number | null {
  if (!rawPort) return null;
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

/**
 * Checks whether the SMTP email service has all required configuration:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Never reads or depends on OWNER_EMAIL.
 */
export function getEmailConfigStatus(): EmailConfigStatus {
  dotenv.config({ quiet: true });
  const missing: string[] = [];

  const host = cleanEnvValue(process.env.SMTP_HOST);
  const portRaw = cleanEnvValue(process.env.SMTP_PORT);
  const port = parseSmtpPort(portRaw);
  const user = cleanEnvValue(process.env.SMTP_USER);
  const pass = cleanEnvValue(process.env.SMTP_PASS);
  const from = cleanEnvValue(process.env.SMTP_FROM);

  const hostConfigured = Boolean(host);
  const portConfigured = Boolean(port !== null);
  const userConfigured = Boolean(user);
  const passConfigured = Boolean(pass);
  const fromConfigured = Boolean(from);

  if (!hostConfigured) missing.push('SMTP_HOST');
  if (!portConfigured) missing.push('SMTP_PORT');
  if (!userConfigured) missing.push('SMTP_USER');
  if (!passConfigured) missing.push('SMTP_PASS');
  if (!fromConfigured) missing.push('SMTP_FROM');

  return {
    configured: missing.length === 0,
    missing,
    hostConfigured,
    portConfigured,
    userConfigured,
    passConfigured,
    fromConfigured
  };
}

export function checkServerSecretsDiagnostic(): ServerSecretsDiagnostic {
  dotenv.config({ quiet: true });
  const sessionSecret = cleanEnvValue(process.env.SESSION_SECRET);
  const host = cleanEnvValue(process.env.SMTP_HOST);
  const port = parseSmtpPort(cleanEnvValue(process.env.SMTP_PORT));
  const user = cleanEnvValue(process.env.SMTP_USER);
  const pass = cleanEnvValue(process.env.SMTP_PASS);
  const from = cleanEnvValue(process.env.SMTP_FROM);
  const ownerEmail = cleanEnvValue(process.env.OWNER_EMAIL);
  const ownerUsername = cleanEnvValue(process.env.OWNER_USERNAME);
  const ownerPassword = cleanEnvValue(process.env.OWNER_PASSWORD);

  return {
    SESSION_SECRET: sessionSecret ? 'configured' : 'missing',
    SMTP_HOST: host ? 'configured' : 'missing',
    SMTP_PORT: port !== null ? 'configured' : 'missing',
    SMTP_USER: user ? 'configured' : 'missing',
    SMTP_PASS: pass ? 'configured' : 'missing',
    SMTP_FROM: from ? 'configured' : 'missing',
    OWNER_EMAIL: ownerEmail ? 'configured' : 'missing',
    OWNER_USERNAME: ownerUsername ? 'configured' : 'missing',
    OWNER_PASSWORD: ownerPassword ? 'configured' : 'missing'
  };
}

export function createEmailTransporter() {
  const { configured } = getEmailConfigStatus();
  if (!configured) {
    return null;
  }

  const host = cleanEnvValue(process.env.SMTP_HOST);
  const port = parseSmtpPort(cleanEnvValue(process.env.SMTP_PORT));
  const user = cleanEnvValue(process.env.SMTP_USER);
  let pass = cleanEnvValue(process.env.SMTP_PASS);

  if (!host || port === null || !user || !pass) {
    return null;
  }

  const isGmail =
    host.toLowerCase().includes('gmail.com') ||
    host.toLowerCase().includes('googlemail.com') ||
    user.toLowerCase().endsWith('@gmail.com');

  // For Gmail SMTP, strip formatting spaces from 16-character Google App Passwords
  if (isGmail || pass.length >= 16) {
    pass = pass.replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]+/g, '');
  }

  const isSecurePort = port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: isSecurePort,
    requireTLS: !isSecurePort,
    auth: {
      type: 'LOGIN',
      user,
      pass
    },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

/**
 * Resolves the sender From header using the configured SMTP_FROM environment variable.
 * Formats display name as "Zenime".
 */
function resolveFromAddress(smtpUser: string): string {
  const envFrom = cleanEnvValue(process.env.SMTP_FROM);
  if (envFrom) {
    const angleMatch = envFrom.match(/<([^>]+)>/);
    if (angleMatch && angleMatch[1]) {
      return `"Zenime" <${angleMatch[1].trim()}>`;
    }
    if (envFrom.includes('@')) {
      return `"Zenime" <${envFrom}>`;
    }
  }
  return `"Zenime" <${smtpUser}>`;
}

function sanitizeSmtpError(err: any): string {
  const rawMsg = String(err?.response || err?.message || 'Unknown SMTP error');
  const rawPass = cleanEnvValue(process.env.SMTP_PASS);
  const strippedPass = rawPass.replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]+/g, '');

  let safe = rawMsg;
  if (rawPass && rawPass.length > 2) {
    safe = safe.split(rawPass).join('[REDACTED]');
  }
  if (strippedPass && strippedPass.length > 2) {
    safe = safe.split(strippedPass).join('[REDACTED]');
  }
  return safe.slice(0, 240);
}

export interface SendOtpEmailOptions {
  recipientEmail: string;
  code: string;
  subject?: string;
  heading?: string;
  description?: string;
  expiryMinutes?: number;
}

/**
 * Sends a 6-digit OTP verification email to the exact normalized recipientEmail provided.
 * Never overrides, filters, or restricts recipientEmail against OWNER_EMAIL.
 * Never logs the OTP code.
 */
export async function sendOtpVerificationEmail(options: SendOtpEmailOptions): Promise<{
  success: boolean;
  messageId: string;
}> {
  const status = getEmailConfigStatus();
  if (!status.configured) {
    throw new Error('Email service is not configured. Missing required SMTP configuration.');
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    throw new Error('Failed to initialize SMTP email transporter.');
  }

  const smtpUser = cleanEnvValue(process.env.SMTP_USER);
  const from = resolveFromAddress(smtpUser);
  const cleanRecipient = options.recipientEmail.trim().toLowerCase();

  if (!cleanRecipient || !cleanRecipient.includes('@')) {
    throw new Error('Invalid recipient email address.');
  }

  const subject = options.subject || 'Verify your Zenime account';
  const heading = options.heading || 'Verify your Zenime email';
  const description =
    options.description || 'Use the 6-digit verification code below to complete your Zenime verification request.';
  const expiryMinutes = options.expiryMinutes || 10;

  const plainTextContent = `Zenime

${heading}

${description}

Verification Code: ${options.code}

This code expires in ${expiryMinutes} minutes and can only be used once.

If you did not request this verification code, you can safely ignore this email.

© Zenime
This is an automated message. Please do not reply to this email.`;

  const builtInCandidates = [
    path.join(process.cwd(), 'src', 'assets', 'images', 'zenime_primary_logo_1790572796973.jpg'),
    path.join(process.cwd(), 'public', 'zenime-logo.png')
  ];
  const logoDiskPath = builtInCandidates.find(p => fs.existsSync(p)) || builtInCandidates[0];
  const hasLogoFile = fs.existsSync(logoDiskPath);
  const logoAttachment = hasLogoFile
    ? {
        filename: 'zenime-logo.png',
        path: logoDiskPath,
        cid: 'zenime-logo',
        contentDisposition: 'inline' as const,
        contentType: 'image/png'
      }
    : null;
  const externalLogoUrl: string | null = null;

  const appUrl = cleanEnvValue(process.env.APP_URL).replace(/\/+$/, '');
  const logoSrc = logoAttachment
    ? 'cid:zenime-logo'
    : externalLogoUrl
      ? externalLogoUrl
      : appUrl
        ? `${appUrl}/zenime-logo.png`
        : '/zenime-logo.png';

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #030712; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #030712; padding: 40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
            <!-- Zenime Brand Header -->
            <tr>
              <td align="center" style="padding: 36px 24px 20px; text-align: center;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                  <tr>
                    <td align="center" style="padding-bottom: 14px; text-align: center;">
                      <img src="${logoSrc}" alt="Zenime" width="240" style="display: block; width: 240px; max-width: 100%; height: auto; margin: 0 auto; border: 0; outline: none; text-decoration: none;" />
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="text-align: center;">
                      <div style="font-size: 26px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff; line-height: 1.2;">
                        Zen<span style="color: #f43f5e;">ime</span>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Body Content -->
            <tr>
              <td align="center" style="padding: 6px 32px 32px; text-align: center;">
                <h1 style="color: #ffffff; font-size: 20px; font-weight: 800; margin: 0 0 12px 0; letter-spacing: -0.3px; line-height: 1.35;">
                  ${heading}
                </h1>
                <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                  ${description}
                </p>
                <!-- Dedicated OTP Box -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 20px auto;">
                  <tr>
                    <td align="center" style="background-color: #030712; border: 1.5px solid #f43f5e; border-radius: 12px; padding: 16px 28px; text-align: center;">
                      <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #fda4af; display: inline-block;">
                        ${options.code}
                      </span>
                    </td>
                  </tr>
                </table>
                <!-- Expiration -->
                <p style="color: #cbd5e1; font-size: 13px; font-weight: 600; margin: 0 0 16px 0;">
                  This code expires in ${expiryMinutes} minutes and is single-use.
                </p>
                <!-- Security Message -->
                <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
                  If you did not request this verification code, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td align="center" style="padding: 20px 32px; background-color: #060911; border-top: 1px solid #1e293b; text-align: center;">
                <p style="font-size: 12px; color: #64748b; margin: 0 0 4px 0; font-weight: 600;">
                  &copy; Zenime
                </p>
                <p style="font-size: 11px; color: #475569; margin: 0; line-height: 1.4;">
                  This is an automated message. Please do not reply to this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const host = cleanEnvValue(process.env.SMTP_HOST);
  const port = parseSmtpPort(cleanEnvValue(process.env.SMTP_PORT));

  try {
    const info = await transporter.sendMail({
      from,
      to: cleanRecipient,
      subject,
      text: plainTextContent,
      html: htmlContent,
      attachments: logoAttachment ? [logoAttachment] : undefined
    });

    if ((info.rejected && info.rejected.length > 0) || !info.accepted || info.accepted.length === 0) {
      throw new Error('Email provider rejected the recipient address.');
    }

    return {
      success: true,
      messageId: info.messageId || 'sent'
    };
  } catch (err: any) {
    const safeDetail = sanitizeSmtpError(err);
    if (err.code === 'EAUTH' || (err.response && (String(err.response).includes('535') || String(err.response).includes('534')))) {
      const gmailHint = host.toLowerCase().includes('gmail')
        ? ' For Gmail SMTP, use a 16-character Google App Password (with 2-Step Verification enabled) rather than a normal account password.'
        : '';
      throw new Error(`Email service authentication failed (${err.code || '535'}: ${safeDetail}).${gmailHint}`);
    }
    if (err.code === 'EENVELOPE' || (err.response && String(err.response).includes('550')) || (err.message && err.message.includes('rejected'))) {
      throw new Error(`Email provider rejected the message (${safeDetail})`);
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ESOCKET' || err.code === 'ENOTFOUND' || err.code === 'EDNS') {
      throw new Error(`Email service connection to ${host}:${port} failed (${err.code || 'NETWORK_ERROR'}: ${safeDetail})`);
    }
    throw new Error(`Email delivery failed (${safeDetail})`);
  }
}

export async function testEmailTransport(testRecipient?: string): Promise<{
  success: boolean;
  step: string;
  error?: string;
  details?: any;
}> {
  const status = getEmailConfigStatus();
  if (!status.configured) {
    return {
      success: false,
      step: 'SMTP_CONFIGURATION_ERROR',
      error: `Missing configuration: ${status.missing.join(', ')}`,
      details: { missing: status.missing }
    };
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    return {
      success: false,
      step: 'SMTP_CONFIGURATION_ERROR',
      error: 'Unable to initialize email transporter'
    };
  }

  try {
    await transporter.verify();
    if (testRecipient) {
      const smtpUser = cleanEnvValue(process.env.SMTP_USER);
      const from = resolveFromAddress(smtpUser);
      const info = await transporter.sendMail({
        from,
        to: testRecipient.trim().toLowerCase(),
        subject: 'Zenime Email Transport Diagnostic Test',
        text: 'This is an automated test message from Zenime to confirm SMTP transport connectivity.',
        html: '<div style="font-family:sans-serif;padding:20px;background:#0b0f19;color:#fff;border-radius:8px;">Zenime email transport test successful.</div>'
      });
      if ((info.rejected && info.rejected.length > 0) || !info.accepted || info.accepted.length === 0) {
        return {
          success: false,
          step: 'EMAIL_REJECTED',
          error: 'Email provider rejected the recipient address.'
        };
      }
    }
    return {
      success: true,
      step: testRecipient ? 'EMAIL_ACCEPTED' : 'SMTP_AUTH_SUCCESS'
    };
  } catch (err: any) {
    return {
      success: false,
      step: 'SMTP_TRANSPORT_ERROR',
      error: sanitizeSmtpError(err)
    };
  }
}
