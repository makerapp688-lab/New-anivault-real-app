import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'owner-audit-logs.json');

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  operator: string;
  result: 'success' | 'failure';
  recordId?: string;
  details?: string;
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadAuditLogs(): AuditLogEntry[] {
  try {
    if (fs.existsSync(AUDIT_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(AUDIT_LOG_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[AuditLogger] Error loading logs:', err.message);
  }
  return [];
}

export function writeAuditLogs(logs: AuditLogEntry[]): void {
  try {
    fs.writeFileSync(AUDIT_LOG_PATH, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[AuditLogger] Error saving logs:', err.message);
  }
}

export function logAdminAction(
  action: string,
  operator: string,
  result: 'success' | 'failure',
  recordId?: string,
  details?: string
): void {
  try {
    // Sanitize secrets or credentials if any are accidentally passed
    const sanitize = (text?: string) => {
      if (!text) return '';
      return text
        .replace(/(password|secret|pass|token|session|key)=[^\s&]+/gi, '$1=REDACTED')
        .replace(/usr_session_[a-f0-9]+/gi, 'REDACTED_SESSION')
        .replace(/owner_session_[a-f0-9]+/gi, 'REDACTED_OWNER_SESSION');
    };

    const entry: AuditLogEntry = {
      id: `LOG-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toISOString(),
      action: sanitize(action),
      operator: sanitize(operator),
      result,
      recordId: recordId ? sanitize(recordId) : undefined,
      details: details ? sanitize(details) : undefined
    };

    const logs = loadAuditLogs();
    logs.unshift(entry); // Newest first

    // Keep logs size bounded (e.g. max 500 entries)
    if (logs.length > 500) {
      logs.splice(500);
    }

    writeAuditLogs(logs);
    console.log(`[AuditLog] Operator "${entry.operator}" executed action "${entry.action}" with result "${entry.result}".`);
  } catch (err: any) {
    console.error('[AuditLogger] Logging action failed:', err.message);
  }
}
