import {
  ReusableWorkerJobEngine,
  createDeterministicTaskId,
  JobTask,
  LEASE_DURATION_MS
} from '../server/worker-job-engine.ts';

// Assert helper
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('ANIVEX 50-WORKER COORDINATION & RELIABILITY TEST SUITE');
  console.log('========================================================\n');

  // TEST 1: 50 Workers Initialized & Registered
  console.log('[Test 1] Verifying 50 Real Worker Instances & Pool Config...');
  const engine = new ReusableWorkerJobEngine();
  const config = engine.getWorkerPoolConfig();
  assert(config.currentWorkers === 50, `Expected 50 workers, found ${config.currentWorkers}`);
  assert(config.maxWorkers === 50, `Expected maxWorkers 50, found ${config.maxWorkers}`);

  const snapshot1 = engine.getSnapshot();
  assert(snapshot1.workerCount === 50, 'Snapshot workerCount must be 50');
  assert(snapshot1.activeWorkers.length === 50, `Expected 50 activeWorkers, found ${snapshot1.activeWorkers.length}`);
  for (let i = 1; i <= 50; i++) {
    const w = snapshot1.activeWorkers.find(x => x.workerId === i);
    assert(!!w, `Worker #${i} must be registered`);
    assert(w!.status === 'idle', `Worker #${i} must start idle`);
  }
  console.log('✓ PASS: All 50 workers registered, active, and initialized.\n');

  // TEST 2: Deterministic Task Identity & Deduplication
  console.log('[Test 2] Verifying Deterministic Task IDs & Deduplication...');
  const id1 = createDeterministicTaskId('artwork_verification', 'naruto-shippuden');
  const id2 = createDeterministicTaskId('VERIFY_ARTWORK', 'naruto-shippuden');
  const id3 = createDeterministicTaskId('artwork_fix', 'naruto-shippuden');
  const idSeason = createDeterministicTaskId('verify_season', 'naruto-shippuden', 2);

  assert(id1 === 'VERIFY_ARTWORK:naruto-shippuden', `Expected VERIFY_ARTWORK:naruto-shippuden, got ${id1}`);
  assert(id1 === id2, 'Case insensitivity must match');
  assert(id3 === 'FIX_ARTWORK:naruto-shippuden', `Expected FIX_ARTWORK:naruto-shippuden, got ${id3}`);
  assert(idSeason === 'VERIFY_SEASON:naruto-shippuden:2', `Expected VERIFY_SEASON:naruto-shippuden:2, got ${idSeason}`);

  // Test submitting duplicate tasks
  engine.submitTasks([
    { taskId: id1, animeId: 'naruto-shippuden', title: 'Naruto Shippuden', payload: { id: 'naruto-shippuden' } },
    { taskId: id1, animeId: 'naruto-shippuden', title: 'Naruto Shippuden (Duplicate)', payload: { id: 'naruto-shippuden' } },
    { taskId: createDeterministicTaskId('VERIFY_ARTWORK', 'one-piece'), animeId: 'one-piece', title: 'One Piece', payload: { id: 'one-piece' } }
  ]);

  const snapDedupe = engine.getSnapshot();
  assert(snapDedupe.totalTasks === 2, `Expected 2 deduplicated tasks, got ${snapDedupe.totalTasks}`);
  assert(snapDedupe.queuedCount === 2, `Expected 2 queued tasks, got ${snapDedupe.queuedCount}`);
  console.log('✓ PASS: Deterministic task IDs and queue deduplication enforced.\n');

  // TEST 3: Atomic Task Claiming & Mutual Exclusion
  console.log('[Test 3] Verifying Atomic Task Claiming & Mutual Exclusion...');
  // Worker 1 claims first task
  const claimedByW1 = engine.claimTask(1);
  assert(claimedByW1 !== null, 'Worker 1 should claim an available task');
  assert(claimedByW1!.status === 'claimed', 'Task status must be claimed');
  assert(claimedByW1!.claimedByWorkerId === 1, 'Task must be claimed by worker 1');

  // Worker 2 attempts to claim: must get the OTHER task, not the one Worker 1 has
  const claimedByW2 = engine.claimTask(2);
  assert(claimedByW2 !== null, 'Worker 2 should claim the second task');
  assert(claimedByW2!.taskId !== claimedByW1!.taskId, 'Worker 2 must NOT claim the same task as Worker 1');
  assert(claimedByW2!.claimedByWorkerId === 2, 'Task must be claimed by worker 2');

  // Worker 3 attempts to claim: queue is now empty
  const claimedByW3 = engine.claimTask(3);
  assert(claimedByW3 === null, 'Worker 3 should receive null when queue is empty');

  // Complete both tasks
  engine.completeTask(1, claimedByW1!.taskId, { verified: true }, false);
  engine.completeTask(2, claimedByW2!.taskId, { verified: true }, false);
  console.log('✓ PASS: Atomic claiming enforces single-worker ownership.\n');

  // TEST 4: Prevent Duplicate Anime Processing (Critical Anime Locking)
  console.log('[Test 4] Verifying Exclusive Anime-Level Claim / Lease (Requirement 4)...');
  // Enqueue two different tasks for the SAME anime (e.g. Verify and Fix)
  engine.submitTasks([
    {
      taskId: 'VERIFY_ARTWORK:bleach',
      animeId: 'bleach',
      title: 'Bleach',
      payload: { id: 'bleach' },
      priority: 'HIGH'
    },
    {
      taskId: 'FIX_ARTWORK:bleach',
      animeId: 'bleach',
      title: 'Bleach (Fix)',
      payload: { id: 'bleach' },
      priority: 'HIGH'
    },
    {
      taskId: 'VERIFY_ARTWORK:death-note',
      animeId: 'death-note',
      title: 'Death Note',
      payload: { id: 'death-note' },
      priority: 'HIGH'
    }
  ]);

  // Worker 1 claims Task 1 (Bleach)
  const taskW1 = engine.claimTask(1);
  assert(taskW1 !== null && taskW1.animeId === 'bleach', 'Worker 1 must claim Bleach');

  // Worker 2 attempts to claim:
  // Bleach is locked! Worker 2 MUST skip FIX_ARTWORK:bleach and claim Death Note instead!
  const taskW2 = engine.claimTask(2);
  assert(taskW2 !== null, 'Worker 2 must receive a task');
  assert(taskW2!.animeId === 'death-note', `Worker 2 should have skipped locked Bleach and claimed death-note! Got: ${taskW2!.animeId}`);

  // Worker 3 attempts to claim:
  // Only FIX_ARTWORK:bleach remains in queue, but Bleach is locked by Worker 1.
  // Worker 3 MUST NOT claim Bleach while Worker 1 owns it!
  const taskW3 = engine.claimTask(3);
  assert(taskW3 === null, 'Worker 3 must receive null because Bleach is exclusively locked by Worker 1!');

  // Check live registry
  const snapWithLocks = engine.getSnapshot();
  assert(snapWithLocks.activeAnimeLocks.length === 2, `Expected 2 active anime locks, got ${snapWithLocks.activeAnimeLocks.length}`);
  assert(snapWithLocks.liveAnimeRegistry['bleach']?.workerId === 1, 'Bleach must be owned by Worker 1 in registry');
  assert(snapWithLocks.liveAnimeRegistry['death-note']?.workerId === 2, 'Death Note must be owned by Worker 2 in registry');

  // Now Worker 1 finishes Bleach
  engine.completeTask(1, taskW1!.taskId, { success: true }, false);

  // Once Bleach is released, Worker 3 can now claim FIX_ARTWORK:bleach!
  const taskW3After = engine.claimTask(3);
  assert(taskW3After !== null && taskW3After.taskId === 'FIX_ARTWORK:bleach', 'Worker 3 should now claim Bleach after Worker 1 completed');

  engine.completeTask(2, taskW2!.taskId, { success: true }, false);
  engine.completeTask(3, taskW3After!.taskId, { success: true }, false);
  console.log('✓ PASS: Exclusive anime lock strictly prevents simultaneous processing.\n');

  // TEST 5: Season Coordination & Parent Anime Lock
  console.log('[Test 5] Verifying Season Coordination & Parent Anime Lock...');
  engine.submitTasks([
    {
      taskId: 'VERIFY_SEASON:attack-on-titan:1',
      animeId: 'attack-on-titan',
      seasonId: '1',
      title: 'Attack on Titan Season 1',
      payload: { id: 'attack-on-titan', season: 1 }
    },
    {
      taskId: 'VERIFY_SEASON:attack-on-titan:2',
      animeId: 'attack-on-titan',
      seasonId: '2',
      title: 'Attack on Titan Season 2',
      payload: { id: 'attack-on-titan', season: 2 }
    }
  ]);

  const sW1 = engine.claimTask(1);
  assert(sW1 !== null && sW1.seasonId === '1', 'Worker 1 claims Season 1');

  // Worker 2 tries to claim: Parent anime 'attack-on-titan' is locked by Worker 1
  const sW2 = engine.claimTask(2);
  assert(sW2 === null, 'Worker 2 must NOT claim Season 2 while parent anime is locked');

  engine.completeTask(1, sW1!.taskId, { success: true }, false);
  const sW2After = engine.claimTask(2);
  assert(sW2After !== null && sW2After.seasonId === '2', 'Worker 2 claims Season 2 after Season 1 is released');
  engine.completeTask(2, sW2After!.taskId, { success: true }, false);
  console.log('✓ PASS: Season coordination and parent anime locking verified.\n');

  // TEST 6: Stale Worker Watchdog Recovery
  console.log('[Test 6] Verifying Stale Worker Watchdog Recovery (Heartbeat Timeout)...');
  engine.submitTasks([
    {
      taskId: 'VERIFY_ARTWORK:steins-gate',
      animeId: 'steins-gate',
      title: 'Steins;Gate',
      payload: { id: 'steins-gate' }
    }
  ]);

  const staleTask = engine.claimTask(5);
  assert(staleTask !== null, 'Worker 5 claims Steins;Gate');

  // Manually simulate stale lease (>30s ago)
  (staleTask as any).leaseExpiresAt = Date.now() - 5000;
  const worker5 = (engine as any).workerMap.get(5);
  if (worker5) worker5.lastHeartbeat = Date.now() - 40000;
  const claim5 = (engine as any).claimedTasks.get(staleTask!.taskId);
  if (claim5) claim5.leaseExpiresAt = Date.now() - 5000;

  // Run recoverStaleTasks
  const recovered = engine.recoverStaleTasks();
  assert(recovered === 1, `Expected 1 recovered stale task, got ${recovered}`);

  // Steins;Gate should now be back in queue and claimable by Worker 6!
  const recoveredClaim = engine.claimTask(6);
  assert(recoveredClaim !== null && recoveredClaim.taskId === 'VERIFY_ARTWORK:steins-gate', 'Worker 6 should successfully claim recovered task');
  engine.completeTask(6, recoveredClaim!.taskId, { ok: true }, false);
  console.log('✓ PASS: Stale worker heartbeat timeout detected & recovered without task loss.\n');

  // TEST 7: 50-Worker Fleet Concurrent Stress Test
  console.log('[Test 7] Running 50-Worker Fleet Concurrent Concurrency & Race-Condition Test...');
  const NUM_ANIME = 100;
  const testTasks: any[] = [];
  for (let i = 1; i <= NUM_ANIME; i++) {
    testTasks.push({
      taskId: `VERIFY_ARTWORK:anime-${i}`,
      animeId: `anime-${i}`,
      title: `Anime Title #${i}`,
      payload: { id: `anime-${i}` }
    });
  }

  engine.submitTasks(testTasks);

  // Invariant tracker: At any millisecond, an animeId may ONLY be processed by 1 worker!
  const activeAnimeHolders = new Map<string, number>();
  let concurrencyViolations = 0;
  let maxActiveConcurrentWorkers = 0;
  let currentActive = 0;

  await engine.runJobPool(async (task: JobTask, workerId: number) => {
    currentActive++;
    if (currentActive > maxActiveConcurrentWorkers) {
      maxActiveConcurrentWorkers = currentActive;
    }

    const animeId = task.animeId;
    if (activeAnimeHolders.has(animeId)) {
      console.error(`💥 RACE CONDITION DETECTED! Anime ${animeId} is already held by Worker #${activeAnimeHolders.get(animeId)} while Worker #${workerId} claimed it!`);
      concurrencyViolations++;
    }
    activeAnimeHolders.set(animeId, workerId);

    // Simulate work with randomized delay (5ms to 20ms)
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 15) + 5));

    activeAnimeHolders.delete(animeId);
    currentActive--;
    return { verified: true, workerId };
  });

  const finalSnap = engine.getSnapshot();
  assert(concurrencyViolations === 0, `Detected ${concurrencyViolations} concurrency/race violations!`);
  assert(finalSnap.completedCount === NUM_ANIME, `Expected ${NUM_ANIME} completed, got ${finalSnap.completedCount}`);
  assert(finalSnap.failedCount === 0, `Expected 0 failed, got ${finalSnap.failedCount}`);
  assert(finalSnap.progressPercent === 100, `Expected 100% progress, got ${finalSnap.progressPercent}`);
  console.log(`✓ PASS: 50-worker pool processed 100 tasks with peak concurrency = ${maxActiveConcurrentWorkers} workers.`);
  console.log(`✓ PASS: Zero race conditions or duplicate anime claims detected.\n`);

  // TEST 8: Worker Failure Isolation
  console.log('[Test 8] Verifying Worker Failure Isolation (Worker Crash Handling)...');
  engine.submitTasks([
    { taskId: 'VERIFY_ARTWORK:crash-test-1', animeId: 'crash-test-1', title: 'Crash Test 1', payload: { id: 'crash-test-1' } },
    { taskId: 'VERIFY_ARTWORK:crash-test-2', animeId: 'crash-test-2', title: 'Crash Test 2', payload: { id: 'crash-test-2' } }
  ]);

  // Simulate processor where one task throws an uncaught error
  await engine.runJobPool(async (task: JobTask, workerId: number) => {
    if (task.animeId === 'crash-test-1') {
      throw new Error('Simulated network timeout/crash in Worker');
    }
    return { success: true };
  });

  const crashSnap = engine.getSnapshot();
  assert(crashSnap.status === 'completed', 'Job should finish remaining work despite error in one task');
  console.log('✓ PASS: Worker failure isolated without stopping worker fleet.\n');

  console.log('========================================================');
  console.log('🎉 ALL 8 WORKER COORDINATION & RELIABILITY TESTS PASSED!');
  console.log('========================================================');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
