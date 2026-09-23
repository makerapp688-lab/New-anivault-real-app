import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateOwnerSession } from './owner-auth.js';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const BUG_REPORTS_PATH = path.join(DATA_DIR, 'bug-reports.json');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'bug-attachments');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

export type BugReportStatus = 'New' | 'Investigating' | 'Fixed' | 'Closed';

export interface BugReportAttachmentMeta {
  fileName: string;
  fileType: string;
  fileSize: number;
  storedPath: string;
}

export interface BugReport {
  id: string; // BUG-YYYYMMDD-XXXXX
  createdAt: string;
  whatHappened: string;
  whatWereYouTryingToDo: string;
  additionalDetails?: string;
  status: BugReportStatus;
  internalNotes?: string;
  reporterProfile?: {
    username?: string;
    email?: string;
    role?: string;
    avatar?: string | null;
  } | null;
  diagnostics: {
    appVersion: string;
    devicePlatform: string;
    browserInfo: string;
    currentRoute: string;
    relevantFeature: string;
    accountId?: string | null;
    userType: 'guest' | 'logged-in';
    ip?: string;
  };
  attachment?: BugReportAttachmentMeta | null;
}

// Load bug reports from file
function loadBugReports(): BugReport[] {
  try {
    if (fs.existsSync(BUG_REPORTS_PATH)) {
      const content = fs.readFileSync(BUG_REPORTS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err: any) {
    console.error('[BugReports DB] Error reading reports:', err.message);
  }
  return [];
}

// Save bug reports to file
function saveBugReports(reports: BugReport[]): void {
  try {
    fs.writeFileSync(BUG_REPORTS_PATH, JSON.stringify(reports, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[BugReports DB] Error saving reports:', err.message);
  }
}

// Allowed file MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/mov',
  'video/x-matroska'
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export function createBugReportsRouter(): Router {
  const router = express.Router();

  // Middleware to verify Owner Session for admin endpoints
  const requireOwnerSession = (req: Request, res: Response, next: express.NextFunction) => {
    let sessionToken = req.headers['x-owner-session'] as string || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    
    if (!sessionToken && req.headers.cookie) {
      const match = req.headers.cookie.match(/anivault_owner_session=([^;]+)/);
      if (match) {
        sessionToken = match[1];
      }
    }

    if (!sessionToken) {
      res.status(401).json({ error: 'Unauthorized. Owner session token missing.' });
      return;
    }

    const owner = validateOwnerSession(sessionToken);
    if (!owner) {
      res.status(403).json({ error: 'Forbidden. Owner authorization required.' });
      return;
    }

    (req as any).owner = owner;
    next();
  };

  // 1. PUBLIC: Submit a Bug Report
  router.post('/', (req: Request, res: Response) => {
    try {
      const {
        whatHappened,
        whatWereYouTryingToDo,
        additionalDetails,
        diagnostics,
        attachment,
        reporterProfile
      } = req.body;

      if (!whatHappened || !whatHappened.trim()) {
        res.status(400).json({ error: 'Please describe what happened.' });
        return;
      }

      if (!whatWereYouTryingToDo || !whatWereYouTryingToDo.trim()) {
        res.status(400).json({ error: 'Please describe what you were trying to do.' });
        return;
      }

      // Generate Report ID
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      const reportId = `BUG-${dateStr}-${randomHex}`;

      let attachmentMeta: BugReportAttachmentMeta | null = null;

      // Process attachment if provided
      if (attachment && attachment.base64Data) {
        const { fileName, fileType, base64Data, fileSize } = attachment;

        if (fileSize && fileSize > MAX_FILE_SIZE_BYTES) {
          res.status(400).json({ error: 'Attached file exceeds maximum size limit of 20MB.' });
          return;
        }

        if (fileType && !ALLOWED_MIME_TYPES.has(fileType.toLowerCase())) {
          res.status(400).json({ error: 'Unsupported file type. Please upload an image (PNG, JPG, WEBP, GIF) or video (MP4, WEBM, MOV).' });
          return;
        }

        // Clean base64 prefix if present
        const pureBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(pureBase64, 'base64');

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
          res.status(400).json({ error: 'Attached file exceeds maximum size limit of 20MB.' });
          return;
        }

        const ext = path.extname(fileName || '') || (fileType?.includes('video') ? '.mp4' : '.png');
        const safeExt = ext.replace(/[^a-zA-Z0-9\.]/g, '');
        const storedFileName = `${reportId}${safeExt}`;
        const storedPath = path.join(ATTACHMENTS_DIR, storedFileName);

        fs.writeFileSync(storedPath, buffer);

        attachmentMeta = {
          fileName: fileName || `attachment${safeExt}`,
          fileType: fileType || 'application/octet-stream',
          fileSize: buffer.length,
          storedPath: storedFileName
        };
      }

      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';

      const newReport: BugReport = {
        id: reportId,
        createdAt: new Date().toISOString(),
        whatHappened: whatHappened.trim(),
        whatWereYouTryingToDo: whatWereYouTryingToDo.trim(),
        additionalDetails: additionalDetails ? additionalDetails.trim() : '',
        status: 'New',
        reporterProfile: reporterProfile ? {
          username: reporterProfile.username || 'Anonymous',
          email: reporterProfile.email || undefined,
          role: reporterProfile.role || 'user',
          avatar: reporterProfile.avatar || null
        } : null,
        diagnostics: {
          appVersion: diagnostics?.appVersion || '2.4.0',
          devicePlatform: diagnostics?.devicePlatform || req.headers['user-agent'] || 'Unknown Device',
          browserInfo: diagnostics?.browserInfo || 'Browser Environment',
          currentRoute: diagnostics?.currentRoute || '/',
          relevantFeature: diagnostics?.relevantFeature || 'General',
          accountId: diagnostics?.accountId || null,
          userType: diagnostics?.userType === 'logged-in' ? 'logged-in' : 'guest',
          ip: clientIp
        },
        attachment: attachmentMeta
      };

      const reports = loadBugReports();
      reports.unshift(newReport); // newest first
      saveBugReports(reports);

      console.log(`[BugReport DB] New bug report submitted: ${reportId}`);

      res.status(201).json({
        success: true,
        reportId,
        message: 'Thanks! Your bug report has been submitted.'
      });
    } catch (err: any) {
      console.error('[BugReport DB] Error creating bug report:', err);
      res.status(500).json({ error: 'Failed to submit bug report. Please try again.' });
    }
  });

  // 2. OWNER: List All Bug Reports
  router.get('/owner/list', requireOwnerSession, (req: Request, res: Response) => {
    try {
      const reports = loadBugReports();
      const newCount = reports.filter(r => r.status === 'New').length;

      // Sanitize storedPath out of list view if necessary, return summary
      res.json({
        success: true,
        total: reports.length,
        newCount,
        reports
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch bug reports.' });
    }
  });

  // 3. OWNER: Get Single Bug Report Details
  router.get('/owner/report/:id', requireOwnerSession, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const reports = loadBugReports();
      const report = reports.find(r => r.id === id);

      if (!report) {
        res.status(404).json({ error: `Bug report '${id}' not found.` });
        return;
      }

      res.json({
        success: true,
        report
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch bug report details.' });
    }
  });

  // 4. OWNER: Update Bug Report Status or Internal Notes
  router.patch('/owner/report/:id', requireOwnerSession, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, internalNote } = req.body;

      const reports = loadBugReports();
      const reportIndex = reports.findIndex(r => r.id === id);

      if (reportIndex === -1) {
        res.status(404).json({ error: `Bug report '${id}' not found.` });
        return;
      }

      const report = reports[reportIndex];

      if (status && ['New', 'Investigating', 'Fixed', 'Closed'].includes(status)) {
        report.status = status as BugReportStatus;
      }

      if (internalNote !== undefined) {
        report.internalNotes = internalNote.trim();
      }

      reports[reportIndex] = report;
      saveBugReports(reports);

      res.json({
        success: true,
        message: 'Bug report updated successfully.',
        report
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to update bug report.' });
    }
  });

  // 5. OWNER: Download/View Attachment File
  router.get('/owner/attachment/:id', requireOwnerSession, (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const reports = loadBugReports();
      const report = reports.find(r => r.id === id);

      if (!report || !report.attachment) {
        res.status(404).send('Attachment not found.');
        return;
      }

      const filePath = path.join(ATTACHMENTS_DIR, report.attachment.storedPath);

      if (!fs.existsSync(filePath)) {
        res.status(404).send('Attachment file missing from storage.');
        return;
      }

      res.setHeader('Content-Type', report.attachment.fileType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${report.attachment.fileName}"`);
      
      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);
    } catch (err: any) {
      res.status(500).send('Failed to serve attachment.');
    }
  });

  return router;
}
