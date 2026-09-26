import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { globalDataStore } from './data-store.ts';

export interface SourcePackageMetadata {
  available: boolean;
  packageName: string;
  generatedAt: string;
  totalFiles: number;
  totalUncompressedBytes: number;
  includedDirectories: string[];
  excludedSensitiveItems: string[];
  lastUpdatedAt?: string;
  lastSha256?: string;
  lastCompressedBytes?: number;
}

export interface GeneratedSourcePackage {
  buffer: Buffer;
  filename: string;
  generatedAt: string;
  sha256: string;
  compressedBytes: number;
  uncompressedBytes: number;
  totalFiles: number;
  excludedSensitiveItems: string[];
}

// Directories that must never be included in the source package
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.cache',
  '.next',
  'coverage',
  'tmp',
  'temp'
]);

// Specific relative file paths or filenames that contain secrets, credentials, password hashes, or active sessions
const EXCLUDED_SENSITIVE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.session-secret',
  'server/data/.session-secret',
  'server/data/owner-account.json',
  'server/data/owner-sessions.json',
  'server/data/owner-setup-temp.json',
  'server/data/owner-email-change-temp.json',
  'server/data/users-sessions.json',
  'server/data/users-temp-verifications.json',
  'public/anivault-source.tar.gz',
  'dist/anivault-source.tar.gz',
  'public/anivault-source.zip',
  'dist/anivault-source.zip'
]);

// Files that should be included as sanitized empty structures so the app boots cleanly with zero leaked user/audit data
const SANITIZED_JSON_OVERRIDES: Record<string, string> = {
  'server/data/users-accounts.json': '[]\n',
  'server/data/owner-audit-logs.json': '[]\n'
};

// Patterns of sensitive extensions or filenames
function isSensitiveOrExcludedFile(relPath: string, fileName: string): boolean {
  const normalizedRel = relPath.replace(/\\/g, '/');
  if (EXCLUDED_SENSITIVE_FILES.has(normalizedRel) || EXCLUDED_SENSITIVE_FILES.has(fileName)) {
    return true;
  }
  // Block any .env* file except .env.example
  if (fileName.startsWith('.env') && fileName !== '.env.example') {
    return true;
  }
  // Block temporary atomic write files, private keys, certificates, secret files, or pre-built archive bundles
  const lower = fileName.toLowerCase();
  if (
    lower.endsWith('.tmp') ||
    lower.includes('.tmp.') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.endsWith('.pfx') ||
    lower.endsWith('.p12') ||
    lower.endsWith('.secret') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.zip')
  ) {
    return true;
  }
  return false;
}

/**
 * Sanitizes text content for configuration files to ensure no secret values,
 * API keys, SMTP passwords, or tokens can ever leak into the exported archive.
 */
function sanitizeContentIfNeeded(relPath: string, rawBuffer: Buffer): Buffer {
  const normalizedRel = relPath.replace(/\\/g, '/');

  if (normalizedRel in SANITIZED_JSON_OVERRIDES) {
    return Buffer.from(SANITIZED_JSON_OVERRIDES[normalizedRel], 'utf-8');
  }

  if (normalizedRel === '.env.example') {
    const lines = rawBuffer.toString('utf-8').split('\n');
    const safeLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) return line;
      const key = line.slice(0, eqIdx).trim();
      if (/KEY|SECRET|PASS|TOKEN|AUTH|CREDENTIAL/i.test(key)) {
        return `${key}="YOUR_${key}_HERE"`;
      }
      return line;
    });
    return Buffer.from(safeLines.join('\n'), 'utf-8');
  }

  if (normalizedRel === 'server/data/artwork-sources-config.json') {
    try {
      const parsed = JSON.parse(rawBuffer.toString('utf-8'));
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map(item => {
          const copy = { ...item };
          delete copy.apiKey;
          delete copy.secret;
          delete copy.token;
          return copy;
        });
        return Buffer.from(JSON.stringify(cleaned, null, 2) + '\n', 'utf-8');
      }
    } catch {
      // Leave as-is if not JSON array
    }
  }

  return rawBuffer;
}

interface CollectedFile {
  relPath: string;
  content: Buffer;
  mtime: Date;
  mode: number;
}

function collectProjectFiles(rootDir: string): {
  files: CollectedFile[];
  excludedSensitiveItems: string[];
} {
  try {
    globalDataStore.flushCatalogueSync();
    globalDataStore.flushRecordsSync();
  } catch {
    // Non-fatal if data store is not dirty
  }

  const files: CollectedFile[] = [];
  const excludedSet = new Set<string>([
    '.env / .env.* (runtime environment secrets)',
    'server/data/.session-secret (HMAC session signing secret)',
    'server/data/owner-account.json (Owner passwordHash & salt)',
    'server/data/owner-sessions.json (Active Owner session tokens)',
    'server/data/users-accounts.json (Sanitized — user password hashes stripped)',
    'server/data/users-sessions.json (Active user session tokens)',
    'SMTP credentials, API keys, and runtime process.env secrets'
  ]);

  function walk(currentDir: string, relPrefix: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort deterministically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        if (isSensitiveOrExcludedFile(relPath, entry.name)) {
          excludedSet.add(relPath);
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          const rawBuf = fs.readFileSync(fullPath);
          const sanitizedBuf = sanitizeContentIfNeeded(relPath, rawBuf);
          files.push({
            relPath,
            content: sanitizedBuf,
            mtime: stat.mtime,
            mode: (stat.mode & 0o777) || 0o644
          });
        } catch (err) {
          console.warn(`[SourcePackager] Skipped unreadable file ${relPath}:`, err);
        }
      }
    }
  }

  walk(rootDir, '');

  // Ensure sanitized overrides exist even if not yet created on disk
  for (const [overridePath, overrideContent] of Object.entries(SANITIZED_JSON_OVERRIDES)) {
    if (!files.some(f => f.relPath === overridePath)) {
      files.push({
        relPath: overridePath,
        content: Buffer.from(overrideContent, 'utf-8'),
        mtime: new Date(),
        mode: 0o644
      });
    }
  }

  return {
    files,
    excludedSensitiveItems: Array.from(excludedSet)
  };
}

// Precomputed IEEE 802.3 CRC-32 lookup table fallback
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(buf: Buffer): number {
  if (typeof (zlib as any).crc32 === 'function') {
    return (zlib as any).crc32(buf) >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, Math.min(2107, d.getUTCFullYear()));
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = Math.floor(d.getUTCSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Builds a standard PKZIP (.zip) archive buffer from the collected files.
 */
function createZipArchiveBuffer(files: CollectedFile[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralDirectoryChunks: Buffer[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const cleanPath = file.relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanPath, 'utf-8');
    const uncompressedData = file.content;
    const uncompressedSize = uncompressedData.length;
    const crc32 = computeCrc32(uncompressedData);
    const { dosTime, dosDate } = toDosDateTime(file.mtime);

    let compressionMethod = 0; // 0 = STORE, 8 = DEFLATE
    let compressedData = uncompressedData;

    if (uncompressedSize > 0) {
      const deflated = zlib.deflateRawSync(uncompressedData, { level: 6 });
      if (deflated.length < uncompressedSize) {
        compressionMethod = 8;
        compressedData = deflated;
      }
    }

    const compressedSize = compressedData.length;
    const utf8Flag = 0x0800; // Bit 11: filename and comment are UTF-8 encoded

    // 1. Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature (PK\x03\x04)
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(utf8Flag, 6); // General purpose bit flag
    localHeader.writeUInt16LE(compressionMethod, 8); // Compression method
    localHeader.writeUInt16LE(dosTime, 10); // Last mod file time
    localHeader.writeUInt16LE(dosDate, 12); // Last mod file date
    localHeader.writeUInt32LE(crc32, 14); // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    const localHeaderOffset = currentOffset;
    localChunks.push(localHeader);
    currentOffset += localHeader.length;

    if (compressedSize > 0) {
      localChunks.push(compressedData);
      currentOffset += compressedSize;
    }

    // 2. Central Directory File Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central file header signature (PK\x01\x02)
    centralHeader.writeUInt16LE(0x0314, 4); // Version made by (UNIX + 2.0)
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract (2.0)
    centralHeader.writeUInt16LE(utf8Flag, 8); // General purpose bit flag
    centralHeader.writeUInt16LE(compressionMethod, 10); // Compression method
    centralHeader.writeUInt16LE(dosTime, 12); // Last mod file time
    centralHeader.writeUInt16LE(dosDate, 14); // Last mod file date
    centralHeader.writeUInt32LE(crc32, 16); // CRC-32
    centralHeader.writeUInt32LE(compressedSize, 20); // Compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    const unixPermissions = ((0o100000 | (file.mode & 0o777)) << 16) >>> 0;
    centralHeader.writeUInt32LE(unixPermissions, 38); // External file attributes
    centralHeader.writeUInt32LE(localHeaderOffset, 42); // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralDirectoryChunks.push(centralHeader);
  }

  const centralDirectoryOffset = currentOffset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectoryChunks);
  const centralDirectorySize = centralDirectoryBuffer.length;
  const totalEntries = files.length;

  // 3. End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central dir signature (PK\x05\x06)
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(totalEntries, 8); // Number of central directory records on this disk
  eocd.writeUInt16LE(totalEntries, 10); // Total number of central directory records
  eocd.writeUInt32LE(centralDirectorySize, 12); // Size of central directory (bytes)
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localChunks, centralDirectoryBuffer, eocd]);
}

/**
 * Verifies that a generated ZIP archive buffer is structurally valid and non-empty
 * before it is ever sent to the client.
 */
export function validateZipArchiveBuffer(zipBuffer: Buffer, expectedEntries?: number): void {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('Generated source archive is empty or truncated.');
  }
  const firstSig = zipBuffer.readUInt32LE(0);
  if (firstSig !== 0x04034b50) {
    throw new Error(`Invalid ZIP local file header signature (0x${firstSig.toString(16)}).`);
  }
  const eocdOffset = zipBuffer.length - 22;
  const eocdSig = zipBuffer.readUInt32LE(eocdOffset);
  if (eocdSig !== 0x06054b50) {
    throw new Error(`Invalid ZIP End-of-Central-Directory signature (0x${eocdSig.toString(16)}).`);
  }
  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  if (entryCount === 0) {
    throw new Error('Generated ZIP archive contains 0 files.');
  }
  if (typeof expectedEntries === 'number' && entryCount !== expectedEntries) {
    throw new Error(`ZIP archive entry count mismatch: expected ${expectedEntries}, got ${entryCount}.`);
  }
}

const ARCHIVE_STORAGE_DIR = '/tmp/anivex-owner-archive';
const ARCHIVE_DISK_PATH = path.join(ARCHIVE_STORAGE_DIR, 'anivex-latest-source.zip');
const ARCHIVE_META_PATH = path.join(ARCHIVE_STORAGE_DIR, 'anivex-latest-source.meta.json');

export function getArchiveDiskPath(): string {
  return ARCHIVE_DISK_PATH;
}

let lastUpdatedPackageState: GeneratedSourcePackage | null = null;

function persistArchiveToDisk(pkg: GeneratedSourcePackage): void {
  fs.mkdirSync(ARCHIVE_STORAGE_DIR, { recursive: true });
  const tmpZipPath = `${ARCHIVE_DISK_PATH}.tmp.${process.pid}.${Date.now()}`;
  const tmpMetaPath = `${ARCHIVE_META_PATH}.tmp.${process.pid}.${Date.now()}`;

  fs.writeFileSync(tmpZipPath, pkg.buffer);
  fs.renameSync(tmpZipPath, ARCHIVE_DISK_PATH);

  const metaPayload = {
    filename: pkg.filename,
    generatedAt: pkg.generatedAt,
    sha256: pkg.sha256,
    compressedBytes: pkg.compressedBytes,
    uncompressedBytes: pkg.uncompressedBytes,
    totalFiles: pkg.totalFiles,
    excludedSensitiveItems: pkg.excludedSensitiveItems
  };
  fs.writeFileSync(tmpMetaPath, JSON.stringify(metaPayload, null, 2), 'utf-8');
  fs.renameSync(tmpMetaPath, ARCHIVE_META_PATH);

  // Verify the written file exists and is readable on disk
  if (!fs.existsSync(ARCHIVE_DISK_PATH)) {
    throw new Error('Archive file does not exist on disk after generation.');
  }
  fs.accessSync(ARCHIVE_DISK_PATH, fs.constants.R_OK);
  const stat = fs.statSync(ARCHIVE_DISK_PATH);
  if (stat.size < 22 || stat.size !== pkg.buffer.length) {
    throw new Error('Archive file on disk is incomplete or unreadable.');
  }
}

function readVerifiedArchiveFromDisk(): GeneratedSourcePackage | null {
  try {
    if (!fs.existsSync(ARCHIVE_DISK_PATH) || !fs.existsSync(ARCHIVE_META_PATH)) {
      return null;
    }
    fs.accessSync(ARCHIVE_DISK_PATH, fs.constants.R_OK);
    fs.accessSync(ARCHIVE_META_PATH, fs.constants.R_OK);

    const diskBuffer = fs.readFileSync(ARCHIVE_DISK_PATH);
    const metaRaw = JSON.parse(fs.readFileSync(ARCHIVE_META_PATH, 'utf-8'));

    validateZipArchiveBuffer(diskBuffer, metaRaw.totalFiles);

    const pkg: GeneratedSourcePackage = {
      buffer: diskBuffer,
      filename: metaRaw.filename || `anivex-latest-source-${new Date().toISOString().slice(0, 10)}.zip`,
      generatedAt: metaRaw.generatedAt || new Date().toISOString(),
      sha256: metaRaw.sha256 || crypto.createHash('sha256').update(diskBuffer).digest('hex'),
      compressedBytes: diskBuffer.length,
      uncompressedBytes: metaRaw.uncompressedBytes || diskBuffer.length,
      totalFiles: metaRaw.totalFiles || 0,
      excludedSensitiveItems: metaRaw.excludedSensitiveItems || []
    };
    lastUpdatedPackageState = pkg;
    return pkg;
  } catch {
    return null;
  }
}

/**
 * Inspects the live workspace and ensures a valid downloadable archive is ready on disk.
 */
export function inspectLatestAppSourceMetadata(): SourcePackageMetadata {
  const rootDir = process.cwd();
  const { files, excludedSensitiveItems } = collectProjectFiles(rootDir);
  const generatedAt = new Date().toISOString();
  const dateStamp = generatedAt.slice(0, 10);
  const totalUncompressedBytes = files.reduce((acc, f) => acc + f.content.length, 0);

  if (!lastUpdatedPackageState) {
    readVerifiedArchiveFromDisk();
  }

  return {
    available: files.length > 0,
    packageName: lastUpdatedPackageState?.filename || `anivex-latest-source-${dateStamp}.zip`,
    generatedAt,
    totalFiles: files.length + 1, // +1 for SOURCE_PACKAGE_MANIFEST.json
    totalUncompressedBytes,
    includedDirectories: ['src', 'server', 'public', 'scripts', 'test'],
    excludedSensitiveItems,
    lastUpdatedAt: lastUpdatedPackageState?.generatedAt,
    lastSha256: lastUpdatedPackageState?.sha256,
    lastCompressedBytes: lastUpdatedPackageState?.compressedBytes
  };
}

/**
 * Explicitly rebuilds and replaces the downloadable source archive file on disk
 * using the latest current ANIVEX project files.
 */
export function updateLatestAppSourceArchive(ownerUsername: string = 'Death197'): GeneratedSourcePackage {
  const pkg = buildLatestAppSourceArchive(ownerUsername);
  lastUpdatedPackageState = pkg;
  return pkg;
}

/**
 * Verifies the latest generated archive exists and is readable on disk before returning it,
 * or generates a fresh archive if none exists yet.
 */
export function getLatestOrBuildAppSourceArchive(
  ownerUsername: string = 'Death197',
  forceFresh: boolean = false
): GeneratedSourcePackage {
  if (!forceFresh) {
    const diskPkg = readVerifiedArchiveFromDisk();
    if (diskPkg) {
      return diskPkg;
    }
  }
  return buildLatestAppSourceArchive(ownerUsername);
}

/**
 * Dynamically generates a fresh, sanitized `.zip` source code package
 * from the live server/project state and persists it to disk.
 */
export function buildLatestAppSourceArchive(ownerUsername: string = 'Death197'): GeneratedSourcePackage {
  const rootDir = process.cwd();
  const { files, excludedSensitiveItems } = collectProjectFiles(rootDir);
  if (files.length === 0) {
    throw new Error('No source files could be collected from the project workspace.');
  }

  const generatedAt = new Date().toISOString();
  const dateStamp = generatedAt.slice(0, 10);
  const filename = `anivex-latest-source-${dateStamp}.zip`;

  // Build live manifest file so the developer knows the exact snapshot state
  const manifest = {
    application: 'ANIVEX',
    packageType: 'live-development-source-snapshot',
    archiveFormat: 'zip',
    generatedAt,
    generatedForOwner: ownerUsername,
    totalProjectFiles: files.length,
    securityPolicy: {
      secretsExcluded: true,
      passwordsExcluded: true,
      smtpCredentialsExcluded: true,
      apiKeysExcluded: true,
      sessionSecretsExcluded: true,
      excludedSensitiveItems
    },
    quickStart: [
      '1. Extract archive: unzip ' + filename,
      '2. Copy .env.example to .env and fill in your own local credentials if needed',
      '3. Install dependencies: npm install',
      '4. Start development server: npm run dev'
    ]
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  const allFiles: CollectedFile[] = [
    ...files,
    {
      relPath: 'SOURCE_PACKAGE_MANIFEST.json',
      content: manifestBuffer,
      mtime: new Date(),
      mode: 0o644
    }
  ];

  const uncompressedBytes = allFiles.reduce((acc, f) => acc + f.content.length, 0);
  const zipBuffer = createZipArchiveBuffer(allFiles);

  // Strict validation before persisting and returning the archive
  validateZipArchiveBuffer(zipBuffer, allFiles.length);

  const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

  const pkg: GeneratedSourcePackage = {
    buffer: zipBuffer,
    filename,
    generatedAt,
    sha256,
    compressedBytes: zipBuffer.length,
    uncompressedBytes,
    totalFiles: allFiles.length,
    excludedSensitiveItems
  };

  persistArchiveToDisk(pkg);
  lastUpdatedPackageState = pkg;
  return pkg;
}
