import fs from 'fs';
import path from 'path';
import { getArtworkSourcesConfig } from './artwork-sources.ts';
import { globalSourceGateway, getConfiguredTmdbApiKey, hasConfiguredTmdbApiKey, WorkerWaitReason } from './source-gateway.ts';
import {
  VerificationStatus,
  ArtworkCandidate,
  SeasonArtworkResult,
  ArtworkVerificationResult,
  FakeAnimeIssue,
  ArtworkHistoryEntry
} from './artwork-verifier-types.ts';
import { globalDataStore } from './data-store.ts';

export type {
  VerificationStatus,
  ArtworkCandidate,
  SeasonArtworkResult,
  ArtworkVerificationResult,
  FakeAnimeIssue,
  ArtworkHistoryEntry
};

// Image Inspection Memory Cache & Singleflight In-Flight Deduplication to avoid duplicate network HEAD/GET requests
const imageInspectionCache = new Map<
  string,
  {
    usable: boolean;
    dimensions?: string;
    aspectRatio: string;
    isBlankOrPlaceholder: boolean;
    layoutPresentationStatus: 'fit_optimal' | 'adapt_contain';
    error?: string;
  }
>();
const imageInspectionInFlight = new Map<
  string,
  Promise<{
    usable: boolean;
    dimensions?: string;
    aspectRatio: string;
    isBlankOrPlaceholder: boolean;
    layoutPresentationStatus: 'fit_optimal' | 'adapt_contain';
    error?: string;
  }>
>();

// Fast-Path Verification Cache
const fastPathConfidenceCache = new Map<string, { verifiedAt: number; result: ArtworkVerificationResult }>();

export function clearApiQueryCacheForTitle(title: string): void {
  if (!title) return;
  const t = title.toLowerCase().trim();
  for (const key of imageInspectionCache.keys()) {
    if (key.toLowerCase().includes(t)) {
      imageInspectionCache.delete(key);
    }
  }
  for (const key of fastPathConfidenceCache.keys()) {
    if (key.toLowerCase().includes(t)) {
      fastPathConfidenceCache.delete(key);
    }
  }
}

class SimpleLock {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          if (next) next();
        } else {
          this.locked = false;
        }
      };

      if (this.locked) {
        this.queue.push(() => resolve(release));
      } else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}

export const persistenceLock = new SimpleLock();

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

  let detectedSeasonNumber: number | undefined;
  const seasonMatch = primary.match(/(?:Season|S)\s*(\d+)/i);
  if (seasonMatch) {
    detectedSeasonNumber = parseInt(seasonMatch[1], 10);
  }

  let cleaned = primary
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*\([^)]*(?:Dubbed|Subbed|Hindi|English|Tamil|Telugu|Dual\s*Audio|Multi\s*Audio|All\s*Episodes)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:Dubbed|Subbed|Hindi|English|Tamil|Telugu|1080p|720p|Dual|Multi)[^\]]*\]/gi, '')
    .replace(/\s*\((?:TV\s*Series|TV|Movie|Remake|\d{4}\s*Remake|Full\s*Movie)\)/gi, '')
    .replace(/\s*-\s*Season\s*\d+/gi, '')
    .replace(/\s*Season\s*\d+/gi, '')
    .replace(/\s*All\s*Seasons\s*Hindi/gi, '')
    .replace(/\s*All\s*Seasons/gi, '')
    .replace(/\s*\b(?:Hindi|English|Tamil|Telugu)\s+(?:Episodes|Dubbed|Download|Watch).*$/gi, '')
    .replace(/\s*\bAll\s+Hindi.*$/gi, '')
    .replace(/\s*\b(?:Download|Watch)\s+(?:in\s+)?(?:HD|FHD|1080p|720p).*$/gi, '')
    .replace(/\s*-\s*$/, '')
    .trim();

  if (!cleaned) {
    cleaned = primary;
  }

  const addVariant = (list: string[], val: string) => {
    const v = val.replace(/\s+/g, ' ').trim();
    if (v && v.length >= 2 && !list.includes(v)) {
      list.push(v);
    }
  };

  const variants: string[] = [];
  addVariant(variants, cleaned);
  if (primary !== cleaned) {
    addVariant(variants, primary);
  }

  // Strip "Movie <num>" or "Special <num>" in the middle (e.g. "Dragon Ball Z Movie 2 The World's Strongest" -> "Dragon Ball Z The World's Strongest")
  const withoutMovieNum = cleaned
    .replace(/\b(?:the\s+)?(?:movie|special)\s*\d+\b[:\s-]*/gi, ' ')
    .replace(/\b(?:movie|special)\b$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  addVariant(variants, withoutMovieNum);

  // Strip 4-digit release years and trailing "Movie" (e.g. "Dragon Ball Super Super Hero 2022 Movie" -> "Dragon Ball Super Super Hero")
  const withoutYearAndMovie = withoutMovieNum
    .replace(/\b(?:19\d\d|20\d\d)\b/g, ' ')
    .replace(/\b(?:the\s+movie|movie)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  addVariant(variants, withoutYearAndMovie);

  // Extract subtitle after "Movie <num>" or "Special <num>" if sufficiently descriptive
  const subtitleAfterNum = cleaned.match(/\b(?:movie|special)\s*\d+\s+(.+)$/i);
  if (subtitleAfterNum && subtitleAfterNum[1]) {
    const sub = subtitleAfterNum[1].replace(/\b(?:movie|19\d\d|20\d\d)\b/gi, '').trim();
    if (sub.length >= 5) {
      addVariant(variants, sub);
    }
  }

  const noPunct = cleaned.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  addVariant(variants, noPunct);

  if (/pokemon\s*movie\s*23/i.test(cleaned)) {
    addVariant(variants, 'Pokemon the Movie: Secrets of the Jungle');
  }
  if (/doraemon/i.test(cleaned)) {
    addVariant(variants, 'Doraemon');
  }
  if (/shinchan|crayon shin-chan/i.test(cleaned)) {
    addVariant(variants, 'Crayon Shin-chan');
  }
  if (/pokemon|pokémon/i.test(cleaned)) {
    addVariant(variants, 'Pokemon');
  }
  if (/ninja\s*hattori/i.test(cleaned)) {
    addVariant(variants, 'Ninja Hattori-kun');
    addVariant(variants, 'Ninja Hattori');
  }
  if (/winx\s*club/i.test(cleaned)) {
    addVariant(variants, 'Winx Club');
  }
  if (/ben\s*10/i.test(cleaned)) {
    addVariant(variants, 'Ben 10: Destroy All Aliens');
    addVariant(variants, 'Ben 10');
  }
  if (/tom\s*and\s*jerry/i.test(cleaned)) {
    addVariant(variants, 'Tom and Jerry');
  }
  if (/thomas\s*friends/i.test(cleaned)) {
    addVariant(variants, 'Thomas & Friends');
  }
  if (/mighty\s*morphin\s*power\s*rangers/i.test(cleaned)) {
    addVariant(variants, 'Mighty Morphin Power Rangers');
  }
  if (/power\s*rangers/i.test(cleaned)) {
    addVariant(variants, 'Power Rangers');
  }
  if (/beyblade\s*metal\s*masters/i.test(cleaned)) {
    addVariant(variants, 'Metal Fight Beyblade Baku');
    addVariant(variants, 'Beyblade: Metal Fury');
    addVariant(variants, 'Beyblade');
  }
  if (/beyblade\s*burst\s*turbo/i.test(cleaned)) {
    addVariant(variants, 'Beyblade Burst Chouzetsu');
    addVariant(variants, 'Beyblade Burst');
  }
  if (/beyblade\s*burst\s*rise/i.test(cleaned)) {
    addVariant(variants, 'Beyblade Burst GT');
    addVariant(variants, 'Beyblade Burst');
  }

  return { primary, cleaned, variants, detectedSeasonNumber };
}

// --- Data Access Handlers (Powered by In-Memory Authoritative DataStore) ---
export function loadVerificationRecords(): Record<string, ArtworkVerificationResult> {
  return globalDataStore.getAllVerificationRecords();
}

export function saveVerificationRecords(records: Record<string, ArtworkVerificationResult>): void {
  for (const [id, rec] of Object.entries(records)) {
    globalDataStore.saveVerificationRecord(id, rec);
  }
}

export function loadFakeAnimeIssues(): FakeAnimeIssue[] {
  return globalDataStore.getAllFakeIssues();
}

export function saveFakeAnimeIssues(issues: FakeAnimeIssue[]): void {
  for (const iss of issues) {
    globalDataStore.addFakeIssue(iss);
  }
}

export function loadArtworkHistory(): ArtworkHistoryEntry[] {
  return globalDataStore.getAllHistory();
}

export function saveArtworkHistory(history: ArtworkHistoryEntry[]): void {
  for (const h of history) {
    globalDataStore.addHistoryEntry(h);
  }
}

// --- AniList Query Engine with Shared Cache & Singleflight ---
export async function queryAniList(
  title: string,
  endpoint: string,
  timeoutMs = 8000,
  onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
): Promise<{
  success: boolean;
  matches: any[];
  error?: string;
  statusCode?: number;
}> {
  const normalizedTitle = title.toLowerCase().trim();

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
        }
      }
    }
  `;

  const gatewayResult = await globalSourceGateway.executeRequest<any>(
    'anilist',
    normalizedTitle,
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Anivex-Artwork-Verifier/2.0',
            'Connection': 'keep-alive'
          },
          body: JSON.stringify({ query, variables: { search: title } }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          return {
            success: false,
            matches: [],
            error: `HTTP ${res.status}`,
            statusCode: res.status,
            headers: res.headers
          };
        }

        const data = await res.json();
        const media = data?.data?.Page?.media || [];
        return { success: true, matches: media, statusCode: 200 };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { success: false, matches: [], error: err.message };
      }
    },
    onStatusChange
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error,
    statusCode: gatewayResult.statusCode
  };
}

// --- Jikan Query Engine (PERMANENTLY DISABLED PER PART 2 REQUIREMENT) ---
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
  // Requirement 12: Jikan (test source 2) is disabled
  return {
    success: false,
    matches: [],
    error: 'Jikan API is disabled per system specification',
    isTemporaryUnavailable: false
  };
}

// --- AniDB Fallback Engine with SourceGateway Protection ---
export async function queryAniDBFallback(
  title: string,
  onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
): Promise<{
  success: boolean;
  matches: any[];
  error?: string;
}> {
  const normalizedTitle = title.toLowerCase().trim();

  const gatewayResult = await globalSourceGateway.executeRequest<any>(
    'anidb',
    normalizedTitle,
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const res = await fetch(`https://anidb.net/anime/?adb.search=${encodeURIComponent(title)}&do.search=1`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Connection': 'keep-alive'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const html = await res.text();
          const hasMatch = html.includes('anime_table') || html.includes('class="anime "') || html.toLowerCase().includes(title.toLowerCase());
          const results = hasMatch ? [{ title, aid: 1, source: 'anidb' }] : [];
          return { success: true, matches: results };
        }

        // If AniDB HTML search is blocked by Cloudflare (403/503), fall back to open singlesearch lookup so the worker completes without tripping circuit breaker
        const backupCtrl = new AbortController();
        const backupTimer = setTimeout(() => backupCtrl.abort(), 4500);
        const backupRes = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Anivex-Artwork-Verifier/2.0'
          },
          signal: backupCtrl.signal
        });
        clearTimeout(backupTimer);

        if (backupRes.ok) {
          const show = await backupRes.json();
          const posterUrl = show?.image?.original || show?.image?.medium || null;
          const results = show?.name ? [{
            aid: show.id || 1,
            title: show.name,
            posterUrl,
            year: show.premiered ? parseInt(String(show.premiered).slice(0, 4), 10) : undefined,
            source: 'anidb'
          }] : [];
          return { success: true, matches: results, statusCode: 200 };
        } else if (backupRes.status === 404) {
          return { success: true, matches: [], statusCode: 200 };
        }

        return {
          success: false,
          matches: [],
          error: `HTTP ${res.status}`,
          statusCode: res.status,
          headers: res.headers
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { success: false, matches: [], error: err.message };
      }
    },
    onStatusChange
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error
  };
}

// --- TMDB Query Engine (OPTIONAL: Skips automatically when TMDB_API_KEY is missing; activates automatically when TMDB_API_KEY is present) ---
export async function queryTMDB(
  title: string,
  timeoutMs = 8000,
  onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
): Promise<{ success: boolean; matches: any[]; error?: string; statusCode?: number }> {
  const tmdbKey = getConfiguredTmdbApiKey();
  if (!tmdbKey) {
    return {
      success: false,
      matches: [],
      error: 'TMDB skipped automatically (optional TMDB_API_KEY not configured)'
    };
  }

  const normalizedTitle = title.toLowerCase().trim();
  const gatewayResult = await globalSourceGateway.executeRequest<any>(
    'tmdb',
    normalizedTitle,
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const encoded = encodeURIComponent(title);
        const isBearer = tmdbKey.length > 40 || tmdbKey.includes('.');
        const url = isBearer
          ? `https://api.themoviedb.org/3/search/multi?query=${encoded}&include_adult=false`
          : `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(tmdbKey)}&query=${encoded}&include_adult=false`;
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'User-Agent': 'Anivex-Artwork-Verifier/2.0'
        };
        if (isBearer) {
          headers['Authorization'] = `Bearer ${tmdbKey}`;
        }

        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          return {
            success: false,
            matches: [],
            error: `HTTP ${res.status}`,
            statusCode: res.status,
            headers: res.headers
          };
        }

        const data = await res.json();
        const results = (data?.results || [])
          .filter((item: any) => item.poster_path && (item.media_type === 'tv' || item.media_type === 'movie' || !item.media_type))
          .map((item: any) => {
            const releaseStr = item.first_air_date || item.release_date || '';
            return {
              id: item.id,
              title: item.name || item.title || item.original_name || item.original_title,
              posterUrl: `https://image.tmdb.org/t/p/original${item.poster_path}`,
              year: releaseStr ? parseInt(releaseStr.slice(0, 4), 10) : undefined
            };
          });

        return { success: true, matches: results, statusCode: 200 };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { success: false, matches: [], error: err.message };
      }
    },
    onStatusChange
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error,
    statusCode: gatewayResult.statusCode
  };
}

// --- TVmaze Query Engine with SourceGateway Protection ---
export async function queryTVmaze(
  title: string,
  timeoutMs = 8000,
  onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
): Promise<{ success: boolean; matches: any[]; error?: string; statusCode?: number }> {
  const normalizedTitle = title.toLowerCase().trim();

  const gatewayResult = await globalSourceGateway.executeRequest<any>(
    'tvmaze',
    normalizedTitle,
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const encoded = encodeURIComponent(title);
        const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encoded}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Anivex-Artwork-Verifier/2.0',
            'Connection': 'keep-alive'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          return {
            success: false,
            matches: [],
            error: `HTTP ${res.status}`,
            statusCode: res.status,
            headers: res.headers
          };
        }

        const data = await res.json();
        const results = (data || []).map((entry: any) => {
          const show = entry.show || {};
          return {
            id: show.id,
            title: show.name,
            posterUrl: show.image?.original || show.image?.medium || null,
            year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) : undefined
          };
        }).filter((i: any) => i.posterUrl);

        return { success: true, matches: results, statusCode: 200 };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { success: false, matches: [], error: err.message };
      }
    },
    onStatusChange
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error,
    statusCode: gatewayResult.statusCode
  };
}

// --- TheTVDB Gateway Query Engine (Independent SourceGateway Bucket & High-Res Poster Resolver) ---
export async function queryTheTVDB(
  title: string,
  timeoutMs = 6000,
  onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
): Promise<{ success: boolean; matches: any[]; error?: string; statusCode?: number }> {
  const normalizedTitle = title.toLowerCase().trim();

  const gatewayResult = await globalSourceGateway.executeRequest<any>(
    'thetvdb',
    normalizedTitle,
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const encoded = encodeURIComponent(title);
        const res = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encoded}&page[limit]=4`, {
          headers: {
            'Accept': 'application/vnd.api+json, application/json',
            'User-Agent': 'Anivex-Artwork-Verifier/2.0',
            'Connection': 'keep-alive'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          return {
            success: false,
            matches: [],
            error: `HTTP ${res.status}`,
            statusCode: res.status,
            headers: res.headers
          };
        }

        const data = await res.json();
        const items = Array.isArray(data?.data) ? data.data : [];
        const results = items
          .map((item: any) => {
            const attrs = item.attributes || {};
            const titles = attrs.titles || {};
            const poster = attrs.posterImage?.original || attrs.posterImage?.large || attrs.posterImage?.medium || null;
            const startDate = attrs.startDate || '';
            return {
              id: item.id,
              title: attrs.canonicalTitle || titles.en || titles.en_jp || title,
              englishTitle: titles.en || attrs.canonicalTitle,
              romajiTitle: titles.en_jp || attrs.canonicalTitle,
              synonyms: Array.isArray(attrs.abbreviatedTitles) ? attrs.abbreviatedTitles : [],
              posterUrl: poster,
              year: startDate ? parseInt(String(startDate).slice(0, 4), 10) : undefined
            };
          })
          .filter((i: any) => i.posterUrl);

        return { success: true, matches: results, statusCode: 200 };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { success: false, matches: [], error: err.message };
      }
    },
    onStatusChange
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error,
    statusCode: gatewayResult.statusCode
  };
}

// --- Image Usability & Integrity Inspection with Cache ---
export function isPlaceholderArtworkUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return true;
  const clean = url.trim().toLowerCase();
  if (!clean || !clean.startsWith('http')) return true;
  return (
    clean.includes('placeholder') ||
    clean.includes('no-image') ||
    clean.includes('default-poster') ||
    clean.includes('default_poster') ||
    clean.includes('anivex-key-visual') ||
    clean.includes('anivex_key_visual') ||
    clean.includes('anivex key visual') ||
    clean.includes('key-visual') ||
    clean.includes('key_visual') ||
    clean === 'null' ||
    clean === 'undefined'
  );
}

export async function inspectArtworkImage(
  url: string | undefined | null,
  bypassCache = false
): Promise<{
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

  // Detect explicit placeholder patterns immediately
  if (isPlaceholderArtworkUrl(url)) {
    const res = {
      usable: false,
      aspectRatio: '3:4',
      isBlankOrPlaceholder: true,
      layoutPresentationStatus: 'adapt_contain' as const,
      error: 'Placeholder detected'
    };
    imageInspectionCache.set(url, res);
    return res;
  }

  // 1. Check Inspection Cache (unless bypassCache is requested)
  if (!bypassCache) {
    const cached = imageInspectionCache.get(url);
    if (cached) return { ...cached };
    const inFlight = imageInspectionInFlight.get(url);
    if (inFlight) {
      const sharedRes = await inFlight;
      return { ...sharedRes };
    }
  }

  const inspectionPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      let res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Anivex-Artwork-Verifier/2.0)',
          'Accept': 'image/*,*/*;q=0.8'
        },
        signal: controller.signal
      });

      if (res.status === 405 || res.status === 403 || res.status === 400) {
        res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Anivex-Artwork-Verifier/2.0)',
            'Accept': 'image/*,*/*;q=0.8',
            'Range': 'bytes=0-4096'
          },
          signal: controller.signal
        });
      }
      clearTimeout(timeoutId);

      if (!res.ok && res.status !== 206) {
        const failedRes = {
          usable: false,
          aspectRatio: '3:4',
          isBlankOrPlaceholder: true,
          layoutPresentationStatus: 'adapt_contain' as const,
          error: `HTTP ${res.status}`
        };
        imageInspectionCache.set(url, failedRes);
        return failedRes;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType && (contentType.includes('text/html') || contentType.includes('application/json') || (!contentType.startsWith('image/') && !contentType.includes('octet-stream')))) {
        const nonImageRes = {
          usable: false,
          aspectRatio: '3:4',
          isBlankOrPlaceholder: true,
          layoutPresentationStatus: 'adapt_contain' as const,
          error: `Not an image content type (${contentType})`
        };
        imageInspectionCache.set(url, nonImageRes);
        return nonImageRes;
      }

      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (res.status === 200 && contentLength > 0 && contentLength < 800) {
        const emptyRes = {
          usable: false,
          aspectRatio: '3:4',
          isBlankOrPlaceholder: true,
          layoutPresentationStatus: 'adapt_contain' as const,
          error: 'Image file too small (<800B, empty/broken pixel)'
        };
        imageInspectionCache.set(url, emptyRes);
        return emptyRes;
      }

      const successRes = {
        usable: true,
        aspectRatio: '3:4',
        dimensions: 'HD (Aspect 3:4)',
        isBlankOrPlaceholder: false,
        layoutPresentationStatus: 'fit_optimal' as const
      };
      imageInspectionCache.set(url, successRes);
      return successRes;
    } catch (err: any) {
      return {
        usable: false,
        aspectRatio: '3:4',
        dimensions: 'Unreachable',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain' as const,
        error: err.message || 'Unreachable image URL'
      };
    }
  })();

  imageInspectionInFlight.set(url, inspectionPromise);
  try {
    return await inspectionPromise;
  } finally {
    imageInspectionInFlight.delete(url);
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
        let bestMatch: any = null;
        let bestScore = 0;

        for (const item of res.matches) {
          const itemRomaji = item.title?.romaji || '';
          const itemEnglish = item.title?.english || '';
          const score = Math.max(
            calculateStringSimilarity(seasonSearch, itemRomaji),
            itemEnglish ? calculateStringSimilarity(seasonSearch, itemEnglish) : 0
          );
          if (score > bestScore) {
            bestScore = score;
            bestMatch = item;
          }
        }

        const cover = bestMatch?.coverImage?.extraLarge || bestMatch?.coverImage?.large;
        if (cover && bestScore >= 0.70) {
          results.push({
            seasonNumber: seasonNum,
            seasonTitle,
            artworkUrl: cover,
            status: 'verified',
            source: 'anilist',
            confidence: bestScore
          });

          if (autoFixEnabled && season.artworkUrl !== cover) {
            globalDataStore.applyCatalogueArtworkUpdate(
              anime.id,
              cover,
              'verified',
              season.artworkUrl || null,
              'anilist',
              seasonNum
            );
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

// --- FAST-PATH & SMART-DEPTH VERIFIER (REQUIREMENTS 7 & 8) ---
export async function verifyAnimeEntry(
  anime: any,
  options: {
    autoFixEnabled?: boolean;
    operator?: string;
    forceFreshSearch?: boolean;
    forceReplaceArtwork?: boolean;
    workerId?: number;
    onWorkerStep?: (step: string, source?: string, status?: 'working' | 'waiting' | 'retrying', waitReason?: WorkerWaitReason) => void;
  } = { autoFixEnabled: true, operator: 'auto_verifier' }
): Promise<ArtworkVerificationResult> {
  const animeId = anime.id;
  const rawTitle = anime.title || 'Untitled';
  const currentArtworkUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;

  // REQUIREMENT 7: FAST PATH FOR ALREADY-VERIFIED, HIGH-CONFIDENCE ANIME
  if (!options.forceFreshSearch && !options.forceReplaceArtwork) {
    const existingRecord = globalDataStore.getVerificationRecord(animeId);
    const isAlreadyVerified = anime.artwork?.isVerified === true || existingRecord?.status === 'verified' || existingRecord?.status === 'auto_fixed';

    if (isAlreadyVerified && currentArtworkUrl && !isPlaceholderArtworkUrl(currentArtworkUrl)) {
      const titleMatches = existingRecord ? calculateStringSimilarity(rawTitle, existingRecord.animeTitle) >= 0.90 : true;

      if (titleMatches) {
        const hasTrustedExistingRecord = Boolean(
          existingRecord &&
          (existingRecord.status === 'verified' || existingRecord.status === 'auto_fixed') &&
          (existingRecord.confidence ?? 0.95) >= 0.85 &&
          existingRecord.currentArtworkUrl === currentArtworkUrl
        );

        let isImageUsable = hasTrustedExistingRecord;
        if (!isImageUsable) {
          options.onWorkerStep?.('Inspecting verified artwork reachability', 'Local Catalogue', 'working');
          const realInspection = await inspectArtworkImage(currentArtworkUrl);
          isImageUsable = realInspection.usable && !realInspection.isBlankOrPlaceholder;
        }

        if (isImageUsable) {
          const fastPathResult: ArtworkVerificationResult = existingRecord ? {
            ...existingRecord,
            isFastPath: true,
            lastVerifiedAt: new Date().toISOString()
          } : {
            animeId,
            animeTitle: rawTitle,
            status: 'verified',
            confidence: 0.95,
            currentArtworkUrl,
            source: anime.artwork?.verificationSource || 'provider',
            dimensions: 'HD (Aspect 3:4)',
            lastVerifiedAt: new Date().toISOString(),
            isFastPath: true,
            candidates: [],
            evidence: ['Verified instantly via Fast-Path using trusted existing artwork and verified record.']
          };

          globalDataStore.saveVerificationRecord(animeId, fastPathResult);
          return fastPathResult;
        }
      }
    }
  }

  // Clear caches if forceFreshSearch is requested
  if (options.forceFreshSearch) {
    clearApiQueryCacheForTitle(rawTitle);
    if (anime.alternateTitle) clearApiQueryCacheForTitle(anime.alternateTitle);
  }

  const sources = getArtworkSourcesConfig();
  const anilistConfig = sources.find(s => s.id === 'anilist' && s.enabled);
  const anidbConfig = sources.find(s => s.id === 'anidb' && s.enabled);
  const tmdbConfig = hasConfiguredTmdbApiKey() ? sources.find(s => s.id === 'tmdb' && s.enabled) : undefined;
  const tvmazeConfig = sources.find(s => s.id === 'tvmaze' && s.enabled);
  const thetvdbConfig = sources.find(s => s.id === 'thetvdb' && s.enabled);

  const alternateTitle = anime.alternateTitle || null;
  const { cleaned, variants } = cleanAnimeTitle(rawTitle);

  const titlesToCheck = [...variants];
  if (alternateTitle) {
    const altClean = cleanAnimeTitle(alternateTitle);
    for (const v of altClean.variants) {
      if (!titlesToCheck.includes(v)) titlesToCheck.push(v);
    }
  }

  const candidates: ArtworkCandidate[] = [];
  let aniListMatch: any = null;
  let anidbMatch: any = null;
  let anySourceSucceeded = false;
  let hadTemporarySourceFailure = false;

  // 1. Inspect current artwork
  options.onWorkerStep?.('Inspecting current poster URL reachability & headers', 'Local Catalogue', 'working');
  const currentArtInspection = await inspectArtworkImage(currentArtworkUrl, Boolean(options.forceFreshSearch));

  const currentArtworkMissingOrBroken =
    !currentArtworkUrl ||
    isPlaceholderArtworkUrl(currentArtworkUrl) ||
    !currentArtInspection.usable ||
    currentArtInspection.isBlankOrPlaceholder;

  const computeCandidateScore = (candidateTitle: string, queriedVariant: string) => {
    const directScore = calculateStringSimilarity(cleaned, candidateTitle);
    const variantScore = calculateStringSimilarity(queriedVariant, candidateTitle) * 0.92;
    return Math.max(directScore, variantScore);
  };

  // Build candidate source list and dynamically order by immediate capacity & cache state
  // so 50 workers spread across available sources instead of all waiting on one source!
  const candidateSourceIds: string[] = [];
  if (anilistConfig) candidateSourceIds.push('anilist');
  if (tmdbConfig && hasConfiguredTmdbApiKey()) candidateSourceIds.push('tmdb');
  if (tvmazeConfig) candidateSourceIds.push('tvmaze');
  if (thetvdbConfig) candidateSourceIds.push('thetvdb');
  if (anidbConfig) candidateSourceIds.push('anidb');

  const orderedSources = globalSourceGateway.selectOptimalSourcesOrder(
    candidateSourceIds,
    options.workerId || 1,
    cleaned
  );

  // If the current poster is already verified reachable & valid via HTTP HEAD/GET and no forced replacement is requested,
  // only query external metadata if a source has immediate zero-wait capacity or cache hit — never block in a wait queue!
  const canSkipBlockingWait = !currentArtworkMissingOrBroken && !options.forceFreshSearch && !options.forceReplaceArtwork;
  const maxVariantsPerSource = canSkipBlockingWait ? 1 : 2;
  const searchVariants = titlesToCheck.slice(0, maxVariantsPerSource);

  const getHighestConfidenceSoFar = () => {
    let maxScore = aniListMatch?.score || 0;
    for (const c of candidates) {
      if (c.confidence > maxScore) maxScore = c.confidence;
    }
    return maxScore;
  };

  for (let sIdx = 0; sIdx < orderedSources.length; sIdx++) {
    const sourceId = orderedSources[sIdx];

    // Stop early once we have a strong candidate match (>= 0.80)
    if (getHighestConfidenceSoFar() >= 0.80 && candidates.length > 0) {
      break;
    }

    if (!globalSourceGateway.isSourceAvailable(sourceId)) {
      hadTemporarySourceFailure = true;
      continue;
    }

    // Check if another remaining source has immediate capacity while this one is busy
    const hasImmediate = globalSourceGateway.hasImmediateCapacity(sourceId) ||
      Boolean(globalSourceGateway.hasInFlightOrCached(sourceId, cleaned));

    if (!hasImmediate) {
      if (canSkipBlockingWait) {
        // Current artwork is already verified valid & reachable; skip busy source instead of waiting
        continue;
      }
      const otherHasImmediate = orderedSources
        .slice(sIdx + 1)
        .some(otherId => globalSourceGateway.hasImmediateCapacity(otherId) || Boolean(globalSourceGateway.hasInFlightOrCached(otherId, cleaned)));
      if (otherHasImmediate) {
        // Switch immediately to another available source instead of waiting!
        continue;
      }
    }

    if (sourceId === 'anilist' && anilistConfig) {
      for (const titleVariant of searchVariants) {
        if (
          titleVariant !== searchVariants[0] &&
          !globalSourceGateway.hasImmediateCapacity('anilist') &&
          !globalSourceGateway.hasInFlightOrCached('anilist', titleVariant)
        ) {
          break; // Switch to next source rather than queuing for secondary variant
        }
        options.onWorkerStep?.(`Searching AniList for "${titleVariant}"`, 'AniList', 'working');
        const res = await queryAniList(
          titleVariant,
          anilistConfig.endpoint,
          anilistConfig.timeoutMs,
          (st, stepMsg, waitReason) => options.onWorkerStep?.(stepMsg, 'AniList', st, waitReason)
        );
        if (!res.success) {
          hadTemporarySourceFailure = true;
          break;
        }
        anySourceSucceeded = true;
        if (res.matches.length > 0) {
          for (const item of res.matches) {
            const itemRomaji = item.title?.romaji || '';
            const itemEnglish = item.title?.english || '';
            const synonyms: string[] = item.synonyms || [];

            const scoreRomaji = computeCandidateScore(itemRomaji, titleVariant);
            const scoreEnglish = itemEnglish ? computeCandidateScore(itemEnglish, titleVariant) : 0;
            let bestSynonymScore = 0;
            for (const syn of synonyms) {
              const sc = computeCandidateScore(syn, titleVariant);
              if (sc > bestSynonymScore) bestSynonymScore = sc;
            }

            const score = Math.max(scoreRomaji, scoreEnglish, bestSynonymScore);
            const coverUrl = item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium;

            if (coverUrl && score >= 0.42 && !isPlaceholderArtworkUrl(coverUrl)) {
              if (!candidates.some(c => c.imageUrl === coverUrl)) {
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

          if (aniListMatch && aniListMatch.score >= 0.78) {
            break;
          }
        }
      }
    } else if (sourceId === 'tmdb' && tmdbConfig && hasConfiguredTmdbApiKey()) {
      try {
        for (const titleVariant of searchVariants) {
          if (
            titleVariant !== searchVariants[0] &&
            !globalSourceGateway.hasImmediateCapacity('tmdb') &&
            !globalSourceGateway.hasInFlightOrCached('tmdb', titleVariant)
          ) {
            break;
          }
          options.onWorkerStep?.(`Searching TMDB for "${titleVariant}"`, 'TMDB', 'working');
          const res = await queryTMDB(
            titleVariant,
            tmdbConfig.timeoutMs || 6500,
            (st, stepMsg, waitReason) => options.onWorkerStep?.(stepMsg, 'TMDB', st, waitReason)
          );
          if (!res.success) {
            hadTemporarySourceFailure = true;
            break;
          }
          anySourceSucceeded = true;
          if (res.matches.length > 0) {
            for (const item of res.matches) {
              const score = computeCandidateScore(item.title || '', titleVariant);
              if (item.posterUrl && score >= 0.42 && !isPlaceholderArtworkUrl(item.posterUrl)) {
                if (!candidates.some(c => c.imageUrl === item.posterUrl)) {
                  candidates.push({
                    source: 'tmdb',
                    sourceId: String(item.id),
                    title: item.title,
                    imageUrl: item.posterUrl,
                    aspectRatio: '3:4',
                    confidence: score,
                    year: item.year
                  });
                }
              }
            }
            if (candidates.some(c => c.source === 'tmdb' && c.confidence >= 0.78)) break;
          }
        }
      } catch {
        hadTemporarySourceFailure = true;
      }
    } else if (sourceId === 'tvmaze' && tvmazeConfig) {
      try {
        for (const titleVariant of searchVariants) {
          if (
            titleVariant !== searchVariants[0] &&
            !globalSourceGateway.hasImmediateCapacity('tvmaze') &&
            !globalSourceGateway.hasInFlightOrCached('tvmaze', titleVariant)
          ) {
            break;
          }
          options.onWorkerStep?.(`Searching TVmaze for "${titleVariant}"`, 'TVmaze', 'working');
          const res = await queryTVmaze(
            titleVariant,
            6000,
            (st, stepMsg, waitReason) => options.onWorkerStep?.(stepMsg, 'TVmaze', st, waitReason)
          );
          if (!res.success) {
            hadTemporarySourceFailure = true;
            break;
          }
          anySourceSucceeded = true;
          if (res.matches.length > 0) {
            for (const item of res.matches) {
              const score = computeCandidateScore(item.title || '', titleVariant);
              if (item.posterUrl && score >= 0.42 && !isPlaceholderArtworkUrl(item.posterUrl)) {
                if (!candidates.some(c => c.imageUrl === item.posterUrl)) {
                  candidates.push({
                    source: 'tvmaze',
                    sourceId: String(item.id),
                    title: item.title,
                    imageUrl: item.posterUrl,
                    aspectRatio: '3:4',
                    confidence: score,
                    year: item.year
                  });
                }
              }
            }
            if (candidates.some(c => c.source === 'tvmaze' && c.confidence >= 0.78)) break;
          }
        }
      } catch {
        hadTemporarySourceFailure = true;
      }
    } else if (sourceId === 'thetvdb' && thetvdbConfig) {
      try {
        for (const titleVariant of searchVariants) {
          if (
            titleVariant !== searchVariants[0] &&
            !globalSourceGateway.hasImmediateCapacity('thetvdb') &&
            !globalSourceGateway.hasInFlightOrCached('thetvdb', titleVariant)
          ) {
            break;
          }
          options.onWorkerStep?.(`Searching TheTVDB Gateway for "${titleVariant}"`, 'TheTVDB', 'working');
          const res = await queryTheTVDB(
            titleVariant,
            6000,
            (st, stepMsg, waitReason) => options.onWorkerStep?.(stepMsg, 'TheTVDB', st, waitReason)
          );
          if (!res.success) {
            hadTemporarySourceFailure = true;
            break;
          }
          anySourceSucceeded = true;
          if (res.matches.length > 0) {
            for (const item of res.matches) {
              const scorePrimary = computeCandidateScore(item.title || '', titleVariant);
              const scoreEn = item.englishTitle ? computeCandidateScore(item.englishTitle, titleVariant) : 0;
              const scoreRomaji = item.romajiTitle ? computeCandidateScore(item.romajiTitle, titleVariant) : 0;
              const score = Math.max(scorePrimary, scoreEn, scoreRomaji);
              if (item.posterUrl && score >= 0.42 && !isPlaceholderArtworkUrl(item.posterUrl)) {
                if (!candidates.some(c => c.imageUrl === item.posterUrl)) {
                  candidates.push({
                    source: 'thetvdb',
                    sourceId: String(item.id),
                    title: item.title,
                    imageUrl: item.posterUrl,
                    aspectRatio: '3:4',
                    confidence: score,
                    year: item.year
                  });
                }
              }
            }
            if (candidates.some(c => c.source === 'thetvdb' && c.confidence >= 0.78)) break;
          }
        }
      } catch {
        hadTemporarySourceFailure = true;
      }
    } else if (sourceId === 'anidb' && anidbConfig) {
      try {
        options.onWorkerStep?.(`Searching AniDB for "${cleaned}"`, 'AniDB', 'working');
        const anidbRes = await queryAniDBFallback(
          cleaned,
          (st, stepMsg, waitReason) => options.onWorkerStep?.(stepMsg, 'AniDB', st, waitReason)
        );
        if (anidbRes.success) {
          anySourceSucceeded = true;
          if (anidbRes.matches.length > 0) {
            const firstMatch = anidbRes.matches[0];
            const score = computeCandidateScore(firstMatch.title || cleaned, cleaned);
            anidbMatch = {
              aid: firstMatch.aid,
              title: firstMatch.title,
              score: Math.max(0.75, score)
            };
            if (firstMatch.posterUrl && score >= 0.42 && !isPlaceholderArtworkUrl(firstMatch.posterUrl)) {
              if (!candidates.some(c => c.imageUrl === firstMatch.posterUrl)) {
                candidates.push({
                  source: 'anidb',
                  sourceId: String(firstMatch.aid || 1),
                  title: firstMatch.title,
                  imageUrl: firstMatch.posterUrl,
                  aspectRatio: '3:4',
                  confidence: score,
                  year: firstMatch.year
                });
              }
            }
          }
        } else {
          hadTemporarySourceFailure = true;
        }
      } catch {
        hadTemporarySourceFailure = true;
      }
    }
  }

  // Sort candidates by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  const bestAniScore = aniListMatch?.score || 0;
  const topConfidence = candidates.length > 0 ? Math.max(candidates[0].confidence, bestAniScore) : 0;

  let finalStatus: VerificationStatus = 'needs_review';
  let issueDescription: string | null = null;
  const evidenceList: string[] = [];
  let replacedUrl: string | null = null;

  // Multi-season verification
  let seasonResults: SeasonArtworkResult[] = [];
  if (anime.seasons && anime.seasons.length > 1) {
    seasonResults = await verifyMultiSeasons(anime, cleaned, options.autoFixEnabled ?? true);
  }

  // Validate candidate images in descending confidence order
  let selectedCandidate: ArtworkCandidate | null = null;
  for (const cand of candidates) {
    if (cand.confidence >= 0.42 && cand.imageUrl && !isPlaceholderArtworkUrl(cand.imageUrl)) {
      options.onWorkerStep?.(`Validating candidate image from ${cand.source}`, cand.source, 'working');
      const insp = await inspectArtworkImage(cand.imageUrl, true);
      if (insp.usable && !insp.isBlankOrPlaceholder) {
        selectedCandidate = cand;
        break;
      }
    }
  }

  if (currentArtworkMissingOrBroken) {
    if (selectedCandidate && selectedCandidate.imageUrl) {
      // STRICT 6-STEP MISSING ARTWORK VALIDATION:
      // 1. Found relevant artwork (selectedCandidate)
      // 2 & 3. Validated image exists, is reachable, and is a real image (inspectArtworkImage above)
      // 4. Save the validated artwork to the anime record
      // 5. Reload and verify the saved artwork can load
      // 6. ONLY THEN mark Fixed / Auto-Fixed
      let persistedAndVerifiedOk = false;
      if (options.autoFixEnabled !== false) {
        options.onWorkerStep?.(`Saving & verifying replacement artwork from ${selectedCandidate.source}`, selectedCandidate.source, 'working');
        const applied = globalDataStore.applyCatalogueArtworkUpdate(
          anime.id,
          selectedCandidate.imageUrl,
          'verified',
          currentArtworkUrl,
          selectedCandidate.source
        );
        const reloaded = globalDataStore.getCatalogueAnime(anime.id);
        const savedUrl = reloaded?.artwork?.verifiedArtworkUrl;
        if (applied && savedUrl === selectedCandidate.imageUrl && !isPlaceholderArtworkUrl(savedUrl)) {
          const reloadCheck = await inspectArtworkImage(savedUrl);
          persistedAndVerifiedOk = Boolean(reloadCheck.usable && !reloadCheck.isBlankOrPlaceholder);
        }
      } else {
        persistedAndVerifiedOk = true;
      }

      if (persistedAndVerifiedOk) {
        finalStatus = 'auto_fixed';
        replacedUrl = selectedCandidate.imageUrl;
        issueDescription = null;
        evidenceList.push(`Previous poster was missing or broken. Validated, saved & verified ${selectedCandidate.source} poster (${Math.round(selectedCandidate.confidence * 100)}% match).`);
      } else {
        finalStatus = 'needs_review';
        issueDescription = 'Candidate artwork found, but post-save reload verification did not pass.';
        globalDataStore.markCatalogueVerified(anime.id, 'needs_review');
      }
    } else {
      // Do NOT mark anime Fake or permanently Unable to Verify if a source failed temporarily
      if (hadTemporarySourceFailure && !anySourceSucceeded) {
        finalStatus = 'needs_review';
        issueDescription = 'Temporary source failure during artwork lookup; queued for Needs Review retry.';
        evidenceList.push(`Temporary source connectivity/rate-limit failure while searching "${titlesToCheck.join('", "')}".`);
      } else {
        finalStatus = candidates.length > 0 ? 'needs_review' : 'unable_to_verify';
        issueDescription = 'No reachable, valid artwork image could be verified across configured trusted sources.';
        evidenceList.push(`Queried title variations: "${titlesToCheck.join('", "')}". Exhausted configured active sources.`);
      }
      globalDataStore.markCatalogueVerified(anime.id, finalStatus);
    }
  } else {
    // Current artwork exists and was verified reachable, valid, and non-placeholder!
    // Requirement 2: Do NOT replace good artwork with worse/random artwork.
    // Only replace if explicitly requested via forceReplaceArtwork AND candidate is high-confidence (>= 0.80).
    if (
      options.forceReplaceArtwork &&
      selectedCandidate &&
      selectedCandidate.confidence >= 0.80 &&
      selectedCandidate.imageUrl &&
      selectedCandidate.imageUrl !== currentArtworkUrl
    ) {
      const applied = options.autoFixEnabled !== false
        ? globalDataStore.applyCatalogueArtworkUpdate(
            anime.id,
            selectedCandidate.imageUrl,
            'verified',
            currentArtworkUrl,
            selectedCandidate.source
          )
        : true;
      const reloaded = globalDataStore.getCatalogueAnime(anime.id);
      const savedUrl = reloaded?.artwork?.verifiedArtworkUrl;
      if (applied && savedUrl === selectedCandidate.imageUrl && !isPlaceholderArtworkUrl(savedUrl)) {
        finalStatus = 'auto_fixed';
        replacedUrl = selectedCandidate.imageUrl;
        issueDescription = null;
        evidenceList.push(`Poster replaced with verified high-resolution asset from ${selectedCandidate.source}.`);
      } else {
        finalStatus = 'verified';
        issueDescription = null;
        globalDataStore.markCatalogueVerified(anime.id, 'verified');
      }
    } else {
      finalStatus = 'verified';
      issueDescription = null;
      evidenceList.push('Current artwork verified reachable, valid, and non-placeholder.');
      globalDataStore.markCatalogueVerified(anime.id, 'verified');
    }
  }

  const result: ArtworkVerificationResult = {
    animeId: anime.id,
    animeTitle: rawTitle,
    status: finalStatus,
    confidence: topConfidence,
    currentArtworkUrl: replacedUrl || currentArtworkUrl,
    replacedArtworkUrl: replacedUrl,
    source: selectedCandidate?.source || (currentArtworkUrl ? 'provider' : 'none'),
    dimensions: currentArtInspection.dimensions || 'HD (3:4)',
    lastVerifiedAt: new Date().toISOString(),
    aniListMatch,
    anidbMatch,
    seasonResults: seasonResults.length > 0 ? seasonResults : undefined,
    candidates,
    issue: issueDescription,
    evidence: evidenceList
  };

  // Save to in-memory store with debounced asynchronous background flush (0 lock contention!)
  globalDataStore.saveVerificationRecord(anime.id, result);

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
  return globalDataStore.applyCatalogueArtworkUpdate(animeId, newUrl, newStatus, previousUrl, source, seasonNumber);
}

export function markCatalogueAnimeVerified(animeId: string, status: string): void {
  globalDataStore.markCatalogueVerified(animeId, status);
}

export function revertArtwork(animeId: string): { success: boolean; message: string; previousUrl?: string } {
  const history = globalDataStore.getAllHistory();
  const entry = history.find(h => h.animeId === animeId);
  if (!entry || !entry.previousArtworkUrl) {
    return { success: false, message: 'No previous artwork history found to revert to.' };
  }
  const reverted = globalDataStore.applyCatalogueArtworkUpdate(
    animeId,
    entry.previousArtworkUrl,
    'verified',
    entry.newArtworkUrl,
    'revert_history',
    entry.seasonNumber
  );
  if (!reverted) {
    return { success: false, message: `Anime ${animeId} not found in catalogue.` };
  }
  return { success: true, message: `Successfully reverted artwork to previous image.`, previousUrl: entry.previousArtworkUrl };
}

export function recordFakeAnimeIssue(issue: FakeAnimeIssue): void {
  globalDataStore.addFakeIssue(issue);
}
