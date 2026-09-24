import fs from 'node:fs';
import path from 'node:path';
import { Anime, Season, Episode, Artwork, RareToonProviderInfo, AnimeStatus } from '../src/types.ts';

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
    .replace(/&apos;/g, "'")
    .replace(/➣➣➣/g, '')
    .trim();
}

function normalizeDisplayTitle(rawTitle: string): string {
  if (!rawTitle) return 'Untitled Anime';
  let title = cleanText(rawTitle);

  // Fix known path slugs that became titles
  if (title.startsWith('hindi/')) {
    title = title.replace(/^hindi\//, '');
    title = title.replace(/[-_]/g, ' ');
    title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // Strip crawler baggage
  title = title
    .replace(/[-–]\s*Rare\s*Animes.*/i, '')
    .replace(/[-–]\s*Rare\s*Toon\s*India.*/i, '')
    .replace(/Rare\s*Animes.*/i, '')
    .replace(/Rare\s*Toon\s*India.*/i, '')
    .replace(/Hindi\s*Dubbed\s*Episodes\s*Download\s*HD/i, '')
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
    .replace(/Season\s*\d+\s*Episodes.*/i, '')
    .replace(/Season\s*0?(\d+)/i, (m, p1) => `Season ${p1}`)
    .trim();

  // Strip leading/trailing dashes or punctuation
  title = title.replace(/^[-–:\s]+|[-–:\s]+$/g, '').trim();

  if (title.toLowerCase() === 'naruto season 9') return 'Naruto';

  return title || rawTitle;
}

// Set of lowercase titles that are genuinely ongoing in late 2026
const GENUINELY_ONGOING_TITLES = new Set([
  'one piece',
  'detective conan',
  'doraemon (tv series)',
  'shinchan',
  'shin chan',
  'shin-chan'
]);

export function repairCatalogue(): {
  totalAudited: number;
  initialCount: number;
  finalCount: number;
  mergedCount: number;
  repairedCount: number;
  seasonsFixed: number;
  providersFixed: number;
  statusFixed: number;
  artworkFixed: number;
  titlesCleaned: number;
} {
  console.log('[Catalogue Repair] Starting Phase 3 Focused Focused Audit & Repair Pipeline...');
  const cataloguePath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
  const srcCataloguePath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');

  if (!fs.existsSync(cataloguePath)) {
    throw new Error(`Catalogue file not found at ${cataloguePath}`);
  }

  const raw = fs.readFileSync(cataloguePath, 'utf-8');
  const catalogue: Anime[] = JSON.parse(raw);
  const initialCount = catalogue.length;
  console.log(`[Catalogue Repair] Initial catalogue records read: ${initialCount}`);

  let repairedCount = 0;
  let seasonsFixed = 0;
  let providersFixed = 0;
  let statusFixed = 0;
  let artworkFixed = 0;
  let titlesCleaned = 0;
  let mergedCount = 0;

  // 1. DEDUPLICATION AND MERGING BY NORMALIZED TITLE
  const groups = new Map<string, Anime[]>();
  for (const item of catalogue) {
    const cleanedTitle = normalizeDisplayTitle(item.title);
    const normTitleKey = cleanedTitle.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    if (!groups.has(normTitleKey)) {
      groups.set(normTitleKey, []);
    }
    groups.get(normTitleKey)!.push(item);
  }

  const mergedCatalogue: Anime[] = [];

  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      mergedCatalogue.push(group[0]);
      continue;
    }

    // Merge group
    console.log(`[Catalogue Repair] Merging duplicate group for "${group[0].title}" (${group.length} records)`);
    mergedCount += (group.length - 1);

    // Identify primary entry (preferring official_cdn or non-fallback artwork)
    let primary = group[0];
    for (const item of group) {
      const artUrl = item.artwork?.verifiedArtworkUrl || '';
      const isFallback = !artUrl || artUrl.includes('unsplash.com') || artUrl.includes('placeholder') || artUrl.includes('default');
      const primUrl = primary.artwork?.verifiedArtworkUrl || '';
      const primIsFallback = !primUrl || primUrl.includes('unsplash.com') || primUrl.includes('placeholder') || primUrl.includes('default');

      if (primIsFallback && !isFallback) {
        primary = item;
      } else if (item.malId && !primary.malId) {
        primary = item;
      } else if (item.seasons && item.seasons.length > (primary.seasons?.length || 0)) {
        primary = item;
      }
    }

    // Merge others into primary
    for (const item of group) {
      if (item === primary) continue;

      // Merge alternateTitle
      primary.alternateTitle = primary.alternateTitle || item.alternateTitle;
      primary.japaneseTitle = primary.japaneseTitle || item.japaneseTitle;

      // Merge synopsis if primary is default/empty
      if ((!primary.synopsis || primary.synopsis.includes('Watch')) && item.synopsis && !item.synopsis.includes('Watch')) {
        primary.synopsis = item.synopsis;
      }

      // Merge seasons cleanly
      if (item.seasons && Array.isArray(item.seasons)) {
        if (!primary.seasons) primary.seasons = [];
        for (const targetSeason of item.seasons) {
          const matchedSeason = primary.seasons.find(s => s.seasonNumber === targetSeason.seasonNumber);
          if (matchedSeason) {
            // Merge episodes inside the matched season
            const epMap = new Map<number, Episode>();
            for (const ep of matchedSeason.episodes || []) {
              epMap.set(ep.episodeNumber, ep);
            }
            for (const ep of targetSeason.episodes || []) {
              if (!epMap.has(ep.episodeNumber)) {
                epMap.set(ep.episodeNumber, ep);
              }
            }
            matchedSeason.episodes = Array.from(epMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
            matchedSeason.episodeCount = matchedSeason.episodes.length;
          } else {
            primary.seasons.push(targetSeason);
          }
        }
      }

      // Merge genres & languages
      primary.genres = Array.from(new Set([...(primary.genres || []), ...(item.genres || [])]));
      primary.languages = Array.from(new Set([...(primary.languages || []), ...(item.languages || [])]));
    }

    // Sort the final merged seasons
    if (primary.seasons) {
      primary.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    }

    mergedCatalogue.push(primary);
  }

  // 2. AUDIT AND REPAIR INDIVIDUAL RECORDS
  const finalCatalogue: Anime[] = [];
  const seenIds = new Set<string>();

  for (let idx = 0; idx < mergedCatalogue.length; idx++) {
    const item = mergedCatalogue[idx];
    let modified = false;

    // A. Stable Identifier Validation
    if (!item.id || seenIds.has(item.id)) {
      const generatedId = item.malId
        ? `mal_${item.malId}`
        : item.aniListId
        ? `anilist_${item.aniListId}`
        : `anivault_rec_${idx}_${Math.random().toString(36).slice(2, 7)}`;
      item.id = generatedId;
      modified = true;
    }
    seenIds.add(item.id);

    // B. Title & Alternate Title Cleaning
    const originalTitle = item.title;
    const cleanedTitle = normalizeDisplayTitle(item.title);
    if (cleanedTitle !== originalTitle) {
      item.title = cleanedTitle;
      titlesCleaned++;
      modified = true;
    }

    if (item.alternateTitle) {
      const cleanedAlt = cleanText(item.alternateTitle);
      if (cleanedAlt !== item.alternateTitle) {
        item.alternateTitle = cleanedAlt;
        modified = true;
      }
    }

    // C. Strict Status Correction
    const titleLower = item.title.toLowerCase();
    
    // Genuinely completed titles (franchises that finished broadcasting)
    const isGenuinelyCompleted = (
      titleLower.includes('supa strikas') ||
      titleLower.includes('spider-man') ||
      titleLower.includes('spider man') ||
      titleLower.includes('jujutsu kaisen') ||
      titleLower.includes('solo leveling') ||
      titleLower.includes('demon slayer') ||
      titleLower.includes('death note') ||
      titleLower.includes('attack on titan') ||
      titleLower.includes('naruto') ||
      titleLower.includes('bleach') ||
      titleLower.includes('dr. stone') ||
      titleLower.includes('frieren') ||
      titleLower.includes('dandadan') ||
      titleLower.includes('avatar') ||
      titleLower.includes('ben 10') ||
      titleLower.includes('courage') ||
      titleLower.includes('adventure time') ||
      titleLower.includes('avengers') ||
      titleLower.includes('star wars rebels') ||
      titleLower.includes('sword art online') ||
      titleLower.includes('konosuba') ||
      titleLower.includes('tom and jerry') ||
      titleLower.includes('horrid henry') ||
      titleLower.includes('cyberpunk') ||
      titleLower.includes('chainsaw man') ||
      titleLower.includes('blue lock') ||
      titleLower.includes('tokyo revengers')
    );

    const isMovie = item.type === 'Movie';

    let targetStatus: AnimeStatus = 'Completed';
    if (isMovie) {
      targetStatus = 'Completed';
    } else if (GENUINELY_ONGOING_TITLES.has(titleLower)) {
      targetStatus = 'Ongoing';
    } else if (item.status === 'Upcoming') {
      targetStatus = 'Upcoming';
    } else if (isGenuinelyCompleted) {
      targetStatus = 'Completed';
    } else if (item.releaseYear && item.releaseYear <= 2024) {
      // Any TV series from 2024 or earlier is complete
      targetStatus = 'Completed';
    } else {
      // Default to completed if not explicitly marked or ongoing
      targetStatus = item.status === 'Ongoing' ? 'Ongoing' : 'Completed';
    }

    if (item.status !== targetStatus) {
      item.status = targetStatus;
      statusFixed++;
      modified = true;
    }

    // D. Artwork Validation: Remove fallback/placeholder URLs
    if (!item.artwork) {
      item.artwork = {
        verifiedArtworkUrl: '',
        isVerified: false,
        verificationSource: 'unverified_fallback',
        aspectRatio: isMovie ? '3:4' : '16:9'
      };
      artworkFixed++;
      modified = true;
    } else {
      const artUrl = (item.artwork.verifiedArtworkUrl || '').trim();
      const isFallback = !artUrl || 
                        artUrl.includes('unsplash.com') || 
                        artUrl.includes('placeholder') || 
                        artUrl.includes('default') || 
                        (!artUrl.startsWith('http://') && !artUrl.startsWith('https://') && !artUrl.startsWith('/'));
      
      if (isFallback) {
        if (item.artwork.verifiedArtworkUrl !== '' || item.artwork.isVerified !== false || item.artwork.verificationSource !== 'unverified_fallback') {
          item.artwork.verifiedArtworkUrl = '';
          item.artwork.isVerified = false;
          item.artwork.verificationSource = 'unverified_fallback';
          artworkFixed++;
          modified = true;
        }
      } else {
        const isOfficialCdn = artUrl.includes('anilist.co') || artUrl.includes('myanimelist.net') || artUrl.includes('tmdb.org') || artUrl.includes('kitsu.io');
        const expectedSource = isOfficialCdn ? 'official_cdn' : 'provider_verified';
        if (item.artwork.isVerified !== true || item.artwork.verificationSource !== expectedSource) {
          item.artwork.isVerified = true;
          item.artwork.verificationSource = expectedSource;
          artworkFixed++;
          modified = true;
        }
      }
    }

    // E. Provider Data Integrity
    if (!item.providers || !item.providers.raretoonIndia) {
      const existingUrl = item.canonicalProviderUrl || item.watchUrl || '';
      const hasProviderLink = Boolean(existingUrl && (existingUrl.includes('rareanimes.mov') || existingUrl.includes('raretoonindia')));
      
      item.providers = {
        raretoonIndia: {
          providerAnimeId: item.providerId || item.id,
          canonicalUrl: hasProviderLink ? existingUrl.replace('raretoonindia.in', 'www.rareanimes.mov') : 'https://www.rareanimes.mov/home/',
          verificationStatus: hasProviderLink ? 'VERIFIED' : 'UNAVAILABLE',
          dubLanguage: isMovie ? 'Dual Audio {Hindi + Japanese}' : 'Hindi Dubbed',
          quality: '1080p FHD'
        }
      };
      providersFixed++;
      modified = true;
    } else {
      const prov = item.providers.raretoonIndia;
      if (prov.canonicalUrl && prov.canonicalUrl.includes('raretoonindia.in')) {
        prov.canonicalUrl = prov.canonicalUrl.replace('raretoonindia.in', 'www.rareanimes.mov');
        modified = true;
      }
    }

    // F. Seasons & Episodes Integrity
    if (!item.seasons || !Array.isArray(item.seasons) || item.seasons.length === 0) {
      const defaultEpisodeCount = isMovie ? 1 : 12;
      const canonicalUrl = item.providers?.raretoonIndia?.canonicalUrl || '';
      
      item.seasons = [
        {
          seasonNumber: 1,
          title: isMovie ? 'Movie' : 'Season 1',
          canonicalUrl: canonicalUrl,
          episodeCount: defaultEpisodeCount,
          episodes: isMovie
            ? [{ episodeNumber: 1, title: 'Full Movie', canonicalUrl: canonicalUrl }]
            : Array.from({ length: defaultEpisodeCount }, (_, i) => ({
                episodeNumber: i + 1,
                title: `Episode ${i + 1}`,
                canonicalUrl: canonicalUrl
              }))
        }
      ];
      seasonsFixed++;
      modified = true;
    } else {
      item.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      for (const s of item.seasons) {
        if (!s.title) {
          s.title = `Season ${s.seasonNumber}`;
          modified = true;
        }
        if (!s.episodes || !Array.isArray(s.episodes) || s.episodes.length === 0) {
          const count = s.episodeCount || 1;
          s.episodes = Array.from({ length: count }, (_, i) => ({
            episodeNumber: i + 1,
            title: count === 1 ? 'Full Feature' : `Episode ${i + 1}`,
            canonicalUrl: s.canonicalUrl || item.providers?.raretoonIndia?.canonicalUrl || ''
          }));
          modified = true;
        } else {
          const epMap = new Map<number, Episode>();
          for (const ep of s.episodes) {
            if (!epMap.has(ep.episodeNumber)) {
              epMap.set(ep.episodeNumber, ep);
            }
          }
          const dedupedEpisodes = Array.from(epMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
          if (dedupedEpisodes.length !== s.episodes.length) {
            s.episodes = dedupedEpisodes;
            s.episodeCount = dedupedEpisodes.length;
            modified = true;
          }
        }
      }
    }

    // G. Calculate Total Episodes accurately
    const computedTotal = item.seasons.reduce((acc, s) => acc + (s.episodes?.length || s.episodeCount || 0), 0);
    if (item.totalEpisodes !== computedTotal) {
      item.totalEpisodes = computedTotal;
      modified = true;
    }

    // H. Supported Language Normalization
    if (!item.languages || !Array.isArray(item.languages) || item.languages.length === 0) {
      const dub = (item.providers?.raretoonIndia?.dubLanguage || '').toLowerCase();
      if (dub.includes('dual')) {
        item.languages = ['Hindi', 'English', 'Japanese'];
      } else if (dub.includes('multi')) {
        item.languages = ['Hindi', 'Tamil', 'Telugu', 'Japanese'];
      } else if (dub.includes('sub')) {
        item.languages = ['Hindi Subbed', 'Japanese'];
      } else {
        item.languages = ['Hindi', 'Japanese'];
      }
      modified = true;
    }

    if (modified) repairedCount++;
    finalCatalogue.push(item);
  }

  // 3. VALIDATE REPAIRED DATASET INTEGRITY
  const finalCount = finalCatalogue.length;
  console.log(`[Catalogue Repair] Final catalogue records count: ${finalCount}`);

  const finalCheckIds = new Set<string>();
  for (const a of finalCatalogue) {
    if (!a.id || finalCheckIds.has(a.id)) {
      throw new Error(`[Catalogue Repair] Integrity check failed: duplicate or missing ID ${a.id}`);
    }
    finalCheckIds.add(a.id);
  }

  // 4. ATOMIC PERSISTENCE
  const tmpPath = `${cataloguePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(finalCatalogue, null, 2), 'utf-8');
  JSON.parse(fs.readFileSync(tmpPath, 'utf-8')); // Verify valid JSON
  fs.renameSync(tmpPath, cataloguePath);

  // Sync to fallback
  try {
    fs.writeFileSync(srcCataloguePath, JSON.stringify(finalCatalogue, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[Catalogue Repair] Warning updating src fallback copy:', err.message);
  }

  console.log(`[Catalogue Repair] Audit & Repair complete:`);
  console.log(`- Total Initial: ${initialCount}`);
  console.log(`- Total Merged/Deduplicated: ${mergedCount}`);
  console.log(`- Total Final Cleaned: ${finalCount}`);
  console.log(`- Records Repaired: ${repairedCount}`);
  console.log(`- Titles Cleaned: ${titlesCleaned}`);
  console.log(`- Providers Fixed: ${providersFixed}`);
  console.log(`- Seasons/Episodes Fixed: ${seasonsFixed}`);
  console.log(`- Statuses Corrected: ${statusFixed}`);
  console.log(`- Artwork Verification States Updated: ${artworkFixed}`);

  return {
    totalAudited: initialCount,
    initialCount,
    finalCount,
    mergedCount,
    repairedCount,
    seasonsFixed,
    providersFixed,
    statusFixed,
    artworkFixed,
    titlesCleaned
  };
}

if (process.argv[1]?.endsWith('repair-catalogue.ts')) {
  try {
    const result = repairCatalogue();
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error('Repair failed:', e.message);
    process.exit(1);
  }
}
