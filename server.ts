import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { runIngestion } from './server/raretoon-ingest.ts';
import { createOwnerRouter, authenticateSession, isEmailAuthorizedOwner } from './server/owner-auth.js';
import { createUserAuthRouter } from './server/user-auth.js';
import { logEmailConfigDiagnostics } from './server/email-service.js';

import { createBugReportsRouter } from './server/bug-reports.js';
import { globalDataStore } from './server/data-store.ts';

const app = express();
app.set('trust proxy', 1);
const PORT = 3000;

// Safe server-side check of email configuration secrets (values never displayed)
logEmailConfigDiagnostics();

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
    app: 'Anivex',
    totalAnime: catalogueCache.length,
    activeProvider: 'RareToon India (RareAnimes)',
    providerUrl: 'https://www.rareanimes.mov/home/'
  });
});

app.get('/api/download-source', authenticateSession, (req, res) => {
  const session = (req as any).ownerSession;
  if (!session || session.role !== 'owner' || !isEmailAuthorizedOwner(session.email)) {
    res.status(403).json({ error: 'Access denied. The source code download feature is reserved strictly for the verified Owner account.' });
    return;
  }

  let archivePath = path.join(process.cwd(), 'public', 'anivault-source.tar.gz');
  if (!fs.existsSync(archivePath)) {
    archivePath = path.join(process.cwd(), 'dist', 'anivault-source.tar.gz');
  }

  if (!fs.existsSync(archivePath)) {
    res.status(404).json({ error: 'Project archive not found.' });
    return;
  }

  if (req.query.check === 'true') {
    res.json({ success: true });
    return;
  }

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', 'attachment; filename="anivex-source-code.tar.gz"');
  fs.createReadStream(archivePath).pipe(res);
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
    res.status(404).json({ error: `Anime with id '${id}' not found in Anivex catalogue.` });
    return;
  }
  res.json(item);
});

// Trigger Catalogue Sync
app.post('/api/sync', async (req, res) => {
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
    console.log(`AniVault server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
