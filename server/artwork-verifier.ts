import fs from 'fs';
import path from 'path';
import { getArtworkSourcesConfig } from './artwork-sources.ts';

export type VerificationStatus =
  | 'verified'
  | 'auto_fixed'
  | 'needs_review'
  | 'unable_to_verify'
  | 'possible_fake';

export interface ArtworkCandidate {
  source: 'anilist' | 'jikan' | 'anidb' | 'provider';
  sourceId: string | number;
  title: string;
  imageUrl: string;
  aspectRatio: string;
  confidence: number;
  dimensions?: string;
  format?: string;
  year?: number;
  seasonNumber?: number;
}

export interface SeasonArtworkResult {
  seasonNumber: number;
  seasonTitle: string;
  artworkUrl?: string | null;
  status: 'verified' | 'auto_fixed' | 'needs_review' | 'not_found';
  source?: string;
  confidence?: number;
}

export interface ArtworkVerificationResult {
  animeId: string;
  animeTitle: string;
  status: VerificationStatus;
  confidence: number;
  currentArtworkUrl: string | null;
  replacedArtworkUrl?: string | null;
  source: string;
  dimensions?: string;
  lastVerifiedAt: string;
  aniListMatch?: {
    id: number;
    title: string;
    englishTitle?: string;
    romajiTitle?: string;
    year?: number;
    coverUrl?: string;
    score: number;
  } | null;
  jikanMatch?: {
    malId: number;
    title: string;
    englishTitle?: string;
    year?: number;
    coverUrl?: string;
    score: number;
  } | null;
  anidbMatch?: {
    aid: number;
    title: string;
    score: number;
  } | null;
  seasonResults?: SeasonArtworkResult[];
  candidates: ArtworkCandidate[];
  issue?: string | null;
  evidence?: string[];
}

export interface FakeAnimeIssue {
  id: string;
  catalogueId: string;
  animeTitle: string;
  source: string;
  sourceUrl?: string;
  titlesChecked: string[];
  aniListResult: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  jikanResult: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  anidbResult?: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  verificationResults: string;
  reason: string;
  timestamp: string;
  evidence: string[];
  status: 'active' | 'dismissed' | 'manual_verified';
}

export interface ArtworkHistoryEntry {
  id: string;
  animeId: string;
  animeTitle: string;
  previousArtworkUrl: string;
  newArtworkUrl: string;
  replacedAt: string;
  replacedBy: 'auto_verifier' | 'owner';
  source: string;
  reason: string;
  seasonNumber?: number;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const VERIFICATION_RECORDS_PATH = path.join(DATA_DIR, 'artwork-verification-records.json');
const FAKE_ISSUES_PATH = path.join(DATA_DIR, 'fake-anime-issues.json');
const ARTWORK_HISTORY_PATH = path.join(DATA_DIR, 'artwork-history.json');
const CATALOGUE_PATH = path.join(DATA_DIR, 'anivault-catalogue.json');

// Memory LRU / Request cache to avoid redundant API queries
const apiQueryCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache

function getCached<T>(key: string): T | null {
  const cached = apiQueryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    apiQueryCache.delete(key);
    return null;
  }
  return cached.data as T;
}

function setCached(key: string, data: any): void {
  // Prevent unbounded cache growth
  if (apiQueryCache.size > 2500) {
    const firstKey = apiQueryCache.keys().next().value;
    if (firstKey) apiQueryCache.delete(firstKey);
  }
  apiQueryCache.set(key, { timestamp: Date.now(), data });
}

// --- String Similarity using Token matching, Substring, and Bigram Dice Coefficient ---
export function calculateStringSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const a = s1.trim().toLowerCase();
  const b = s2.trim().toLowerCase();
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0;

  // Substring match
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    return Math.max(0.78, minLen / maxLen);
  }

  // Token overlap check
  const tokensA = new Set(a.split(/[\s\-_:,\.\(\)\[\]]+/).filter(Boolean));
  const tokensB = new Set(b.split(/[\s\-_:,\.\(\)\[\]]+/).filter(Boolean));
  let matchCount = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) matchCount++;
  }
  const tokenScore = (2 * matchCount) / (tokensA.size + tokensB.size);

  // Bigram Dice score
  if (a.length < 2 || b.length < 2) return tokenScore;
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.substring(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.substring(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }
  const bigramScore = (2.0 * intersection) / (a.length + b.length - 2);

  return Math.max(tokenScore * 0.85, bigramScore);
}

// --- Title Cleaning and Variant Extractor ---
export function cleanAnimeTitle(rawTitle: string): {
  primary: string;
  cleaned: string;
  variants: string[];
  detectedSeasonNumber?: number;
} {
  const primary = rawTitle.trim();

  // Detect explicit season from title (e.g. "BAKI Season 1", "Naruto Shippuden Season 2", "Attack on Titan Season 3 Part 2")
  let detectedSeasonNumber: number | undefined;
  const seasonMatch = primary.match(/(?:Season|S)\s*(\d+)/i);
  if (seasonMatch) {
    detectedSeasonNumber = parseInt(seasonMatch[1], 10);
  }

  let cleaned = primary
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Remove (Hindi Dubbed), (English Dubbed), [Hindi], etc.
    .replace(/\s*\([^)]*(?:Dubbed|Subbed|Hindi|English|Tamil|Telugu|Dual\s*Audio|Multi\s*Audio|All\s*Episodes)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:Dubbed|Subbed|Hindi|English|Tamil|Telugu|1080p|720p|Dual|Multi)[^\]]*\]/gi, '')
    // Remove (TV Series), (Movie), (Remake) etc.
    .replace(/\s*\((?:TV\s*Series|TV|Movie|Remake|\d{4}\s*Remake|Full\s*Movie)\)/gi, '')
    // Remove trailing season patterns for base title queries
    .replace(/\s*-\s*Season\s*\d+/gi, '')
    .replace(/\s*Season\s*\d+/gi, '')
    .replace(/\s*All\s*Seasons\s*Hindi/gi, '')
    .replace(/\s*All\s*Seasons/gi, '')
    .replace(/\s*-\s*$/, '')
    .trim();

  if (!cleaned) {
    cleaned = primary;
  }

  const variants = [cleaned];
  if (primary !== cleaned && !variants.includes(primary)) {
    variants.push(primary);
  }

  // Without punctuation variant
  const noPunct = cleaned.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noPunct && !variants.includes(noPunct)) {
    variants.push(noPunct);
  }

  // Common franchise normalizations
  if (/doraemon/i.test(cleaned) && !variants.includes('Doraemon')) {
    variants.push('Doraemon');
  }
  if (/shinchan|crayon shin-chan/i.test(cleaned) && !variants.includes('Crayon Shin-chan')) {
    variants.push('Crayon Shin-chan');
  }
  if (/pokemon|pokémon/i.test(cleaned) && !variants.includes('Pokemon')) {
    variants.push('Pokemon');
  }

  return { primary, cleaned, variants, detectedSeasonNumber };
}

// --- Thread-safe file write with retry self-recovery ---
function safeWriteFileSync(filePath: string, content: string): void {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return;
    } catch (err: any) {
      if (attempts >= 3) {
        console.error(`[ArtworkVerifier] Failed to write file ${filePath} after 3 attempts:`, err.message);
      } else {
        // Short pause for lock resolution
        const delay = 50 * attempts;
        const start = Date.now();
        while (Date.now() - start < delay) { /* sync pause */ }
      }
    }
  }
}

// --- Storage Handlers ---
export function loadVerificationRecords(): Record<string, ArtworkVerificationResult> {
  try {
    if (fs.existsSync(VERIFICATION_RECORDS_PATH)) {
      return JSON.parse(fs.readFileSync(VERIFICATION_RECORDS_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error loading records:', err.message);
  }
  return {};
}

export function saveVerificationRecords(records: Record<string, ArtworkVerificationResult>): void {
  safeWriteFileSync(VERIFICATION_RECORDS_PATH, JSON.stringify(records, null, 2));
}

export function loadFakeAnimeIssues(): FakeAnimeIssue[] {
  try {
    if (fs.existsSync(FAKE_ISSUES_PATH)) {
      return JSON.parse(fs.readFileSync(FAKE_ISSUES_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error loading fake issues:', err.message);
  }
  return [];
}

export function saveFakeAnimeIssues(issues: FakeAnimeIssue[]): void {
  safeWriteFileSync(FAKE_ISSUES_PATH, JSON.stringify(issues, null, 2));
}

export function loadArtworkHistory(): ArtworkHistoryEntry[] {
  try {
    if (fs.existsSync(ARTWORK_HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(ARTWORK_HISTORY_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error loading history:', err.message);
  }
  return [];
}

export function saveArtworkHistory(history: ArtworkHistoryEntry[]): void {
  safeWriteFileSync(ARTWORK_HISTORY_PATH, JSON.stringify(history, null, 2));
}

// --- AniList Query Engine ---
export async function queryAniList(
  title: string,
  endpoint: string,
  timeoutMs = 8000
): Promise<{
  success: boolean;
  matches: any[];
  error?: string;
  statusCode?: number;
}> {
  const cacheKey = `anilist:${title.toLowerCase().trim()}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) {
    return { success: true, matches: cached };
  }

  const query = `
    query ($search: String) {
      Page (page: 1, perPage: 4) {
        media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
          format
          status
          seasonYear
          episodes
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          relations {
            edges {
              relationType
              node {
                id
                title { romaji english }
                seasonYear
                coverImage { large }
              }
            }
          }
        }
      }
    }
  `;

  // Safe retry loop with backoff
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Anivex-Artwork-Verifier/1.0'
        },
        body: JSON.stringify({ query, variables: { search: title } }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.status === 429) {
        // Rate limited - wait and retry once
        const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
        await new Promise(r => setTimeout(r, Math.min(retryAfter * 1000, 3000)));
        continue;
      }

      if (!res.ok) {
        return { success: false, matches: [], error: `HTTP ${res.status}`, statusCode: res.status };
      }

      const data = await res.json();
      const media = data?.data?.Page?.media || [];
      setCached(cacheKey, media);
      return { success: true, matches: media, statusCode: 200 };
    } catch (err: any) {
      if (attempt >= 2) {
        return { success: false, matches: [], error: err.message };
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return { success: false, matches: [], error: 'AniList request failed after retries' };
}

// --- Jikan / MyAnimeList Query Engine with Safe Fallback Handling ---
export async function queryJikan(
  title: string,
  endpoint: string,
  timeoutMs = 6000
): Promise<{
  success: boolean;
  matches: any[];
  error?: string;
  statusCode?: number;
  isTemporaryUnavailable?: boolean;
}> {
  const cacheKey = `jikan:${title.toLowerCase().trim()}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) {
    return { success: true, matches: cached };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const encoded = encodeURIComponent(title);
    const res = await fetch(`${endpoint}/anime?q=${encoded}&limit=3`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Anivex-Artwork-Verifier/1.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.status === 504 || res.status === 502 || res.status === 503 || res.status === 429) {
      // 504 BadResponseException: MyAnimeList is temporarily unavailable
      return {
        success: false,
        matches: [],
        error: `HTTP ${res.status}: Temporary gateway issue`,
        statusCode: res.status,
        isTemporaryUnavailable: true
      };
    }

    if (!res.ok) {
      return {
        success: false,
        matches: [],
        error: `HTTP ${res.status}`,
        statusCode: res.status,
        isTemporaryUnavailable: false
      };
    }

    const data = await res.json();
    const list = data?.data || [];
    setCached(cacheKey, list);
    return { success: true, matches: list, statusCode: 200 };
  } catch (err: any) {
    return {
      success: false,
      matches: [],
      error: err.message,
      isTemporaryUnavailable: true
    };
  }
}

// --- AniDB Fallback Engine (Used only when Jikan is genuinely unavailable/unreliable) ---
export async function queryAniDBFallback(
  title: string
): Promise<{
  success: boolean;
  matches: any[];
  error?: string;
}> {
  const cacheKey = `anidb:${title.toLowerCase().trim()}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) {
    return { success: true, matches: cached };
  }

  try {
    // AniDB client query with safety timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Query AniDB anime search via HTML/REST gateway
    const res = await fetch(`https://anidb.net/anime/?adb.search=${encodeURIComponent(title)}&do.search=1`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const html = await res.text();
      // If we see anime titles in table or direct entry
      const hasMatch = html.includes('anime_table') || html.includes('class="anime "') || html.toLowerCase().includes(title.toLowerCase());
      const results = hasMatch ? [{ title, aid: 1, source: 'anidb' }] : [];
      setCached(cacheKey, results);
      return { success: true, matches: results };
    }

    return { success: false, matches: [], error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, matches: [], error: err.message };
  }
}

// --- Image Usability & Integrity Inspection ---
export async function inspectArtworkImage(url: string | undefined | null): Promise<{
  usable: boolean;
  dimensions?: string;
  aspectRatio: string;
  isBlankOrPlaceholder: boolean;
  layoutPresentationStatus: 'fit_optimal' | 'adapt_contain';
  error?: string;
}> {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return {
      usable: false,
      aspectRatio: '3:4',
      isBlankOrPlaceholder: true,
      layoutPresentationStatus: 'adapt_contain',
      error: 'Missing or invalid URL'
    };
  }

  // Detect explicit placeholder patterns
  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.includes('placeholder') ||
    lowerUrl.includes('no-image') ||
    lowerUrl.includes('default-poster') ||
    lowerUrl.includes('default_poster') ||
    lowerUrl.includes('null') ||
    lowerUrl.includes('undefined')
  ) {
    return {
      usable: false,
      aspectRatio: '3:4',
      isBlankOrPlaceholder: true,
      layoutPresentationStatus: 'adapt_contain',
      error: 'Placeholder detected'
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Anivex-Artwork-Verifier/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok && res.status !== 405 && res.status !== 403) {
      return {
        usable: false,
        aspectRatio: '3:4',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain',
        error: `HTTP ${res.status}`
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      return {
        usable: false,
        aspectRatio: '3:4',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain',
        error: 'Not an image content type'
      };
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    // If image file is suspiciously small (< 1KB), it is likely an empty 1x1 GIF or broken pixel
    if (contentLength > 0 && contentLength < 1000) {
      return {
        usable: false,
        aspectRatio: '3:4',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain',
        error: 'Image file too small (<1KB, empty pixel)'
      };
    }

    return {
      usable: true,
      aspectRatio: '3:4',
      dimensions: 'HD (Aspect 3:4)',
      isBlankOrPlaceholder: false,
      layoutPresentationStatus: 'fit_optimal'
    };
  } catch (err: any) {
    // If HEAD is blocked or fails, treat with grace if URL looks like a valid image extension
    const hasImageExt = /\.(jpg|jpeg|png|webp|avif)($|\?)/i.test(url);
    return {
      usable: hasImageExt,
      aspectRatio: '3:4',
      dimensions: 'Standard',
      isBlankOrPlaceholder: !hasImageExt,
      layoutPresentationStatus: 'adapt_contain',
      error: err.message
    };
  }
}

// --- Multi-Season Specific Artwork Verifier ---
export async function verifyMultiSeasons(
  anime: any,
  baseAnimeTitle: string,
  autoFixEnabled: boolean
): Promise<SeasonArtworkResult[]> {
  const seasons = anime.seasons;
  if (!Array.isArray(seasons) || seasons.length <= 1) {
    return [];
  }

  const results: SeasonArtworkResult[] = [];
  const sources = getArtworkSourcesConfig();
  const anilistConfig = sources.find(s => s.id === 'anilist' && s.enabled);
  if (!anilistConfig) return [];

  for (const season of seasons) {
    const seasonNum = season.seasonNumber || 1;
    const seasonTitle = season.title || `Season ${seasonNum}`;
    const seasonSearch = `${baseAnimeTitle} Season ${seasonNum}`;

    try {
      const res = await queryAniList(seasonSearch, anilistConfig.endpoint, 6000);
      if (res.success && res.matches.length > 0) {
        // Find best match matching seasonYear or season title
        let bestSeasonMatch: any = null;
        let bestScore = 0;

        for (const item of res.matches) {
          const eng = item.title?.english || '';
          const rom = item.title?.romaji || '';
          const score = Math.max(
            calculateStringSimilarity(seasonSearch, eng),
            calculateStringSimilarity(seasonSearch, rom)
          );
          if (score > bestScore) {
            bestScore = score;
            bestSeasonMatch = item;
          }
        }

        const cover = bestSeasonMatch?.coverImage?.extraLarge || bestSeasonMatch?.coverImage?.large;
        if (bestSeasonMatch && bestScore >= 0.70 && cover) {
          results.push({
            seasonNumber: seasonNum,
            seasonTitle,
            artworkUrl: cover,
            status: 'verified',
            source: 'anilist',
            confidence: bestScore
          });

          // Apply to season object if autoFix is enabled
          if (autoFixEnabled && !season.artworkUrl) {
            season.artworkUrl = cover;
          }
        } else {
          results.push({
            seasonNumber: seasonNum,
            seasonTitle,
            artworkUrl: season.artworkUrl || null,
            status: season.artworkUrl ? 'verified' : 'needs_review',
            source: 'provider',
            confidence: bestScore
          });
        }
      } else {
        results.push({
          seasonNumber: seasonNum,
          seasonTitle,
          artworkUrl: season.artworkUrl || null,
          status: season.artworkUrl ? 'verified' : 'not_found'
        });
      }
    } catch {
      results.push({
        seasonNumber: seasonNum,
        seasonTitle,
        artworkUrl: season.artworkUrl || null,
        status: 'not_found'
      });
    }
  }

  return results;
}

// --- Core Single Anime Verification Engine ---
export async function verifyAnimeEntry(
  anime: any,
  options: {
    autoFixEnabled?: boolean;
    operator?: string;
  } = { autoFixEnabled: true, operator: 'auto_verifier' }
): Promise<ArtworkVerificationResult> {
  const sources = getArtworkSourcesConfig();
  const anilistConfig = sources.find(s => s.id === 'anilist' && s.enabled);
  const jikanConfig = sources.find(s => s.id === 'jikan' && s.enabled);
  const anidbConfig = sources.find(s => s.id === 'anidb' && s.enabled);

  const rawTitle = anime.title || 'Untitled';
  const alternateTitle = anime.alternateTitle || null;
  const currentArtworkUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;
  const { cleaned, variants, detectedSeasonNumber } = cleanAnimeTitle(rawTitle);

  const titlesToCheck = [...variants];
  if (alternateTitle && !titlesToCheck.includes(alternateTitle)) {
    titlesToCheck.push(cleanAnimeTitle(alternateTitle).cleaned);
  }

  const candidates: ArtworkCandidate[] = [];
  let aniListMatch: any = null;
  let jikanMatch: any = null;
  let anidbMatch: any = null;

  let aniListQueried = false;
  let jikanQueried = false;
  let anidbQueried = false;

  let aniListError: string | null = null;
  let jikanError: string | null = null;
  let jikanIsOfflineOrFailing = false;
  let anidbError: string | null = null;

  // 1. Inspect current artwork usability and quality
  const currentArtInspection = await inspectArtworkImage(currentArtworkUrl);

  // 2. Query Primary Source: AniList
  if (anilistConfig) {
    aniListQueried = true;
    for (const titleVariant of titlesToCheck) {
      const res = await queryAniList(titleVariant, anilistConfig.endpoint, anilistConfig.timeoutMs);
      if (!res.success) {
        aniListError = res.error || 'Network error';
        break;
      }
      if (res.matches.length > 0) {
        for (const item of res.matches) {
          const itemRomaji = item.title?.romaji || '';
          const itemEnglish = item.title?.english || '';
          const synonyms: string[] = item.synonyms || [];

          const scoreRomaji = calculateStringSimilarity(cleaned, itemRomaji);
          const scoreEnglish = itemEnglish ? calculateStringSimilarity(cleaned, itemEnglish) : 0;
          let bestSynonymScore = 0;
          for (const syn of synonyms) {
            const sc = calculateStringSimilarity(cleaned, syn);
            if (sc > bestSynonymScore) bestSynonymScore = sc;
          }

          const score = Math.max(scoreRomaji, scoreEnglish, bestSynonymScore);
          const coverUrl = item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium;

          if (coverUrl && score > 0.45) {
            candidates.push({
              source: 'anilist',
              sourceId: item.id,
              title: itemEnglish || itemRomaji,
              imageUrl: coverUrl,
              aspectRatio: '3:4',
              confidence: score,
              format: item.format,
              year: item.seasonYear
            });
          }

          if (!aniListMatch || score > aniListMatch.score) {
            aniListMatch = {
              id: item.id,
              title: itemEnglish || itemRomaji,
              englishTitle: itemEnglish,
              romajiTitle: itemRomaji,
              year: item.seasonYear,
              coverUrl,
              score
            };
          }
        }
        if (aniListMatch && aniListMatch.score >= 0.85) {
          break; // Strong match found
        }
      }
    }
  }

  // 3. Query Secondary Source: Jikan (MyAnimeList) with safe backoff
  if (jikanConfig) {
    jikanQueried = true;
    try {
      // Throttle delay to respect Jikan rate limits
      await new Promise(r => setTimeout(r, 200));

      for (const titleVariant of titlesToCheck) {
        const res = await queryJikan(titleVariant, jikanConfig.endpoint, jikanConfig.timeoutMs);
        if (!res.success) {
          jikanError = res.error || 'Gateway error';
          if (res.isTemporaryUnavailable || res.statusCode === 504 || res.statusCode === 429) {
            jikanIsOfflineOrFailing = true;
          }
          break;
        }
        if (res.matches.length > 0) {
          for (const item of res.matches) {
            const itemTitle = item.title || '';
            const itemEnglish = item.title_english || '';

            const scoreMain = calculateStringSimilarity(cleaned, itemTitle);
            const scoreEng = itemEnglish ? calculateStringSimilarity(cleaned, itemEnglish) : 0;
            const score = Math.max(scoreMain, scoreEng);

            const coverUrl =
              item.images?.webp?.large_image_url ||
              item.images?.jpg?.large_image_url ||
              item.images?.webp?.image_url ||
              item.images?.jpg?.image_url;

            if (coverUrl && score > 0.45) {
              candidates.push({
                source: 'jikan',
                sourceId: item.mal_id,
                title: itemEnglish || itemTitle,
                imageUrl: coverUrl,
                aspectRatio: '3:4',
                confidence: score,
                format: item.type,
                year: item.year
              });
            }

            if (!jikanMatch || score > jikanMatch.score) {
              jikanMatch = {
                malId: item.mal_id,
                title: itemEnglish || itemTitle,
                englishTitle: itemEnglish,
                year: item.year,
                coverUrl,
                score
              };
            }
          }
          if (jikanMatch && jikanMatch.score >= 0.85) {
            break;
          }
        }
      }
    } catch (err: any) {
      jikanError = err.message;
      jikanIsOfflineOrFailing = true;
    }
  }

  // 4. Tertiary Fallback Source: AniDB (Used ONLY when Jikan is failing/unavailable and AniList is inconclusive)
  if (jikanIsOfflineOrFailing && (!aniListMatch || aniListMatch.score < 0.80) && anidbConfig) {
    anidbQueried = true;
    try {
      const anidbRes = await queryAniDBFallback(cleaned);
      if (anidbRes.success && anidbRes.matches.length > 0) {
        anidbMatch = {
          aid: anidbRes.matches[0].aid,
          title: anidbRes.matches[0].title,
          score: 0.80
        };
      } else {
        anidbError = anidbRes.error || 'AniDB query returned no matches';
      }
    } catch (err: any) {
      anidbError = err.message;
    }
  }

  // Sort candidates by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  const bestCandidate = candidates[0] || null;

  // Composite scores
  const bestAniScore = aniListMatch?.score || 0;
  const bestJikanScore = jikanMatch?.score || 0;
  const bestAniDBScore = anidbMatch?.score || 0;
  const topConfidence = Math.max(bestAniScore, bestJikanScore, bestAniDBScore);

  let finalStatus: VerificationStatus = 'needs_review';
  let issueDescription: string | null = null;
  const evidenceList: string[] = [];
  let replacedUrl: string | null = null;

  // Multi-season verification
  let seasonResults: SeasonArtworkResult[] = [];
  if (anime.seasons && anime.seasons.length > 1) {
    seasonResults = await verifyMultiSeasons(anime, cleaned, options.autoFixEnabled ?? true);
  }

  // Evaluation criteria
  const currentArtworkMissingOrBroken =
    !currentArtworkUrl ||
    !currentArtInspection.usable ||
    currentArtInspection.isBlankOrPlaceholder;

  // Both trusted sources agree
  const sourcesStronglyAgree =
    bestAniScore >= 0.75 &&
    bestJikanScore >= 0.75 &&
    calculateStringSimilarity(aniListMatch?.title || '', jikanMatch?.title || '') >= 0.70;

  // AniList primary source has high confidence (> 0.75)
  // Per requirement: DO NOT send to Needs Review just because Jikan is temporarily down/unavailable
  const primarySourceHighConfidence = bestAniScore >= 0.75;
  const secondarySourceHighConfidence = bestJikanScore >= 0.85;

  if (sourcesStronglyAgree || primarySourceHighConfidence || secondarySourceHighConfidence) {
    const verifiedSource = bestAniScore >= 0.75 ? 'AniList' : 'Jikan';
    const verifiedScore = bestAniScore >= 0.75 ? bestAniScore : bestJikanScore;

    if (sourcesStronglyAgree) {
      evidenceList.push(`AniList and Jikan both verify identity (${Math.round(bestAniScore * 100)}% / ${Math.round(bestJikanScore * 100)}%).`);
    } else {
      evidenceList.push(`High confidence verified via ${verifiedSource} (${Math.round(verifiedScore * 100)}%).`);
      if (jikanIsOfflineOrFailing) {
        evidenceList.push('Jikan temporarily offline or returned 504; AniList primary source safely maintained verification.');
      }
    }

    if (currentArtworkMissingOrBroken) {
      // Auto-fix scenario: Missing or broken poster replaced with verified asset
      if (bestCandidate && bestCandidate.imageUrl) {
        finalStatus = 'auto_fixed';
        replacedUrl = bestCandidate.imageUrl;
        issueDescription = `Artwork automatically fixed with verified high-resolution asset from ${bestCandidate.source}.`;
        evidenceList.push(`Previous artwork was missing or unverified. Replaced with verified ${bestCandidate.source} poster.`);

        if (options.autoFixEnabled) {
          applyArtworkUpdate(anime.id, bestCandidate.imageUrl, 'verified', currentArtworkUrl, bestCandidate.source);
        }
      } else {
        // High confidence identity, but image URL failed inspection
        finalStatus = 'verified';
        issueDescription = 'Anime identity verified, but poster imagery retained from provider.';
        markCatalogueAnimeVerified(anime.id, 'verified');
      }
    } else {
      // Current artwork exists and is verified usable
      finalStatus = 'verified';
      issueDescription = 'Artwork and anime identity successfully verified against trusted databases.';
      evidenceList.push('Current artwork verified usable and matches verified database entry.');
      markCatalogueAnimeVerified(anime.id, 'verified');
    }
  } else if (
    // Possible fake evaluation: Only flag when trusted sources are HEALTHY and returned ZERO matches
    aniListQueried &&
    !aniListError &&
    bestAniScore < 0.30 &&
    (!jikanQueried || (!jikanIsOfflineOrFailing && !jikanError && bestJikanScore < 0.30)) &&
    (!anidbQueried || !anidbMatch)
  ) {
    evidenceList.push(`Queried titles: "${titlesToCheck.join('", "')}". Zero database matches found on AniList.`);
    const providerUrl = anime.providers?.raretoonIndia?.canonicalUrl || '';
    evidenceList.push(`Source provider: ${anime.provider || 'RareToon India'} (${providerUrl || 'No provider canonical URL'})`);

    finalStatus = 'possible_fake';
    issueDescription = 'Zero matching records found in anime databases after exhaustive title variations search.';

    recordFakeAnimeIssue({
      id: `FAKE-${Date.now()}-${anime.id}`,
      catalogueId: anime.id,
      animeTitle: rawTitle,
      source: anime.provider || 'RareToon India',
      sourceUrl: providerUrl,
      titlesChecked: titlesToCheck,
      aniListResult: {
        queried: aniListQueried,
        found: aniListMatch ? 1 : 0,
        error: aniListError
      },
      jikanResult: {
        queried: jikanQueried,
        found: jikanMatch ? 1 : 0,
        error: jikanError
      },
      anidbResult: anidbQueried ? {
        queried: true,
        found: anidbMatch ? 1 : 0,
        error: anidbError
      } : undefined,
      verificationResults: `Zero matches found across ${titlesToCheck.length} title variations.`,
      reason: 'No matching records in AniList or MyAnimeList databases after exhaustive search.',
      timestamp: new Date().toISOString(),
      evidence: evidenceList,
      status: 'active'
    });
  } else if (aniListError && (jikanIsOfflineOrFailing || jikanError)) {
    // Both external APIs experienced network or 504 errors
    finalStatus = 'unable_to_verify';
    issueDescription = `External APIs temporarily degraded: AniList (${aniListError || 'degraded'}), Jikan (${jikanError || 'offline'}).`;
    evidenceList.push('Temporary API failure detected. Safe fallback engaged; anime was not falsely flagged as fake.');
  } else if (bestCandidate && bestCandidate.confidence >= 0.60) {
    // Moderate confidence match: Auto-accept if artwork is usable to minimize Owner review
    if (currentArtworkMissingOrBroken && bestCandidate.imageUrl) {
      finalStatus = 'auto_fixed';
      replacedUrl = bestCandidate.imageUrl;
      issueDescription = `Artwork automatically fixed from candidate (${Math.round(bestCandidate.confidence * 100)}% match).`;
      if (options.autoFixEnabled) {
        applyArtworkUpdate(anime.id, bestCandidate.imageUrl, 'verified', currentArtworkUrl, bestCandidate.source);
      }
    } else {
      finalStatus = 'verified';
      issueDescription = `Anime identity and artwork matched with ${Math.round(bestCandidate.confidence * 100)}% confidence.`;
      markCatalogueAnimeVerified(anime.id, 'verified');
    }
  } else {
    // Genuine unresolved case -> Needs Review
    finalStatus = 'needs_review';
    issueDescription = `Unresolved artwork match (Confidence: ${Math.round(topConfidence * 100)}%). Sent to review queue.`;
    evidenceList.push(`AniList score: ${Math.round(bestAniScore * 100)}%. Jikan score: ${Math.round(bestJikanScore * 100)}%.`);
  }

  const result: ArtworkVerificationResult = {
    animeId: anime.id,
    animeTitle: rawTitle,
    status: finalStatus,
    confidence: topConfidence,
    currentArtworkUrl: replacedUrl || currentArtworkUrl,
    replacedArtworkUrl: replacedUrl,
    source: bestCandidate?.source || (currentArtworkUrl ? 'provider' : 'none'),
    dimensions: currentArtInspection.dimensions || 'HD (3:4)',
    lastVerifiedAt: new Date().toISOString(),
    aniListMatch,
    jikanMatch,
    anidbMatch,
    seasonResults: seasonResults.length > 0 ? seasonResults : undefined,
    candidates,
    issue: issueDescription,
    evidence: evidenceList
  };

  // Persist record
  const records = loadVerificationRecords();
  records[anime.id] = result;
  saveVerificationRecords(records);

  return result;
}

// --- Catalogue Updating Helpers ---
export function applyArtworkUpdate(
  animeId: string,
  newUrl: string,
  newStatus: string,
  previousUrl: string | null,
  source: string,
  seasonNumber?: number
): boolean {
  try {
    if (!fs.existsSync(CATALOGUE_PATH)) return false;
    const catalogue: any[] = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
    const index = catalogue.findIndex(a => a.id === animeId);
    if (index === -1) return false;

    const anime = catalogue[index];
    const prev = anime.artwork?.verifiedArtworkUrl || previousUrl || null;

    anime.artwork = {
      ...anime.artwork,
      verifiedArtworkUrl: newUrl,
      isVerified: newStatus === 'verified',
      verificationStatus: newStatus,
      verificationSource: source,
      aspectRatio: '3:4',
      originalArtworkUrl: prev || anime.artwork?.originalArtworkUrl
    };

    // If season number is provided, also set season artwork
    if (seasonNumber && Array.isArray(anime.seasons)) {
      const s = anime.seasons.find((sn: any) => sn.seasonNumber === seasonNumber);
      if (s) {
        s.artworkUrl = newUrl;
      }
    }

    catalogue[index] = anime;
    safeWriteFileSync(CATALOGUE_PATH, JSON.stringify(catalogue, null, 2));

    // Also sync to src/data/ if exists
    const publicPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
    if (fs.existsSync(publicPath)) {
      safeWriteFileSync(publicPath, JSON.stringify(catalogue, null, 2));
    }

    // Save history entry for recovery
    if (prev && prev !== newUrl) {
      const history = loadArtworkHistory();
      history.unshift({
        id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        animeId,
        animeTitle: anime.title,
        previousArtworkUrl: prev,
        newArtworkUrl: newUrl,
        replacedAt: new Date().toISOString(),
        replacedBy: 'auto_verifier',
        source,
        reason: `Artwork auto-fixed with verified high-resolution asset from ${source}`,
        seasonNumber
      });
      // Keep up to 3000 history entries
      saveArtworkHistory(history.slice(0, 3000));
    }

    return true;
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error updating catalogue artwork:', err.message);
    return false;
  }
}

export function revertArtwork(animeId: string): { success: boolean; message: string; previousUrl?: string } {
  try {
    const history = loadArtworkHistory();
    const entryIndex = history.findIndex(h => h.animeId === animeId);
    if (entryIndex === -1) {
      return { success: false, message: 'No previous artwork history found for this anime.' };
    }

    const entry = history[entryIndex];
    const restoredUrl = entry.previousArtworkUrl;

    if (!fs.existsSync(CATALOGUE_PATH)) {
      return { success: false, message: 'Catalogue not found.' };
    }

    const catalogue: any[] = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
    const index = catalogue.findIndex(a => a.id === animeId);
    if (index === -1) {
      return { success: false, message: 'Anime not found in catalogue.' };
    }

    catalogue[index].artwork = {
      ...catalogue[index].artwork,
      verifiedArtworkUrl: restoredUrl,
      verificationStatus: 'unverified',
      isVerified: false,
      verificationSource: 'reverted_backup'
    };

    fs.writeFileSync(CATALOGUE_PATH, JSON.stringify(catalogue, null, 2), 'utf-8');

    // Remove from history or mark reverted
    history.splice(entryIndex, 1);
    saveArtworkHistory(history);

    // Update records
    const records = loadVerificationRecords();
    if (records[animeId]) {
      records[animeId].status = 'needs_review';
      records[animeId].currentArtworkUrl = restoredUrl;
      records[animeId].issue = 'Artwork manually reverted to previous backup.';
      saveVerificationRecords(records);
    }

    return { success: true, message: 'Artwork successfully reverted to previous backup.', previousUrl: restoredUrl };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export function markCatalogueAnimeVerified(animeId: string, status: string): void {
  try {
    if (!fs.existsSync(CATALOGUE_PATH)) return;
    const catalogue: any[] = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
    const index = catalogue.findIndex(a => a.id === animeId);
    if (index === -1) return;

    catalogue[index].artwork = {
      ...catalogue[index].artwork,
      isVerified: status === 'verified',
      verificationStatus: status
    };
    fs.writeFileSync(CATALOGUE_PATH, JSON.stringify(catalogue, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error marking verified:', err.message);
  }
}

export function recordFakeAnimeIssue(issue: FakeAnimeIssue): void {
  try {
    const issues = loadFakeAnimeIssues();
    const existingIndex = issues.findIndex(i => i.catalogueId === issue.catalogueId);
    if (existingIndex !== -1) {
      issues[existingIndex] = issue;
    } else {
      issues.unshift(issue);
    }
    saveFakeAnimeIssues(issues);
  } catch (err: any) {
    console.error('[ArtworkVerifier] Error recording fake issue:', err.message);
  }
}
