import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Ensure latest environment variables are loaded
dotenv.config();

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
  SMTP_HOST: 'configured' | 'missing';
  SMTP_PORT: 'configured' | 'missing';
  SMTP_USER: 'configured' | 'missing';
  SMTP_PASS: 'configured' | 'missing';
  SMTP_FROM: 'configured' | 'missing';
}

/**
 * Check if the email service has the minimum required SMTP configuration.
 * Reloads dotenv if present to ensure dynamically added env vars are detected.
 * Never logs or exposes credential values.
 */
export function getEmailConfigStatus(): EmailConfigStatus {
  dotenv.config();

  const missing: string[] = [];
  const host = (process.env.SMTP_HOST || '').trim().replace(/^["']|["']$/g, '');
  const user = (process.env.SMTP_USER || '').trim().replace(/^["']|["']$/g, '');
  const pass = (process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '');
  const from = (process.env.SMTP_FROM || '').trim().replace(/^["']|["']$/g, '');

  const hostConfigured = !!host;
  const userConfigured = !!user;
  const passConfigured = !!pass;
  const fromConfigured = !!from || !!user;

  if (!hostConfigured) {
    missing.push('SMTP_HOST');
  }
  if (!userConfigured) {
    missing.push('SMTP_USER');
  }
  if (!passConfigured) {
    missing.push('SMTP_PASS');
  }

  return {
    configured: missing.length === 0,
    missing,
    hostConfigured,
    portConfigured: true,
    userConfigured,
    passConfigured,
    fromConfigured
  };
}

/**
 * Verifies AI Studio server secrets status without ever exposing private values.
 * Reports only 'configured' | 'missing' for each required variable.
 */
export function checkServerSecretsDiagnostic(): ServerSecretsDiagnostic {
  dotenv.config();
  const host = (process.env.SMTP_HOST || '').trim().replace(/^["']|["']$/g, '');
  const port = (process.env.SMTP_PORT || '').trim().replace(/^["']|["']$/g, '');
  const user = (process.env.SMTP_USER || '').trim().replace(/^["']|["']$/g, '');
  const pass = (process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '');
  const from = (process.env.SMTP_FROM || '').trim().replace(/^["']|["']$/g, '');

  return {
    SMTP_HOST: host ? 'configured' : 'missing',
    SMTP_PORT: port ? 'configured' : 'missing',
    SMTP_USER: user ? 'configured' : 'missing',
    SMTP_PASS: pass ? 'configured' : 'missing',
    SMTP_FROM: from || user ? 'configured' : 'missing'
  };
}

/**
 * Safe server-side startup report logging secret status without exposing values.
 */
export function logEmailConfigDiagnostics(): void {
  const diag = checkServerSecretsDiagnostic();
  console.log('[AI_STUDIO_SECRETS_CHECK] Server runtime email configuration:');
  console.log(`  SMTP_HOST: ${diag.SMTP_HOST}`);
  console.log(`  SMTP_PORT: ${diag.SMTP_PORT}`);
  console.log(`  SMTP_USER: ${diag.SMTP_USER}`);
  console.log(`  SMTP_PASS: ${diag.SMTP_PASS}`);
  console.log(`  SMTP_FROM: ${diag.SMTP_FROM}`);
}

/**
 * Creates and configures a nodemailer transport compliant with Gmail and standard SMTP.
 * Enforces TLS, timeouts, and authenticated connection.
 */
export function createEmailTransporter() {
  const { configured } = getEmailConfigStatus();
  if (!configured) {
    return null;
  }

  const host = process.env.SMTP_HOST!.trim().replace(/^["']|["']$/g, '');
  const portStr = (process.env.SMTP_PORT || '587').trim().replace(/^["']|["']$/g, '');
  const port = parseInt(portStr, 10) || 587;
  const user = process.env.SMTP_USER!.trim().replace(/^["']|["']$/g, '');
  let pass = process.env.SMTP_PASS!.trim().replace(/^["']|["']$/g, '');

  // Gmail 16-character App Passwords are commonly displayed in 4 space-separated groups (e.g. "abcd efgh ijkl mnop").
  // Strip all standard and unicode whitespace so SMTP authentication succeeds.
  if ((host.toLowerCase().includes('gmail') || user.toLowerCase().includes('@gmail.com') || pass.length >= 16)) {
    pass = pass.replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]+/g, '');
  }

  const isSecurePort = port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure: isSecurePort,
    requireTLS: !isSecurePort, // enforce STARTTLS on port 587 and others
    auth: {
      user,
      pass
    },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    },
    connectionTimeout: 15000, // 15 seconds connection timeout
    greetingTimeout: 15000,   // 15 seconds greeting timeout
    socketTimeout: 20000      // 20 seconds socket timeout
  });
}

/**
 * Generate cryptographically secure 6-digit verification code and its SHA-256 hash.
 * Plaintext code is strictly single-use and only the hash is persisted.
 */
export function generateVerificationCode(): { code: string; codeHash: string } {
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  return { code, codeHash };
}

/**
 * Determines the authoritative From address.
 * Formats sender display name as "AniVault" with verified sender email.
 */
function resolveFromAddress(smtpUser: string): string {
  const envFrom = (process.env.SMTP_FROM || '').trim().replace(/^["']|["']$/g, '');
  
  if (envFrom) {
    const match = envFrom.match(/<([^>]+)>/);
    if (match && match[1]) {
      return `"AniVault" <${match[1].trim()}>`;
    }
    if (envFrom.includes('@')) {
      return `"AniVault" <${envFrom}>`;
    }
  }

  return `"AniVault" <${smtpUser}>`;
}

export async function testEmailTransport(testRecipient?: string): Promise<{
  success: boolean;
  step: string;
  error?: string;
  details?: any;
}> {
  const status = getEmailConfigStatus();
  if (!status.configured) {
    console.error(`[EMAIL_DIAGNOSTIC] SMTP_CONFIGURATION_ERROR: missing=[${status.missing.join(', ')}]`);
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

  const host = process.env.SMTP_HOST!.trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;

  try {
    console.log(`[EMAIL_DIAGNOSTIC] EMAIL_TRANSPORT_TEST_STARTED: host=${host}, port=${port}`);
    await transporter.verify();
    console.log(`[EMAIL_DIAGNOSTIC] SMTP_CONNECTION_SUCCESS: host=${host}, port=${port}`);
    console.log('[EMAIL_DIAGNOSTIC] SMTP_AUTH_SUCCESS: true');

    if (testRecipient) {
      const recipientDomain = testRecipient.includes('@') ? '@' + testRecipient.split('@')[1] : 'recipient';
      const smtpUser = process.env.SMTP_USER!.trim().replace(/^["']|["']$/g, '');
      const from = resolveFromAddress(smtpUser);
      console.log(`[EMAIL_DIAGNOSTIC] EMAIL_SEND_STARTED: domain=${recipientDomain}`);
      const info = await transporter.sendMail({
        from,
        to: testRecipient,
        subject: 'AniVault Email Transport Diagnostic Test',
        text: 'This is an automated test message from AniVault to confirm SMTP transport connectivity.',
        html: '<div style="font-family:sans-serif;padding:20px;background:#0b0f19;color:#fff;border-radius:8px;">AniVault email transport test successful.</div>'
      });

      if (info.rejected && info.rejected.length > 0) {
        console.error(`[EMAIL_DIAGNOSTIC] EMAIL_REJECTED: provider rejected recipient count=${info.rejected.length}`);
        return {
          success: false,
          step: 'EMAIL_REJECTED',
          error: 'Email provider rejected the message.'
        };
      }

      console.log(`[EMAIL_DIAGNOSTIC] EMAIL_ACCEPTED: messageId=${info.messageId}`);
    }

    return {
      success: true,
      step: 'EMAIL_ACCEPTED'
    };
  } catch (err: any) {
    if (err.code === 'EAUTH' || (err.response && err.response.includes('535'))) {
      console.error(`[EMAIL_DIAGNOSTIC] SMTP_AUTH_FAILED: ${err.message}`);
      return { success: false, step: 'SMTP_AUTH_FAILED', error: 'Email service authentication failed.' };
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ESOCKET' || err.code === 'ENOTFOUND' || err.code === 'EDNS') {
      console.error(`[EMAIL_DIAGNOSTIC] SMTP_CONNECTION_FAILED: ${err.message}`);
      return { success: false, step: 'SMTP_CONNECTION_FAILED', error: 'Email service connection failed.' };
    }
    if (err.code === 'EENVELOPE' || (err.response && err.response.includes('550'))) {
      console.error(`[EMAIL_DIAGNOSTIC] EMAIL_REJECTED: ${err.message}`);
      return { success: false, step: 'EMAIL_REJECTED', error: 'Email provider rejected the message.' };
    }
    console.error(`[EMAIL_DIAGNOSTIC] EMAIL_SEND_FAILED: ${err.message}`);
    return { success: false, step: 'EMAIL_SEND_FAILED', error: 'Email delivery failed.' };
  }
}

/**
 * Send real email verification code via authenticated SMTP.
 * Awaits full provider confirmation before returning success.
 * Throws clean, informative errors if delivery fails.
 */
export async function sendVerificationEmail(
  toEmail: string,
  code: string,
  subjectTitle: string = 'Verify your AniVault account'
): Promise<{ success: boolean; messageId?: string }> {
  const status = getEmailConfigStatus();
  if (!status.configured) {
    console.error(`[EMAIL_DIAGNOSTIC] Missing SMTP configuration: ${status.missing.join(', ')}`);
    throw new Error('Email service is not configured.');
  }

  const transporter = createEmailTransporter();
  if (!transporter) {
    console.error('[EMAIL_DIAGNOSTIC] Missing SMTP configuration: transporter initialization returned null');
    throw new Error('Email service is not configured.');
  }

  const smtpUser = process.env.SMTP_USER!.trim().replace(/^["']|["']$/g, '');
  const from = resolveFromAddress(smtpUser);
  const host = process.env.SMTP_HOST!.trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  const userDomain = smtpUser.includes('@') ? '@' + smtpUser.split('@')[1] : 'smtp_host';

  const recipientDomain = toEmail.includes('@') ? '@' + toEmail.split('@')[1] : 'recipient';
  console.log(`[EMAIL_DIAGNOSTIC] Email send started: recipientDomain=${recipientDomain}`);
  console.log(`[EMAIL_DIAGNOSTIC] SMTP connection: host=${host}, port=${port}`);
  console.log(`[EMAIL_DIAGNOSTIC] SMTP authentication: authenticated as userDomain=${userDomain}`);

  // Plain text fallback
  const plainTextContent = 
`AniVault

Here’s your new account verification code

Use the verification code below to verify your AniVault account:

┌─────────────────┐
│     ${code}      │
└─────────────────┘

This code expires in 10 minutes.

If you didn’t request this verification code, you can safely ignore this email.

© AniVault
This is an automated message. Please do not reply to this email.`;

  // Production-grade responsive HTML email template matching AniVault branding.
  // Uses pure CSS/HTML table layout with 0 binary attachments for maximum deliverability & inbox placement.
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subjectTitle}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #030712; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #030712; padding: 40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
            
            <!-- Header: AniVault Brand Header -->
            <tr>
              <td align="center" style="padding: 36px 32px 20px; text-align: center;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                  <tr>
                    <td align="center" style="padding-bottom: 12px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                        <tr>
                          <td align="center" style="width: 56px; height: 56px; background-color: #e11d48; border-radius: 14px; text-align: center; vertical-align: middle; box-shadow: 0 4px 14px rgba(225, 29, 72, 0.45);">
                            <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 30px; font-weight: 900; color: #ffffff; line-height: 56px; display: block;">A</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td align="center">
                      <div style="font-size: 24px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff; line-height: 1.2;">
                        Ani<span style="color: #f43f5e;">Vault</span>
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
                  Here’s your new account verification
                </h1>
                
                <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                  Use the verification code below to verify your AniVault account.
                </p>

                <!-- Dedicated OTP Box -->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto 20px auto;">
                  <tr>
                    <td align="center" style="background-color: #030712; border: 1.5px solid #f43f5e; border-radius: 12px; padding: 16px 28px; text-align: center;">
                      <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #fda4af; display: inline-block;">
                        ${code}
                      </span>
                    </td>
                  </tr>
                </table>

                <!-- Expiration -->
                <p style="color: #cbd5e1; font-size: 13px; font-weight: 600; margin: 0 0 16px 0;">
                  This code expires in 10 minutes.
                </p>

                <!-- Security Message -->
                <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
                  If you didn’t request this verification code, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Professional Footer -->
            <tr>
              <td align="center" style="padding: 20px 32px; background-color: #060911; border-top: 1px solid #1e293b; text-align: center;">
                <p style="font-size: 12px; color: #64748b; margin: 0 0 4px 0; font-weight: 600;">
                  &copy; AniVault
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

  try {
    console.log(`[EMAIL_DIAGNOSTIC] SMTP send attempt: recipientDomain=${recipientDomain}`);
    const info = await transporter.sendMail({
      from,
      to: toEmail,
      subject: subjectTitle,
      text: plainTextContent,
      html: htmlContent
    });

    if (info.rejected && info.rejected.length > 0) {
      console.error(`[EMAIL_DIAGNOSTIC] Email provider rejected message: count=${info.rejected.length}`);
      console.error('[EMAIL_DIAGNOSTIC] Invalid recipient: recipient was rejected by the mail server');
      throw new Error('Email provider rejected the message.');
    }

    console.log(`[EMAIL_DIAGNOSTIC] SMTP/provider acceptance: messageId=${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    if (err.code === 'EAUTH' || (err.response && err.response.includes('535'))) {
      console.error(`[EMAIL_DIAGNOSTIC] SMTP authentication failed: ${err.message}`);
      throw new Error('Email service authentication failed.');
    }
    if (err.code === 'EENVELOPE' || (err.response && err.response.includes('550')) || (err.message && err.message.includes('Email provider rejected'))) {
      console.error(`[EMAIL_DIAGNOSTIC] Email provider rejected message: ${err.message}`);
      throw new Error('Email provider rejected the message.');
    }
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ESOCKET' || err.code === 'ENOTFOUND' || err.code === 'EDNS') {
      console.error(`[EMAIL_DIAGNOSTIC] SMTP connection failed: ${err.message}`);
      throw new Error('Email service connection failed.');
    }
    if (err.message && (err.message.includes('authentication') || err.message.includes('connection') || err.message.includes('configured'))) {
      throw err;
    }

    console.error(`[EMAIL_DIAGNOSTIC] SMTP connection failed: ${err.message}`);
    throw new Error('Email delivery failed.');
  }
}

