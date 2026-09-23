/**
 * Canonical metadata verification table for AniVault.
 * Provides exact, factual anime metadata:
 * - Precise season-by-season episode counts
 * - Exact real-world airing status (Completed, Ongoing, Upcoming)
 * - Exact type (TV, Movie, Collection)
 * - Official verified artwork
 */
export const VERIFIED_ANIME_REGISTRY: Record<string, {
  status: 'Completed' | 'Ongoing' | 'Upcoming';
  type: 'TV' | 'Movie' | 'Collection';
  releaseYear?: number;
  alternateTitle?: string;
  artworkUrl?: string;
  seasonEpisodes: Record<number, number | null>; // seasonNumber -> episodeCount
  synopsis?: string;
}> = {
  // 1. Vinland Saga
  'anivault_rt_vinland_saga': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Vinland Saga',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1500/103005.jpg',
    seasonEpisodes: { 1: 24, 2: 24 }
  },

  // 2. Attack on Titan
  'anivault_rt_attack_on_titan': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2013,
    alternateTitle: 'Shingeki no Kyojin',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/10/47347.jpg',
    seasonEpisodes: { 1: 25, 2: 12, 3: 22, 4: 28 }
  },

  // 3. Death Note
  'anivault_rt_death_note': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2006,
    alternateTitle: 'Death Note',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/9/9453.jpg',
    seasonEpisodes: { 1: 37 }
  },

  // 4. Assassination Classroom
  'anivault_rt_assassination_classroom': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2015,
    alternateTitle: 'Ansatsu Kyoushitsu',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/5/75810.jpg',
    seasonEpisodes: { 1: 22, 2: 25 }
  },

  // 5. Jujutsu Kaisen
  'anivault_rt_jujutsu_kaisen': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2020,
    alternateTitle: 'Jujutsu Kaisen',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1171/109222.jpg',
    seasonEpisodes: { 1: 24, 2: 23 }
  },

  // 6. Demon Slayer: Kimetsu no Yaiba
  'anivault_rt_demon_slayer': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Kimetsu no Yaiba',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1286/99889.jpg',
    seasonEpisodes: { 1: 26, 2: 18, 3: 11, 4: 8 }
  },

  // 7. Solo Leveling
  'anivault_rt_solo_leveling': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Na Honjaman Rebeleop',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1844/141757.jpg',
    seasonEpisodes: { 1: 12, 2: 13 }
  },

  // 8. Frieren: Beyond Journey's End
  'anivault_rt_frieren_beyond_journeys_end': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2023,
    alternateTitle: 'Sousou no Frieren',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1015/138075.jpg',
    seasonEpisodes: { 1: 28 }
  },

  // 9. Dan Da Dan
  'anivault_rt_dan_da_dan': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Dandadan',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1966/143577.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 10. Kaiju No. 8
  'anivault_rt_kaiju_no_8': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Kaijuu 8-gou',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1758/141285.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 11. Dr. STONE
  'anivault_rt_dr_stone': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2019,
    alternateTitle: 'Dr. STONE',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1613/102576.jpg',
    seasonEpisodes: { 1: 24, 2: 11, 3: 22, 4: 12 }
  },

  // 12. My Hero Academia
  'anivault_rt_my_hero_academia': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Boku no Hero Academia',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/10/78745.jpg',
    seasonEpisodes: { 1: 13, 2: 25, 3: 25, 4: 25, 5: 25, 6: 25, 7: 21 }
  },

  // 13. Classroom of the Elite
  'anivault_rt_classroom_of_the_elite': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2017,
    alternateTitle: 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/4/86835.jpg',
    seasonEpisodes: { 1: 12, 2: 13, 3: 13 }
  },

  // 14. Tokyo Revengers
  'anivault_rt_tokyo_revengers': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Tokyo Revengers',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1830/117906.jpg',
    seasonEpisodes: { 1: 24, 2: 13, 3: 13 }
  },

  // 15. Baki
  'anivault_rt_baki': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2018,
    alternateTitle: 'Baki (2018)',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1169/93126.jpg',
    seasonEpisodes: { 1: 26 }
  },

  // 16. Baki Hanma
  'anivault_rt_baki_hanma': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Hanma Baki: Son of Ogre',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1370/118332.jpg',
    seasonEpisodes: { 1: 12, 2: 27 }
  },

  // 17. Haikyu!!
  'anivault_rt_haikyu': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2014,
    alternateTitle: 'Haikyuu!!',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/7/76014.jpg',
    seasonEpisodes: { 1: 25, 2: 25, 3: 10, 4: 25 }
  },

  // 18. Black Clover
  'anivault_rt_black_clover': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2017,
    alternateTitle: 'Black Clover',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/2/88336.jpg',
    seasonEpisodes: { 1: 51, 2: 51, 3: 52, 4: 16 }
  },

  // 19. Gintama
  'anivault_rt_gintama': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2006,
    alternateTitle: 'Gintama',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/10/73249.jpg',
    seasonEpisodes: { 1: 201 }
  },

  // 20. Horimiya: The Missing Pieces & Horimiya
  'anivault_rt_horimiya_the_missing_pieces': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Horimiya',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1695/111486.jpg',
    seasonEpisodes: { 1: 13, 2: 13 }
  },

  // 21. Bleach: Thousand-Year Blood War
  'anivault_rt_bleach_thousand_year_blood_war': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2022,
    alternateTitle: 'Bleach: Sennen Kessen-hen',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1764/126627.jpg',
    seasonEpisodes: { 1: 13, 2: 13, 3: 13 }
  },

  // 22. High School DxD
  'anivault_rt_high_school_dxd': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2012,
    alternateTitle: 'High School DxD',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/11/35921.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 23. The Daily Life of the Immortal King
  'anivault_rt_the_daily_life_of_the_immortal_king': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2020,
    alternateTitle: 'Xian Wang de Richang Shenghuo',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1614/105436.jpg',
    seasonEpisodes: { 1: 15, 2: 12, 3: 12, 4: 12 }
  },

  // 24. Mushoku Tensei: Jobless Reincarnation
  'anivault_rt_mushoku_tensei': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2021,
    alternateTitle: 'Mushoku Tensei: Isekai Ittara Honki Dasu',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1530/117776.jpg',
    seasonEpisodes: { 1: 23, 2: 24 }
  },

  // 25. That Time I Got Reincarnated as a Slime
  'anivault_rt_that_time_i_got_reincarnated_as_a_slime': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2018,
    alternateTitle: 'Tensei shitara Slime Datta Ken',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1092/95535.jpg',
    seasonEpisodes: { 1: 24, 2: 24, 3: 24 }
  },

  // 26. Blue Lock
  'anivault_rt_blue_lock': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2022,
    alternateTitle: 'Blue Lock',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1258/126929.jpg',
    seasonEpisodes: { 1: 24, 2: 14 }
  },

  // 27. Re:Zero - Starting Life in Another World
  'anivault_rt_rezero': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Re:Zero kara Hajimeru Isekai Seikatsu',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1522/128039.jpg',
    seasonEpisodes: { 1: 25, 2: 25, 3: 16 }
  },

  // 28. Wistoria: Wand and Sword
  'anivault_rt_wistoria_wand_and_sword': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2024,
    alternateTitle: 'Tsue to Tsurugi no Wistoria',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1260/143522.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 29. Sakamoto Days
  'anivault_rt_sakamoto_days': {
    status: 'Ongoing',
    type: 'TV',
    releaseYear: 2025,
    alternateTitle: 'Sakamoto Days',
    seasonEpisodes: { 1: 12 }
  },

  // 30. Zenshu
  'anivault_rt_zenshu': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2025,
    alternateTitle: 'Zenshu.',
    seasonEpisodes: { 1: 12 }
  },

  // 31. Devil May Cry
  'anivault_rt_devil_may_cry': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2007,
    alternateTitle: 'Devil May Cry',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/13/20040.jpg',
    seasonEpisodes: { 1: 12 }
  },

  // 32. Naruto (Original)
  'anivault_rt_naruto': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2002,
    alternateTitle: 'Naruto',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/13/17405.jpg',
    seasonEpisodes: { 1: 35, 2: 48, 3: 48, 4: 26, 5: 28, 6: 26, 7: 26, 8: 26, 9: 7 }
  },

  // 33. Naruto Shippuden
  'anivault_rt_naruto_shippuden': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2007,
    alternateTitle: 'Naruto: Shippuuden',
    artworkUrl: 'https://cdn.myanimelist.net/images/anime/1565/111305.jpg',
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
    seasonEpisodes: { 1: 52, 2: 52, 3: 52, 4: 52, 5: 52, 6: 52, 7: 52, 8: 52, 14: 52 }
  },

  // 35. Pokemon
  'anivault_rt_pokemon': {
    status: 'Completed',
    type: 'TV',
    releaseYear: 2016,
    alternateTitle: 'Pokemon Sun & Moon',
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
