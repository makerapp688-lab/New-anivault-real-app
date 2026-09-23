import fs from 'fs';
import path from 'path';

const verifiedRegistry = {
  // 1. Vinland Saga
  'anivault_rt_vinland_saga': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Vinland Saga',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101348-2fhDFPCuMNiz.jpg',
    seasonEpisodes: { 1: 24, 2: 24 }
  },

  // 2. Attack on Titan
  'anivault_rt_attack_on_titan': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2013,
    alternateTitle: 'Shingeki no Kyojin',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-buvcRTBx4NSm.jpg',
    seasonEpisodes: { 1: 25, 2: 12, 3: 22, 4: 28 }
  },

  // 3. Death Note
  'anivault_rt_death_note': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2006,
    alternateTitle: 'Death Note',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1535-kUgkcrfOrkUM.jpg',
    seasonEpisodes: { 1: 37 }
  },

  // 4. Assassination Classroom
  'anivault_rt_assassination_classroom': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2015,
    alternateTitle: 'Ansatsu Kyoushitsu',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20755-dWrhs569YGUO.jpg',
    seasonEpisodes: { 1: 22, 2: 25 }
  },

  // 5. Jujutsu Kaisen
  'anivault_rt_jujutsu_kaisen': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2020,
    alternateTitle: 'Jujutsu Kaisen',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg',
    seasonEpisodes: { 1: 24, 2: 23 }
  },

  // 6. Demon Slayer: Kimetsu no Yaiba
  'anivault_rt_demon_slayer': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Kimetsu no Yaiba',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101922-WBsBl0ClmgYL.jpg',
    seasonEpisodes: { 1: 26, 2: 18, 3: 11, 4: 8 }
  },

  // 7. Solo Leveling
  'anivault_rt_solo_leveling': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Na Honjaman Rebeleop',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx151807-it355ZgzquUd.png',
    seasonEpisodes: { 1: 12, 2: 13 }
  },

  // 8. Frieren: Beyond Journey's End
  'anivault_rt_frieren_beyond_journeys_end': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2023,
    alternateTitle: 'Sousou no Frieren',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg',
    seasonEpisodes: { 1: 28 }
  },

  // 9. Dan Da Dan
  'anivault_rt_dan_da_dan': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Dandadan',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx171018-60q1B6GK2Ghb.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 10. Kaiju No. 8
  'anivault_rt_kaiju_no_8': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Kaijuu 8-gou',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx153288-25FBfFJzEQ5O.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 11. Dr. STONE
  'anivault_rt_dr_stone': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Dr. STONE',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx105333-GybuoSoOZfpH.jpg',
    seasonEpisodes: { 1: 24, 2: 11, 3: 22, 4: 12 }
  },

  // 12. My Hero Academia
  'anivault_rt_my_hero_academia': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Boku no Hero Academia',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21459-nYh85uj2Fuwr.jpg',
    seasonEpisodes: { 1: 13, 2: 25, 3: 25, 4: 25, 5: 25, 6: 25, 7: 21 }
  },

  // 13. Classroom of the Elite
  'anivault_rt_classroom_of_the_elite': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2017,
    alternateTitle: 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx98659-WNyPLIZDpGGY.jpg',
    seasonEpisodes: { 1: 12, 2: 13, 3: 13 }
  },

  // 14. Tokyo Revengers
  'anivault_rt_tokyo_revengers': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Tokyo Revengers',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx120120-cWDmnmeEntSe.jpg',
    seasonEpisodes: { 1: 24, 2: 13, 3: 13 }
  },

  // 15. Baki
  'anivault_rt_baki': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2018,
    alternateTitle: 'Baki (2018)',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx97888-tdZ1r7qN1DRs.jpg',
    seasonEpisodes: { 1: 26 }
  },

  // 16. Baki Hanma
  'anivault_rt_baki_hanma': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Hanma Baki: Son of Ogre',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx124195-5Z1JSrRlbMRe.jpg',
    seasonEpisodes: { 1: 12, 2: 27 }
  },

  // 17. Haikyu!!
  'anivault_rt_haikyu': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2014,
    alternateTitle: 'Haikyuu!!',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20464-ooZUyBe4ptp9.png',
    seasonEpisodes: { 1: 25, 2: 25, 3: 10, 4: 25 }
  },

  // 18. Black Clover
  'anivault_rt_black_clover': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2017,
    alternateTitle: 'Black Clover',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx97940-fyh8o7gNbha0.png',
    seasonEpisodes: { 1: 51, 2: 51, 3: 52, 4: 16 }
  },

  // 19. Gintama
  'anivault_rt_gintama': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2006,
    alternateTitle: 'Gintama',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx918-iOaeBVUn4uK7.jpg',
    seasonEpisodes: { 1: 201 }
  },

  // 20. Horimiya: The Missing Pieces & Horimiya
  'anivault_rt_horimiya_the_missing_pieces': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Horimiya',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx124080-3i22mRVPBS0T.jpg',
    seasonEpisodes: { 1: 13, 2: 13 }
  },

  // 21. Bleach: Thousand-Year Blood War
  'anivault_rt_bleach_thousand_year_blood_war': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2022,
    alternateTitle: 'Bleach: Sennen Kessen-hen',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx116674-p3zK4PUX2Aag.jpg',
    seasonEpisodes: { 1: 13, 2: 13, 3: 13 }
  },

  // 22. High School DxD
  'anivault_rt_high_school_dxd': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2012,
    alternateTitle: 'High School DxD',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/nx11617-nmxMU9Zh3H5R.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 23. The Daily Life of the Immortal King
  'anivault_rt_the_daily_life_of_the_immortal_king': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2020,
    alternateTitle: 'Xian Wang de Richang Shenghuo',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx114121-vxWVgIBlBjox.png',
    seasonEpisodes: { 1: 15, 2: 12, 3: 12, 4: 12 }
  },

  // 24. Mushoku Tensei: Jobless Reincarnation
  'anivault_rt_mushoku_tensei': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx108465-1ANspF1EWyFx.jpg',
    seasonEpisodes: { 1: 23, 2: 24 }
  },

  // 25. That Time I Got Reincarnated as a Slime
  'anivault_rt_that_time_i_got_reincarnated_as_a_slime': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2018,
    alternateTitle: 'Tensei shitara Slime Datta Ken',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101280-tDxCVJm714nt.jpg',
    seasonEpisodes: { 1: 24, 2: 24, 3: 24 }
  },

  // 26. Blue Lock
  'anivault_rt_blue_lock': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2022,
    alternateTitle: 'Blue Lock',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx137822-U8naszP96vzC.png',
    seasonEpisodes: { 1: 24, 2: 14 }
  },

  // 27. Re:Zero - Starting Life in Another World
  'anivault_rt_rezero': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Re:Zero kara Hajimeru Isekai Seikatsu',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21355-wRVUrGxpvIQQ.jpg',
    seasonEpisodes: { 1: 25, 2: 25, 3: 16 }
  },

  // 28. Wistoria: Wand and Sword
  'anivault_rt_wistoria_wand_and_sword': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Tsue to Tsurugi no Wistoria',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx174576-tpKcHG0eO6CS.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 29. Sakamoto Days
  'anivault_rt_sakamoto_days': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2025,
    alternateTitle: 'Sakamoto Days',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx177709-e5Qx6RlsBgD5.png',
    seasonEpisodes: { 1: 12 }
  },

  // 30. Zenshu
  'anivault_rt_zenshu': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2025,
    alternateTitle: 'Zenshu.',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx176273-raxxcgkslf4Q.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 31. Devil May Cry
  'anivault_rt_devil_may_cry': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2007,
    alternateTitle: 'Devil May Cry',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1726-IrpH32PVADiO.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 32. Naruto (Original)
  'anivault_rt_naruto': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2002,
    alternateTitle: 'Naruto',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20-dE6UHbFFg1A5.jpg',
    seasonEpisodes: { 1: 35, 2: 48, 3: 48, 4: 26, 5: 28, 6: 26, 7: 26, 8: 26, 9: 7 }
  },

  // 33. Naruto Shippuden
  'anivault_rt_naruto_shippuden': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2007,
    alternateTitle: 'Naruto: Shippuuden',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1735-kGfVm0YqCPcu.png',
    seasonEpisodes: {
      1: 32, 2: 21, 3: 18, 4: 17, 5: 24, 6: 31, 7: 8, 8: 24,
      9: 21, 10: 25, 11: 21, 12: 33, 13: 20, 14: 25, 15: 28, 16: 212
    }
  },

  // 34. Doraemon TV Series
  'anivault_rt_doraemon_tv_series': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2005,
    alternateTitle: 'Doraemon (2005)',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/501.jpg',
    seasonEpisodes: { 1: 52, 2: 52, 3: 52, 4: 52, 5: 52, 6: 52, 7: 52, 8: 52, 14: 52 }
  },

  // 35. Pokemon
  'anivault_rt_pokemon': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Pokemon Sun & Moon',
    artworkUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21507-4z4gJkZ3N3v0.png',
    seasonEpisodes: { 1: 82, 20: 43 }
  },

  // 36. Miraculous Tales of Ladybug & Cat Noir
  'anivault_rt_miraculous_tales_of_ladybug_cat_noir': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2015,
    alternateTitle: 'Miraculous: Tales of Ladybug & Cat Noir',
    seasonEpisodes: { 5: 27 }
  },

  // 37. Stranger Things
  'anivault_rt_stranger_things_tales_from_85': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2022,
    seasonEpisodes: { 1: 6 }
  },

  // 38. Liar Game
  'anivault_rt_liar_game': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2022,
    seasonEpisodes: { 1: 12 }
  },

  // 39. Daemons of the Shadow Realm
  'anivault_rt_daemons_of_the_shadow_realm': {
    status: 'Upcoming',
    type: 'TV',
    releaseYear: 2026,
    seasonEpisodes: { 1: null }
  },

  // 40. Release That Witch
  'anivault_rt_release_that_witch': {
    status: 'Upcoming',
    type: 'TV',
    releaseYear: 2025,
    seasonEpisodes: { 1: null }
  },

  // 41. Hoppers (2026 Movie)
  'anivault_rt_hoppers_2026_movie': {
    status: 'Upcoming',
    type: 'Movie',
    releaseYear: 2026,
    seasonEpisodes: { 1: 1 }
  },

  // 42. Shin Chan In Very Very Tasty Tasty (Movie)
  'anivault_rt_shin_chan_in_very_very_tasty_tasty': {
    status: 'Completed',
    type: 'Movie',
    releaseYear: 2013,
    alternateTitle: 'Crayon Shin-chan: Very Tasty Tasty B-grade Gourmet Survival!!',
    seasonEpisodes: { 1: 1 }
  },

  // 43. Doraemon All Seasons
  'anivault_rt_doraemon_all_seasons_episodes': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2005,
    alternateTitle: 'Doraemon Classic All Seasons',
    seasonEpisodes: { 1: 52 }
  }
};

const inputPath = path.join(process.cwd(), 'server', 'data', 'anivault-catalogue.json');
let rawCatalogue = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

// Filter out spurious category hub/archive pages that crawled in with SVG logo
const EXCLUDED_HUB_IDS = new Set([
  'anivault_rt_animes',
  'anivault_rt_disney',
  'anivault_rt_movies',
  'anivault_rt_doraemon'
]);
const catalogue = rawCatalogue.filter(a => !EXCLUDED_HUB_IDS.has(a.id));

let statusesCorrectedCount = 0;
let episodeCountsCorrectedCount = 0;
let typesCorrectedCount = 0;
const statusAuditLog = [];

for (const anime of catalogue) {
  const originalStatus = anime.status;
  const originalType = anime.type;
  const id = anime.id;
  const title = anime.title || '';

  // Check if it is in verified registry
  const verified = verifiedRegistry[id];

  if (verified) {
    if (anime.status !== verified.status) {
      statusAuditLog.push({ id, title, from: anime.status, to: verified.status, reason: 'Verified Registry' });
      anime.status = verified.status;
      statusesCorrectedCount++;
    }
    if (anime.type !== verified.type) {
      anime.type = verified.type;
      typesCorrectedCount++;
    }
    if (verified.releaseYear) {
      anime.releaseYear = verified.releaseYear;
    }
    if (verified.alternateTitle) {
      anime.alternateTitle = verified.alternateTitle;
    }
    if (verified.artworkUrl) {
      anime.artwork = {
        verifiedArtworkUrl: verified.artworkUrl,
        isVerified: true,
        verificationSource: 'OFFICIAL_CANONICAL_POSTER',
        aspectRatio: '3:4'
      };
    }

    // Apply exact season-by-season episode counts
    if (Array.isArray(anime.seasons)) {
      for (const season of anime.seasons) {
        const sNum = season.seasonNumber;
        if (verified.seasonEpisodes[sNum] !== undefined) {
          if (season.episodeCount !== verified.seasonEpisodes[sNum]) {
            season.episodeCount = verified.seasonEpisodes[sNum];
            episodeCountsCorrectedCount++;
          }
        }
      }
    }
  } else {
    // Determine if it is a movie by title patterns
    const isMovieByTitle = 
      title.toLowerCase().includes('movie') ||
      title.toLowerCase().includes('full movie') ||
      title.toLowerCase().includes('(20') ||
      title.toLowerCase().includes('(19') ||
      id.includes('movie') ||
      id.includes('shin_chan_movie') ||
      id.includes('doraemon_the_movie') ||
      id.includes('doraemon_nobita') ||
      id.includes('lion_king') ||
      id.includes('tangled') ||
      id.includes('moana') ||
      id.includes('ratatouille') ||
      id.includes('turning_red') ||
      id.includes('spider_man_across') ||
      id.includes('shaun_the_sheep') ||
      id.includes('kung_fu_panda') ||
      id.includes('motu_patlu');

    if (isMovieByTitle) {
      if (anime.type !== 'Movie') {
        anime.type = 'Movie';
        typesCorrectedCount++;
      }
      if (anime.status !== 'Completed' && anime.status !== 'Upcoming') {
        statusAuditLog.push({ id, title, from: anime.status, to: 'Completed', reason: 'Verified Movie Feature' });
        anime.status = 'Completed';
        statusesCorrectedCount++;
      }
      // Movie has 1 season with 1 episode
      anime.seasons = [
        {
          seasonNumber: 1,
          title: 'Full Movie',
          canonicalUrl: anime.providers?.raretoonIndia?.canonicalUrl || 'https://www.rareanimes.mov/home/',
          episodeCount: 1,
          episodes: [
            {
              episodeNumber: 1,
              title: 'Full Movie',
              canonicalUrl: anime.providers?.raretoonIndia?.canonicalUrl || 'https://www.rareanimes.mov/home/'
            }
          ]
        }
      ];
    } else {
      // General TV series or collection
      // For general TV series without explicit verified registry, check status
      // If release year is before 2024 and was marked Ongoing, verify
      if (anime.releaseYear && anime.releaseYear < 2023 && anime.status === 'Ongoing') {
        // e.g. Baki, Stranger Things, etc.
        statusAuditLog.push({ id, title, from: anime.status, to: 'Completed', reason: 'Historical Release Concluded' });
        anime.status = 'Completed';
        statusesCorrectedCount++;
      }
    }
  }

  // Ensure total episodes separated from season episodes
  let totalEp = 0;
  let hasNull = false;
  if (Array.isArray(anime.seasons)) {
    for (const s of anime.seasons) {
      if (s.episodeCount === null || s.episodeCount === undefined) {
        hasNull = true;
      } else {
        totalEp += s.episodeCount;
      }
    }
  }
  anime.totalEpisodes = hasNull && totalEp === 0 ? null : (totalEp > 0 ? totalEp : null);
  anime.totalSeasons = anime.seasons ? anime.seasons.length : 1;

  // Clean up any old provider links to the new active RareToon domain
  if (anime.providers?.raretoonIndia) {
    const rawUrl = anime.providers.raretoonIndia.canonicalUrl || '';
    anime.providers.raretoonIndia.canonicalUrl = rawUrl.replace('https://raretoonindia.in', 'https://www.rareanimes.mov');
  }
  if (Array.isArray(anime.seasons)) {
    for (const s of anime.seasons) {
      if (s.canonicalUrl) {
        s.canonicalUrl = s.canonicalUrl.replace('https://raretoonindia.in', 'https://www.rareanimes.mov');
      }
      if (Array.isArray(s.episodes)) {
        for (const ep of s.episodes) {
          if (ep.canonicalUrl) {
            ep.canonicalUrl = ep.canonicalUrl.replace('https://raretoonindia.in', 'https://www.rareanimes.mov');
          }
        }
      }
    }
  }
}

// Write to both server and client data destinations
fs.writeFileSync(inputPath, JSON.stringify(catalogue, null, 2), 'utf-8');
const clientPath = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
fs.writeFileSync(clientPath, JSON.stringify(catalogue, null, 2), 'utf-8');

console.log('=== AUDIT & RECTIFICATION SUMMARY ===');
console.log('Total anime checked:', catalogue.length);
console.log('Statuses corrected:', statusesCorrectedCount);
console.log('Episode counts updated:', episodeCountsCorrectedCount);
console.log('Types corrected to Movie/TV:', typesCorrectedCount);
console.log('Detailed corrections sample:');
console.log(JSON.stringify(statusAuditLog.slice(0, 15), null, 2));

// Save audit log to file for reference and report
fs.writeFileSync('server/data/status-audit-report.json', JSON.stringify({
  totalChecked: catalogue.length,
  statusesCorrected: statusesCorrectedCount,
  typesCorrected: typesCorrectedCount,
  episodeCountsUpdated: episodeCountsCorrectedCount,
  corrections: statusAuditLog
}, null, 2));
