import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { runIngestion } from './server/raretoon-ingest.ts';
import { createOwnerRouter, authenticateSession, requireOwner, isEmailAuthorizedOwner } from './server/owner-auth.js';
import { buildLatestAppSourceArchive, getLatestOrBuildAppSourceArchive, inspectLatestAppSourceMetadata, validateZipArchiveBuffer } from './server/source-packager.js';
import { createUserAuthRouter } from './server/user-auth.js';

import { createBugReportsRouter } from './server/bug-reports.js';
import { globalDataStore } from './server/data-store.ts';

const app = express();
app.set('trust proxy', 1);
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Mount AniVault User & Provider Authentication
const userAuthRouter = createUserAuthRouter();
app.use('/api/auth', userAuthRouter);
app.use('/auth', userAuthRouter);

// Mount AniVault Owner System Backend Foundation
app.use('/api/owner', createOwnerRouter());

// Mount AniVault Bug Reporting System
const bugReportsRouter = createBugReportsRouter();
app.use('/api/bug-reports', bugReportsRouter);

// In-memory cache for catalogue
let catalogueCache: any[] = [];
let statsCache: any = null;
let isSyncing = false;
let syncMessage = 'Idle';
let lastSyncTimestamp = new Date().toISOString();

function loadCatalogue() {
  try {
    const dataPath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
    const statsPath = path.join(process.cwd(), 'server', 'data', 'sync-report.json');
    const fallbackPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');

    const inMemoryCatalogue = globalDataStore.getAllCatalogueAnime();
    if (inMemoryCatalogue && inMemoryCatalogue.length > 0) {
      catalogueCache = inMemoryCatalogue;
    } else if (fs.existsSync(dataPath)) {
      catalogueCache = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } else if (fs.existsSync(fallbackPath)) {
      catalogueCache = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
    }

    if (fs.existsSync(statsPath)) {
      statsCache = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[AniVault DB] Error loading catalogue:', err.message);
  }
}

// Initial load
loadCatalogue();

// API ROUTES FIRST
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Zenime',
    totalAnime: catalogueCache.length,
    activeProvider: 'RareToon India (RareAnimes)',
    providerUrl: 'https://www.rareanimes.mov/home/'
  });
});

function resolveBuiltInZenimeLogoPath(variant: 'primary' | 'cinematic' = 'primary'): string | null {
  if (variant === 'cinematic') {
    const cinematicCandidates = [
      path.join(process.cwd(), 'public', 'zenime-cinematic-logo.png'),
      path.join(process.cwd(), 'src', 'assets', 'images', 'zenime_official_logo_1790572469771.jpg')
    ];
    const canonicalCinematic = path.join(process.cwd(), 'public', 'zenime-cinematic-logo.png');
    for (const candidate of cinematicCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          if (fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 0) {
            if (candidate !== canonicalCinematic) {
              try {
                fs.mkdirSync(path.dirname(canonicalCinematic), { recursive: true });
                fs.copyFileSync(candidate, canonicalCinematic);
              } catch {}
            }
            return fs.existsSync(canonicalCinematic) ? canonicalCinematic : candidate;
          }
        } catch {}
      }
    }
    return null;
  }

  const primarySource = path.join(process.cwd(), 'src', 'assets', 'images', 'zenime_primary_logo_1790572796973.jpg');
  const canonicalPrimary = path.join(process.cwd(), 'public', 'zenime-logo.png');
  const canonicalPrimaryAlias = path.join(process.cwd(), 'public', 'zenime-primary-logo.png');

  if (fs.existsSync(primarySource) && fs.statSync(primarySource).size > 0) {
    try {
      fs.mkdirSync(path.dirname(canonicalPrimary), { recursive: true });
      fs.copyFileSync(primarySource, canonicalPrimary);
      fs.copyFileSync(primarySource, canonicalPrimaryAlias);
    } catch {}
    return fs.existsSync(canonicalPrimary) ? canonicalPrimary : primarySource;
  }

  if (fs.existsSync(canonicalPrimary) && fs.statSync(canonicalPrimary).size > 0) {
    return canonicalPrimary;
  }
  return null;
}

// Ensure canonical public/zenime-logo.png and public/zenime-cinematic-logo.png exist from built-in project assets on startup
resolveBuiltInZenimeLogoPath('primary');
resolveBuiltInZenimeLogoPath('cinematic');

app.get(['/zenime-logo.png', '/zenime-primary-logo.png'], (_req, res) => {
  const logoPath = resolveBuiltInZenimeLogoPath('primary');
  if (!logoPath) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(logoPath);
});

app.get('/zenime-cinematic-logo.png', (_req, res) => {
  const logoPath = resolveBuiltInZenimeLogoPath('cinematic');
  if (!logoPath) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(logoPath);
});

app.get('/api/brand-logo', (_req, res) => {
  const primaryPath = resolveBuiltInZenimeLogoPath('primary');
  const cinematicPath = resolveBuiltInZenimeLogoPath('cinematic');
  res.json({
    configured: Boolean(primaryPath && cinematicPath),
    source: 'built-in-asset',
    logoUrl: '/zenime-logo.png',
    primaryLogoUrl: '/zenime-logo.png',
    cinematicLogoUrl: '/zenime-cinematic-logo.png'
  });
});

app.post('/api/brand-logo', (_req, res) => {
  res.status(403).json({
    error: 'Forbidden: The official Zenime logo is a permanent built-in project asset and cannot be uploaded or replaced.'
  });
});

// Block any direct static URL access to source archive filenames outside the authenticated Owner API
app.use((req, res, next) => {
  const lowerPath = req.path.toLowerCase();
  const isOwnerDownloadApi =
    lowerPath.startsWith('/api/owner/source-package/download') ||
    lowerPath === '/api/download-source';

  if (
    !isOwnerDownloadApi &&
    (lowerPath.endsWith('.tar.gz') ||
      lowerPath.endsWith('.tgz') ||
      lowerPath.endsWith('.zip') ||
      lowerPath.includes('anivault-source') ||
      lowerPath.includes('anivex-source'))
  ) {
    res.status(403).json({
      error: 'Forbidden: Direct URL access to source archives is prohibited. Use the authenticated Owner Administration endpoint.'
    });
    return;
  }
  next();
});

app.get('/api/download-source', authenticateSession, requireOwner, (req, res) => {
  try {
    const session = (req as any).ownerSession;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.query.check === 'true') {
      const meta = inspectLatestAppSourceMetadata();
      res.json({
        success: true,
        available: meta.available,
        packageName: meta.packageName,
        totalFiles: meta.totalFiles,
        generatedAt: meta.generatedAt
      });
      return;
    }

    const forceFresh = req.query.fresh === 'true' || req.query.fresh === '1';
    const pkg = getLatestOrBuildAppSourceArchive(session?.username || 'Death197', forceFresh);
    validateZipArchiveBuffer(pkg.buffer, pkg.totalFiles);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(pkg.compressedBytes));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pkg.filename}"; filename*=UTF-8''${encodeURIComponent(pkg.filename)}`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Zenime-Source-Filename', pkg.filename);
    res.setHeader('X-Zenime-Source-Generated-At', pkg.generatedAt);
    res.setHeader('X-Zenime-Source-Files-Count', String(pkg.totalFiles));
    res.setHeader('X-Zenime-Source-SHA256', pkg.sha256);
    res.status(200).end(pkg.buffer);
  } catch (err: any) {
    console.error('[DownloadSource Error]', err);
    res.status(500).json({
      error: err?.message || 'Failed to generate live source .zip archive.',
      code: 'ARCHIVE_GENERATION_FAILED'
    });
  }
});

app.get('/api/stats', (req, res) => {
  if (!statsCache) {
    loadCatalogue();
  }
  res.json({
    stats: statsCache,
    totalAnime: catalogueCache.length,
    lastSyncTimestamp
  });
});

app.get('/api/genres', (req, res) => {
  loadCatalogue();
  const counts: Record<string, number> = {};
  for (const item of catalogueCache) {
    if (Array.isArray(item.genres)) {
      for (const g of item.genres) {
        counts[g] = (counts[g] || 0) + 1;
      }
    }
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([genre, count]) => ({ genre, count }));

  res.json({ genres: sorted });
});

app.get('/api/anime', (req, res) => {
  loadCatalogue();
  let results = [...catalogueCache];

  const { search, genre, type, sort, audio, status, page, limit, all } = req.query;

  // Search filter
  if (typeof search === 'string' && search.trim().length > 0) {
    const query = search.trim().toLowerCase();
    results = results.filter(item => {
      const matchTitle = item.title?.toLowerCase().includes(query);
      const matchAlt = item.alternateTitle?.toLowerCase().includes(query);
      const matchSynopsis = item.synopsis?.toLowerCase().includes(query);
      const matchGenres = item.genres?.some((g: string) => g.toLowerCase().includes(query));
      const matchDub = item.providers?.raretoonIndia?.dubLanguage?.toLowerCase().includes(query);
      const matchProviderId = item.providers?.raretoonIndia?.providerAnimeId?.toLowerCase().includes(query);
      return matchTitle || matchAlt || matchSynopsis || matchGenres || matchDub || matchProviderId;
    });
  }

  // Genre filter
  if (typeof genre === 'string' && genre.trim().length > 0 && genre !== 'All') {
    const target = genre.trim().toLowerCase();
    results = results.filter(item =>
      item.genres?.some((g: string) => g.toLowerCase() === target)
    );
  }

  // Type filter (TV / Movie)
  if (typeof type === 'string' && (type === 'TV' || type === 'Movie')) {
    results = results.filter(item => item.type === type);
  }

  // Audio filter
  if (typeof audio === 'string') {
    if (audio === 'hindi') {
      results = results.filter(item => {
        const dub = (item.providers?.raretoonIndia?.dubLanguage || '').toLowerCase();
        return dub.includes('hindi') || dub.includes('dual') || dub.includes('multi');
      });
    } else if (audio === 'dual') {
      results = results.filter(item => {
        const dub = (item.providers?.raretoonIndia?.dubLanguage || '').toLowerCase();
        return dub.includes('dual') || (dub.includes('hindi') && dub.includes('english'));
      });
    }
  }

  // Status filter
  if (typeof status === 'string' && status !== 'all') {
    results = results.filter(item => item.status === status);
  }

  // Sorting
  if (sort === 'title') {
    results.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === 'year') {
    results.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
  } else if (sort === 'seasons') {
    results.sort((a, b) => (b.seasons?.length || 0) - (a.seasons?.length || 0));
  } else {
    // Default popularity: prioritized multi-season anime first
    results.sort((a, b) => {
      const aSeasons = a.seasons?.length || 0;
      const bSeasons = b.seasons?.length || 0;
      if (bSeasons !== aSeasons) return bSeasons - aSeasons;
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  const isFullRequested = limit === 'all' || limit === '-1' || all === 'true' || (!page && !limit);

  if (isFullRequested) {
    res.json({
      anime: results,
      pagination: {
        page: 1,
        limit: results.length,
        total: results.length,
        totalPages: 1,
        hasNext: false,
        hasPrev: false
      }
    });
    return;
  }

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit as string, 10) || 24);
  const total = results.length;
  const totalPages = Math.ceil(total / limitNum) || 1;
  const startIndex = (pageNum - 1) * limitNum;
  const paginated = results.slice(startIndex, startIndex + limitNum);

  res.json({
    anime: paginated,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasNext: pageNum < totalPages,
      hasPrev: pageNum > 1
    }
  });
});

app.get('/api/anime/:id', (req, res) => {
  loadCatalogue();
  const { id } = req.params;
  const item = catalogueCache.find(a => a.id === id);
  if (!item) {
    res.status(404).json({ error: `Anime with id '${id}' not found in Zenime catalogue.` });
    return;
  }
  res.json(item);
});

// Trigger Catalogue Sync (Owner-only)
app.post('/api/sync', authenticateSession, requireOwner, async (req, res) => {
  if (isSyncing) {
    res.json({ status: 'already_syncing', message: syncMessage });
    return;
  }

  isSyncing = true;
  syncMessage = 'Syncing catalogue from RareToon India...';

  // Run in background
  (async () => {
    try {
      syncMessage = 'Crawling sitemaps and paginated archives...';
      const report = await runIngestion();
      loadCatalogue();
      lastSyncTimestamp = new Date().toISOString();
      syncMessage = `Sync complete. ${report.totalUniqueAnime} anime catalogued.`;
    } catch (err: any) {
      console.error('[Sync Error]', err);
      syncMessage = `Sync failed: ${err.message}`;
    } finally {
      isSyncing = false;
    }
  })();

  res.json({ status: 'started', message: 'Sync process started in background.' });
});

app.get('/api/sync-status', (req, res) => {
  res.json({
    isSyncing,
    message: syncMessage,
    lastSyncTimestamp,
    stats: statsCache
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zenime server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
