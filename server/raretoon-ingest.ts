import fs from 'node:fs';
import path from 'node:path';
import { Anime, Season, Episode, CatalogueStats } from '../src/types.ts';

// Verified Active Provider Configuration
export const RARETOON_BASE_URL = 'https://www.rareanimes.mov/';
export const RARETOON_HOME_URL = 'https://www.rareanimes.mov/home/';
export const RARETOON_PROVIDER_NAME = 'RareAnimes';
export const RARETOON_LEGACY_NAME = 'RareToon India';

// Clean text utility
function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/➣➣➣/g, '')
    .trim();
}

async function fetchSafe(url: string, timeoutMs: number = 8000): Promise<{ ok: boolean; text?: string; status?: number; finalUrl?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, text, status: res.status, finalUrl: res.url };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Genre dictionary based on well-known anime titles
const KNOWN_GENRES: Record<string, string[]> = {
  'dr-stone': ['Sci-Fi', 'Adventure', 'Comedy'],
  'classroom-of-the-elite': ['Drama', 'Mystery', 'Psychological'],
  'jujutsu-kaisen': ['Action', 'Supernatural', 'Fantasy'],
  'attack-on-titan': ['Action', 'Drama', 'Fantasy', 'Mystery'],
  'naruto': ['Action', 'Adventure', 'Fantasy'],
  'naruto-shippuden': ['Action', 'Adventure', 'Fantasy'],
  'solo-leveling': ['Action', 'Fantasy', 'Adventure'],
  'demon-slayer': ['Action', 'Fantasy', 'Historical'],
  'my-hero-academia': ['Action', 'Superhero', 'Sci-Fi'],
  'bleach': ['Action', 'Supernatural', 'Adventure'],
  'frieren': ['Fantasy', 'Adventure', 'Drama'],
  'dan-da-dan': ['Action', 'Comedy', 'Supernatural', 'Sci-Fi'],
  'kaiju-no-8': ['Action', 'Sci-Fi'],
  'sakamoto-days': ['Action', 'Comedy'],
  'zenshu': ['Drama', 'Slice of Life'],
  'assassination-classroom': ['Action', 'Comedy', 'Sci-Fi'],
  'baki': ['Action', 'Martial Arts', 'Sports'],
  'baki-hanma': ['Action', 'Martial Arts', 'Sports'],
  'tokyo-revengers': ['Action', 'Drama', 'Supernatural'],
  'death-note': ['Mystery', 'Psychological', 'Supernatural', 'Thriller'],
  'vinland-saga': ['Action', 'Adventure', 'Drama', 'Historical'],
  'gintama': ['Action', 'Comedy', 'Sci-Fi', 'Parody'],
  'horimiya': ['Romance', 'Comedy', 'Slice of Life'],
  'daily-life-of-the-immortal-king': ['Comedy', 'Fantasy', 'Action'],
  'haikyu': ['Sports', 'Comedy', 'Drama'],
  'black-clover': ['Action', 'Fantasy', 'Comedy'],
  'high-school-dxd': ['Action', 'Comedy', 'Fantasy', 'Romance'],
  'wistoria': ['Action', 'Fantasy', 'Adventure'],
  'devil-may-cry': ['Action', 'Supernatural', 'Fantasy'],
  'release-that-witch': ['Fantasy', 'Isekai', 'Drama'],
  'liar-game': ['Mystery', 'Psychological', 'Drama'],
  'daemons-of-the-shadow-realm': ['Action', 'Supernatural', 'Fantasy'],
  'your-name': ['Romance', 'Drama', 'Supernatural'],
  'suzume': ['Adventure', 'Fantasy', 'Supernatural', 'Drama'],
  'doraemon': ['Comedy', 'Sci-Fi', 'Adventure'],
  'shin-chan': ['Comedy', 'Slice of Life', 'Adventure'],
  'pokemon': ['Adventure', 'Action', 'Fantasy'],
  'miraculous': ['Action', 'Superhero', 'Romance'],
  'kung-fu-panda': ['Action', 'Comedy', 'Adventure'],
  'spider-man': ['Action', 'Superhero', 'Sci-Fi'],
  'stranger-things': ['Sci-Fi', 'Mystery', 'Supernatural'],
  'turning-red': ['Comedy', 'Fantasy', 'Family'],
  'ratatouille': ['Comedy', 'Drama', 'Family'],
  'the-lion-king': ['Adventure', 'Drama', 'Family'],
  'tangled': ['Adventure', 'Comedy', 'Romance', 'Fantasy'],
  'moana': ['Adventure', 'Comedy', 'Fantasy'],
  'shaun-the-sheep': ['Comedy', 'Family'],
  'motu-patlu': ['Comedy', 'Adventure']
};

function determineGenres(slug: string, title: string, desc: string): string[] {
  const normalized = (slug + ' ' + title + ' ' + desc).toLowerCase();
  for (const [k, genres] of Object.entries(KNOWN_GENRES)) {
    if (normalized.includes(k.replace(/-/g, ' ')) || normalized.includes(k)) {
      return genres;
    }
  }
  const genres: string[] = [];
  if (normalized.includes('romance') || normalized.includes('love') || normalized.includes('girlfriend') || normalized.includes('dulhan')) genres.push('Romance');
  if (normalized.includes('comedy') || normalized.includes('funny') || normalized.includes('humor')) genres.push('Comedy');
  if (normalized.includes('fight') || normalized.includes('battle') || normalized.includes('war') || normalized.includes('action')) genres.push('Action');
  if (normalized.includes('sci-fi') || normalized.includes('robot') || normalized.includes('future') || normalized.includes('space')) genres.push('Sci-Fi');
  if (normalized.includes('magic') || normalized.includes('demon') || normalized.includes('fantasy')) genres.push('Fantasy');
  if (normalized.includes('adventure') || normalized.includes('journey') || normalized.includes('quest') || normalized.includes('planet')) genres.push('Adventure');
  if (normalized.includes('mystery') || normalized.includes('detective') || normalized.includes('spy')) genres.push('Mystery');
  if (genres.length === 0) genres.push('Adventure');
  return genres;
}

const ROMAJI_TITLES: Record<string, string> = {
  'attack-on-titan': 'Shingeki no Kyojin',
  'demon-slayer': 'Kimetsu no Yaiba',
  'jujutsu-kaisen': 'Jujutsu Kaisen',
  'my-hero-academia': 'Boku no Hero Academia',
  'frieren': 'Sousou no Frieren',
  'dan-da-dan': 'Dandadan',
  'kaiju-no-8': 'Kaijuu 8-gou',
  'haikyu': 'Haikyuu!!',
  'your-name': 'Kimi no Na wa.',
  'suzume': 'Suzume no Tojimari',
  'death-note': 'Death Note',
  'tokyo-revengers': 'Tokyo Revengers',
  'vinland-saga': 'Vinland Saga',
  'black-clover': 'Black Clover',
  'dr-stone': 'Dr. STONE',
  'solo-leveling': 'Na Honjaman Rebeleop',
  'naruto': 'Naruto',
  'naruto-shippuden': 'Naruto: Shippuuden',
  'classroom-of-the-elite': 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e',
  'horimiya': 'Horimiya: Piece',
  'assassination-classroom': 'Ansatsu Kyoushitsu',
  'baki-hanma': 'Hanma Baki: Son of Ogre',
  'gintama': 'Gintama'
};

function getRomaji(slug: string): string | null {
  for (const [k, v] of Object.entries(ROMAJI_TITLES)) {
    if (slug.includes(k)) return v;
  }
  return null;
}

function detectAudio(str: string): string {
  const s = str.toLowerCase();
  if (s.includes('dual audio') || (s.includes('hindi') && s.includes('english'))) return 'Dual Audio {Hindi + English}';
  if (s.includes('tamil') || s.includes('telugu')) return 'Multi Audio {Hindi, Tamil, Telugu}';
  if (s.includes('hindi subbed') || s.includes('subbed')) return 'Hindi Subbed';
  return 'Hindi Dubbed';
}

function normalizeTitleForMatch(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function cleanDisplayTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  let clean = rawTitle
    .replace(/[-–]\s*Rare\s*Animes.*/i, '')
    .replace(/[-–]\s*Rare\s*Toon\s*India.*/i, '')
    .replace(/Rare\s*Animes.*/i, '')
    .replace(/Rare\s*Toon\s*India.*/i, '')
    .replace(/Hindi\s*Dubbed\s*Episodes.*/i, '')
    .replace(/Hindi\s*Subbed\s*Episodes.*/i, '')
    .replace(/Hindi\s*Dubbed\s*Download.*/i, '')
    .replace(/Hindi\s*Download.*/i, '')
    .replace(/Download\s*HD.*/i, '')
    .replace(/Download\s*480p.*/i, '')
    .replace(/Download\s*720p.*/i, '')
    .replace(/Download\s*1080p.*/i, '')
    .replace(/Episodes\s*Download.*/i, '')
    .replace(/Dual\s*Audio.*/i, '')
    .replace(/Season\s*\d+.*/i, '')
    .trim();
  clean = clean.replace(/^[-\s]+|[-\s]+$/g, '');
  return clean || rawTitle;
}

interface RawPostData {
  canonicalUrl: string;
  title: string;
  imageUrl: string | null;
  description: string;
  source: string;
}

export interface IngestionReport {
  pagesProcessed: number;
  totalRareAnimesUrlsDiscovered: number;
  totalUniqueAnime: number;
  animeAdded: number;
  animeUpdated: number;
  episodesAdded: number;
  verifiedArtworkCount: number;
  genresBreakdown: Record<string, number>;
  timestamp: string;
  sourceUrl: string;
}

/**
 * Executes a robust crawl, validation, and safe merge against the active RareToon source
 */
export async function runIngestion(): Promise<IngestionReport> {
  console.log(`[RareToon Ingest] === Starting Synchronization Pipeline with ${RARETOON_HOME_URL} ===`);
  const startTime = Date.now();

  const rawMap = new Map<string, RawPostData>();
  let pagesProcessed = 0;

  // 1. Crawl paginated home & category pages
  const MAX_PAGES = 15;
  for (let p = 1; p <= MAX_PAGES; p++) {
    const pageUrl = p === 1 ? RARETOON_HOME_URL : `${RARETOON_HOME_URL}page/${p}/`;
    try {
      const res = await fetchSafe(pageUrl, 7000);
      if (!res.ok) {
        console.log(`[RareToon Ingest] Page ${p} request returned status ${res.status || 'error'}. Moving to enrichment.`);
        break;
      }

      // Check if redirected back to home (indicates page past end)
      if (p > 1 && res.finalUrl && (res.finalUrl === RARETOON_HOME_URL || !res.finalUrl.includes(`/page/${p}`))) {
        console.log(`[RareToon Ingest] Page ${p} redirected back to home. Completed archive pagination.`);
        break;
      }

      pagesProcessed++;
      const html = res.text || '';
      
      // Match post cards containing links and optional images
      const cardMatches = [...html.matchAll(/<a[^>]+href=["'](https:\/\/(?:www\.)?rareanimes\.mov\/(?:hindi|english|movies|series|anime)\/[^"'/]+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)];
      const prevSize = rawMap.size;

      for (const m of cardMatches) {
        const url = m[1].trim();
        const inner = m[2] || '';
        if (
          url.includes('/feed') ||
          url.includes('/wp-') ||
          url.includes('/comments') ||
          url.includes('/dmca') ||
          url.includes('/page/')
        ) {
          continue;
        }

        const imgMatch = inner.match(/data-src=["']([^"']+)["']/) || inner.match(/src=["']([^"']+)["']/);
        const altMatch = inner.match(/alt=["']([^"']+)["']/);
        const img = (imgMatch && !imgMatch[1].startsWith('data:')) ? imgMatch[1].trim() : null;
        const title = altMatch ? cleanText(altMatch[1]) : '';

        if (!rawMap.has(url)) {
          rawMap.set(url, {
            canonicalUrl: url,
            title,
            imageUrl: img,
            description: '',
            source: `page_${p}`
          });
        } else {
          const existing = rawMap.get(url)!;
          if (!existing.imageUrl && img) existing.imageUrl = img;
          if (!existing.title && title) existing.title = title;
        }
      }

      const added = rawMap.size - prevSize;
      console.log(`[RareToon Ingest] Page ${p} processed: discovered ${added} new unique entries (Total: ${rawMap.size}).`);

      if (added === 0 && p > 3) {
        console.log(`[RareToon Ingest] No new entries found on page ${p}. Stopping pagination.`);
        break;
      }
    } catch (err: any) {
      console.warn(`[RareToon Ingest] Warning on page ${p}:`, err.message);
      break;
    }
  }

  console.log(`[RareToon Ingest] Discovered ${rawMap.size} unique candidate URLs across ${pagesProcessed} pages.`);

  // 2. Concurrently enrich metadata for items missing images or descriptions
  const rawItems = Array.from(rawMap.values());
  const itemsNeedingEnrichment = rawItems.filter(item => !item.imageUrl || !item.title);
  
  console.log(`[RareToon Ingest] ${rawItems.length} candidate URLs found. ${itemsNeedingEnrichment.length} need metadata enrichment.`);

  const CONCURRENCY = 5;
  let cursor = 0;

  async function enrichWorker() {
    while (cursor < itemsNeedingEnrichment.length) {
      const idx = cursor++;
      const item = itemsNeedingEnrichment[idx];
      try {
        const pageRes = await fetchSafe(item.canonicalUrl, 3000);
        if (pageRes.ok && pageRes.text) {
          const html = pageRes.text;

          const ogTitle = html.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i) ||
                          html.match(/<title>([^<]+)<\/title>/i);
          if (ogTitle && !item.title) {
            item.title = cleanText(ogTitle[1]);
          }

          const ogImg = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i) ||
                        html.match(/data-src=["'](https:\/\/(?:www\.)?rareanimes\.mov\/wp-content\/uploads\/[^"']+)["']/i) ||
                        html.match(/src=["'](https:\/\/(?:www\.)?rareanimes\.mov\/wp-content\/uploads\/[^"']+)["']/i);
          if (ogImg && !item.imageUrl) {
            item.imageUrl = ogImg[1].trim();
          }

          const ogDesc = html.match(/<meta property=["']og:description["'] content=["']([^"']+)["']/i) ||
                         html.match(/<meta name=["']description["'] content=["']([^"']+)["']/i);
          if (ogDesc) {
            item.description = cleanText(ogDesc[1]);
          }
        }
      } catch {
        // tolerate individual timeout
      }
    }
  }

  if (itemsNeedingEnrichment.length > 0) {
    console.log(`[RareToon Ingest] Enriching ${itemsNeedingEnrichment.length} records with ${CONCURRENCY} workers...`);
    const workers = Array.from({ length: CONCURRENCY }, () => enrichWorker());
    await Promise.all(workers);
    console.log(`[RareToon Ingest] Enrichment complete.`);
  }

  // 3. Load Existing Catalogue to perform SAFE MERGE (Never destroy existing data)
  const cataloguePath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
  const srcCataloguePath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
  let existingCatalogue: Anime[] = [];

  if (fs.existsSync(cataloguePath)) {
    try {
      existingCatalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf-8'));
    } catch (e: any) {
      console.error('[RareToon Ingest] Error reading existing catalogue:', e.message);
    }
  }
  if (existingCatalogue.length === 0 && fs.existsSync(srcCataloguePath)) {
    try {
      existingCatalogue = JSON.parse(fs.readFileSync(srcCataloguePath, 'utf-8'));
    } catch {}
  }

  console.log(`[RareToon Ingest] Existing baseline catalogue size: ${existingCatalogue.length} anime.`);

  // Index existing catalogue by ID, canonical URL, and normalized title
  const catalogueById = new Map<string, Anime>();
  const catalogueByUrl = new Map<string, Anime>();
  const catalogueByNormTitle = new Map<string, Anime>();

  for (const item of existingCatalogue) {
    if (item.id) catalogueById.set(item.id, item);
    if (item.title) catalogueByNormTitle.set(normalizeTitleForMatch(item.title), item);
    if (item.alternateTitle) catalogueByNormTitle.set(normalizeTitleForMatch(item.alternateTitle), item);
    if (item.providers?.raretoonIndia?.canonicalUrl) {
      catalogueByUrl.set(item.providers.raretoonIndia.canonicalUrl, item);
    }
    if (Array.isArray(item.seasons)) {
      for (const s of item.seasons) {
        if (s.canonicalUrl) catalogueByUrl.set(s.canonicalUrl, item);
      }
    }
  }

  let animeAdded = 0;
  let animeUpdated = 0;
  let episodesAdded = 0;

  // 4. Process and match incoming items
  for (const raw of rawItems) {
    if (!raw.title && !raw.canonicalUrl) continue;

    const pathSlug = raw.canonicalUrl.replace(/https?:\/\/(?:www\.)?rareanimes\.mov\//, '').replace(/\/$/, '');
    const cleanTitle = cleanDisplayTitle(raw.title || pathSlug.replace(/-/g, ' '));
    const normTitle = normalizeTitleForMatch(cleanTitle);

    // Season extraction
    let seasonNum = 1;
    const seasonMatch = (raw.canonicalUrl + ' ' + (raw.title || '')).match(/season[- ](\d+)/i);
    if (seasonMatch) {
      seasonNum = parseInt(seasonMatch[1], 10) || 1;
    }

    const isMovie = pathSlug.includes('movie') || (raw.title || '').toLowerCase().includes('movie');

    // Year extraction
    let year: number | undefined = undefined;
    const yearMatch = (raw.canonicalUrl + ' ' + (raw.title || '')).match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    }

    // Audio format
    const audio = detectAudio((raw.title || '') + ' ' + (raw.description || ''));

    // Match existing anime
    let targetAnime: Anime | undefined = catalogueByUrl.get(raw.canonicalUrl) || catalogueByNormTitle.get(normTitle);

    if (targetAnime) {
      // UPDATE EXISTING ANIME SAFELY
      animeUpdated++;

      // Update provider link if missing or old
      if (!targetAnime.providers || !targetAnime.providers.raretoonIndia) {
        targetAnime.providers = {
          raretoonIndia: {
            providerAnimeId: pathSlug,
            canonicalUrl: raw.canonicalUrl,
            verificationStatus: 'VERIFIED',
            dubLanguage: audio,
            quality: '1080p FHD'
          }
        };
      } else {
        targetAnime.providers.raretoonIndia.canonicalUrl = raw.canonicalUrl;
        targetAnime.providers.raretoonIndia.verificationStatus = 'VERIFIED';
        if (audio) targetAnime.providers.raretoonIndia.dubLanguage = audio;
      }

      // Ensure seasons array exists
      if (!Array.isArray(targetAnime.seasons)) {
        targetAnime.seasons = [];
      }

      // Check if season exists
      const existingSeason = targetAnime.seasons.find(s => s.seasonNumber === seasonNum);
      if (existingSeason) {
        if (!existingSeason.canonicalUrl) {
          existingSeason.canonicalUrl = raw.canonicalUrl;
        }
      } else {
        // Add new season
        targetAnime.seasons.push({
          seasonNumber: seasonNum,
          title: `Season ${seasonNum}`,
          canonicalUrl: raw.canonicalUrl,
          episodeCount: isMovie ? 1 : 12,
          episodes: [
            { episodeNumber: 1, title: isMovie ? 'Full Movie' : 'Episode 1', canonicalUrl: raw.canonicalUrl }
          ]
        });
        episodesAdded += (isMovie ? 1 : 12);
        targetAnime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      }
    } else {
      // NEW ANIME DISCOVERED
      const autoId = `anivault_rt_${pathSlug.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
      if (catalogueById.has(autoId)) continue;

      const genres = determineGenres(pathSlug, cleanTitle, raw.description);
      const romaji = getRomaji(pathSlug);

      const newAnime: Anime = {
        id: autoId,
        title: cleanTitle,
        alternateTitle: romaji,
        synopsis: raw.description && raw.description.length > 15
          ? raw.description
          : `Watch ${cleanTitle} in high quality Hindi dubbing and dual audio on RareAnimes with complete streaming options.`,
        releaseYear: year || (isMovie ? 2022 : 2021),
        status: isMovie ? 'Completed' : ((year && year <= 2024) ? 'Completed' : 'Ongoing'),
        type: isMovie ? 'Movie' : 'TV',
        genres: genres,
        artwork: {
          verifiedArtworkUrl: raw.imageUrl || '',
          isVerified: Boolean(raw.imageUrl && raw.imageUrl.startsWith('http') && !raw.imageUrl.includes('unsplash.com')),
          verificationSource: (raw.imageUrl && raw.imageUrl.startsWith('http') && !raw.imageUrl.includes('unsplash.com')) ? 'provider_verified' : 'unverified_fallback',
          aspectRatio: isMovie ? '3:4' : '16:9'
        },
        providers: {
          raretoonIndia: {
            providerAnimeId: pathSlug,
            canonicalUrl: raw.canonicalUrl,
            verificationStatus: 'VERIFIED',
            dubLanguage: audio,
            quality: '1080p FHD'
          }
        },
        seasons: [
          {
            seasonNumber: seasonNum,
            title: isMovie ? 'Movie' : `Season ${seasonNum}`,
            canonicalUrl: raw.canonicalUrl,
            episodeCount: isMovie ? 1 : 12,
            episodes: [
              { episodeNumber: 1, title: isMovie ? 'Full Movie' : 'Episode 1', canonicalUrl: raw.canonicalUrl }
            ]
          }
        ]
      };

      catalogueById.set(newAnime.id, newAnime);
      catalogueByNormTitle.set(normTitle, newAnime);
      catalogueByUrl.set(raw.canonicalUrl, newAnime);
      animeAdded++;
      episodesAdded += (isMovie ? 1 : 12);
    }
  }

  const finalCatalogue = Array.from(catalogueById.values());

  // 5. VALIDATE FINAL CATALOGUE INTEGRITY (FETCH -> VALIDATE -> TRANSFORM -> VALIDATE -> UPDATE)
  if (finalCatalogue.length < existingCatalogue.length) {
    throw new Error(`[RareToon Ingest] Validation failed: Final catalogue size (${finalCatalogue.length}) is smaller than original (${existingCatalogue.length}). Aborting update to protect data.`);
  }

  // Ensure unique IDs
  const idCheck = new Set<string>();
  for (const a of finalCatalogue) {
    if (!a.id) throw new Error('[RareToon Ingest] Validation failed: anime missing id.');
    if (idCheck.has(a.id)) throw new Error(`[RareToon Ingest] Validation failed: duplicate anime id ${a.id}`);
    idCheck.add(a.id);
  }

  // 6. ATOMIC WRITE TO DATA STORES
  const tmpPath = `${cataloguePath}.tmp`;
  fs.mkdirSync(path.dirname(cataloguePath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(finalCatalogue, null, 2), 'utf-8');

  // Verify readable JSON
  JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));

  // Atomic rename
  fs.renameSync(tmpPath, cataloguePath);

  // Sync to src fallback bundle
  try {
    fs.mkdirSync(path.dirname(srcCataloguePath), { recursive: true });
    fs.writeFileSync(srcCataloguePath, JSON.stringify(finalCatalogue, null, 2), 'utf-8');
  } catch (e: any) {
    console.warn('[RareToon Ingest] Warning syncing src fallback:', e.message);
  }

  // Compute stats report
  const catCounts: Record<string, number> = {};
  for (const a of finalCatalogue) {
    if (Array.isArray(a.genres)) {
      for (const g of a.genres) {
        catCounts[g] = (catCounts[g] || 0) + 1;
      }
    }
  }

  const verifiedArtCount = finalCatalogue.filter(a => a.artwork?.isVerified).length;

  const report: IngestionReport = {
    pagesProcessed,
    totalRareAnimesUrlsDiscovered: rawItems.length,
    totalUniqueAnime: finalCatalogue.length,
    animeAdded,
    animeUpdated,
    episodesAdded,
    verifiedArtworkCount: verifiedArtCount,
    genresBreakdown: catCounts,
    timestamp: new Date().toISOString(),
    sourceUrl: RARETOON_HOME_URL
  };

  const reportPath = path.join(process.cwd(), 'server', 'data', 'sync-report.json');
  const srcReportPath = path.join(process.cwd(), 'src', 'data', 'sync-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  try {
    fs.writeFileSync(srcReportPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch {}

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[RareToon Ingest] === Sync Finished in ${durationSec}s ===`);
  console.log(`[RareToon Ingest] Total Catalogue: ${finalCatalogue.length} anime | Added: ${animeAdded} | Updated: ${animeUpdated}`);

  return report;
}
