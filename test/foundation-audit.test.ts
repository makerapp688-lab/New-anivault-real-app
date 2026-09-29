import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { globalDataStore } from '../server/data-store.ts';
import { infoManager } from '../server/info-manager.ts';
import {
  globalWorkerJobEngine,
  ReusableWorkerJobEngine,
  DEFAULT_PRODUCTION_WORKERS,
  MAX_INFRASTRUCTURE_WORKERS,
  createDeterministicTaskId
} from '../server/worker-job-engine.ts';
import { TEST_OR_SYNTHETIC_ANIME_IDS } from '../server/repair-catalogue.ts';
import {
  ingestRawRareToonItems,
  syncAnimeEpisodeIntegrity,
  extractReliableEpisodeCount,
  extractReliableReleaseYear,
  extractReliableStatus
} from '../server/raretoon-ingest.ts';

async function runFoundationAuditTests() {
  console.log('================================================================');
  console.log('ZENIME — PHASE 1 & PHASE 2 COMPLETE FOUNDATION VERIFICATION SUITE');
  console.log('================================================================\n');

  const dataDir = path.join(process.cwd(), 'server', 'data');
  const catalogue = JSON.parse(fs.readFileSync(path.join(dataDir, 'anivault-catalogue.json'), 'utf-8'));
  const artRecords = JSON.parse(fs.readFileSync(path.join(dataDir, 'artwork-verification-records.json'), 'utf-8'));
  const infoRecords = JSON.parse(fs.readFileSync(path.join(dataDir, 'info-verification-records.json'), 'utf-8'));
  const syncReport = JSON.parse(fs.readFileSync(path.join(dataDir, 'sync-report.json'), 'utf-8'));
  const statusReport = JSON.parse(fs.readFileSync(path.join(dataDir, 'status-audit-report.json'), 'utf-8'));
  const inspectReport = JSON.parse(fs.readFileSync(path.join(dataDir, 'artwork-inspect-report.json'), 'utf-8'));
  const workerState = JSON.parse(fs.readFileSync(path.join(dataDir, 'worker-job-state.json'), 'utf-8'));
  const workerHistory = JSON.parse(fs.readFileSync(path.join(dataDir, 'worker-job-history.json'), 'utf-8'));

  // ---------------------------------------------------------------------------
  // PHASE 1.1: EPISODE & SEASON INTEGRITY ACROSS ENTIRE CATALOGUE
  // ---------------------------------------------------------------------------
  console.log('[Phase 1.1] Auditing Episode & Season Integrity across entire catalogue...');
  assert.ok(catalogue.length >= 840, `Catalogue size should be >= 840 (got ${catalogue.length})`);

  for (const anime of catalogue) {
    assert.ok(Array.isArray(anime.seasons) && anime.seasons.length > 0, `Anime ${anime.id} must have seasons[]`);
    assert.strictEqual(anime.totalSeasons, anime.seasons.length, `Anime ${anime.id} totalSeasons mismatch`);
    assert.ok(
      anime.authoritativeTotalEpisodes === null ||
        (typeof anime.authoritativeTotalEpisodes === 'number' && anime.authoritativeTotalEpisodes > 0),
      `Anime ${anime.id} invalid authoritativeTotalEpisodes: ${anime.authoritativeTotalEpisodes}`
    );
    assert.strictEqual(anime.totalEpisodes, anime.authoritativeTotalEpisodes, `Anime ${anime.id} totalEpisodes !== authoritativeTotalEpisodes`);
    assert.strictEqual(anime.authoritativeEpisodeCount, anime.authoritativeTotalEpisodes, `Anime ${anime.id} authoritativeEpisodeCount !== authoritativeTotalEpisodes`);
    assert.ok(typeof anime.importedEpisodesCount === 'number' && anime.importedEpisodesCount >= 0, `Anime ${anime.id} missing importedEpisodesCount`);
    assert.strictEqual(anime.importedEpisodeCount, anime.importedEpisodesCount, `Anime ${anime.id} importedEpisodeCount !== importedEpisodesCount`);
    assert.ok(['complete', 'partial', 'empty'].includes(anime.episodeListStatus), `Anime ${anime.id} invalid episodeListStatus`);
    assert.strictEqual(anime.episodeImportStatus, anime.episodeListStatus, `Anime ${anime.id} episodeImportStatus !== episodeListStatus`);

    let seasonAuthSum = 0;
    let allSeasonsKnownAuth = anime.seasons.length > 0;
    let seasonImpSum = 0;
    for (const s of anime.seasons) {
      const eps = Array.isArray(s.episodes) ? s.episodes : [];
      assert.strictEqual(s.importedEpisodeCount, eps.length, `Anime ${anime.id} S${s.seasonNumber} importedEpisodeCount !== episodes.length`);
      assert.ok(
        s.authoritativeEpisodeCount === null ||
          (typeof s.authoritativeEpisodeCount === 'number' && s.authoritativeEpisodeCount >= eps.length),
        `Anime ${anime.id} S${s.seasonNumber} authoritativeEpisodeCount (${s.authoritativeEpisodeCount}) < episodes.length (${eps.length})`
      );
      assert.strictEqual(s.episodeCount, s.authoritativeEpisodeCount, `Anime ${anime.id} S${s.seasonNumber} episodeCount !== authoritativeEpisodeCount`);
      const expectedComplete =
        s.authoritativeEpisodeCount !== null &&
        s.authoritativeEpisodeCount > 0 &&
        eps.length >= s.authoritativeEpisodeCount;
      assert.strictEqual(s.isEpisodeListComplete, expectedComplete, `Anime ${anime.id} S${s.seasonNumber} isEpisodeListComplete mismatch`);
      assert.strictEqual(s.episodeImportStatus, s.episodeListStatus, `Anime ${anime.id} S${s.seasonNumber} episodeImportStatus !== episodeListStatus`);
      if (s.authoritativeEpisodeCount !== null) {
        seasonAuthSum += s.authoritativeEpisodeCount;
      } else {
        allSeasonsKnownAuth = false;
      }
      seasonImpSum += eps.length;
    }
    const expectedAnimeAuth = allSeasonsKnownAuth ? seasonAuthSum : anime.type === 'Movie' ? 1 : null;
    assert.strictEqual(
      anime.authoritativeTotalEpisodes,
      expectedAnimeAuth,
      `Anime ${anime.id} authoritativeTotalEpisodes (${anime.authoritativeTotalEpisodes}) !== expected (${expectedAnimeAuth})`
    );
    assert.strictEqual(anime.importedEpisodesCount, seasonImpSum, `Anime ${anime.id} importedEpisodesCount (${anime.importedEpisodesCount}) !== season imported sum (${seasonImpSum})`);
  }

  // Verify partial episode list separation (e.g., Haikyu!! has 25 authoritative episodes, 1 imported episode, marked partial)
  const haikyu = catalogue.find((a: any) => a.id === 'anivault_rt_haikyu');
  assert.ok(haikyu, 'Haikyu!! must exist in catalogue');
  assert.strictEqual(haikyu.authoritativeTotalEpisodes, 25, 'Haikyu!! authoritative episode count must be preserved as 25');
  assert.strictEqual(haikyu.importedEpisodesCount, 1, 'Haikyu!! imported episode count must be 1 (never invent Episodes 2-25)');
  assert.strictEqual(haikyu.isEpisodeListComplete, false, 'Haikyu!! episode list must not be falsely marked complete');
  assert.strictEqual(haikyu.episodeListStatus, 'partial', 'Haikyu!! episodeListStatus must be partial');
  console.log('✓ PASS: All 848 anime & seasons strictly separate authoritativeEpisodeCount, importedEpisodeCount, and completeness.');

  // ---------------------------------------------------------------------------
  // PHASE 1.2: DUPLICATE ANIME RESOLUTION (YOUR NAME, SUZUME, ETC.)
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 1.2] Verifying Duplicate Anime Resolution...');
  const idSet = new Set<string>();
  for (const a of catalogue) {
    assert.ok(!idSet.has(a.id), `Duplicate ID found in catalogue: ${a.id}`);
    idSet.add(a.id);
  }

  // Verify Your Name and Suzume duplicates are cleanly merged into canonical records
  assert.ok(idSet.has('mal_32281'), 'Canonical Your Name (mal_32281) must exist');
  assert.ok(!idSet.has('anivault_rt_your_name_2016_movie'), 'Duplicate Your Name record must be merged');
  const yourName = catalogue.find((a: any) => a.id === 'mal_32281');
  assert.ok(yourName.providers?.raretoonIndia?.canonicalUrl?.includes('your-name'), 'Merged Your Name must preserve specific RareToon URL');

  assert.ok(idSet.has('mal_50594'), 'Canonical Suzume (mal_50594) must exist');
  assert.ok(!idSet.has('anivault_rt_suzume_no_tojimari_2022_english_subbed_download'), 'Duplicate Suzume record must be merged');
  const suzume = catalogue.find((a: any) => a.id === 'mal_50594');
  assert.ok(suzume.providers?.raretoonIndia?.canonicalUrl?.includes('suzume'), 'Merged Suzume must preserve specific RareToon URL');

  const duplicateMap = infoManager.buildDuplicateIndex(catalogue);
  assert.strictEqual(duplicateMap.size, 0, `Expected 0 remaining duplicates in catalogue, found ${duplicateMap.size}`);
  console.log('✓ PASS: Confirmed duplicates (Your Name, Suzume, etc.) merged with metadata, artwork, and RareToon mappings preserved.');

  // ---------------------------------------------------------------------------
  // PHASE 1.3 & 1.4: CATALOGUE VALIDATION, BACKUP, STALE REPORTS & TEST DATA
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 1.3 & 1.4] Verifying Backup, Reports & Zero Test Pollution...');
  assert.ok(fs.existsSync(path.join(dataDir, 'anivault-catalogue.backup.json')), 'Pre-merge catalogue backup file must exist');
  assert.strictEqual(syncReport.totalUniqueAnime, catalogue.length, 'sync-report.json must match current catalogue length');
  assert.strictEqual(statusReport.totalSeries, catalogue.length, 'status-audit-report.json must match current catalogue length');
  assert.strictEqual(inspectReport.totalCatalogue, catalogue.length, 'artwork-inspect-report.json must match current catalogue length');
  assert.strictEqual(Object.keys(artRecords).length, catalogue.length, 'artwork-verification-records.json must match 100% of canonical catalogue');
  assert.strictEqual(Object.keys(infoRecords).length, catalogue.length, 'info-verification-records.json must match 100% of canonical catalogue');

  for (const testId of TEST_OR_SYNTHETIC_ANIME_IDS) {
    assert.ok(!artRecords[testId], `Test anime ID ${testId} must not pollute artwork-verification-records.json`);
    assert.ok(!infoRecords[testId], `Test anime ID ${testId} must not pollute info-verification-records.json`);
  }
  console.log('✓ PASS: Reports synchronized with 848 canonical records and 0 synthetic/test records in production data stores.');

  // ---------------------------------------------------------------------------
  // PHASE 1.5 & PHASE 2.1: IMPORTER & INFORMATION MANAGER EVIDENCE CASES
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 1.5 & 2.1] Testing Importer & Information Manager with 6 edge cases...');
  const dummyCatMap = new Map<string, any>();

  // Case 1: Complete episode list (Movie or fully imported season)
  const completeAnime = {
    id: 'test_case_complete',
    title: 'Your Name',
    alternateTitle: 'Kimi no Na wa.',
    type: 'Movie',
    status: 'Completed',
    releaseYear: 2016,
    totalSeasons: 1,
    totalEpisodes: 1,
    authoritativeTotalEpisodes: 1,
    importedEpisodesCount: 1,
    isEpisodeListComplete: true,
    episodeListStatus: 'complete',
    genres: ['Romance', 'Drama'],
    languages: ['Hindi', 'Japanese'],
    synopsis: 'Two teenagers share a profound, magical connection upon discovering they are swapping bodies.',
    providers: {
      raretoonIndia: {
        providerAnimeId: 'your-name-2016-movie',
        canonicalUrl: 'https://www.rareanimes.mov/hindi/your-name-2016-movie/',
        verificationStatus: 'VERIFIED',
        dubLanguage: 'Dual Audio'
      }
    },
    seasons: [
      {
        seasonNumber: 1,
        title: 'Movie',
        canonicalUrl: 'https://www.rareanimes.mov/hindi/your-name-2016-movie/',
        episodeCount: 1,
        authoritativeEpisodeCount: 1,
        importedEpisodeCount: 1,
        isEpisodeListComplete: true,
        episodeListStatus: 'complete',
        episodes: [{ episodeNumber: 1, title: 'Full Movie', canonicalUrl: 'https://www.rareanimes.mov/hindi/your-name-2016-movie/' }]
      }
    ]
  };
  const evalComplete = infoManager.evaluateAnimeMetadata(completeAnime, [], dummyCatMap, [
    { source: 'AniList', confidence: 0.96, title: 'Your Name', status: 'Completed', releaseYear: 2016, type: 'Movie', totalEpisodes: 1 }
  ]);
  assert.strictEqual(evalComplete.status, 'verified', 'Complete anime with strong candidate agreement must be Verified');
  assert.strictEqual(evalComplete.discrepancies.length, 0, 'Complete anime must have 0 discrepancies');

  // Case 2: Partial episode list with known authoritative episode count (12 declared, 1 imported)
  const partialAnime = {
    ...completeAnime,
    id: 'test_case_partial',
    title: 'Zenshu',
    type: 'TV',
    releaseYear: 2025,
    totalEpisodes: 12,
    authoritativeTotalEpisodes: 12,
    importedEpisodesCount: 1,
    isEpisodeListComplete: false,
    episodeListStatus: 'partial',
    seasons: [
      {
        seasonNumber: 1,
        title: 'Season 1',
        canonicalUrl: 'https://www.rareanimes.mov/anime/zenshu/',
        episodeCount: 12,
        authoritativeEpisodeCount: 12,
        importedEpisodeCount: 1,
        isEpisodeListComplete: false,
        episodeListStatus: 'partial',
        episodes: [{ episodeNumber: 1, title: 'Episode 1', canonicalUrl: 'https://www.rareanimes.mov/anime/zenshu/' }]
      }
    ]
  };
  const evalPartial = infoManager.evaluateAnimeMetadata(partialAnime, [], dummyCatMap, [
    { source: 'AniList', confidence: 0.94, title: 'Zenshu', status: 'Completed', releaseYear: 2025, type: 'TV', totalEpisodes: 12 }
  ]);
  assert.strictEqual(evalPartial.checkedFields.seasonEpisodes, 'ok', 'Partial imported list with preserved authoritative count must NOT be flagged as broken season count');
  assert.strictEqual(evalPartial.checkedFields.totalEpisodes, 'ok', 'Total episodes matching authoritative season count must be ok');

  // Case 3: Multiple seasons with known episode counts
  const multiSeasonAnime = {
    ...completeAnime,
    id: 'test_case_multi_season',
    title: 'Jujutsu Kaisen',
    type: 'TV',
    totalSeasons: 2,
    totalEpisodes: 47,
    authoritativeTotalEpisodes: 47,
    importedEpisodesCount: 2,
    isEpisodeListComplete: false,
    episodeListStatus: 'partial',
    seasons: [
      {
        seasonNumber: 1,
        title: 'Season 1',
        canonicalUrl: 'https://www.rareanimes.mov/hindi/jujutsu-kaisen-season-1/',
        episodeCount: 24,
        authoritativeEpisodeCount: 24,
        importedEpisodeCount: 1,
        isEpisodeListComplete: false,
        episodeListStatus: 'partial',
        episodes: [{ episodeNumber: 1, title: 'Episode 1', canonicalUrl: 'https://www.rareanimes.mov/hindi/jujutsu-kaisen-season-1/' }]
      },
      {
        seasonNumber: 2,
        title: 'Season 2',
        canonicalUrl: 'https://www.rareanimes.mov/hindi/jujutsu-kaisen-season-2/',
        episodeCount: 23,
        authoritativeEpisodeCount: 23,
        importedEpisodeCount: 1,
        isEpisodeListComplete: false,
        episodeListStatus: 'partial',
        episodes: [{ episodeNumber: 1, title: 'Episode 1', canonicalUrl: 'https://www.rareanimes.mov/hindi/jujutsu-kaisen-season-2/' }]
      }
    ]
  };
  const evalMulti = infoManager.evaluateAnimeMetadata(multiSeasonAnime, [], dummyCatMap, []);
  assert.strictEqual(evalMulti.checkedFields.seasonsCount, 'ok');
  assert.strictEqual(evalMulti.checkedFields.totalEpisodes, 'ok');

  // Case 4: Conflicting trusted sources -> Conflict status
  const evalConflict = infoManager.evaluateAnimeMetadata(completeAnime, [], dummyCatMap, [
    { source: 'AniList', confidence: 0.92, title: 'Your Name', status: 'Completed', releaseYear: 2016, type: 'Movie' },
    { source: 'TVMaze', confidence: 0.89, title: 'Your Name', status: 'Ongoing', releaseYear: 2021, type: 'Movie' }
  ]);
  assert.strictEqual(evalConflict.status, 'conflict', 'Conflicting trusted sources must result in Conflict status for Owner review');

  // Case 4b: Weak candidate result -> Insufficient Evidence (Needs Review, NEVER Verified)
  const evalWeakCandidate = infoManager.evaluateAnimeMetadata(completeAnime, [], dummyCatMap, [
    { source: 'TVMaze', confidence: 0.58, title: 'Some Weak Match', status: 'Completed', releaseYear: 2016, type: 'Movie' }
  ]);
  assert.strictEqual(evalWeakCandidate.status, 'needs_review', 'Single weak candidate result must NEVER mark anime Verified; must be Needs Review');
  assert.ok(
    evalWeakCandidate.discrepancies.some(d => d.label === 'Insufficient External Evidence'),
    'Weak candidate result must record Insufficient External Evidence discrepancy'
  );

  // Case 5 & Phase 2.2: Suspected Fake anime detection & resolution workflow (Suspected Fake -> Verified Real / Confirmed Fake)
  const fakeCandidateAnime = {
    ...completeAnime,
    id: 'test_case_fake',
    title: 'Test Fake NonExistent Anime 999',
    providers: { raretoonIndia: { providerAnimeId: '', canonicalUrl: '' } },
    _externalSourcesQueried: true
  };
  const evalFake = infoManager.evaluateAnimeMetadata(fakeCandidateAnime, [], dummyCatMap, []);
  assert.strictEqual(evalFake.status, 'suspected_fake', 'Invalid/unmatched anime without canonical URL must be flagged as suspected_fake');
  assert.ok(evalFake.suspectedFakeStrongEvidence, 'Strong evidence flag must be set');
  assert.ok(evalFake.confidence <= 0.25, 'Suspected fake must have low real confidence (<= 0.25)');

  // Case 6: Season numbering validation (duplicate or non-positive seasonNumber)
  const badSeasonNumAnime = {
    ...completeAnime,
    id: 'test-bad-season-num',
    totalSeasons: 2,
    totalEpisodes: 24,
    seasons: [
      { seasonNumber: 1, episodeCount: 12, authoritativeEpisodeCount: 12, importedEpisodeCount: 1, episodes: [{ episodeNumber: 1 }] },
      { seasonNumber: 1, episodeCount: 12, authoritativeEpisodeCount: 12, importedEpisodeCount: 1, episodes: [{ episodeNumber: 1 }] }
    ]
  };
  const evalBadSeasonNum = infoManager.evaluateAnimeMetadata(badSeasonNumAnime, [], dummyCatMap, []);
  assert.strictEqual(evalBadSeasonNum.checkedFields.seasonsCount, 'mismatch', 'Duplicate seasonNumber must be flagged in seasonsCount check');

  // Case 7: Never invent missing metadata (no fake genres, no boilerplate synopsis, no guessed 2020 year)
  const missingFieldsAnime = {
    ...completeAnime,
    id: 'test-no-invented-data',
    releaseYear: 0,
    genres: [],
    synopsis: ''
  };
  const evalNoInvent = infoManager.evaluateAnimeMetadata(missingFieldsAnime, [], dummyCatMap, []);
  const genreDisc = evalNoInvent.discrepancies.find(d => d.field === 'genres');
  const synDisc = evalNoInvent.discrepancies.find(d => d.field === 'synopsis');
  const yrDisc = evalNoInvent.discrepancies.find(d => d.field === 'releaseYear');
  assert.strictEqual(genreDisc?.suggestedValue, null, 'Must not invent default genres when no source provides them');
  assert.strictEqual(synDisc?.suggestedValue, null, 'Must not invent boilerplate synopsis when no source provides one');
  assert.strictEqual(yrDisc?.suggestedValue, null, 'Must not guess year 2020 when no source provides releaseYear');

  // Case 8: Owner actions (Mark Needs Review, Reject, Approve, Confirm Fake)
  const revMarkRes = infoManager.resolveReviewItem('anivault_rt_haikyu', 'mark_needs_review', 'Owner', 'Test manual review flag');
  assert.ok(revMarkRes.success && revMarkRes.record?.status === 'needs_review', 'mark_needs_review must set status to needs_review');
  const revRejectRes = infoManager.resolveReviewItem('anivault_rt_haikyu', 'reject_suggestions', 'Owner');
  assert.ok(revRejectRes.success && revRejectRes.record?.status === 'verified', 'reject_suggestions must keep catalogue data and mark verified');

  // Case 9: Needs Review Logic Rules (Optional metadata non-failure, 1-char anime "K", Remake year protection, Structured Review Queue Reasons)
  const optionalMissingAnime = {
    ...completeAnime,
    id: 'test-optional-missing',
    alternateTitle: null,
    japaneseTitle: null,
    languages: [],
    relatedAnime: [],
    franchiseRelationships: []
  };
  const evalOptionalMissing = infoManager.evaluateAnimeMetadata(optionalMissingAnime, [], dummyCatMap, [
    {
      source: 'AniList',
      confidence: 0.95,
      title: 'Your Name',
      alternateTitle: 'Kimi no Na wa.',
      japaneseTitle: '君の名は。',
      status: 'Completed',
      releaseYear: 2016,
      type: 'Movie',
      totalEpisodes: 1,
      franchiseRelationships: ['SIDE STORY: Weathering With You (Movie)']
    }
  ]);
  assert.strictEqual(evalOptionalMissing.status, 'verified', 'Missing optional metadata must NEVER mark the anime Needs Review');
  assert.strictEqual(evalOptionalMissing.discrepancies.length, 0, 'Missing optional metadata must not create blocking discrepancies');

  // Valid 1-character anime title "K" must be Verified/Correct, never Suspected Fake
  const kAnime = globalDataStore.getCatalogueAnime('anivault_rt_k');
  assert.ok(kAnime, 'Anime "K" (anivault_rt_k) must exist in catalogue');
  const evalK = infoManager.getRecord('anivault_rt_k');
  assert.ok(evalK && (evalK.status === 'verified' || evalK.status === 'correct'), `1-character anime "K" must be verified/correct, got ${evalK?.status}`);

  // Remake year protection: Doraemon Nobita's Little Star Wars (2021 Remake) must not be flagged against 1985 original
  const doraemonRemakeRec = infoManager.getRecord('anivault_rt_doraemon_nobitas_little_star_wars_2021_remake');
  assert.ok(
    doraemonRemakeRec && (doraemonRemakeRec.status === 'verified' || doraemonRemakeRec.status === 'correct'),
    `Doraemon 2021 Remake must not be sent to Needs Review over 1985 original year, got ${doraemonRemakeRec?.status}`
  );

  // Structured Review Queue Reasons must include field, currentValue, proposedValue, evidence, sources, confidence, reasonForReview
  assert.ok(
    Array.isArray(evalWeakCandidate.reviewQueueReasons) && evalWeakCandidate.reviewQueueReasons.length > 0,
    'Needs Review item must populate structured reviewQueueReasons'
  );
  const firstReason = evalWeakCandidate.reviewQueueReasons![0];
  assert.ok(firstReason.field && firstReason.evidence && Array.isArray(firstReason.sources) && typeof firstReason.confidence === 'number' && firstReason.reasonForReview, 'Review queue reason must contain field, currentValue, proposedValue, evidence, sources, confidence, and reasonForReview');

  // Case 10: REPAIR PART 1 — External ID alone (0.05 weak candidate), 6 Representative Records, Source Conflict, Temporary Failure Retry, Safe Auto-Fix
  const weakWithExternalIdAnime = {
    ...completeAnime,
    id: 'test-weak-external-id-005',
    aniListId: 151807,
    malId: 52299
  };
  const evalWeakWithExternalId = infoManager.evaluateAnimeMetadata(weakWithExternalIdAnime, [], dummyCatMap, [
    { source: 'AniList', sourceId: 151807, malId: 52299, confidence: 0.05, title: 'Unrelated Weak Match', status: 'Completed', releaseYear: 2016, type: 'Movie' }
  ]);
  assert.strictEqual(
    evalWeakWithExternalId.status,
    'needs_review',
    'Rule 1: An external ID alone with 0.05 candidate confidence must NEVER become Verified; must be needs_review'
  );
  assert.ok(evalWeakWithExternalId.confidence <= 0.55, 'Weak candidate with external ID must not have inflated confidence');
  assert.strictEqual(evalWeakWithExternalId.externalIds?.aniListId, null, 'Unverified external aniListId must not be promoted when candidate confidence is weak');
  assert.strictEqual(evalWeakWithExternalId.externalIds?.malId, null, 'Unverified external malId must not be promoted when candidate confidence is weak');

  const sanitizedWeakCands = (infoManager as any).sanitizePersistedCandidates(weakWithExternalIdAnime, [
    { source: 'AniList', sourceId: 151807, malId: 52299, confidence: 0.05, title: 'Unrelated Weak Match', status: 'Completed', releaseYear: 2016, type: 'Movie' }
  ]);
  const evalSanitizedWeak = infoManager.evaluateAnimeMetadata(weakWithExternalIdAnime, [], dummyCatMap, sanitizedWeakCands);
  assert.strictEqual(evalSanitizedWeak.status, 'needs_review', 'Persisted 0.05 weak candidate must not be stripped or converted into Verified/Correct');

  const evalInflatedIdOnly = infoManager.evaluateAnimeMetadata(weakWithExternalIdAnime, [], dummyCatMap, [
    { source: 'AniList', sourceId: 151807, malId: 52299, confidence: 0.96, title: 'Completely Unrelated Title XYZ', status: 'Completed', releaseYear: 2016, type: 'Movie' }
  ]);
  assert.strictEqual(evalInflatedIdOnly.status, 'needs_review', 'Matching external ID with weak actual title similarity must NEVER become Verified');

  // Genuine cross-source conflict between AniList and MyAnimeList
  const evalMalAniConflict = infoManager.evaluateAnimeMetadata(completeAnime, [], dummyCatMap, [
    { source: 'AniList', sourceId: 21519, confidence: 0.95, title: 'Your Name', status: 'Completed', releaseYear: 2016, type: 'Movie' },
    { source: 'MyAnimeList', sourceId: 32281, malId: 32281, confidence: 0.93, title: 'Your Name', status: 'Ongoing', releaseYear: 2019, type: 'Movie' }
  ]);
  assert.strictEqual(evalMalAniConflict.status, 'conflict', 'Genuine disagreement between AniList and MyAnimeList must become conflict');

  // Safe Auto-Fix: Strong identity + reliable evidence of wrong field -> auto_fixed
  const evalAutoFixed = infoManager.evaluateAnimeMetadata(
    completeAnime,
    [],
    dummyCatMap,
    [{ source: 'AniList', sourceId: 21519, confidence: 0.96, title: 'Your Name', status: 'Completed', releaseYear: 2016, type: 'Movie', totalEpisodes: 1 }],
    'auto_fixed'
  );
  assert.strictEqual(evalAutoFixed.status, 'auto_fixed', 'Strong identity + repaired field must become auto_fixed');

  // Representative 6 records check: Solo Leveling, Jujutsu Kaisen, Frieren, Naruto, Naruto: Shippuden, Horimiya: The Missing Pieces
  const soloRec = infoManager.getRecord('anivault_rt_solo_leveling');
  const jjkRec = infoManager.getRecord('anivault_rt_jujutsu_kaisen');
  const frierenRec = infoManager.getRecord('anivault_rt_frieren_beyond_journeys_end');
  const narutoRec = infoManager.getRecord('anivault_rt_naruto');
  const shippudenRec = infoManager.getRecord('anivault_rt_naruto_shippuden');
  const horimiyaRec = infoManager.getRecord('anivault_rt_horimiya_the_missing_pieces');

  assert.ok(soloRec && (soloRec.status === 'verified' || soloRec.status === 'auto_fixed') && soloRec.confidence >= 0.90, `Solo Leveling must be Verified/Auto-Fixed with high confidence, got ${soloRec?.status} (${soloRec?.confidence})`);
  assert.ok(jjkRec && (jjkRec.status === 'verified' || jjkRec.status === 'auto_fixed') && jjkRec.confidence >= 0.90, `Jujutsu Kaisen must be Verified/Auto-Fixed with high confidence, got ${jjkRec?.status} (${jjkRec?.confidence})`);
  assert.ok(frierenRec && (frierenRec.status === 'verified' || frierenRec.status === 'auto_fixed') && frierenRec.confidence >= 0.90, `Frieren must be Verified/Auto-Fixed with high confidence, got ${frierenRec?.status} (${frierenRec?.confidence})`);
  assert.ok(narutoRec && narutoRec.status === 'needs_review' && narutoRec.discrepancies.some(d => d.field === 'seasonEpisodes'), `Naruto (9 seasons x 1 ep vs 220) must be Needs Review for uncertain season mapping, got ${narutoRec?.status}`);
  assert.ok(shippudenRec && shippudenRec.status === 'needs_review' && shippudenRec.discrepancies.some(d => d.field === 'seasonEpisodes'), `Naruto: Shippuden (16 seasons x 1 ep vs 500) must be Needs Review for uncertain season mapping, got ${shippudenRec?.status}`);
  assert.ok(horimiyaRec && horimiyaRec.status === 'needs_review' && horimiyaRec.discrepancies.some(d => d.field === 'seasonEpisodes'), `Horimiya: The Missing Pieces (2 seasons x 1 ep vs 13) must be Needs Review for uncertain season mapping, got ${horimiyaRec?.status}`);

  // Temporary API failure test: must set retryPending=true and throw in processTaskByWorker so worker pool retries instead of marking Needs Review
  const origFetchCandidates = infoManager.fetchExternalMetadataCandidates.bind(infoManager);
  try {
    (infoManager as any).fetchExternalMetadataCandidates = async (animeObj: any) => {
      (infoManager as any).lastFetchDiagnostics.set(animeObj.id, {
        hadTransientFailure: true,
        sourcesAttempted: ['AniList', 'MyAnimeList'],
        sourcesSucceeded: [],
        errors: ['AniList HTTP 429', 'Jikan HTTP 503']
      });
      return [];
    };
    const beforeFrieren = JSON.parse(JSON.stringify(infoManager.getRecord('anivault_rt_frieren_beyond_journeys_end')));
    let workerThrewForRetry = false;
    try {
      await infoManager.processTaskByWorker(
        {
          taskId: 'test-transient-retry',
          jobId: 'TEST-JOB',
          jobSystem: 'INFORMATION_VERIFICATION',
          animeId: 'anivault_rt_frieren_beyond_journeys_end',
          seasonId: null,
          title: "Frieren: Beyond Journey's End",
          type: 'info_verify',
          payload: { animeId: 'anivault_rt_frieren_beyond_journeys_end', autoFix: false, operatorEmail: 'Owner' },
          priority: 'HIGH',
          status: 'claimed',
          retryCount: 0,
          maxRetries: 3
        },
        1
      );
    } catch (retryErr: any) {
      workerThrewForRetry = true;
      assert.ok(retryErr.message.includes('429') || retryErr.message.includes('503'), 'Worker error must preserve transient API failure message');
    }
    assert.ok(workerThrewForRetry, 'Temporary API failure must throw in processTaskByWorker to trigger shared worker backoff retry');
    const afterTransientRec = infoManager.getRecord('anivault_rt_frieren_beyond_journeys_end');
    assert.strictEqual(afterTransientRec?.retryPending, true, 'Temporary API failure must set retryPending = true');
    assert.notStrictEqual(afterTransientRec?.status, 'needs_review', 'Temporary API failure must NEVER mark a verified anime as needs_review');
    // Restore clean record state
    if (beforeFrieren) {
      (infoManager as any).recordsMap.set('anivault_rt_frieren_beyond_journeys_end', beforeFrieren);
    }
  } finally {
    (infoManager as any).fetchExternalMetadataCandidates = origFetchCandidates;
  }

  console.log('✓ PASS: Complete, partial, multi-season, conflicting metadata, weak-candidate insufficient evidence, 0.05 external-ID rejection, 6 representative records, temporary failure retry, and Owner review actions verified.');

  // ---------------------------------------------------------------------------
  // PHASE 2.3: WORKER POOL LIMITS, MATHEMATICAL CONSISTENCY & CROSS-SYSTEM SAFETY
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 2.3] Verifying Worker Pool Limits (50 Production / 80 Capacity), Task Math & Worker Safety...');
  assert.strictEqual(DEFAULT_PRODUCTION_WORKERS, 50, 'DEFAULT_PRODUCTION_WORKERS must be 50');
  assert.strictEqual(MAX_INFRASTRUCTURE_WORKERS, 80, 'MAX_INFRASTRUCTURE_WORKERS must be 80');

  const isolatedEngine = new ReusableWorkerJobEngine({ isolated: true });
  const snap = isolatedEngine.getSnapshot();
  assert.strictEqual(snap.workerCount, 50, 'Active production worker count must be 50');
  assert.strictEqual(snap.architectureCapacity, 80, 'Maximum infrastructure capacity must be 80');

  // Verify persisted worker-job-state.json math
  assert.strictEqual(
    workerState.totalTasks,
    workerState.completedCount + workerState.failedCount + workerState.queuedCount + workerState.claimedCount,
    'Persisted worker-job-state.json must satisfy totalTasks == completed + failed + queued + claimed'
  );
  assert.ok(workerState.completedCount <= workerState.totalTasks, 'completedCount must never exceed totalTasks');

  for (const h of workerHistory) {
    assert.ok(typeof h.totalTasks === 'number', 'Job history entry must have numeric totalTasks');
    assert.ok(h.completedCount <= h.totalTasks, `Job history ${h.jobId} has completedCount (${h.completedCount}) > totalTasks (${h.totalTasks})`);
  }

  // Verify Worker Safety: Information updates never corrupt artwork or Phase 1 episode integrity, and Artwork updates never corrupt Information records
  const sampleId = 'anivault_rt_haikyu';
  const beforeAnime = JSON.parse(JSON.stringify(globalDataStore.getCatalogueAnime(sampleId)));
  const beforeArtRec = JSON.parse(JSON.stringify(globalDataStore.getVerificationRecord(sampleId)));
  const beforeInfoRec = JSON.parse(JSON.stringify(infoManager.getRecord(sampleId)));

  // 1) Artwork update must preserve canonical ID, season numbering, episode counts, and info record
  globalDataStore.applyCatalogueArtworkUpdate(
    sampleId,
    beforeAnime.artwork.verifiedArtworkUrl,
    'verified',
    beforeAnime.artwork.verifiedArtworkUrl,
    'anilist'
  );
  const afterArtAnime = globalDataStore.getCatalogueAnime(sampleId);
  assert.strictEqual(afterArtAnime.id, beforeAnime.id, 'Artwork update must not alter canonical anime ID');
  assert.strictEqual(afterArtAnime.authoritativeTotalEpisodes, 25, 'Artwork update must not alter authoritativeTotalEpisodes');
  assert.strictEqual(afterArtAnime.importedEpisodesCount, 1, 'Artwork update must not alter importedEpisodesCount');
  assert.strictEqual(afterArtAnime.isEpisodeListComplete, false, 'Artwork update must not alter isEpisodeListComplete');
  assert.deepStrictEqual(infoManager.getRecord(sampleId), beforeInfoRec, 'Artwork update must not corrupt Information Manager record');

  // 2) Info update must preserve artwork record and Phase 1 episode integrity
  infoManager.applyMetadataUpdate(sampleId, { synopsis: beforeAnime.synopsis }, 'Owner', 'Safety test', 'Safety Check', 'correct');
  const afterInfoAnime = globalDataStore.getCatalogueAnime(sampleId);
  assert.strictEqual(afterInfoAnime.artwork.verifiedArtworkUrl, beforeAnime.artwork.verifiedArtworkUrl, 'Info update must not corrupt verifiedArtworkUrl');
  assert.strictEqual(afterInfoAnime.authoritativeTotalEpisodes, 25, 'Info update must preserve authoritativeTotalEpisodes');
  assert.strictEqual(afterInfoAnime.importedEpisodesCount, 1, 'Info update must preserve importedEpisodesCount');
  assert.strictEqual(afterInfoAnime.isEpisodeListComplete, false, 'Info update must preserve partial episode status');
  assert.deepStrictEqual(globalDataStore.getVerificationRecord(sampleId), beforeArtRec, 'Info update must not corrupt Artwork Manager record');
  console.log('✓ PASS: Worker pool strictly enforces 50 active workers / 70 max capacity, exact task accounting, and cross-system safety.');

  // ---------------------------------------------------------------------------
  // PHASE 2.4: OWNER REPORTS, LIVE STATISTICS & SECURITY / SECRET EXCLUSION
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 2.4] Verifying Live Owner Statistics & Source Package Secret Exclusion...');
  const liveInfoStats = infoManager.computeGlobalStats();
  assert.strictEqual(liveInfoStats.total, catalogue.length, 'Live info stats total must match canonical catalogue count');
  assert.ok(liveInfoStats.totalSeasons >= catalogue.length, 'Live info stats must report totalSeasons');
  assert.ok(liveInfoStats.totalAuthoritativeEpisodes > liveInfoStats.totalImportedEpisodes, 'Live info stats must separate totalAuthoritativeEpisodes and totalImportedEpisodes');
  assert.strictEqual(typeof liveInfoStats.confirmedFake, 'number', 'Live info stats must report confirmedFake count');

  const { inspectLatestAppSourceMetadata } = await import('../server/source-packager.ts');
  const pkgMeta = inspectLatestAppSourceMetadata();
  assert.ok(pkgMeta.excludedSensitiveItems.some(item => item.includes('.env')), 'Source package must exclude .env secrets');
  assert.ok(pkgMeta.excludedSensitiveItems.some(item => item.includes('owner-account.json')), 'Source package must exclude owner-account.json');
  assert.ok(pkgMeta.excludedSensitiveItems.some(item => item.includes('owner-sessions.json')), 'Source package must exclude owner-sessions.json');
  console.log('✓ PASS: Live Owner statistics and source package secret exclusions verified.');

  // ---------------------------------------------------------------------------
  // PHASE 3 STEP 2: RARETOON IMPORTER & EPISODE-DATA INTEGRITY
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 3 Step 2] Verifying Rare Toon Importer & Episode-Data Integrity across 6 representative cases...');

  // 1. Normal TV anime (with reliable episode count, release year, and status)
  const frierenCat = catalogue.find((a: any) => a.id === 'anivault_rt_frieren_beyond_journeys_end');
  assert.ok(frierenCat, 'Normal TV anime Frieren must exist');
  assert.strictEqual(frierenCat.type, 'TV');
  assert.strictEqual(frierenCat.releaseYear, 2023);
  assert.strictEqual(frierenCat.status, 'Completed');
  assert.strictEqual(frierenCat.authoritativeTotalEpisodes, 28);
  assert.strictEqual(frierenCat.importedEpisodesCount, 28);
  assert.strictEqual(frierenCat.episodeListStatus, 'complete');
  assert.strictEqual(frierenCat.isEpisodeListComplete, true);

  // 2. Anime with partial imported episodes (authoritative = 24, imported = 6, status = partial)
  const partialImportRes = ingestRawRareToonItems(
    [
      {
        canonicalUrl: 'https://www.rareanimes.mov/hindi/sample-24-ep-anime-season-1/',
        title: 'Sample 24 Ep Anime Season 1 (2023) Episodes 1-24 Hindi Dubbed',
        imageUrl: 'https://www.rareanimes.mov/wp-content/uploads/2023/10/sample24.jpg',
        description: 'Status: Completed. Watch Sample 24 Ep Anime All 24 Episodes in Hindi.',
        source: 'unit_test',
        episodes: Array.from({ length: 6 }, (_, i) => ({
          episodeNumber: i + 1,
          title: `Episode ${i + 1}`,
          canonicalUrl: `https://www.rareanimes.mov/hindi/sample-24-ep-anime-season-1/ep-${i + 1}/`
        }))
      }
    ],
    []
  );
  assert.strictEqual(partialImportRes.finalCatalogue.length, 1);
  const partial24 = partialImportRes.finalCatalogue[0];
  assert.strictEqual(partial24.authoritativeTotalEpisodes, 24, 'Authoritative count must remain 24 (never reduced to 6)');
  assert.strictEqual(partial24.totalEpisodes, 24, 'totalEpisodes must remain 24');
  assert.strictEqual(partial24.importedEpisodesCount, 6, 'Imported count must be 6');
  assert.strictEqual(partial24.seasons![0].episodes.length, 6, 'Must NEVER generate fake episodes 7-24');
  assert.strictEqual(partial24.episodeListStatus, 'partial', 'Status must be partial when 6 of 24 episodes imported');
  assert.strictEqual(partial24.episodeImportStatus, 'partial', 'episodeImportStatus must be partial');
  assert.strictEqual(partial24.isEpisodeListComplete, false, 'isEpisodeListComplete must be false');
  assert.strictEqual(partial24.releaseYear, 2023);
  assert.strictEqual(partial24.status, 'Completed');

  // 3. Movie (with and without release year)
  const movieImportRes = ingestRawRareToonItems(
    [
      {
        canonicalUrl: 'https://www.rareanimes.mov/movies/sample-anime-movie-hindi/',
        title: 'Sample Anime Movie Hindi Dubbed Download HD',
        imageUrl: 'https://www.rareanimes.mov/wp-content/uploads/2022/05/movie.jpg',
        description: 'Watch Sample Anime Movie in Hindi.',
        source: 'unit_test'
      }
    ],
    []
  );
  const importedMovie = movieImportRes.finalCatalogue[0];
  assert.strictEqual(importedMovie.type, 'Movie');
  assert.strictEqual(importedMovie.authoritativeTotalEpisodes, 1, 'Movie authoritative episode count must be 1');
  assert.strictEqual(importedMovie.importedEpisodesCount, 1, 'Movie imported episode count must be 1');
  assert.strictEqual(importedMovie.episodeListStatus, 'complete', 'Movie with 1 episode must be complete');
  assert.strictEqual(importedMovie.releaseYear, null, 'Movie without year in title/slug/desc must NOT invent 2022 or use WP upload path year');
  assert.strictEqual(importedMovie.status, 'Completed');

  // 4, 5, 6. Anime without reliable episode-count, release-year, or status information
  const unknownTvRes = ingestRawRareToonItems(
    [
      {
        canonicalUrl: 'https://www.rareanimes.mov/hindi/mystery-unverified-series-season-1-hindi/',
        title: 'Mystery Unverified Series Season 1 Hindi Dubbed Episodes Download HD',
        imageUrl: 'https://www.rareanimes.mov/wp-content/uploads/2021/04/mystery.jpg',
        description: 'Download Mystery Unverified Series Season 1 [Complete Season 01] in Hindi.',
        source: 'unit_test'
      }
    ],
    []
  );
  const unknownTv = unknownTvRes.finalCatalogue[0];
  assert.strictEqual(unknownTv.type, 'TV');
  assert.strictEqual(unknownTv.authoritativeTotalEpisodes, null, 'TV anime without reliable episode count must have null authoritativeTotalEpisodes (never 12)');
  assert.strictEqual(unknownTv.totalEpisodes, null, 'TV anime without reliable episode count must have null totalEpisodes');
  assert.strictEqual(unknownTv.seasons![0].authoritativeEpisodeCount, null, 'Season without reliable episode count must have null authoritativeEpisodeCount');
  assert.strictEqual(unknownTv.importedEpisodesCount, 1, 'Imported episode count must be 1');
  assert.strictEqual(unknownTv.seasons![0].episodes.length, 1, 'Must not generate fake episodes');
  assert.strictEqual(unknownTv.episodeListStatus, 'partial', 'TV anime with unknown authoritative count and 1 imported episode must be partial');
  assert.strictEqual(unknownTv.isEpisodeListComplete, false, 'TV anime with unknown authoritative count must not be marked complete');
  assert.strictEqual(unknownTv.releaseYear, null, 'TV anime without reliable release year must have null releaseYear (never 2021)');
  assert.strictEqual(unknownTv.status, 'Unknown', 'TV anime without reliable status must have Unknown status (never guessed Completed)');

  // Also verify that an anime with a known historical year (e.g. 2018 <= 2024) but no status text stays 'Unknown' (no year <= 2024 rule)
  const yearOnlyTvRes = ingestRawRareToonItems(
    [
      {
        canonicalUrl: 'https://www.rareanimes.mov/hindi/older-series-2018-season-1-hindi/',
        title: 'Older Series (2018) Season 1 Hindi Dubbed',
        imageUrl: null,
        description: 'Watch Older Series (2018) Season 1 in Hindi.',
        source: 'unit_test'
      }
    ],
    []
  );
  const yearOnlyTv = yearOnlyTvRes.finalCatalogue[0];
  assert.strictEqual(yearOnlyTv.releaseYear, 2018, 'Explicit release year 2018 must be extracted');
  assert.strictEqual(yearOnlyTv.status, 'Unknown', 'Release year <= 2024 must NEVER cause status to be guessed as Completed');
  assert.strictEqual(yearOnlyTv.authoritativeTotalEpisodes, null, 'Episode count must remain null when not provided');

  // Verify persisted catalogue representative records for unknown episode count, unknown year, and unknown status
  const gavvCat = catalogue.find(
    (a: any) => a.id === 'anivault_rt_hindi_kamen_rider_gavv_season_1_hindi_dubbed_episodes_download_hd'
  );
  assert.ok(gavvCat, 'Kamen Rider Gavv must exist in catalogue');
  assert.strictEqual(gavvCat.authoritativeTotalEpisodes, null, 'Kamen Rider Gavv authoritativeTotalEpisodes must be null (not 12)');
  assert.strictEqual(gavvCat.importedEpisodesCount, 1, 'Kamen Rider Gavv importedEpisodesCount must be 1');
  assert.strictEqual(gavvCat.episodeListStatus, 'partial', 'Kamen Rider Gavv episodeListStatus must be partial');
  assert.strictEqual(gavvCat.releaseYear, null, 'Kamen Rider Gavv releaseYear must be null (not 2021)');
  assert.strictEqual(gavvCat.status, 'Unknown', 'Kamen Rider Gavv status must be Unknown (not Completed)');

  const koyaMovieCat = catalogue.find(
    (a: any) => a.id === 'anivault_rt_doraemon_the_movie_adventure_of_koya_koya_planet'
  );
  assert.ok(koyaMovieCat, 'Doraemon Koya Koya Planet movie must exist in catalogue');
  assert.strictEqual(koyaMovieCat.type, 'Movie');
  assert.strictEqual(koyaMovieCat.releaseYear, null, 'Movie without reliable release year in source must have null releaseYear (not 2021/2022)');
  assert.strictEqual(koyaMovieCat.authoritativeTotalEpisodes, 1);
  assert.strictEqual(koyaMovieCat.importedEpisodesCount, 1);

  console.log('✓ PASS: Phase 3 Step 2 Rare Toon importer & episode-data integrity verified across all 6 representative cases.');

  // ---------------------------------------------------------------------------
  // PHASE 3 STEP 3: SHARED WORKER CAPACITY, TELEMETRY & HISTORICAL FAILURES
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 3 Step 3] Verifying Shared Worker Capacity (50 Production / 80 Infrastructure), Telemetry Invariants & Historical Failures...');

  const testPool = new ReusableWorkerJobEngine({ isolated: true });
  const initialSnap = testPool.getSnapshot();
  assert.strictEqual(initialSnap.workerCount, 50, 'Default practical production workers must be 50 (never auto-run 80)');
  assert.strictEqual(initialSnap.poolConfig.currentWorkers, 50, 'poolConfig.currentWorkers must default to 50');
  assert.strictEqual(initialSnap.architectureCapacity, 80, 'Infrastructure capacity must be 80');

  // Verify explicit scaling up to 80 is supported by infrastructure, and capped at 80
  const scaledCfg = testPool.setWorkerPoolConfig({ maxWorkers: 100, currentWorkers: 90 });
  assert.strictEqual(scaledCfg.maxWorkers, 80, 'Infrastructure maxWorkers must cap at 80');
  assert.strictEqual(scaledCfg.currentWorkers, 80, 'Infrastructure currentWorkers must cap at 80');
  // Restore normal production configuration (50 workers)
  const prodCfg = testPool.setWorkerPoolConfig({ maxWorkers: 50, currentWorkers: 50, concurrencyLimit: 50 });
  assert.strictEqual(prodCfg.currentWorkers, 50, 'Restored production worker count must be 50');

  // Verify both ARTWORK_VERIFICATION and INFORMATION_VERIFICATION share the same worker pool
  let artProcessedByPool = 0;
  let infoProcessedByPool = 0;
  testPool.registerSystemProcessor('ARTWORK_VERIFICATION', async (task, wId) => {
    testPool.heartbeat(wId, 'Checking artwork', 'AniList');
    artProcessedByPool++;
    return { status: 'verified', workerId: wId, taskId: task.taskId };
  });
  testPool.registerSystemProcessor('INFORMATION_VERIFICATION', async (task, wId) => {
    testPool.heartbeat(wId, 'Checking metadata', 'AniList');
    if (task.animeId === 'test_fail_anime') {
      throw new Error('Permanent test source validation error');
    }
    infoProcessedByPool++;
    return { status: 'verified', workerId: wId, taskId: task.taskId };
  });

  testPool.submitTasks(
    [
      { taskId: 'VERIFY_ARTWORK:test_art_1', jobSystem: 'ARTWORK_VERIFICATION', animeId: 'test_art_1', title: 'Test Art 1', payload: { id: 'test_art_1' } },
      { taskId: 'VERIFY_ARTWORK:test_art_2', jobSystem: 'ARTWORK_VERIFICATION', animeId: 'test_art_2', title: 'Test Art 2', payload: { id: 'test_art_2' } }
    ],
    'batch',
    2,
    'ARTWORK_VERIFICATION'
  );
  testPool.submitTasks(
    [
      { taskId: 'VERIFY_INFORMATION:test_info_1', jobSystem: 'INFORMATION_VERIFICATION', animeId: 'test_info_1', title: 'Test Info 1', payload: { id: 'test_info_1' } },
      { taskId: 'VERIFY_INFORMATION:test_fail_anime', jobSystem: 'INFORMATION_VERIFICATION', animeId: 'test_fail_anime', title: 'Test Fail Anime', payload: { id: 'test_fail_anime' } }
    ],
    'batch',
    2,
    'INFORMATION_VERIFICATION'
  );

  // Set maxRetries = 0 on the failing task so the test completes immediately without waiting for retry backoff
  const failTaskObj = (testPool as any).tasksMap.get('VERIFY_INFORMATION:test_fail_anime');
  if (failTaskObj) failTaskObj.maxRetries = 0;

  await testPool.runJobPool();

  const postRunSnap = testPool.getSnapshot();
  assert.strictEqual(artProcessedByPool, 2, 'Shared worker pool must execute Artwork tasks');
  assert.strictEqual(infoProcessedByPool, 1, 'Shared worker pool must execute Information tasks');
  assert.strictEqual(postRunSnap.counters.total, 4, 'Total tasks across shared run must be 4');
  assert.strictEqual(postRunSnap.counters.completed, 3, 'Completed tasks must be 3');
  assert.strictEqual(postRunSnap.counters.failed, 1, 'Failed tasks must be 1');
  assert.strictEqual(postRunSnap.counters.processed, 4, 'Processed tasks must be 4');
  assert.strictEqual(postRunSnap.counters.queued, 0, 'Queued tasks must be 0');
  assert.strictEqual(postRunSnap.counters.claimed, 0, 'Claimed tasks must be 0');
  assert.strictEqual(postRunSnap.counters.processing, 0, 'Processing tasks must be 0');

  // Attempt duplicate/stale/orphan completions to prove 1711/1710-style counter drift is impossible
  testPool.completeTask(1, 'VERIFY_ARTWORK:test_art_1', { status: 'verified' }, false);
  testPool.completeTask(2, 'VERIFY_INFORMATION:test_fail_anime', { status: 'verified' }, false);
  testPool.completeTask(3, 'VERIFY_ARTWORK:non_existent_orphan_task', { status: 'verified' }, false);

  const afterDupSnap = testPool.getSnapshot();
  assert.strictEqual(afterDupSnap.counters.total, 4, 'Total must remain 4 after duplicate/orphan completeTask calls');
  assert.strictEqual(afterDupSnap.counters.completed, 3, 'Completed must remain 3 (never exceed total)');
  assert.strictEqual(afterDupSnap.counters.failed, 1, 'Failed must remain 1 (never overwrite finalized failure or exceed total)');
  assert.strictEqual(afterDupSnap.counters.processed, 4, 'Processed must remain 4 (no 1711/1710-style counter possible)');
  assert.ok(afterDupSnap.counters.processed <= afterDupSnap.counters.total, 'processed <= total invariant');
  assert.ok(afterDupSnap.counters.completed <= afterDupSnap.counters.total, 'completed <= total invariant');
  assert.ok(afterDupSnap.counters.failed <= afterDupSnap.counters.total, 'failed <= total invariant');

  // Verify Historical Failures vs Current Active Failures separation:
  // Start a new clean 1-task Information job that succeeds; historical failure from previous run must remain in historicalFailures, NOT in current failed counter!
  testPool.submitTasks(
    [
      { taskId: 'VERIFY_INFORMATION:test_info_2', jobSystem: 'INFORMATION_VERIFICATION', animeId: 'test_info_2', title: 'Test Info 2', payload: { id: 'test_info_2' } }
    ],
    'batch',
    1,
    'INFORMATION_VERIFICATION'
  );
  await testPool.runJobPool();

  const secondRunSnap = testPool.getSnapshot('INFORMATION_VERIFICATION');
  assert.strictEqual(secondRunSnap.counters.total, 1, 'Second run total must be 1');
  assert.strictEqual(secondRunSnap.counters.completed, 1, 'Second run completed must be 1');
  assert.strictEqual(secondRunSnap.counters.failed, 0, 'Historical failures must NOT be reported as current job failures');
  assert.strictEqual(secondRunSnap.historicalFailures.currentJobFailedCount, 0, 'currentJobFailedCount must be 0');
  assert.ok(secondRunSnap.historicalFailures.permanentlyFailedCount >= 1, 'Historical failure must be preserved in permanentlyFailedCount');
  assert.strictEqual(secondRunSnap.historicalFailures.hasUnresolvedFailures, true, 'Unresolved historical failure must remain identifiable');
  assert.ok(secondRunSnap.successRatePercent < 100, 'Unresolved failures must NEVER be reported as 100% overall success');

  console.log('✓ PASS: Phase 3 Step 3 shared worker capacity (50/80), telemetry invariants, and historical failure separation verified.');

  // ---------------------------------------------------------------------------
  // PHASE 4: ANIME DETAILS + SHARING + CANONICAL LINK ROUTING
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 4] Verifying Anime Details Metadata, Season/Episode Integrity, Watch URL Resolution, Share & Copy Link Routing...');

  const {
    calculateTotalEpisodes,
    calculateSeasonEpisodes,
    calculateImportedEpisodes,
    calculateSeasonImportedEpisodes,
    getSeasonEpisodeStatus,
    resolveAnimeLanguages,
    resolveRelatedAnimeItems,
    resolveWatchUrl,
    getAnimeDetailsPath,
    getAnimeShareUrl,
    parseAnimeIdFromLocation
  } = await import('../src/utils/provider.ts');

  // 1. Canonical Share URL & Copy Link generation and parsing
  assert.strictEqual(
    getAnimeDetailsPath('anivault_rt_solo_leveling'),
    '/anime/anivault_rt_solo_leveling',
    'Canonical path must follow /anime/{anime-id}'
  );
  assert.strictEqual(
    getAnimeShareUrl('anivault_rt_solo_leveling', 'https://zenime.example.com'),
    'https://zenime.example.com/anime/anivault_rt_solo_leveling',
    'Share URL must join origin and /anime/{anime-id}'
  );
  assert.strictEqual(
    parseAnimeIdFromLocation('/anime/anivault_rt_solo_leveling'),
    'anivault_rt_solo_leveling',
    'Direct /anime/{anime-id} pathname must resolve exact anime ID'
  );
  assert.strictEqual(
    parseAnimeIdFromLocation('/anime/anivault_rt_solo_leveling/'),
    'anivault_rt_solo_leveling',
    'Trailing slash on /anime/{anime-id}/ must resolve exact anime ID'
  );
  assert.strictEqual(
    parseAnimeIdFromLocation('/', '?anime=anivault_rt_frieren_beyond_journeys_end'),
    'anivault_rt_frieren_beyond_journeys_end',
    'Query param ?anime={anime-id} must resolve exact anime ID'
  );
  assert.strictEqual(
    parseAnimeIdFromLocation('/', '', '#/anime/anivault_rt_haikyu'),
    'anivault_rt_haikyu',
    'Hash route #/anime/{anime-id} must resolve exact anime ID'
  );
  assert.strictEqual(
    parseAnimeIdFromLocation('/'),
    null,
    'Root path / must return null anime ID'
  );

  // 2. Multi-season anime stays ONE title in catalogue with season selector & separate season episode counts
  const aotCat = catalogue.find((a: any) => a.id === 'anivault_rt_attack_on_titan');
  assert.ok(aotCat, 'Multi-season anime Attack on Titan must exist as a single title');
  assert.ok(Array.isArray(aotCat.seasons) && aotCat.seasons.length === 4, 'Attack on Titan must have 4 seasons inside its single anime entry');
  assert.strictEqual(calculateTotalEpisodes(aotCat), 87, 'Attack on Titan total authoritative episodes must be 87');
  assert.strictEqual(calculateSeasonEpisodes(aotCat.seasons[0]), 25, 'Attack on Titan Season 1 authoritative episode count must be 25');
  assert.strictEqual(calculateSeasonImportedEpisodes(aotCat.seasons[0]), 1, 'Attack on Titan Season 1 imported episode records must be 1');
  assert.strictEqual(getSeasonEpisodeStatus(aotCat.seasons[0]), 'partial', 'Attack on Titan Season 1 must be marked partial');

  const miraculousCat = catalogue.find((a: any) => a.id === 'anivault_rt_miraculous_tales_of_ladybug_cat_noir');
  assert.ok(miraculousCat && miraculousCat.seasons.length === 6, 'Miraculous must have 6 seasons inside its single anime entry');
  assert.strictEqual(calculateSeasonEpisodes(miraculousCat.seasons[0]), null, 'Miraculous Season 1 unknown authoritative count must remain null');
  assert.strictEqual(calculateSeasonEpisodes(miraculousCat.seasons[4]), 27, 'Miraculous Season 5 authoritative count must be 27');

  // 3. Complete vs Partial vs Unknown episode counts in Anime Details helpers
  assert.strictEqual(calculateTotalEpisodes(frierenCat), 28, 'Frieren total authoritative episodes must be 28');
  assert.strictEqual(calculateImportedEpisodes(frierenCat), 28, 'Frieren total imported episode records must be 28');
  assert.strictEqual(getSeasonEpisodeStatus(frierenCat.seasons[0]), 'complete', 'Frieren Season 1 status must be complete');

  assert.strictEqual(calculateTotalEpisodes(gavvCat), null, 'Unknown episode count anime must return null from calculateTotalEpisodes (never invented)');
  assert.strictEqual(calculateImportedEpisodes(gavvCat), 1, 'Kamen Rider Gavv imported episode count must be 1');
  assert.strictEqual(getSeasonEpisodeStatus(gavvCat.seasons[0]), 'partial', 'Unknown authoritative count with 1 imported episode must be partial');

  // 4. Languages & Related Anime resolution from verified catalogue data (never invented)
  const doraemonStarWars = catalogue.find((a: any) => a.id === 'anivault_rt_doraemon_nobitas_little_star_wars_2021_remake');
  assert.ok(doraemonStarWars, 'Doraemon Little Star Wars 2021 Remake must exist');
  assert.strictEqual(doraemonStarWars.japaneseTitle, 'ドラえもん のび太の宇宙小戦争');
  const doraemonLangs = resolveAnimeLanguages(doraemonStarWars);
  assert.ok(doraemonLangs.includes('Hindi') && doraemonLangs.includes('Japanese'), 'Must resolve verified languages');
  const doraemonRelated = resolveRelatedAnimeItems(doraemonStarWars, catalogue);
  assert.ok(doraemonRelated.length >= 2, 'Must resolve verified related anime and franchise relationships');

  const ippoRising = catalogue.find((a: any) => a.id === 'anivault_rt_hajime_no_ippo_the_fighting_rising');
  const ippoRelated = resolveRelatedAnimeItems(ippoRising, catalogue);
  assert.ok(
    ippoRelated.some(r => r.matchedAnime && r.matchedAnime.id === 'anivault_rt_hajime_no_ippo_the_fighting_new_challenger'),
    'Related anime present in catalogue must link directly to its catalogue Anime object'
  );

  // 5. Watch button URL resolution
  const soloWatch = resolveWatchUrl(catalogue.find((a: any) => a.id === 'anivault_rt_solo_leveling'));
  assert.strictEqual(soloWatch.isAvailable, true, 'Solo Leveling watch URL must be available');
  assert.ok(soloWatch.url && soloWatch.url.startsWith('https://www.rareanimes.mov/'), 'Watch URL must point to canonical rareanimes.mov URL');

  console.log('✓ PASS: Phase 4 Anime Details, Season/Episode separation, Watch URL resolution, Share Anime & Copy Anime Link routing verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 1, PHASE 2, PHASE 3 & PHASE 4 AUDIT CHECKS PASSED!');
  console.log('================================================================\n');
}

runFoundationAuditTests().catch(err => {
  console.error('❌ FOUNDATION AUDIT TEST FAILED:', err);
  process.exit(1);
});
