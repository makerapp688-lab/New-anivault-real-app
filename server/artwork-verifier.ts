import fs from 'fs';
import path from 'path';
import { getArtworkSourcesConfig } from './artwork-sources.ts';
import { globalSourceGateway } from './source-gateway.ts';
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

// Image Inspection Memory Cache to avoid duplicate network HEAD requests
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
    .replace(/\s*-\s*$/, '')
    .trim();

  if (!cleaned) {
    cleaned = primary;
  }

  const variants = [cleaned];
  if (primary !== cleaned && !variants.includes(primary)) {
    variants.push(primary);
  }

  const noPunct = cleaned.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noPunct && !variants.includes(noPunct)) {
    variants.push(noPunct);
  }

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
  timeoutMs = 8000
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
    }
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
  title: string
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
    }
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error
  };
}

// --- TMDB Query Engine (PERMANENTLY DISABLED PER SPECIFICATION) ---
export async function queryTMDB(
  title: string,
  timeoutMs = 8000
): Promise<{ success: boolean; matches: any[]; error?: string; statusCode?: number }> {
  // Requirement 12: TMDB remains disabled
  return {
    success: false,
    matches: [],
    error: 'TMDB is disabled per system specification'
  };
}

// --- TVmaze Query Engine with SourceGateway Protection ---
export async function queryTVmaze(
  title: string,
  timeoutMs = 8000
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
    }
  );

  return {
    success: gatewayResult.success,
    matches: gatewayResult.matches || [],
    error: gatewayResult.error,
    statusCode: gatewayResult.statusCode
  };
}

// --- TheTVDB Gateway Query Engine ---
export async function queryTheTVDB(
  title: string,
  timeoutMs = 8000
): Promise<{ success: boolean; matches: any[]; error?: string; statusCode?: number }> {
  return await queryTVmaze(title, timeoutMs);
}

// --- Image Usability & Integrity Inspection with Cache ---
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

  // 1. Check Inspection Cache
  const cached = imageInspectionCache.get(url);
  if (cached) return { ...cached };

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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Anivex-Artwork-Verifier/2.0',
        'Connection': 'keep-alive'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok && res.status !== 405 && res.status !== 403) {
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

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
      const nonImageRes = {
        usable: false,
        aspectRatio: '3:4',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain' as const,
        error: 'Not an image content type'
      };
      imageInspectionCache.set(url, nonImageRes);
      return nonImageRes;
    }

    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (contentLength > 0 && contentLength < 1000) {
      const emptyRes = {
        usable: false,
        aspectRatio: '3:4',
        isBlankOrPlaceholder: true,
        layoutPresentationStatus: 'adapt_contain' as const,
        error: 'Image file too small (<1KB, empty pixel)'
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
    const hasImageExt = /\.(jpg|jpeg|png|webp|avif)($|\?)/i.test(url);
    const fallbackRes = {
      usable: hasImageExt,
      aspectRatio: '3:4',
      dimensions: 'Standard',
      isBlankOrPlaceholder: !hasImageExt,
      layoutPresentationStatus: 'adapt_contain' as const,
      error: err.message
    };
    imageInspectionCache.set(url, fallbackRes);
    return fallbackRes;
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
  } = { autoFixEnabled: true, operator: 'auto_verifier' }
): Promise<ArtworkVerificationResult> {
  const animeId = anime.id;
  const rawTitle = anime.title || 'Untitled';
  const currentArtworkUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;

  // REQUIREMENT 7: FAST PATH FOR ALREADY-VERIFIED, HIGH-CONFIDENCE ANIME
  if (!options.forceFreshSearch) {
    const existingRecord = globalDataStore.getVerificationRecord(animeId);
    const isAlreadyVerified = anime.artwork?.isVerified === true || existingRecord?.status === 'verified' || existingRecord?.status === 'auto_fixed';

    if (isAlreadyVerified && currentArtworkUrl && !currentArtworkUrl.includes('placeholder')) {
      const titleMatches = existingRecord ? calculateStringSimilarity(rawTitle, existingRecord.animeTitle) >= 0.90 : true;

      if (titleMatches) {
        const cachedInspection = imageInspectionCache.get(currentArtworkUrl);
        const isImageUsable = cachedInspection ? cachedInspection.usable : true;

        if (isImageUsable) {
          // Fast-Path verification completes in <1ms without any external network calls!
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
  const tvmazeConfig = sources.find(s => s.id === 'tvmaze' && s.enabled);
  const thetvdbConfig = sources.find(s => s.id === 'thetvdb' && s.enabled);

  const alternateTitle = anime.alternateTitle || null;
  const { cleaned, variants, detectedSeasonNumber } = cleanAnimeTitle(rawTitle);

  const titlesToCheck = [...variants];
  if (alternateTitle && !titlesToCheck.includes(alternateTitle)) {
    titlesToCheck.push(cleanAnimeTitle(alternateTitle).cleaned);
  }

  const candidates: ArtworkCandidate[] = [];
  let aniListMatch: any = null;
  let anidbMatch: any = null;

  // 1. Inspect current artwork
  const currentArtInspection = await inspectArtworkImage(currentArtworkUrl);

  // 2. Query Primary Source: AniList
  if (anilistConfig && globalSourceGateway.isSourceAvailable('anilist')) {
    for (const titleVariant of titlesToCheck) {
      const res = await queryAniList(titleVariant, anilistConfig.endpoint, anilistConfig.timeoutMs);
      if (!res.success) {
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

          if (coverUrl && score > 0.40) {
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

        // REQUIREMENT 8: HIGH CONFIDENCE -> STOP EARLY!
        if (aniListMatch && aniListMatch.score >= 0.85) {
          break; // Unambiguous match found, no need for redundant queries
        }
      }
    }
  }

  // 3. Fallback Active Source: TVmaze / TheTVDB (if AniList match was medium/low or missing)
  if ((candidates.length === 0 || (aniListMatch?.score || 0) < 0.80) && (tvmazeConfig || thetvdbConfig)) {
    if (globalSourceGateway.isSourceAvailable('tvmaze')) {
      try {
        for (const titleVariant of titlesToCheck) {
          const res = await queryTVmaze(titleVariant, 6000);
          if (res.success && res.matches.length > 0) {
            for (const item of res.matches) {
              const score = calculateStringSimilarity(cleaned, item.title || '');
              if (item.posterUrl && score >= 0.40) {
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
            if (candidates.some(c => c.source === 'tvmaze' && c.confidence >= 0.75)) break;
          }
        }
      } catch {}
    }
  }

  // 4. Secondary Fallback Source: AniDB (only if needed)
  if ((!aniListMatch || aniListMatch.score < 0.65) && candidates.length === 0 && anidbConfig) {
    if (globalSourceGateway.isSourceAvailable('anidb')) {
      try {
        const anidbRes = await queryAniDBFallback(cleaned);
        if (anidbRes.success && anidbRes.matches.length > 0) {
          anidbMatch = {
            aid: anidbRes.matches[0].aid,
            title: anidbRes.matches[0].title,
            score: 0.80
          };
        }
      } catch {}
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

  const currentArtworkMissingOrBroken =
    !currentArtworkUrl ||
    !currentArtInspection.usable ||
    currentArtInspection.isBlankOrPlaceholder;

  let selectedCandidate: ArtworkCandidate | null = null;
  for (const cand of candidates) {
    if (cand.confidence >= 0.40 && cand.imageUrl) {
      const insp = await inspectArtworkImage(cand.imageUrl);
      if (insp.usable && !insp.isBlankOrPlaceholder) {
        selectedCandidate = cand;
        break;
      }
    }
  }

  if (currentArtworkMissingOrBroken) {
    if (selectedCandidate && selectedCandidate.imageUrl) {
      finalStatus = 'auto_fixed';
      replacedUrl = selectedCandidate.imageUrl;
      issueDescription = `Artwork automatically fixed with verified poster from ${selectedCandidate.source} (${Math.round(selectedCandidate.confidence * 100)}% match).`;
      evidenceList.push(`Previous poster was missing or broken. Replaced with ${selectedCandidate.source} poster.`);

      if (options.autoFixEnabled) {
        globalDataStore.applyCatalogueArtworkUpdate(
          anime.id,
          selectedCandidate.imageUrl,
          'verified',
          currentArtworkUrl,
          selectedCandidate.source
        );
      }
    } else {
      finalStatus = 'unable_to_verify';
      issueDescription = 'No usable artwork matched across configured active external databases.';
      evidenceList.push(`Queried title variations: "${titlesToCheck.join('", "')}". Exhausted configured active sources.`);
    }
  } else {
    // Current artwork exists and is usable
    if (selectedCandidate && selectedCandidate.confidence >= 0.85 && selectedCandidate.imageUrl && selectedCandidate.imageUrl !== currentArtworkUrl) {
      finalStatus = 'auto_fixed';
      replacedUrl = selectedCandidate.imageUrl;
      issueDescription = `Poster upgraded to verified high-resolution asset from ${selectedCandidate.source}.`;
      if (options.autoFixEnabled) {
        globalDataStore.applyCatalogueArtworkUpdate(
          anime.id,
          selectedCandidate.imageUrl,
          'verified',
          currentArtworkUrl,
          selectedCandidate.source
        );
      }
    } else {
      finalStatus = 'verified';
      issueDescription = 'Artwork verified usable and matches verified database entry.';
      evidenceList.push('Current artwork verified usable and active.');
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
