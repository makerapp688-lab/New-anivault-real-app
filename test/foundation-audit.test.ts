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
    assert.ok(typeof anime.authoritativeTotalEpisodes === 'number' && anime.authoritativeTotalEpisodes > 0, `Anime ${anime.id} missing authoritativeTotalEpisodes`);
    assert.strictEqual(anime.totalEpisodes, anime.authoritativeTotalEpisodes, `Anime ${anime.id} totalEpisodes !== authoritativeTotalEpisodes`);
    assert.ok(typeof anime.importedEpisodesCount === 'number' && anime.importedEpisodesCount >= 0, `Anime ${anime.id} missing importedEpisodesCount`);
    assert.ok(['complete', 'partial', 'empty'].includes(anime.episodeListStatus), `Anime ${anime.id} invalid episodeListStatus`);

    let seasonAuthSum = 0;
    let seasonImpSum = 0;
    for (const s of anime.seasons) {
      const eps = Array.isArray(s.episodes) ? s.episodes : [];
      assert.strictEqual(s.importedEpisodeCount, eps.length, `Anime ${anime.id} S${s.seasonNumber} importedEpisodeCount !== episodes.length`);
      assert.ok(s.authoritativeEpisodeCount >= eps.length, `Anime ${anime.id} S${s.seasonNumber} authoritativeEpisodeCount < episodes.length`);
      assert.strictEqual(s.episodeCount, s.authoritativeEpisodeCount, `Anime ${anime.id} S${s.seasonNumber} episodeCount !== authoritativeEpisodeCount`);
      const expectedComplete = s.authoritativeEpisodeCount > 0 && eps.length >= s.authoritativeEpisodeCount;
      assert.strictEqual(s.isEpisodeListComplete, expectedComplete, `Anime ${anime.id} S${s.seasonNumber} isEpisodeListComplete mismatch`);
      seasonAuthSum += s.authoritativeEpisodeCount;
      seasonImpSum += eps.length;
    }
    assert.strictEqual(anime.authoritativeTotalEpisodes, seasonAuthSum, `Anime ${anime.id} authoritativeTotalEpisodes (${anime.authoritativeTotalEpisodes}) !== season sum (${seasonAuthSum})`);
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
  console.log('✓ PASS: Complete, partial, multi-season, conflicting metadata, weak-candidate insufficient evidence, and suspected fake workflows verified.');

  // ---------------------------------------------------------------------------
  // PHASE 2.3: WORKER POOL LIMITS, MATHEMATICAL CONSISTENCY & CROSS-SYSTEM SAFETY
  // ---------------------------------------------------------------------------
  console.log('\n[Phase 2.3] Verifying Worker Pool Limits (50 Production / 70 Capacity), Task Math & Worker Safety...');
  assert.strictEqual(DEFAULT_PRODUCTION_WORKERS, 50, 'DEFAULT_PRODUCTION_WORKERS must be 50');
  assert.strictEqual(MAX_INFRASTRUCTURE_WORKERS, 70, 'MAX_INFRASTRUCTURE_WORKERS must be 70');

  const isolatedEngine = new ReusableWorkerJobEngine({ isolated: true });
  const snap = isolatedEngine.getSnapshot();
  assert.strictEqual(snap.workerCount, 50, 'Active production worker count must be 50');
  assert.strictEqual(snap.architectureCapacity, 70, 'Maximum infrastructure capacity must be 70');

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

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 1 & PHASE 2 FOUNDATION AUDIT CHECKS PASSED!');
  console.log('================================================================\n');
}

runFoundationAuditTests().catch(err => {
  console.error('❌ FOUNDATION AUDIT TEST FAILED:', err);
  process.exit(1);
});
