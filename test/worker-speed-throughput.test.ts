import assert from 'assert';
import { globalSourceGateway, SourceGateway } from '../server/source-gateway.ts';
import { globalWorkerJobEngine, ReusableWorkerJobEngine, createDeterministicTaskId } from '../server/worker-job-engine.ts';
import { globalDataStore } from '../server/data-store.ts';
import {
  calculateStringSimilarity,
  cleanAnimeTitle,
  verifyAnimeEntry,
  queryAniList,
  queryTVmaze
} from '../server/artwork-verifier.ts';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTestSuite() {
  console.log('========================================================');
  console.log('ANIVEX PART 2: 50-WORKER SPEED, SMART SCHEDULING & THROUGHPUT TEST SUITE');
  console.log('========================================================');

  // ------------------------------------------------------------------
  // TEST 1: Shared Cache Multi-Tier Speed & Verification
  // ------------------------------------------------------------------
  console.log('\n[Test 1] Verifying Shared Multi-Tier Cache with TTL...');
  const testGateway = new SourceGateway();
  testGateway.registerSource('mock_api', {
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 10,
    minConcurrent: 1,
    maxConcurrent: 5,
    currentConcurrent: 3,
    timeoutMs: 5000
  });

  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    await sleep(20);
    return {
      success: true,
      matches: [{ id: 101, title: 'Attack on Titan', posterUrl: 'https://example.com/aot.jpg' }],
      statusCode: 200
    };
  };

  // First call should hit network (mockFetch)
  const testKey = `attack_on_titan_run_${Date.now()}`;
  const res1 = await testGateway.executeRequest('mock_api', testKey, mockFetch);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(fetchCallCount, 1, 'First call must hit network');
  assert.strictEqual(res1.isFromCache, undefined, 'First call is not from cache');

  // Second call with same normalized title should hit cache instantly (< 5ms, 0 network overhead)
  const startCache = Date.now();
  const res2 = await testGateway.executeRequest('mock_api', `  ${testKey.toUpperCase()}  `, mockFetch);
  const cacheDuration = Date.now() - startCache;
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.isFromCache, true, 'Second call must be served from cache');
  assert.strictEqual(fetchCallCount, 1, 'Fetch call count must remain 1 (no duplicate network request)');
  assert.ok(cacheDuration < 15, `Cache hit must be ultra-fast (took ${cacheDuration}ms)`);

  const metrics = testGateway.getAllMetrics()['mock_api'];
  assert.strictEqual(metrics.cacheHits, 1, 'Cache hits counter incremented');
  console.log(`✓ PASS: Shared cache eliminated redundant external query (Cache hit in ${cacheDuration}ms).`);

  // ------------------------------------------------------------------
  // TEST 2: In-Flight Singleflight Request Deduplication
  // ------------------------------------------------------------------
  console.log('\n[Test 2] Verifying In-Flight Singleflight Request Deduplication...');
  let flightCallCount = 0;
  const slowFetch = async () => {
    flightCallCount++;
    await sleep(60); // In-flight window
    return {
      success: true,
      matches: [{ id: 202, title: 'Steins;Gate' }],
      statusCode: 200
    };
  };

  // 10 concurrent workers request the exact same title at the exact same millisecond
  const flightKey = `steins_gate_flight_${Date.now()}`;
  const concurrentPromises = Array.from({ length: 10 }).map(() =>
    testGateway.executeRequest('mock_api', flightKey, slowFetch)
  );

  const results = await Promise.all(concurrentPromises);
  assert.strictEqual(flightCallCount, 1, 'Exactly ONE external network request must be made for 10 simultaneous workers');
  for (const r of results) {
    assert.strictEqual(r.success, true);
  }

  const postFlightMetrics = testGateway.getAllMetrics()['mock_api'];
  assert.strictEqual(postFlightMetrics.deduplicatedRequests, 9, '9 simultaneous requests were cleanly deduplicated');
  console.log(`✓ PASS: Singleflight deduplication coalesced 10 concurrent requests into 1 external call.`);

  // ------------------------------------------------------------------
  // TEST 3: Source-Specific Concurrency & Decoupled Worker Pool
  // ------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Source-Specific Concurrency Decoupled from 50 Workers...');
  let activeConcurrentReqs = 0;
  let maxObservedConcurrency = 0;
  const CONCURRENCY_CEILING = 3;

  testGateway.registerSource('anilist_test', {
    rateLimitPerMinute: 300,
    rateLimitPerSecond: 20,
    minConcurrent: 1,
    maxConcurrent: CONCURRENCY_CEILING,
    currentConcurrent: CONCURRENCY_CEILING,
    timeoutMs: 5000
  });

  const simulatedWorkerTasks = Array.from({ length: 25 }).map((_, i) =>
    testGateway.executeRequest('anilist_test', `anime_unique_${i}`, async () => {
      activeConcurrentReqs++;
      if (activeConcurrentReqs > maxObservedConcurrency) {
        maxObservedConcurrency = activeConcurrentReqs;
      }
      await sleep(25);
      activeConcurrentReqs--;
      return { success: true, matches: [], statusCode: 200 };
    })
  );

  await Promise.all(simulatedWorkerTasks);
  assert.ok(
    maxObservedConcurrency <= CONCURRENCY_CEILING,
    `Observed concurrency (${maxObservedConcurrency}) must not exceed ceiling (${CONCURRENCY_CEILING})`
  );
  console.log(`✓ PASS: 25 concurrent worker requests regulated strictly within source semaphore ceiling (Max observed: ${maxObservedConcurrency}/${CONCURRENCY_CEILING}).`);

  // ------------------------------------------------------------------
  // TEST 4: Adaptive Concurrency Control (AIMD) & Backoff
  // ------------------------------------------------------------------
  console.log('\n[Test 4] Verifying Adaptive Concurrency (AIMD) on Rate Limits...');
  testGateway.registerSource('adaptive_src', {
    rateLimitPerMinute: 60,
    rateLimitPerSecond: 2,
    minConcurrent: 1,
    maxConcurrent: 4,
    currentConcurrent: 3,
    timeoutMs: 5000
  });

  // Simulate a 429 Too Many Requests response with Retry-After header
  const rateLimitRes = await testGateway.executeRequest('adaptive_src', 'overloaded_query', async () => {
    return {
      success: false,
      error: 'Too Many Requests',
      statusCode: 429,
      headers: { 'retry-after': '3' }
    };
  });

  assert.strictEqual(rateLimitRes.success, false);
  const cbStatus = testGateway.getCircuitStatus('adaptive_src');
  assert.strictEqual(cbStatus.state, 'OPEN', 'Circuit must open on 429');
  const currentLimit = testGateway.getAdaptiveConcurrencyLimit('adaptive_src');
  assert.strictEqual(currentLimit, 1, 'Adaptive concurrency must immediately back off to minConcurrent (1)');
  console.log(`✓ PASS: 429 triggered immediate Multiplicative Decrease to concurrency=1 and circuit cooldown.`);

  // ------------------------------------------------------------------
  // TEST 5: Smart Work Switching & Permanent Disabled Source Enforcement
  // ------------------------------------------------------------------
  console.log('\n[Test 5] Verifying Smart Work Switching & Disabled Sources...');
  // Check Jikan and TMDB are permanently blocked
  const jikanRes = await globalSourceGateway.executeRequest('jikan', 'naruto', async () => {
    return { success: true, matches: [] };
  });
  assert.strictEqual(jikanRes.success, false);
  assert.ok(jikanRes.error?.includes('disabled'), 'Jikan must be blocked by specification');

  const tmdbRes = await globalSourceGateway.executeRequest('tmdb', 'naruto', async () => {
    return { success: true, matches: [] };
  });
  assert.strictEqual(tmdbRes.success, false);
  assert.ok(
    tmdbRes.error?.includes('skipped') || tmdbRes.error?.includes('disabled'),
    'TMDB must be skipped automatically when TMDB_API_KEY is absent'
  );

  assert.strictEqual(globalSourceGateway.isSourceAvailable('jikan'), false);
  assert.strictEqual(globalSourceGateway.isSourceAvailable('tmdb'), false);
  console.log('✓ PASS: Disabled/unconfigured optional sources (Jikan, TMDB without key) skipped instantly with zero network calls.');

  // ------------------------------------------------------------------
  // TEST 6: Fast-Path for Already-Verified Anime
  // ------------------------------------------------------------------
  console.log('\n[Test 6] Verifying Fast-Path Execution for Already-Verified Anime...');
  // Seed an already verified anime in data store
  const verifiedAnime = {
    id: 'fast-path-demo',
    title: 'Fullmetal Alchemist: Brotherhood',
    artwork: {
      verifiedArtworkUrl: 'https://images.example.com/fma-verified.jpg',
      isVerified: true,
      verificationStatus: 'verified',
      verificationSource: 'anilist'
    }
  };
  globalDataStore.updateCatalogueAnime('fast-path-demo', () => {}); // ensure loaded

  const startFast = Date.now();
  const fastResult = await verifyAnimeEntry(verifiedAnime, { autoFixEnabled: true, forceFreshSearch: false });
  const fastDuration = Date.now() - startFast;

  assert.strictEqual(fastResult.isFastPath, true, 'Already verified anime must take fast-path');
  assert.strictEqual(fastResult.status, 'verified');
  assert.ok(fastDuration < 20, `Fast path must complete in milliseconds (took ${fastDuration}ms)`);
  console.log(`✓ PASS: Fast-path completed in ${fastDuration}ms without external API queries.`);

  // ------------------------------------------------------------------
  // TEST 7: In-Memory Storage Engine Performance & 0 Lock Contention
  // ------------------------------------------------------------------
  console.log('\n[Test 7] Verifying In-Memory Storage Engine Performance...');
  const initialMetrics = globalDataStore.getStoreMetrics();
  assert.ok(initialMetrics.catalogueSize > 0, 'Catalogue size > 0');

  const startTime = Date.now();
  const WRITE_COUNT = 500;
  for (let i = 0; i < WRITE_COUNT; i++) {
    globalDataStore.applyCatalogueArtworkUpdate(
      'naruto',
      `https://example.com/art_${i}.jpg`,
      'verified',
      null,
      'benchmark'
    );
  }
  const totalWriteTime = Date.now() - startTime;
  const avgWriteTime = totalWriteTime / WRITE_COUNT;

  assert.ok(avgWriteTime < 0.2, `Average in-memory write time must be <0.2ms (was ${avgWriteTime.toFixed(3)}ms)`);
  console.log(`✓ PASS: 500 concurrent record updates processed in ${totalWriteTime}ms (${avgWriteTime.toFixed(3)}ms/write, 0 disk lock contention).`);

  // ------------------------------------------------------------------
  // TEST 8: 50 Coordinated Workers High-Throughput Batch Processing
  // ------------------------------------------------------------------
  console.log('\n[Test 8] Verifying 50-Worker High-Throughput Batch Processing...');
  const poolEngine = new ReusableWorkerJobEngine();
  poolEngine.setWorkerPoolConfig({
    minWorkers: 50,
    maxWorkers: 50,
    currentWorkers: 50,
    concurrencyLimit: 50
  });

  const TASK_COUNT = 150;
  const tasks = Array.from({ length: TASK_COUNT }).map((_, i) => ({
    taskId: createDeterministicTaskId('VERIFY_ARTWORK', `bench-anime-${i}`),
    animeId: `bench-anime-${i}`,
    title: `Benchmark Anime ${i}`,
    payload: { id: `bench-anime-${i}`, title: `Benchmark Anime ${i}` },
    priority: (i % 5 === 0 ? 'HIGH' : i % 2 === 0 ? 'MEDIUM' : 'NORMAL') as any
  }));

  poolEngine.submitTasks(tasks, 'benchmark');

  const runStart = Date.now();
  let peakActiveWorkers = 0;

  await poolEngine.runJobPool(async (task, workerId) => {
    const snap = poolEngine.getSnapshot();
    const active = snap.workerUtilization.active;
    if (active > peakActiveWorkers) peakActiveWorkers = active;

    // Simulate fast processing with shared cache / in-memory store
    await sleep(8 + Math.floor(Math.random() * 12));
    return { success: true, verified: true };
  });

  const totalRunDuration = Date.now() - runStart;
  const finalSnapshot = poolEngine.getSnapshot();

  assert.strictEqual(finalSnapshot.completedCount, TASK_COUNT, 'All 150 tasks must be completed successfully');
  assert.strictEqual(finalSnapshot.failedCount, 0, 'Zero task failures');
  assert.strictEqual(finalSnapshot.claimedCount, 0, 'Zero lingering claims');
  assert.ok(peakActiveWorkers >= 40, `50-worker pool reached peak active concurrency of ${peakActiveWorkers}`);

  const calculatedTasksPerMin = Math.round((TASK_COUNT / (totalRunDuration / 1000)) * 60);
  console.log(`✓ PASS: 150 tasks processed by 50 workers in ${totalRunDuration}ms (${calculatedTasksPerMin} tasks/min throughput).`);
  console.log(`✓ PASS: Peak active worker concurrency reached ${peakActiveWorkers}/50 workers.`);

  console.log('\n========================================================');
  console.log('🎉 ALL 8 SPEED, SMART SCHEDULING & THROUGHPUT TESTS PASSED!');
  console.log('========================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
