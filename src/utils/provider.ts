import { Anime, Season } from '../types.ts';

/**
 * Centralized Provider Configuration for RareToon India (RareAnimes)
 * Base URL for the new RareToon India website:
 * https://www.rareanimes.mov/home/
 */
export const RARETOON_BASE_URL = 'https://www.rareanimes.mov/home/';
export const RARETOON_PROVIDER_NAME = 'RareAnimes';
export const RARETOON_LEGACY_NAME = 'RareToon India';

// Map of canonical exact URLs on the new RareToon (rareanimes.mov) website
export const KNOWN_RAREANIMES_EXACT_MAP: Record<string, string> = {
  'anivault_rt_solo_leveling': 'https://www.rareanimes.mov/hindi/solo-leveling-season-1-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_mushoku_tensei': 'https://www.rareanimes.mov/hindi/mushoku-tensei-jobless-reincarnation-season-3-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_that_time_i_got_reincarnated_as_a_slime': 'https://www.rareanimes.mov/hindi/that-time-i-got-reincarnated-as-a-slime-season-4-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_naruto': 'https://www.rareanimes.mov/hindi/naruto-season-1-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_naruto_shippuden': 'https://www.rareanimes.mov/hindi/naruto-shippuden-season-01-episodes-hindi-dubbed-download-hd/',
  'anivault_rt_daemons_of_the_shadow_realm': 'https://www.rareanimes.mov/hindi/daemons-of-the-shadow-realm-season-1-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_kaiju_no_8': 'https://www.rareanimes.mov/hindi/kaiju-no-8-narumis-week-at-work-shorts-episodes-download-hd/',
  'anivault_rt_tomb_raider_king': 'https://www.rareanimes.mov/hindi/tomb-raider-king-season-1-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_jojos_bizarre_adventure': 'https://www.rareanimes.mov/hindi/jojos-bizarre-adventure-season-3-diamond-is-unbreakable-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_welcome_to_demon_school_iruma_kun': 'https://www.rareanimes.mov/hindi/welcome-to-demon-school-iruma-kun-season-3-hindi-dubbed-episodes-download-hd/',
  'anivault_rt_hanaori_san': 'https://www.rareanimes.mov/hindi/hanaori-san-still-wants-to-fight-in-the-next-life-season-1-hindi-dubbed-episodes-download-hd/'
};

/**
 * Checks if a given URL is a verified destination on the new RareToon site
 */
export function isVerifiedNewRareToonUrl(url?: string): boolean {
  if (!url) return false;
  return url.startsWith('https://www.rareanimes.mov/') || url.startsWith('https://rareanimes.mov/');
}

/**
 * Resolves the watch destination URL for an anime or selected season.
 * Guarantees that:
 * 1. If an exact verified deep link on rareanimes.mov exists, it is returned with isAvailable = true and isExact = true.
 * 2. If the exact title cannot be verified on RareAnimes, returns isAvailable = false, url = null, and label = 'Not available'.
 * 3. Never returns an old raretoonindia.in link or a fabricated/guessed URL.
 */
export function resolveWatchUrl(anime: Anime, selectedSeasonNumber?: number): {
  url: string | null;
  isAvailable: boolean;
  isExact: boolean;
  label: string;
} {
  // 1. If a season is selected, check that season's canonicalUrl
  if (selectedSeasonNumber) {
    const season = anime.seasons?.find(s => s.seasonNumber === selectedSeasonNumber);
    if (season?.canonicalUrl && isVerifiedNewRareToonUrl(season.canonicalUrl) && !season.canonicalUrl.includes('/home/')) {
      return {
        url: season.canonicalUrl,
        isAvailable: true,
        isExact: true,
        label: `${season.title || `Season ${season.seasonNumber}`} on RareAnimes`
      };
    }
  }

  // 2. Check the anime's primary provider canonical URL
  const primaryUrl = anime.providers?.raretoonIndia?.canonicalUrl;
  if (primaryUrl && isVerifiedNewRareToonUrl(primaryUrl) && !primaryUrl.includes('/home/')) {
    return {
      url: primaryUrl,
      isAvailable: true,
      isExact: true,
      label: `${anime.title} on RareAnimes`
    };
  }

  // 3. Check known exact mapping dictionary
  if (KNOWN_RAREANIMES_EXACT_MAP[anime.id]) {
    return {
      url: KNOWN_RAREANIMES_EXACT_MAP[anime.id],
      isAvailable: true,
      isExact: true,
      label: `${anime.title} on RareAnimes`
    };
  }

  // 4. Strict "Not available" when exact title cannot be verified
  return {
    url: null,
    isAvailable: false,
    isExact: false,
    label: 'Not available on RareAnimes'
  };
}

/**
 * Calculate authoritative total anime episodes across all seasons.
 * Never conflates partial imported episode count with authoritative total episode count.
 */
export function calculateTotalEpisodes(anime: Anime): number | null {
  if (anime.authoritativeTotalEpisodes !== undefined) {
    return typeof anime.authoritativeTotalEpisodes === 'number' && anime.authoritativeTotalEpisodes > 0
      ? anime.authoritativeTotalEpisodes
      : null;
  }
  if (anime.authoritativeEpisodeCount !== undefined) {
    return typeof anime.authoritativeEpisodeCount === 'number' && anime.authoritativeEpisodeCount > 0
      ? anime.authoritativeEpisodeCount
      : null;
  }
  if (anime.totalEpisodes !== undefined) {
    return typeof anime.totalEpisodes === 'number' && anime.totalEpisodes > 0
      ? anime.totalEpisodes
      : null;
  }
  if (!anime.seasons || anime.seasons.length === 0) return null;
  let total = 0;
  for (const s of anime.seasons) {
    const seasonAuth = calculateSeasonEpisodes(s);
    if (seasonAuth === null) return null;
    total += seasonAuth;
  }
  return total > 0 ? total : null;
}

/**
 * Calculate authoritative episode count for a specific season.
 * Returns null if authoritative episode count is unknown/undetermined (never falls back to imported episodes.length).
 */
export function calculateSeasonEpisodes(season?: Season): number | null {
  if (!season) return null;
  if (season.authoritativeEpisodeCount !== undefined) {
    return typeof season.authoritativeEpisodeCount === 'number' && season.authoritativeEpisodeCount > 0
      ? season.authoritativeEpisodeCount
      : null;
  }
  if (typeof season.episodeCount === 'number' && season.episodeCount > 0) {
    return season.episodeCount;
  }
  return null;
}

/**
 * Calculate real imported episode records count for a specific season.
 * Never invents episodes.
 */
export function calculateSeasonImportedEpisodes(season?: Season): number {
  if (!season) return 0;
  if (Array.isArray(season.episodes)) {
    return season.episodes.length;
  }
  if (typeof season.importedEpisodeCount === 'number' && season.importedEpisodeCount >= 0) {
    return season.importedEpisodeCount;
  }
  return 0;
}

/**
 * Calculate total real imported episode records across the entire anime.
 */
export function calculateImportedEpisodes(anime: Anime): number {
  if (Array.isArray(anime.seasons) && anime.seasons.length > 0) {
    return anime.seasons.reduce((sum, s) => sum + calculateSeasonImportedEpisodes(s), 0);
  }
  if (typeof anime.importedEpisodesCount === 'number' && anime.importedEpisodesCount >= 0) {
    return anime.importedEpisodesCount;
  }
  if (typeof anime.importedEpisodeCount === 'number' && anime.importedEpisodeCount >= 0) {
    return anime.importedEpisodeCount;
  }
  return 0;
}

/**
 * Determine the episode list completeness status for a season while keeping
 * authoritative episode count and imported episode records strictly separate.
 */
export function getSeasonEpisodeStatus(season?: Season): 'complete' | 'partial' | 'empty' | 'unknown' {
  if (!season) return 'unknown';
  const imported = calculateSeasonImportedEpisodes(season);
  const authoritative = calculateSeasonEpisodes(season);

  if (imported === 0) {
    return 'empty';
  }
  if (authoritative !== null) {
    return imported >= authoritative ? 'complete' : 'partial';
  }
  if (season.episodeListStatus) {
    return season.episodeListStatus;
  }
  if (season.episodeImportStatus) {
    return season.episodeImportStatus;
  }
  if (season.isEpisodeListComplete === true) {
    return 'complete';
  }
  return 'partial';
}

/**
 * Resolve verified available languages for an anime without inventing values.
 */
export function resolveAnimeLanguages(anime: Anime): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const addLang = (val?: string | null) => {
    if (!val) return;
    const trimmed = val.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  };

  if (Array.isArray(anime.languages)) {
    for (const lang of anime.languages) {
      addLang(lang);
    }
  }

  const dubLang = anime.providers?.raretoonIndia?.dubLanguage;
  if (dubLang && dubLang.trim().length > 0) {
    addLang(dubLang);
  }

  return result;
}

export interface ResolvedRelatedAnimeItem {
  rawLabel: string;
  title: string;
  relationType: string | null;
  formatHint: string | null;
  matchedAnime: Anime | null;
}

/**
 * Resolves related anime entries from verified catalogue data (franchiseRelationships & relatedAnime)
 * and links any entry that exists in the Zenime catalogue so users can navigate directly to it.
 * Never invents related anime.
 */
export function resolveRelatedAnimeItems(anime: Anime, catalogue: Anime[] = []): ResolvedRelatedAnimeItem[] {
  const items: ResolvedRelatedAnimeItem[] = [];
  const seenKeys = new Set<string>();

  const normalizeTitle = (str?: string | null) =>
    (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const findCatalogueMatch = (candidateTitle: string): Anime | null => {
    const norm = normalizeTitle(candidateTitle);
    if (!norm) return null;
    for (const item of catalogue) {
      if (item.id === anime.id) continue;
      if (
        normalizeTitle(item.title) === norm ||
        normalizeTitle(item.alternateTitle) === norm ||
        normalizeTitle(item.japaneseTitle) === norm
      ) {
        return item;
      }
    }
    return null;
  };

  if (Array.isArray(anime.franchiseRelationships)) {
    for (const rel of anime.franchiseRelationships) {
      if (!rel || typeof rel !== 'string') continue;
      const trimmed = rel.trim();
      if (!trimmed) continue;

      let relationType: string | null = null;
      let rest = trimmed;
      const prefixMatch = trimmed.match(/^([A-Z_ ]+):\s*(.+)$/);
      if (prefixMatch) {
        relationType = prefixMatch[1].replace(/_/g, ' ').trim();
        rest = prefixMatch[2].trim();
      }

      let formatHint: string | null = null;
      let cleanTitle = rest;
      const formatMatch = rest.match(/^(.+?)\s*\((TV_SHORT|TV|MOVIE|OVA|ONA|SPECIAL|MUSIC)\)$/i);
      if (formatMatch) {
        cleanTitle = formatMatch[1].trim();
        formatHint = formatMatch[2].replace(/_/g, ' ').toUpperCase();
      }

      const dedupeKey = normalizeTitle(cleanTitle) || trimmed.toLowerCase();
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      items.push({
        rawLabel: trimmed,
        title: cleanTitle,
        relationType,
        formatHint,
        matchedAnime: findCatalogueMatch(cleanTitle)
      });
    }
  }

  if (Array.isArray(anime.relatedAnime)) {
    for (const relTitle of anime.relatedAnime) {
      if (!relTitle || typeof relTitle !== 'string') continue;
      const cleanTitle = relTitle.trim();
      if (!cleanTitle) continue;
      const dedupeKey = normalizeTitle(cleanTitle) || cleanTitle.toLowerCase();
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      items.push({
        rawLabel: cleanTitle,
        title: cleanTitle,
        relationType: null,
        formatHint: null,
        matchedAnime: findCatalogueMatch(cleanTitle)
      });
    }
  }

  return items;
}

/**
 * Returns the canonical Zenime relative route path for an anime details page:
 * /anime/{anime-id}
 */
export function getAnimeDetailsPath(animeId: string): string {
  const cleanId = (animeId || '').trim();
  return `/anime/${encodeURIComponent(cleanId)}`;
}

/**
 * Returns the full shareable Zenime Anime Details URL:
 * {origin}/anime/{anime-id}
 */
export function getAnimeShareUrl(animeId: string, origin?: string): string {
  const baseOrigin =
    origin ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://zenime.local');
  return `${baseOrigin.replace(/\/+$/, '')}${getAnimeDetailsPath(animeId)}`;
}

/**
 * Parses a canonical /anime/{anime-id} route (or ?anime={anime-id} / #/anime/{anime-id})
 * from browser location values.
 */
export function parseAnimeIdFromLocation(
  pathname: string,
  search: string = '',
  hash: string = ''
): string | null {
  if (typeof pathname === 'string') {
    const pathMatch = pathname.match(/^\/anime\/([^/?#]+)\/?$/i);
    if (pathMatch && pathMatch[1]) {
      try {
        return decodeURIComponent(pathMatch[1]).trim() || null;
      } catch {
        return pathMatch[1].trim() || null;
      }
    }
  }

  if (typeof hash === 'string' && hash.length > 1) {
    const hashMatch = hash.match(/^#\/?anime\/([^/?#]+)\/?$/i);
    if (hashMatch && hashMatch[1]) {
      try {
        return decodeURIComponent(hashMatch[1]).trim() || null;
      } catch {
        return hashMatch[1].trim() || null;
      }
    }
  }

  if (typeof search === 'string' && search.length > 1) {
    try {
      const params = new URLSearchParams(search);
      const fromQuery = params.get('anime');
      if (fromQuery && fromQuery.trim().length > 0) {
        return fromQuery.trim();
      }
    } catch {}
  }

  return null;
}

/**
 * Copies text to clipboard using Clipboard API with a DOM textarea fallback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea fallback
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textArea);
      return copied;
    } catch {
      return false;
    }
  }

  return false;
}

