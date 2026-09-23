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
 * Calculate total anime episodes across all seasons
 */
export function calculateTotalEpisodes(anime: Anime): number | null {
  if (!anime.seasons || anime.seasons.length === 0) return null;
  let total = 0;
  for (const s of anime.seasons) {
    if (typeof s.episodeCount === 'number' && s.episodeCount > 0) {
      total += s.episodeCount;
    } else if (Array.isArray(s.episodes) && s.episodes.length > 0) {
      total += s.episodes.length;
    }
  }
  return total > 0 ? total : null;
}

/**
 * Calculate episode count for a specific season
 */
export function calculateSeasonEpisodes(season?: Season): number | null {
  if (!season) return null;
  if (typeof season.episodeCount === 'number' && season.episodeCount > 0) {
    return season.episodeCount;
  }
  if (Array.isArray(season.episodes) && season.episodes.length > 0) {
    return season.episodes.length;
  }
  return null;
}
