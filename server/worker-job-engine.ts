import fs from 'fs';
import path from 'path';
import { globalSourceGateway } from './source-gateway.ts';
import { globalDataStore } from './data-store.ts';

export type TaskPriority = 'HIGH' | 'MEDIUM' | 'NORMAL' | 'LOW';

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  currentWorkers: number;
  concurrencyLimit: number;
}

export interface JobTask<T = any> {
  taskId: string;
  jobId: string;
  animeId: string;
  seasonId?: string | null;
  title: string;
  type: string;
  payload: T;
  priority: TaskPriority;
  status: 'queued' | 'claiming' | 'running' | 'claimed' | 'completed' | 'failed' | 'retrying' | 'waiting';
  workerId?: number | null;
  claimedByWorkerId?: number | null;
  claimedAt?: number | null;
  startedAt?: number | null;
  updatedAt?: number;
  lastHeartbeat?: number | null;
  leaseExpiresAt?: number | null;
  completedAt?: string | null;
  enqueuedAt?: number;
  retryCount: number;
  maxRetries: number;
  retryAfter?: number | null;
  lastError?: string | null;
  result?: any;
}

export interface WorkerCompletedTask {
  taskId: string;
  animeId?: string | null;
  animeTitle: string;
  operation: string;
  completedAt: string;
  status: 'completed' | 'failed';
  details?: string | null;
}

export interface WorkerInfo {
  workerId: number;
  status: 'idle' | 'claiming' | 'working' | 'waiting' | 'retrying' | 'paused' | 'error' | 'stopped' | 'stalled' | 'busy' | 'backing_off';
  currentTaskId?: string | null;
  currentAnimeId?: string | null;
  currentAnimeTitle?: string | null;
  seasonName?: string | null;
  operation?: string | null;
  currentSource?: string | null;
  currentStep?: string | null;
  taskStartedAt?: number | null;
  lastHeartbeat: number;
  leaseExpiresAt?: number | null;
  retryCount?: number;
  tasksCompleted: number;
  tasksFailed: number;
  health?: 'healthy' | 'stale' | 'error';
  lastError?: string | null;
  recentCompletedTasks?: WorkerCompletedTask[];
}

export interface AnimeLease {
  animeId: string;
  workerId: number;
  taskId: string;
  seasonId?: string | null;
  acquiredAt: number;
  leaseExpiresAt: number;
}

export interface SeasonLease {
  seasonKey: string; // animeId:seasonId
  workerId: number;
  taskId: string;
  acquiredAt: number;
  leaseExpiresAt: number;
}

export interface LiveAnimeRegistryEntry {
  animeId: string;
  animeTitle: string;
  workerId: number;
  taskId: string;
  seasonName?: string | null;
  operation: string;
  source: string;
  claimedAt: number;
  leaseExpiresAt: number;
  step: string;
  lastHeartbeat: number;
}

export interface WorkerActivityEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  workerId: number;
  taskId?: string | null;
  animeId?: string | null;
  animeTitle?: string | null;
  operation?: string | null;
  eventType:
    | 'task_claimed'
    | 'verification_started'
    | 'source_searched'
    | 'artwork_checked'
    | 'replacement_found'
    | 'artwork_saved'
    | 'retry_started'
    | 'task_completed'
    | 'task_failed'
    | 'worker_paused'
    | 'worker_stopped'
    | 'stale_task_recovered';
  source?: string | null;
  step?: string | null;
  details?: string | null;
  result?: any;
}

export interface SourceHealthStatus {
  healthy: boolean;
  failureCount: number;
  openUntil: number; // timestamp until circuit breaker closes
  lastError?: string | null;
}

export interface JobStateSnapshot {
  jobId: string;
  jobType: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  mode: string;
  batchLimit: number | null;
  startedAt: string | null;
  updatedAt: string;
  finishedAt?: string | null;

  totalTasks: number;
  queuedCount: number;
  claimedCount: number;
  completedCount: number;
  failedCount: number;
  progressPercent: number;

  lastLog: string;
  workerCount: number;
  poolConfig: WorkerPoolConfig;
  etaFormatted: string;
  avgTaskDurationMs: number;
  systemHealth: {
    heapUsedMb: number;
    heapTotalMb: number;
    status: 'healthy' | 'high_load' | 'critical';
  };
  activeWorkers: WorkerInfo[];
  liveAnimeRegistry: Record<string, LiveAnimeRegistryEntry>;
  activeAnimeLocks: Array<{
    animeId: string;
    workerId: number;
    taskId: string;
    acquiredAt: number;
    leaseExpiresAt: number;
  }>;
  activityEvents: WorkerActivityEvent[];
  sourceHealth: Record<string, SourceHealthStatus>;
  sourceGatewayMetrics?: Record<string, any>;
  tasksPerMinute: number;
  workerUtilization: {
    active: number;
    idle: number;
    waiting: number;
    retrying: number;
    utilizationPercent: number;
  };
  databasePerformance: {
    totalReads: number;
    totalWrites: number;
    latencyMs: number;
  };
}

export interface JobHistoryRecord {
  jobId: string;
  jobType: string;
  mode: string;
  startedAt: string;
  finishedAt: string;
  requestedBatchSize: number | null;
  completedCount: number;
  failedCount: number;
  finalStatus: string;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const JOB_STATE_PATH = path.join(DATA_DIR, 'worker-job-state.json');
const JOB_HISTORY_PATH = path.join(DATA_DIR, 'worker-job-history.json');
const WORKER_EVENTS_PATH = path.join(DATA_DIR, 'worker-activity-events.json');

// Timing Constants for Reliability & Heartbeat Enforcement
export const LEASE_DURATION_MS = 30000; // 30s lease timeout
export const HEARTBEAT_INTERVAL_MS = 2500; // Worker heartbeat every 2.5s
export const WATCHDOG_CHECK_INTERVAL_MS = 5000; // Watchdog sweep every 5s

/**
 * Deterministic Task ID Generator
 * Standardized across all 50 workers and scanner operations:
 * - VERIFY_ARTWORK:anime_id
 * - VERIFY_SEASON:anime_id:season_id
 * - FIX_ARTWORK:anime_id
 * - FIX_MISSING:anime_id
 * - SEARCH_ARTWORK:anime_id
 * - RETRY_VERIFICATION:anime_id
 */
export function createDeterministicTaskId(type: string, animeId: string, seasonId?: string | number | null): string {
  const normType = type.toUpperCase().trim();
  let cleanType = normType;
  if (normType === 'ARTWORK_VERIFICATION' || normType === 'VERIFY_ARTWORK') cleanType = 'VERIFY_ARTWORK';
  else if (normType === 'VERIFY_SEASON' || normType === 'ARTWORK_SEASON') cleanType = 'VERIFY_SEASON';
  else if (normType === 'ARTWORK_FIX' || normType === 'FIX_ARTWORK') cleanType = 'FIX_ARTWORK';
  else if (normType === 'FIX_MISSING') cleanType = 'FIX_MISSING';
  else if (normType === 'ARTWORK_SEARCH_AGAIN' || normType === 'SEARCH_ARTWORK') cleanType = 'SEARCH_ARTWORK';
  else if (normType === 'ARTWORK_REVERIFY' || normType === 'RETRY_VERIFICATION') cleanType = 'RETRY_VERIFICATION';

  const cleanAnime = String(animeId).trim();
  if (seasonId !== undefined && seasonId !== null && String(seasonId).trim() !== '') {
    return `${cleanType}:${cleanAnime}:${String(seasonId).trim()}`;
  }
  return `${cleanType}:${cleanAnime}`;
}

export function parseTaskId(taskId: string): { type: string; animeId: string; seasonId?: string } {
  const parts = taskId.split(':');
  if (parts.length >= 3) {
    return { type: parts[0], animeId: parts[1], seasonId: parts.slice(2).join(':') };
  } else if (parts.length === 2) {
    return { type: parts[0], animeId: parts[1] };
  }
  return { type: 'VERIFY_ARTWORK', animeId: taskId };
}

/**
 * Single Authoritative Server-Side Worker Coordinator & Engine
 * Coordinates all 50 workers, enforces atomic anime-level & season-level leases,
 * ensures zero duplicate task execution, and recovers stale workers seamlessly.
 */
export class ReusableWorkerJobEngine {
  private jobId = 'job_init';
  private jobType = 'artwork_verification';
  private mode = 'all';
  private batchLimit: number | null = null;
  private status: 'idle' | 'running' | 'paused' | 'completed' | 'error' = 'idle';
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private lastLog = 'Authoritative 50-worker coordinator ready.';

  // Authoritative Queues & Task Map
  private tasksMap = new Map<string, JobTask>();
  private priorityQueues: Record<TaskPriority, string[]> = {
    HIGH: [],
    MEDIUM: [],
    NORMAL: [],
    LOW: []
  };

  // Authoritative Claim & Lease Registries
  private claimedTasks = new Map<string, { workerId: number; claimedAt: number; leaseExpiresAt: number; taskId: string; animeId: string }>();
  private animeLeases = new Map<string, AnimeLease>();
  private seasonLeases = new Map<string, SeasonLease>();
  private liveAnimeRegistry = new Map<string, LiveAnimeRegistryEntry>();

  private completedTaskSet = new Set<string>();
  private failedTaskSet = new Set<string>();

  // Activity events (Persisted)
  private activityEvents: WorkerActivityEvent[] = [];

  // Active Production 50-Worker Engine Pool Configuration
  private poolConfig: WorkerPoolConfig = {
    minWorkers: 1,
    maxWorkers: 50,
    currentWorkers: 50, // Production active 50 real server-side worker instances
    concurrencyLimit: 50
  };

  private isProcessing = false;
  private shouldPause = false;
  private shouldStop = false;
  private workerMap = new Map<number, WorkerInfo>();

  // Circuit Breakers / External Source Health
  private sourceHealth: Record<string, SourceHealthStatus> = {
    anilist: { healthy: true, failureCount: 0, openUntil: 0 },
    jikan: { healthy: true, failureCount: 0, openUntil: 0 },
    anidb: { healthy: true, failureCount: 0, openUntil: 0 }
  };

  // Performance rate samples
  private rateSamples: Array<{ timestamp: number; count: number }> = [];

  // Live SSE / state change subscribers
  private stateListeners = new Set<() => void>();

  constructor() {
    this.initWorkers();
    this.loadJobState();
    this.loadActivityEvents();
  }

  public onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public notifyStateListeners() {
    for (const listener of this.stateListeners) {
      try {
        listener();
      } catch {}
    }
  }

  public getWorkerPoolConfig(): WorkerPoolConfig {
    return { ...this.poolConfig };
  }

  public setWorkerPoolConfig(config: Partial<WorkerPoolConfig>): WorkerPoolConfig {
    const minWorkers = Math.max(1, config.minWorkers ?? this.poolConfig.minWorkers);
    const maxWorkers = Math.max(minWorkers, Math.min(50, config.maxWorkers ?? this.poolConfig.maxWorkers));
    const currentWorkers = Math.min(maxWorkers, Math.max(minWorkers, config.currentWorkers ?? this.poolConfig.currentWorkers));
    const concurrencyLimit = Math.max(1, Math.min(50, config.concurrencyLimit ?? this.poolConfig.concurrencyLimit));

    this.poolConfig = { minWorkers, maxWorkers, currentWorkers, concurrencyLimit };
    this.initWorkers();
    this.saveJobState();
    return { ...this.poolConfig };
  }

  private initWorkers() {
    const existing = new Map(this.workerMap);
    this.workerMap.clear();

    for (let i = 1; i <= this.poolConfig.currentWorkers; i++) {
      if (existing.has(i)) {
        this.workerMap.set(i, existing.get(i)!);
      } else {
        this.workerMap.set(i, {
          workerId: i,
          status: 'idle',
          tasksCompleted: 0,
          tasksFailed: 0,
          lastHeartbeat: Date.now(),
          recentCompletedTasks: []
        });
      }
    }
  }

  public recordActivityEvent(event: Omit<WorkerActivityEvent, 'id' | 'timestamp' | 'timestampMs'>) {
    const fullEvent: WorkerActivityEvent = {
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      ...event
    };
    this.activityEvents.unshift(fullEvent);
    if (this.activityEvents.length > 250) {
      this.activityEvents.pop();
    }
    this.saveActivityEvents();
  }

  public getActivityEvents(): WorkerActivityEvent[] {
    return [...this.activityEvents];
  }

  private loadActivityEvents() {
    try {
      if (fs.existsSync(WORKER_EVENTS_PATH)) {
        const data = fs.readFileSync(WORKER_EVENTS_PATH, 'utf-8');
        this.activityEvents = JSON.parse(data);
      }
    } catch {
      this.activityEvents = [];
    }
  }

  private saveActivityEvents() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tempPath = `${WORKER_EVENTS_PATH}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.activityEvents.slice(0, 250), null, 2), 'utf-8');
      fs.renameSync(tempPath, WORKER_EVENTS_PATH);
    } catch {}
  }

  // --- Source Health & Circuit Breakers ---
  public isSourceHealthy(sourceName: string): boolean {
    const health = this.sourceHealth[sourceName.toLowerCase()];
    if (!health) return true;
    if (Date.now() < health.openUntil) {
      return false; // Circuit breaker open
    }
    return true;
  }

  public recordSourceSuccess(sourceName: string) {
    const name = sourceName.toLowerCase();
    if (this.sourceHealth[name]) {
      this.sourceHealth[name].healthy = true;
      this.sourceHealth[name].failureCount = 0;
      this.sourceHealth[name].openUntil = 0;
    }
  }

  public recordSourceFailure(sourceName: string, errorMsg?: string, is429 = false) {
    const name = sourceName.toLowerCase();
    if (!this.sourceHealth[name]) {
      this.sourceHealth[name] = { healthy: true, failureCount: 0, openUntil: 0 };
    }
    const health = this.sourceHealth[name];
    health.failureCount++;
    health.lastError = errorMsg;

    if (is429 || health.failureCount >= 3) {
      health.healthy = false;
      const backoffMs = is429 ? 20000 : 10000;
      health.openUntil = Date.now() + backoffMs;
      console.warn(`[CircuitBreaker] Opened circuit breaker for ${sourceName} (${backoffMs}ms backoff). Error: ${errorMsg}`);
    }
  }

  // --- State Persistence ---
  public loadJobState() {
    try {
      if (fs.existsSync(JOB_STATE_PATH)) {
        const saved = JSON.parse(fs.readFileSync(JOB_STATE_PATH, 'utf-8'));
        if (saved.mode === 'benchmark') {
          this.jobId = 'job_init';
          this.status = 'idle';
          this.completedTaskSet.clear();
          this.failedTaskSet.clear();
          this.initWorkers();
          return;
        }
        this.jobId = saved.jobId || 'job_init';
        this.jobType = saved.jobType || 'artwork_verification';
        this.mode = saved.mode || 'all';
        this.batchLimit = saved.batchLimit || null;
        this.status = saved.status === 'running' ? 'paused' : (saved.status || 'idle');
        this.startedAt = saved.startedAt || null;
        this.finishedAt = saved.finishedAt || null;
        this.lastLog = saved.lastLog || 'Job state reloaded.';

        if (Array.isArray(saved.completedTaskIds)) {
          this.completedTaskSet = new Set(saved.completedTaskIds.filter((id: string) => !id.includes('bench-anime-')));
        }
        if (Array.isArray(saved.failedTaskIds)) {
          this.failedTaskSet = new Set(saved.failedTaskIds.filter((id: string) => !id.includes('bench-anime-')));
        }
        if (saved.poolConfig && typeof saved.poolConfig.currentWorkers === 'number') {
          this.poolConfig.currentWorkers = Math.max(1, Math.min(50, saved.poolConfig.currentWorkers));
          this.poolConfig.maxWorkers = 50;
          this.poolConfig.concurrencyLimit = 50;
        }

        // Clean out any stale in-flight memory locks from a previous server process
        this.claimedTasks.clear();
        this.animeLeases.clear();
        this.seasonLeases.clear();
        this.liveAnimeRegistry.clear();

        this.initWorkers();
      }
    } catch (err: any) {
      console.error('[WorkerCoordinator] Error loading state:', err.message);
    }
  }

  public saveJobState() {
    try {
      if (this.mode === 'benchmark') return;
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const snapshot = this.getSnapshot();
      const tempPath = `${JOB_STATE_PATH}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({
        ...snapshot,
        completedTaskIds: Array.from(this.completedTaskSet),
        failedTaskIds: Array.from(this.failedTaskSet)
      }, null, 2), 'utf-8');
      fs.renameSync(tempPath, JOB_STATE_PATH);
    } catch (err: any) {
      console.error('[WorkerCoordinator] Error saving state:', err.message);
    }
  }

  // --- Release Leases ---
  public releaseAnimeLease(animeId: string): void {
    if (!animeId) return;
    this.animeLeases.delete(animeId);
    this.liveAnimeRegistry.delete(animeId);
  }

  public releaseSeasonLease(animeId: string, seasonId: string | number): void {
    const key = `${animeId}:${seasonId}`;
    this.seasonLeases.delete(key);
  }

  // --- Stale Worker & Task Watchdog Recovery ---
  public recoverStaleTasks(): number {
    const now = Date.now();
    let recoveredCount = 0;

    for (const [taskId, claim] of Array.from(this.claimedTasks.entries())) {
      const worker = this.workerMap.get(claim.workerId);
      const isHeartbeatStale = !worker || (now - worker.lastHeartbeat > LEASE_DURATION_MS);
      const isLeaseExpired = now > claim.leaseExpiresAt;

      if (isHeartbeatStale || isLeaseExpired) {
        console.warn(`[WorkerCoordinator] Stale worker lease detected for task ${taskId} (Worker #${claim.workerId}). Recovering...`);

        // Safely remove claim
        this.claimedTasks.delete(taskId);

        // Safely release anime lease and season lease
        const task = this.tasksMap.get(taskId);
        if (claim.animeId) {
          this.releaseAnimeLease(claim.animeId);
          if (task?.seasonId) {
            this.releaseSeasonLease(claim.animeId, task.seasonId);
          }
        }

        // Recover task: never mark completed, never lose completed work, prevent duplicate processing
        if (task && task.status !== 'completed' && task.status !== 'failed') {
          if (task.retryCount < task.maxRetries) {
            task.retryCount++;
            task.status = 'queued';
            task.workerId = null;
            task.claimedByWorkerId = null;
            task.claimedAt = null;
            task.startedAt = null;
            task.leaseExpiresAt = null;
            task.lastHeartbeat = null;
            task.updatedAt = now;
            task.retryAfter = null; // Healthy worker can claim immediately
            if (!this.priorityQueues[task.priority].includes(taskId)) {
              this.priorityQueues[task.priority].unshift(taskId);
            }
          } else {
            task.status = 'failed';
            task.workerId = null;
            task.claimedByWorkerId = null;
            task.leaseExpiresAt = null;
            task.updatedAt = now;
            task.completedAt = new Date().toISOString();
            task.lastError = `Max retries exceeded after worker #${claim.workerId} heartbeat timeout`;
            this.failedTaskSet.add(taskId);
          }
        }

        // Reset stale worker
        if (worker && worker.currentTaskId === taskId) {
          worker.status = 'idle';
          worker.health = 'stale';
          worker.currentTaskId = null;
          worker.currentAnimeId = null;
          worker.currentAnimeTitle = null;
          worker.seasonName = null;
          worker.operation = null;
          worker.currentSource = null;
          worker.currentStep = null;
          worker.taskStartedAt = null;
          worker.leaseExpiresAt = null;
        }

        this.recordActivityEvent({
          workerId: claim.workerId,
          taskId,
          animeId: claim.animeId,
          animeTitle: task?.title || null,
          eventType: 'stale_task_recovered',
          step: 'Watchdog recovered stale task',
          details: `Worker #${claim.workerId} heartbeat expired (>30s). Task recovered and re-queued.`
        });

        recoveredCount++;
      }
    }

    // Also sweep orphaned anime leases whose lease expiration has elapsed
    for (const [animeId, lease] of Array.from(this.animeLeases.entries())) {
      if (now > lease.leaseExpiresAt) {
        this.releaseAnimeLease(animeId);
      }
    }

    // Sweep orphaned season leases
    for (const [seasonKey, lease] of Array.from(this.seasonLeases.entries())) {
      if (now > lease.leaseExpiresAt) {
        this.seasonLeases.delete(seasonKey);
      }
    }

    return recoveredCount;
  }

  // --- Snapshot Generation (Authoritative Single Source of Truth) ---
  public getSnapshot(): JobStateSnapshot {
    // Automatically sweep expired leases
    this.recoverStaleTasks();

    const now = Date.now();
    const totalTasks = this.tasksMap.size || (this.completedTaskSet.size + this.failedTaskSet.size);
    const completedCount = this.completedTaskSet.size;
    const failedCount = this.failedTaskSet.size;
    const processed = completedCount + failedCount;

    const queuedCount = (this.priorityQueues.HIGH?.length || 0) +
      (this.priorityQueues.MEDIUM?.length || 0) +
      (this.priorityQueues.NORMAL?.length || 0) +
      (this.priorityQueues.LOW?.length || 0);
    const claimedCount = this.claimedTasks.size;

    const progressPercent = totalTasks > 0 ? Math.min(100, Math.round((processed / totalTasks) * 100)) : 0;

    // Real ETA calculation
    let etaFormatted = 'Calculating...';
    let avgTaskDurationMs = 0;

    if (this.rateSamples.length >= 3 && this.startedAt) {
      const startTimeMs = new Date(this.startedAt).getTime();
      const elapsedSec = (now - startTimeMs) / 1000;
      if (elapsedSec > 0 && processed > 0) {
        const ratePerSec = processed / elapsedSec;
        avgTaskDurationMs = Math.round((elapsedSec * 1000) / processed);
        const remainingTasks = totalTasks - processed;
        if (remainingTasks > 0 && ratePerSec > 0) {
          const remainingSec = Math.ceil(remainingTasks / ratePerSec);
          if (remainingSec < 60) {
            etaFormatted = `${remainingSec}s`;
          } else {
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            etaFormatted = `${mins}m ${secs}s`;
          }
        } else if (remainingTasks <= 0) {
          etaFormatted = 'Complete';
        }
      }
    }

    // System Health Throttling Monitor
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const systemHealthStatus: 'healthy' | 'high_load' | 'critical' = heapUsedMb > 450 ? 'critical' : heapUsedMb > 350 ? 'high_load' : 'healthy';

    // Live Authoritative Anime Claims & Registry
    const activeAnimeLocks = Array.from(this.animeLeases.values()).map(l => ({
      animeId: l.animeId,
      workerId: l.workerId,
      taskId: l.taskId,
      acquiredAt: l.acquiredAt,
      leaseExpiresAt: l.leaseExpiresAt
    }));

    const liveAnimeRegistryObj: Record<string, LiveAnimeRegistryEntry> = {};
    for (const [animeId, reg] of this.liveAnimeRegistry.entries()) {
      liveAnimeRegistryObj[animeId] = reg;
    }

    // Real throughput calculation (tasks/min)
    let tasksPerMinute = 0;
    const oneMinAgo = now - 60000;
    const recentCompletedInLastMin = this.rateSamples.filter(s => s.timestamp >= oneMinAgo);
    if (recentCompletedInLastMin.length >= 2) {
      const deltaCount = recentCompletedInLastMin[recentCompletedInLastMin.length - 1].count - recentCompletedInLastMin[0].count;
      const deltaSec = (recentCompletedInLastMin[recentCompletedInLastMin.length - 1].timestamp - recentCompletedInLastMin[0].timestamp) / 1000;
      if (deltaSec > 0) {
        tasksPerMinute = Math.round((deltaCount / deltaSec) * 60);
      }
    } else if (this.startedAt && processed > 0) {
      const totalElapsedMin = Math.max(0.05, (now - new Date(this.startedAt).getTime()) / 60000);
      tasksPerMinute = Math.round(processed / totalElapsedMin);
    }

    // Enforce authoritative worker state: NEVER show IDLE while a worker owns an active task
    const activeWorkerClaimsByWorkerId = new Map<number, { taskId: string; animeId: string }>();
    for (const [tId, c] of this.claimedTasks.entries()) {
      activeWorkerClaimsByWorkerId.set(c.workerId, { taskId: tId, animeId: c.animeId });
    }

    const workers: WorkerInfo[] = Array.from(this.workerMap.values()).map(w => {
      const ownedClaim = activeWorkerClaimsByWorkerId.get(w.workerId);
      const activeTaskId = w.currentTaskId || ownedClaim?.taskId || null;
      const ownedTask = activeTaskId ? this.tasksMap.get(activeTaskId) : null;
      let effectiveStatus = w.status;

      if (activeTaskId && ownedTask && ownedTask.status !== 'completed' && ownedTask.status !== 'failed') {
        if (effectiveStatus === 'idle' || effectiveStatus === 'stopped') {
          effectiveStatus = ownedTask.status === 'claiming'
            ? 'claiming'
            : ownedTask.status === 'waiting'
            ? 'waiting'
            : ownedTask.status === 'retrying'
            ? 'retrying'
            : 'working';
        }
      } else if (!activeTaskId && (effectiveStatus === 'working' || effectiveStatus === 'claiming' || effectiveStatus === 'waiting' || effectiveStatus === 'busy')) {
        effectiveStatus = this.shouldPause ? 'paused' : (this.shouldStop ? 'stopped' : 'idle');
      }

      const hbAge = now - (w.lastHeartbeat || now);
      const effectiveHealth: 'healthy' | 'stale' | 'error' =
        effectiveStatus === 'error'
          ? 'error'
          : (activeTaskId && hbAge > LEASE_DURATION_MS)
          ? 'stale'
          : (w.health || 'healthy');

      return {
        ...w,
        status: effectiveStatus,
        currentTaskId: activeTaskId,
        currentAnimeId: w.currentAnimeId || ownedTask?.animeId || null,
        currentAnimeTitle: w.currentAnimeTitle || ownedTask?.title || null,
        seasonName: w.seasonName || (ownedTask?.seasonId ? `Season ${ownedTask.seasonId}` : 'Main / All Seasons'),
        operation: w.operation || (ownedTask ? this.mapTaskTypeToOperation(ownedTask.type) : null),
        currentSource: w.currentSource || (activeTaskId ? 'AniList' : null),
        currentStep: w.currentStep || (activeTaskId ? 'Executing verification pipeline' : null),
        retryCount: ownedTask ? ownedTask.retryCount : (w.retryCount || 0),
        health: effectiveHealth
      };
    });

    const activeCount = workers.filter(w => w.status === 'working' || w.status === 'claiming' || w.status === 'busy').length;
    const idleCount = workers.filter(w => w.status === 'idle').length;
    const waitingCount = workers.filter(w => w.status === 'waiting').length;
    const retryingCount = workers.filter(w => w.status === 'retrying' || w.status === 'backing_off').length;
    const busyOrActiveCount = activeCount + waitingCount + retryingCount;
    const utilizationPercent = this.poolConfig.currentWorkers > 0
      ? Math.round((busyOrActiveCount / this.poolConfig.currentWorkers) * 100)
      : 0;

    const dbStoreMetrics = globalDataStore.getStoreMetrics();

    return {
      jobId: this.jobId,
      jobType: this.jobType,
      status: this.status,
      mode: this.mode,
      batchLimit: this.batchLimit,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      finishedAt: this.finishedAt,
      totalTasks,
      queuedCount,
      claimedCount,
      completedCount,
      failedCount,
      progressPercent,
      lastLog: this.lastLog,
      workerCount: this.poolConfig.currentWorkers,
      poolConfig: { ...this.poolConfig },
      etaFormatted,
      avgTaskDurationMs,
      tasksPerMinute,
      workerUtilization: {
        active: activeCount,
        idle: idleCount,
        waiting: waitingCount,
        retrying: retryingCount,
        utilizationPercent
      },
      databasePerformance: {
        totalReads: dbStoreMetrics.totalDbReads,
        totalWrites: dbStoreMetrics.totalDbWrites,
        latencyMs: dbStoreMetrics.lastDbLatencyMs
      },
      systemHealth: {
        heapUsedMb,
        heapTotalMb,
        status: systemHealthStatus
      },
      activeWorkers: workers,
      liveAnimeRegistry: liveAnimeRegistryObj,
      activeAnimeLocks,
      activityEvents: this.getActivityEvents(),
      sourceHealth: { ...this.sourceHealth },
      sourceGatewayMetrics: globalSourceGateway.getAllMetrics()
    };
  }

  // --- Task Queue Management ---
  public submitTasks<T>(
    tasks: Array<{ taskId: string; animeId?: string; seasonId?: string | null; title: string; payload: T; priority?: TaskPriority; type?: string }>,
    mode = 'all',
    batchLimit?: number
  ) {
    this.jobId = 'job_' + Date.now();
    this.mode = mode;
    this.batchLimit = batchLimit || null;
    this.status = 'running';
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;

    this.tasksMap.clear();
    this.claimedTasks.clear();
    this.animeLeases.clear();
    this.seasonLeases.clear();
    this.liveAnimeRegistry.clear();
    this.completedTaskSet.clear();
    this.failedTaskSet.clear();
    this.priorityQueues = { HIGH: [], MEDIUM: [], NORMAL: [], LOW: [] };

    let candidateTasks = tasks;
    if (batchLimit && batchLimit > 0) {
      candidateTasks = tasks.slice(0, batchLimit);
    }

    const seenTaskIds = new Set<string>();

    for (const item of candidateTasks) {
      const priority = item.priority || 'MEDIUM';
      const animeId = item.animeId || (item.payload as any)?.id || item.taskId;
      const type = item.type || 'artwork_verification';
      const seasonId = item.seasonId !== undefined ? item.seasonId : ((item.payload as any)?.season ? String((item.payload as any).season) : null);

      const deterministicId = item.taskId.startsWith('VERIFY_') || item.taskId.startsWith('FIX_') || item.taskId.startsWith('SEARCH_') || item.taskId.startsWith('RETRY_')
        ? item.taskId
        : createDeterministicTaskId(type, animeId, seasonId);

      // Unique Task Identity: Merge/Dedupe identical active jobs
      if (seenTaskIds.has(deterministicId)) {
        continue;
      }
      seenTaskIds.add(deterministicId);

      const task: JobTask<T> = {
        taskId: deterministicId,
        jobId: this.jobId,
        animeId,
        seasonId,
        title: item.title,
        type,
        payload: item.payload,
        priority,
        status: 'queued',
        workerId: null,
        claimedByWorkerId: null,
        enqueuedAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
        maxRetries: 2
      };

      this.tasksMap.set(deterministicId, task);
      this.priorityQueues[priority].push(deterministicId);
    }

    this.lastLog = `Launched ${mode} job with ${this.tasksMap.size} unique tasks across ${this.poolConfig.currentWorkers} coordinated workers.`;
    this.saveJobState();
    this.notifyStateListeners();
  }

  public enqueueHighPriorityTasks<T>(
    tasks: Array<{ taskId: string; animeId?: string; seasonId?: string | null; title: string; payload: T; type?: string }>
  ) {
    // If previous job was idle or completed, initialize a fresh active job session so progress counters are clean
    if (this.status === 'idle' || this.status === 'completed') {
      this.jobId = 'job_' + Date.now();
      this.mode = tasks[0]?.type || 'high_priority';
      this.status = 'running';
      this.startedAt = new Date().toISOString();
      this.finishedAt = null;
      this.tasksMap.clear();
      this.claimedTasks.clear();
      this.animeLeases.clear();
      this.seasonLeases.clear();
      this.liveAnimeRegistry.clear();
      this.completedTaskSet.clear();
      this.failedTaskSet.clear();
      this.priorityQueues = { HIGH: [], MEDIUM: [], NORMAL: [], LOW: [] };
    } else if (this.status === 'paused') {
      this.status = 'running';
      this.shouldPause = false;
      this.shouldStop = false;
    }

    let addedCount = 0;
    const now = Date.now();
    for (const item of tasks) {
      const animeId = item.animeId || (item.payload as any)?.id || item.taskId;
      const type = item.type || 'artwork_reverify';
      const seasonId = item.seasonId !== undefined ? item.seasonId : ((item.payload as any)?.season ? String((item.payload as any).season) : null);

      const deterministicId = item.taskId.startsWith('VERIFY_') || item.taskId.startsWith('FIX_') || item.taskId.startsWith('SEARCH_') || item.taskId.startsWith('RETRY_')
        ? item.taskId
        : createDeterministicTaskId(type, animeId, seasonId);

      // Deduplication check:
      const existing = this.tasksMap.get(deterministicId);
      if (existing) {
        const isActivelyOwned =
          existing.status === 'claiming' ||
          existing.status === 'running' ||
          existing.status === 'waiting' ||
          existing.status === 'claimed';
        if (isActivelyOwned || (existing.status === 'queued' && this.priorityQueues.HIGH.includes(deterministicId))) {
          // Already actively running or in high queue, skip duplicate
          continue;
        }
        if (this.completedTaskSet.has(deterministicId)) {
          this.completedTaskSet.delete(deterministicId);
        }
        if (this.failedTaskSet.has(deterministicId)) {
          this.failedTaskSet.delete(deterministicId);
        }
      }

      const task: JobTask<T> = {
        taskId: deterministicId,
        jobId: this.jobId,
        animeId,
        seasonId,
        title: item.title,
        type,
        payload: item.payload,
        priority: 'HIGH',
        status: 'queued',
        workerId: null,
        claimedByWorkerId: null,
        enqueuedAt: now,
        updatedAt: now,
        retryCount: 0,
        maxRetries: 2
      };

      this.tasksMap.set(deterministicId, task);
      if (!this.priorityQueues.HIGH.includes(deterministicId)) {
        this.priorityQueues.HIGH.unshift(deterministicId);
        addedCount++;
      }
    }

    this.lastLog = `Queued ${addedCount} high-priority tasks into active worker queue.`;
    this.saveJobState();
    this.notifyStateListeners();
  }

  public resolveManualAnimeAction(animeId: string, animeTitle: string, operation: string, details: string) {
    // Remove any queued tasks for this animeId so workers do not overwrite manual owner decision
    for (const prio of ['HIGH', 'MEDIUM', 'NORMAL', 'LOW'] as TaskPriority[]) {
      const q = this.priorityQueues[prio];
      for (let i = q.length - 1; i >= 0; i--) {
        const t = this.tasksMap.get(q[i]);
        if (t && t.animeId === animeId && t.status === 'queued') {
          q.splice(i, 1);
          t.status = 'completed';
          t.completedAt = new Date().toISOString();
          t.updatedAt = Date.now();
          this.completedTaskSet.add(t.taskId);
        }
      }
    }

    this.recordActivityEvent({
      workerId: 1,
      animeId,
      animeTitle,
      operation,
      eventType: 'artwork_saved',
      source: 'Owner Action',
      step: operation,
      details
    });
    this.saveJobState();
    this.notifyStateListeners();
  }

  public mapTaskTypeToOperation(type: string): string {
    const t = type.toLowerCase();
    if (t.includes('reverify')) return 'Re-verify';
    if (t.includes('search')) return 'Search Again';
    if (t.includes('fix_missing')) return 'Fix Missing Artwork';
    if (t.includes('fix')) return 'Fix Artwork';
    if (t.includes('season')) return 'Verify Season Artwork';
    return 'Verify Artwork';
  }

  // --- Worker Heartbeats ---
  public heartbeat(workerId: number, step?: string, source?: string) {
    const worker = this.workerMap.get(workerId);
    if (!worker) return;

    const now = Date.now();
    worker.lastHeartbeat = now;
    const newExpiry = now + LEASE_DURATION_MS;
    worker.leaseExpiresAt = newExpiry;
    worker.health = 'healthy';

    if (step !== undefined) worker.currentStep = step;
    if (source !== undefined) worker.currentSource = source;

    if (worker.currentTaskId) {
      const claim = this.claimedTasks.get(worker.currentTaskId);
      if (claim && claim.workerId === workerId) {
        claim.leaseExpiresAt = newExpiry;
      }
      const task = this.tasksMap.get(worker.currentTaskId);
      if (task && task.claimedByWorkerId === workerId) {
        task.leaseExpiresAt = newExpiry;
        task.lastHeartbeat = now;
        task.updatedAt = now;
      }
    }

    if (worker.currentAnimeId) {
      const lease = this.animeLeases.get(worker.currentAnimeId);
      if (lease && lease.workerId === workerId) lease.leaseExpiresAt = newExpiry;
      const reg = this.liveAnimeRegistry.get(worker.currentAnimeId);
      if (reg && reg.workerId === workerId) {
        reg.leaseExpiresAt = newExpiry;
        reg.lastHeartbeat = now;
        if (step !== undefined) reg.step = step;
        if (source !== undefined) reg.source = source;
      }
    }
    this.notifyStateListeners();
  }

  public updateWorkerProgress(workerId: number, update: Partial<WorkerInfo>) {
    const worker = this.workerMap.get(workerId);
    if (worker) {
      if (update.status !== undefined) {
        // Never allow setting IDLE while worker owns an active task
        if (update.status === 'idle' && worker.currentTaskId) {
          worker.status = 'working';
        } else {
          worker.status = update.status;
        }
      }
      if (update.currentAnimeId !== undefined) worker.currentAnimeId = update.currentAnimeId;
      if (update.currentAnimeTitle !== undefined) worker.currentAnimeTitle = update.currentAnimeTitle;
      if (update.seasonName !== undefined) worker.seasonName = update.seasonName;
      if (update.currentStep !== undefined) worker.currentStep = update.currentStep;
      if (update.currentSource !== undefined) worker.currentSource = update.currentSource;
      if (update.operation !== undefined) worker.operation = update.operation;
      if (update.retryCount !== undefined) worker.retryCount = update.retryCount;
      if (update.health !== undefined) worker.health = update.health;
      if (update.lastError !== undefined) worker.lastError = update.lastError;
      if (worker.currentTaskId) {
        const task = this.tasksMap.get(worker.currentTaskId);
        if (task && task.claimedByWorkerId === workerId && task.status !== 'completed' && task.status !== 'failed') {
          if (update.status === 'waiting') task.status = 'waiting';
          else if (update.status === 'retrying') task.status = 'retrying';
          else if (update.status === 'working') task.status = 'running';
          task.updatedAt = Date.now();
        }
      }
      this.heartbeat(workerId, update.currentStep ?? undefined, update.currentSource ?? undefined);
    }
  }

  // --- Atomic Task Claiming with Anime-Level and Season-Level Locks ---
  public claimTask(workerId: number): JobTask | null {
    const now = Date.now();
    // 1. Recover stale tasks first
    this.recoverStaleTasks();

    const worker = this.workerMap.get(workerId);
    if (!worker) return null;
    if (this.shouldPause || this.shouldStop) {
      worker.status = this.shouldPause ? 'paused' : 'stopped';
      return null;
    }

    // REQUIREMENT 13: SMART SCHEDULING & PRIORITY AGING
    // Check if any task in MEDIUM, NORMAL, or LOW has been waiting > 25 seconds.
    // If so, promote to HIGH so large batch operations never starve tasks.
    const AGING_THRESHOLD_MS = 25000;
    for (const p of ['MEDIUM', 'NORMAL', 'LOW'] as TaskPriority[]) {
      const q = this.priorityQueues[p];
      for (let i = 0; i < q.length; i++) {
        const tId = q[i];
        const t = this.tasksMap.get(tId);
        if (t && t.enqueuedAt && now - t.enqueuedAt > AGING_THRESHOLD_MS) {
          q.splice(i, 1);
          i--;
          t.priority = 'HIGH';
          this.priorityQueues.HIGH.push(tId);
        }
      }
    }

    // 2. Scan priority queues in order: HIGH, MEDIUM, NORMAL, LOW
    let chosenTaskId: string | null = null;
    let chosenPrio: TaskPriority | null = null;
    let chosenIndex = -1;

    const priorities: TaskPriority[] = ['HIGH', 'MEDIUM', 'NORMAL', 'LOW'];
    for (const prio of priorities) {
      const queue = this.priorityQueues[prio];
      if (!queue || queue.length === 0) continue;

      for (let i = 0; i < queue.length; i++) {
        const taskId = queue[i];
        const task = this.tasksMap.get(taskId);

        if (!task || (task.status !== 'queued' && task.status !== 'retrying')) {
          queue.splice(i, 1);
          i--;
          continue;
        }

        // Check retry cooldown
        if (task.retryAfter && now < task.retryAfter) {
          continue;
        }

        const animeId = task.animeId || task.payload?.id || taskId;

        // REQUIREMENT 4: PREVENT DUPLICATE ANIME PROCESSING (ATOMIC ANIME LOCK)
        const activeAnimeLease = this.animeLeases.get(animeId);
        if (activeAnimeLease) {
          if (now < activeAnimeLease.leaseExpiresAt) {
            // Anime is currently locked by another worker! Skip to another eligible anime!
            continue;
          } else {
            this.releaseAnimeLease(animeId);
          }
        }

        // REQUIREMENT 5: SEASON COORDINATION & LOCKING
        if (task.seasonId) {
          const seasonKey = `${animeId}:${task.seasonId}`;
          const activeSeasonLease = this.seasonLeases.get(seasonKey);
          if (activeSeasonLease) {
            if (now < activeSeasonLease.leaseExpiresAt) {
              continue;
            } else {
              this.seasonLeases.delete(seasonKey);
            }
          }
        }

        // Eligible task found!
        chosenTaskId = taskId;
        chosenPrio = prio;
        chosenIndex = i;
        break;
      }

      if (chosenTaskId) break;
    }

    if (!chosenTaskId || !chosenPrio) {
      return null; // No available un-locked task
    }

    // Remove from priority queue
    this.priorityQueues[chosenPrio].splice(chosenIndex, 1);

    const task = this.tasksMap.get(chosenTaskId)!;
    const animeId = task.animeId || task.payload?.id || chosenTaskId;
    const leaseExpiresAt = now + LEASE_DURATION_MS;

    // ATOMIC TASK CLAIM (QUEUED -> CLAIMING)
    task.status = 'claiming';
    task.workerId = workerId;
    task.claimedByWorkerId = workerId;
    task.claimedAt = now;
    task.startedAt = now;
    task.updatedAt = now;
    task.lastHeartbeat = now;
    task.leaseExpiresAt = leaseExpiresAt;

    // ATOMIC ANIME LEASE CLAIM
    const animeLease: AnimeLease = {
      animeId,
      workerId,
      taskId: chosenTaskId,
      seasonId: task.seasonId,
      acquiredAt: now,
      leaseExpiresAt
    };
    this.animeLeases.set(animeId, animeLease);

    // ATOMIC SEASON LEASE CLAIM
    if (task.seasonId) {
      const seasonKey = `${animeId}:${task.seasonId}`;
      this.seasonLeases.set(seasonKey, {
        seasonKey,
        workerId,
        taskId: chosenTaskId,
        acquiredAt: now,
        leaseExpiresAt
      });
    }

    // Track claim
    this.claimedTasks.set(chosenTaskId, {
      workerId,
      claimedAt: now,
      leaseExpiresAt,
      taskId: chosenTaskId,
      animeId
    });

    // Update worker info (CLAIMING initially; transitions to WORKING on execution)
    worker.status = 'claiming';
    worker.currentTaskId = chosenTaskId;
    worker.currentAnimeId = animeId;
    worker.currentAnimeTitle = task.title;
    worker.seasonName = task.seasonId ? `Season ${task.seasonId}` : (task.payload?.season ? `Season ${task.payload.season}` : 'Main / All Seasons');
    worker.operation = this.mapTaskTypeToOperation(task.type);
    worker.currentSource = 'Local Catalogue';
    worker.currentStep = 'Claimed task & initialized lease';
    worker.taskStartedAt = now;
    worker.lastHeartbeat = now;
    worker.leaseExpiresAt = leaseExpiresAt;
    worker.retryCount = task.retryCount || 0;
    worker.health = 'healthy';
    worker.lastError = null;

    // Update Authoritative Live Anime Registry
    this.liveAnimeRegistry.set(animeId, {
      animeId,
      animeTitle: task.title,
      workerId,
      taskId: chosenTaskId,
      seasonName: worker.seasonName,
      operation: worker.operation || 'Verify Artwork',
      source: 'Local Catalogue',
      claimedAt: now,
      leaseExpiresAt,
      step: worker.currentStep,
      lastHeartbeat: now
    });

    this.recordActivityEvent({
      workerId,
      taskId: chosenTaskId,
      animeId,
      animeTitle: task.title,
      operation: worker.operation,
      eventType: 'task_claimed',
      source: 'Queue',
      step: 'Task claimed from shared coordinator',
      details: `Worker #${workerId} claimed exclusive lock on "${task.title}" (Anime: ${animeId})`
    });

    this.lastLog = `[Worker #${workerId}] Claimed: ${task.title}`;
    this.saveJobState();
    this.notifyStateListeners();
    return task;
  }

  // --- Complete Task & Release Locks ---
  public completeTask(workerId: number, taskId: string, result: any, isError = false) {
    const now = Date.now();
    const task = this.tasksMap.get(taskId);
    const activeClaim = this.claimedTasks.get(taskId);

    // Ownership Guard: If task was already recovered by watchdog and claimed by another worker, ignore stale worker completion
    if (activeClaim && activeClaim.workerId !== workerId) {
      return;
    }
    if (task && task.claimedByWorkerId && task.claimedByWorkerId !== workerId) {
      return;
    }
    if (task && task.status === 'completed') {
      return;
    }

    const animeId = task?.animeId || task?.payload?.id || taskId;

    // 1. Release anime lease, season lease, and live registry
    this.releaseAnimeLease(animeId);
    if (task?.seasonId) {
      this.releaseSeasonLease(animeId, task.seasonId);
    }

    // 2. Remove claim
    this.claimedTasks.delete(taskId);

    // 3. Update task
    if (task) {
      task.leaseExpiresAt = null;
      task.updatedAt = now;
      task.result = result;

      if (!isError && result) {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        this.completedTaskSet.add(taskId);
        this.failedTaskSet.delete(taskId);
      } else {
        const errorMsg = typeof result === 'string' ? result : (result?.message || result?.error || 'Task failed');
        task.lastError = errorMsg;

        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'retrying';
          task.retryAfter = now + (task.retryCount * 1500); // 1.5s, 3s backoff
          task.workerId = null;
          task.claimedByWorkerId = null;
          task.claimedAt = null;
          if (!this.priorityQueues[task.priority].includes(taskId)) {
            this.priorityQueues[task.priority].push(taskId);
          }
        } else {
          task.status = 'failed';
          task.completedAt = new Date().toISOString();
          this.failedTaskSet.add(taskId);
          this.completedTaskSet.delete(taskId);
        }
      }
    }

    // 4. Update worker
    const worker = this.workerMap.get(workerId);
    if (worker) {
      worker.lastHeartbeat = now;
      worker.leaseExpiresAt = null;

      if (!worker.recentCompletedTasks) worker.recentCompletedTasks = [];
      if (task) {
        worker.recentCompletedTasks.unshift({
          taskId,
          animeId,
          animeTitle: task.title || 'Anime Task',
          operation: this.mapTaskTypeToOperation(task.type),
          completedAt: new Date().toISOString(),
          status: isError ? 'failed' : 'completed',
          details: typeof result === 'string' ? result : (result?.message || result?.error || (isError ? 'Failed' : 'Completed'))
        });
        if (worker.recentCompletedTasks.length > 10) worker.recentCompletedTasks.pop();
      }

      if (!isError) {
        worker.tasksCompleted++;
        worker.status = 'idle';
      } else {
        if (task && task.status === 'retrying') {
          worker.status = 'retrying';
        } else {
          worker.tasksFailed++;
          worker.status = 'error';
        }
        worker.lastError = typeof result === 'string' ? result : (result?.error || 'Task error');
      }

      worker.currentTaskId = null;
      worker.currentAnimeId = null;
      worker.currentAnimeTitle = null;
      worker.seasonName = null;
      worker.operation = null;
      worker.currentSource = null;
      worker.currentStep = null;
      worker.taskStartedAt = null;
    }

    // 5. Activity Event
    if (task) {
      this.recordActivityEvent({
        workerId,
        taskId,
        animeId,
        animeTitle: task.title,
        operation: this.mapTaskTypeToOperation(task.type),
        eventType: isError ? (task.status === 'retrying' ? 'retry_started' : 'task_failed') : 'task_completed',
        step: isError ? (task.status === 'retrying' ? 'Task queued for retry' : 'Task processing failed') : 'Task processing completed',
        details: typeof result === 'string' ? result : (result?.message || result?.error || (isError ? 'Failed' : 'Completed successfully')),
        result
      });
    }

    const processed = this.completedTaskSet.size + this.failedTaskSet.size;
    this.rateSamples.push({ timestamp: now, count: processed });
    if (this.rateSamples.length > 20) this.rateSamples.shift();

    if (task) {
      this.lastLog = `[Worker #${workerId}] ${isError ? 'Failed' : 'Completed'}: ${task.title} (${processed}/${this.tasksMap.size})`;
    }

    this.saveJobState();
    this.notifyStateListeners();
  }

  // --- Coordinated 50-Worker Processing Pool Loop ---
  public async runJobPool(
    processor: (task: JobTask, workerId: number) => Promise<any>
  ): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.shouldPause = false;
    this.shouldStop = false;
    this.status = 'running';

    // Watchdog timer running in background every 5s
    const watchdogTimer = setInterval(() => {
      this.recoverStaleTasks();
    }, WATCHDOG_CHECK_INTERVAL_MS);

    const workerTaskLoop = async (workerId: number) => {
      let worker = this.workerMap.get(workerId);
      if (!worker) {
        this.initWorkers();
        worker = this.workerMap.get(workerId)!;
      }

      while (!this.shouldPause && !this.shouldStop) {
        try {
          worker.lastHeartbeat = Date.now();

          // 1. Atomically claim next eligible task
          const task = this.claimTask(workerId);
          if (!task) {
            // Check if queue is completely drained
            const queuedCount = (this.priorityQueues.HIGH?.length || 0) +
              (this.priorityQueues.MEDIUM?.length || 0) +
              (this.priorityQueues.NORMAL?.length || 0) +
              (this.priorityQueues.LOW?.length || 0);

            if (queuedCount === 0 && this.claimedTasks.size === 0) {
              break; // Truly complete
            }

            // Some tasks exist but their anime is currently locked by another worker:
            // Yield and wait briefly before asking coordinator again
            worker.status = 'idle';
            await new Promise(r => setTimeout(r, 30));
            continue;
          }

          // 2. Active Heartbeat Timer while processing this task
          const heartbeatTimer = setInterval(() => {
            this.heartbeat(workerId);
          }, HEARTBEAT_INTERVAL_MS);

          try {
            // 3. Process the task (CLAIMING -> RUNNING)
            task.status = 'running';
            task.updatedAt = Date.now();
            worker.status = 'working';
            this.notifyStateListeners();
            const result = await processor(task, workerId);
            clearInterval(heartbeatTimer);
            this.completeTask(workerId, task.taskId, result, false);
          } catch (err: any) {
            clearInterval(heartbeatTimer);
            console.error(`[Worker #${workerId}] Error processing task ${task.title}:`, err.message);
            this.completeTask(workerId, task.taskId, { error: err.message }, true);
          }

          // Non-blocking micro-yield to keep event loop cooperative without degrading throughput
          await new Promise(r => setTimeout(r, 4));
        } catch (workerErr: any) {
          // REQUIREMENT 10: WORKER FAILURE ISOLATION
          console.error(`[WorkerCoordinator] Worker #${workerId} loop error:`, workerErr.message);
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Worker shutdown/pause cleanup
      worker.status = this.shouldPause ? 'paused' : (this.shouldStop ? 'stopped' : 'idle');
      worker.currentTaskId = null;
      worker.currentAnimeId = null;
      worker.currentAnimeTitle = null;
      worker.seasonName = null;
      worker.operation = null;
      worker.currentSource = null;
      worker.currentStep = null;
      worker.taskStartedAt = null;
      worker.leaseExpiresAt = null;
    };

    // Spin up all 50 workers concurrently
    const workerPromises: Promise<void>[] = [];
    for (let i = 1; i <= this.poolConfig.currentWorkers; i++) {
      workerPromises.push(workerTaskLoop(i));
    }

    await Promise.all(workerPromises);

    clearInterval(watchdogTimer);
    this.isProcessing = false;

    // Flush in-memory stores to disk on completion
    globalDataStore.flushCatalogueSync();
    globalDataStore.flushRecordsSync();

    if (this.shouldPause) {
      this.status = 'paused';
      this.lastLog = 'Job paused. Authoritative state preserved.';
    } else if (this.shouldStop) {
      this.status = 'idle';
      this.lastLog = 'Job stopped.';
    } else {
      this.status = 'completed';
      this.finishedAt = new Date().toISOString();
      this.lastLog = `Job complete! Processed ${this.completedTaskSet.size}/${this.tasksMap.size} tasks.`;
      this.saveJobHistory();
    }

    this.saveJobState();
    this.notifyStateListeners();
  }

  public pauseJob() {
    this.shouldPause = true;
    this.status = 'paused';
    this.lastLog = 'Job paused by owner.';
    for (const w of this.workerMap.values()) {
      if (!w.currentTaskId) w.status = 'paused';
    }
    globalDataStore.flushCatalogueSync();
    globalDataStore.flushRecordsSync();
    this.recordActivityEvent({
      workerId: 1,
      eventType: 'worker_paused',
      step: 'Job pool paused',
      details: 'Job execution paused by owner request.'
    });
    this.saveJobState();
    this.notifyStateListeners();
  }

  public resumeJob() {
    this.shouldPause = false;
    this.shouldStop = false;
    this.status = 'running';
    for (const w of this.workerMap.values()) {
      if (w.status === 'paused' || w.status === 'stopped') w.status = 'idle';
    }
    this.lastLog = 'Job resumed by owner.';
    this.saveJobState();
    this.notifyStateListeners();
  }

  public stopJob() {
    this.shouldStop = true;
    this.shouldPause = true;
    this.isProcessing = false;
    this.status = 'idle';

    globalDataStore.flushCatalogueSync();
    globalDataStore.flushRecordsSync();

    // Release any active in-memory leases safely
    for (const animeId of Array.from(this.animeLeases.keys())) {
      this.releaseAnimeLease(animeId);
    }
    this.seasonLeases.clear();
    this.claimedTasks.clear();
    for (const w of this.workerMap.values()) {
      w.status = 'stopped';
      w.currentTaskId = null;
      w.currentAnimeId = null;
      w.currentAnimeTitle = null;
      w.seasonName = null;
      w.operation = null;
      w.currentSource = null;
      w.currentStep = null;
      w.taskStartedAt = null;
      w.leaseExpiresAt = null;
    }

    this.lastLog = 'Job stopped by owner.';
    this.recordActivityEvent({
      workerId: 1,
      eventType: 'worker_stopped',
      step: 'Job pool stopped',
      details: 'Job execution stopped by owner request.'
    });
    this.saveJobState();
    this.notifyStateListeners();
  }

  private saveJobHistory() {
    try {
      let history: JobHistoryRecord[] = [];
      if (fs.existsSync(JOB_HISTORY_PATH)) {
        history = JSON.parse(fs.readFileSync(JOB_HISTORY_PATH, 'utf-8'));
      }
      history.unshift({
        jobId: this.jobId,
        jobType: this.jobType,
        mode: this.mode,
        startedAt: this.startedAt || new Date().toISOString(),
        finishedAt: this.finishedAt || new Date().toISOString(),
        requestedBatchSize: this.batchLimit,
        completedCount: this.completedTaskSet.size,
        failedCount: this.failedTaskSet.size,
        finalStatus: this.status
      });
      if (history.length > 50) history = history.slice(0, 50);
      fs.writeFileSync(JOB_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    } catch {}
  }
}

export const globalWorkerJobEngine = new ReusableWorkerJobEngine();
