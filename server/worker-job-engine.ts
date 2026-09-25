import fs from 'fs';
import path from 'path';
import { globalSourceGateway } from './source-gateway.ts';

export type TaskPriority = 'HIGH' | 'MEDIUM' | 'NORMAL' | 'LOW';

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  currentWorkers: number;
  concurrencyLimit: number;
}

export interface JobTask<T = any> {
  taskId: string;
  title: string;
  type: string;
  payload: T;
  priority: TaskPriority;
  status: 'queued' | 'claimed' | 'completed' | 'failed' | 'retrying';
  claimedByWorkerId?: number | null;
  claimedAt?: number | null;
  completedAt?: string | null;
  retryCount: number;
  maxRetries: number;
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
  status: 'idle' | 'claiming' | 'working' | 'retrying' | 'waiting' | 'paused' | 'error' | 'stopped' | 'busy' | 'backing_off';
  currentTaskId?: string | null;
  currentAnimeId?: string | null;
  currentAnimeTitle?: string | null;
  seasonName?: string | null;
  operation?: string | null;
  currentSource?: string | null;
  currentStep?: string | null;
  taskStartedAt?: number | null;
  lastHeartbeat: number;
  retryCount?: number;
  tasksCompleted: number;
  tasksFailed: number;
  health?: 'healthy' | 'stale' | 'error';
  lastError?: string | null;
  recentCompletedTasks?: WorkerCompletedTask[];
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
  activityEvents: WorkerActivityEvent[];
  sourceHealth: Record<string, SourceHealthStatus>;
  sourceGatewayMetrics?: Record<string, any>;
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

const STRICT_MAX_WORKERS = 5;

export class ReusableWorkerJobEngine {
  private jobId = 'job_init';
  private jobType = 'artwork_verification';
  private mode = 'all';
  private batchLimit: number | null = null;
  private status: 'idle' | 'running' | 'paused' | 'completed' | 'error' = 'idle';
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private lastLog = 'Worker engine ready.';

  // Queues & Tasks
  private tasksMap = new Map<string, JobTask>();
  private priorityQueues: Record<TaskPriority, string[]> = {
    HIGH: [],
    MEDIUM: [],
    NORMAL: [],
    LOW: []
  };
  private claimedTasks = new Map<string, { workerId: number; claimedAt: number; taskId: string }>();
  private completedTaskSet = new Set<string>();
  private failedTaskSet = new Set<string>();

  // Activity events (Persisted)
  private activityEvents: WorkerActivityEvent[] = [];

  // Dynamic Worker Pool Configuration
  private poolConfig: WorkerPoolConfig = {
    minWorkers: 1,
    maxWorkers: 10,
    currentWorkers: 10, // UPGRADED TO 10 WORKERS
    concurrencyLimit: 10
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

  constructor() {
    this.initWorkers();
    this.loadJobState();
    this.loadActivityEvents();
  }

  public getWorkerPoolConfig(): WorkerPoolConfig {
    return { ...this.poolConfig };
  }

  public setWorkerPoolConfig(config: Partial<WorkerPoolConfig>): WorkerPoolConfig {
    const minWorkers = Math.max(1, config.minWorkers ?? this.poolConfig.minWorkers);
    const maxWorkers = Math.max(minWorkers, config.maxWorkers ?? this.poolConfig.maxWorkers);
    const currentWorkers = Math.min(maxWorkers, Math.max(minWorkers, config.currentWorkers ?? this.poolConfig.currentWorkers));
    const concurrencyLimit = Math.max(1, config.concurrencyLimit ?? this.poolConfig.concurrencyLimit);

    this.poolConfig = { minWorkers, maxWorkers, currentWorkers, concurrencyLimit };
    this.initWorkers();
    this.saveJobState();
    return { ...this.poolConfig };
  }

  private initWorkers() {
    // Retain existing worker statistics if available
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
        this.jobId = saved.jobId || 'job_init';
        this.jobType = saved.jobType || 'artwork_verification';
        this.mode = saved.mode || 'all';
        this.batchLimit = saved.batchLimit || null;
        this.status = saved.status === 'running' ? 'paused' : (saved.status || 'idle');
        this.startedAt = saved.startedAt || null;
        this.finishedAt = saved.finishedAt || null;
        this.lastLog = saved.lastLog || 'Job state reloaded.';

        if (Array.isArray(saved.completedTaskIds)) {
          this.completedTaskSet = new Set(saved.completedTaskIds);
        }
        if (Array.isArray(saved.failedTaskIds)) {
          this.failedTaskSet = new Set(saved.failedTaskIds);
        }
      }
    } catch (err: any) {
      console.error('[WorkerEngine] Error loading state:', err.message);
    }
  }

  public saveJobState() {
    try {
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
      console.error('[WorkerEngine] Error saving state:', err.message);
    }
  }

  // --- Snapshot Generation ---
  public getSnapshot(): JobStateSnapshot {
    // Clean up stale busy worker statuses (>30s)
    const now = Date.now();
    for (const worker of this.workerMap.values()) {
      if ((worker.status === 'working' || worker.status === 'busy') && now - worker.lastHeartbeat > 30000) {
        worker.status = 'idle';
        worker.currentTaskId = null;
        worker.currentAnimeId = null;
        worker.currentAnimeTitle = null;
        worker.seasonName = null;
        worker.operation = null;
        worker.currentSource = null;
        worker.currentStep = null;
        worker.taskStartedAt = null;
      }
    }

    const totalTasks = this.tasksMap.size || (this.completedTaskSet.size + this.failedTaskSet.size);
    const completedCount = this.completedTaskSet.size;
    const failedCount = this.failedTaskSet.size;
    const processed = completedCount + failedCount;

    const queuedCount = (this.priorityQueues.HIGH?.length || 0) + (this.priorityQueues.MEDIUM?.length || 0) + (this.priorityQueues.NORMAL?.length || 0) + (this.priorityQueues.LOW?.length || 0);
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
      systemHealth: {
        heapUsedMb,
        heapTotalMb,
        status: systemHealthStatus
      },
      activeWorkers: Array.from(this.workerMap.values()),
      activityEvents: this.getActivityEvents(),
      sourceHealth: { ...this.sourceHealth },
      sourceGatewayMetrics: globalSourceGateway.getAllMetrics()
    };
  }

  // --- Task Queue Management ---
  public submitTasks<T>(
    tasks: Array<{ taskId: string; title: string; payload: T; priority?: TaskPriority; type?: string }>,
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
    this.completedTaskSet.clear();
    this.failedTaskSet.clear();
    this.priorityQueues = { HIGH: [], MEDIUM: [], NORMAL: [], LOW: [] };

    let candidateTasks = tasks;
    if (batchLimit && batchLimit > 0) {
      candidateTasks = tasks.slice(0, batchLimit);
    }

    for (const item of candidateTasks) {
      const priority = item.priority || 'MEDIUM';
      const task: JobTask<T> = {
        taskId: item.taskId,
        title: item.title,
        type: item.type || 'artwork_verification',
        payload: item.payload,
        priority,
        status: 'queued',
        retryCount: 0,
        maxRetries: 2
      };

      this.tasksMap.set(item.taskId, task);
      this.priorityQueues[priority].push(item.taskId);
    }

    this.lastLog = `Launched ${mode} job with ${candidateTasks.length} tasks across ${this.poolConfig.currentWorkers} workers.`;
    this.saveJobState();
  }

  public enqueueHighPriorityTasks<T>(
    tasks: Array<{ taskId: string; title: string; payload: T; type?: string }>
  ) {
    let addedCount = 0;
    for (const item of tasks) {
      // Deduplication check
      if (this.tasksMap.has(item.taskId) && this.completedTaskSet.has(item.taskId)) {
        this.completedTaskSet.delete(item.taskId); // Re-queued for reverification
      }

      const task: JobTask<T> = {
        taskId: item.taskId,
        title: item.title,
        type: item.type || 'artwork_reverify',
        payload: item.payload,
        priority: 'HIGH',
        status: 'queued',
        retryCount: 0,
        maxRetries: 2
      };

      this.tasksMap.set(item.taskId, task);
      if (!this.priorityQueues.HIGH.includes(item.taskId)) {
        this.priorityQueues.HIGH.push(item.taskId);
        addedCount++;
      }
    }

    this.lastLog = `Queued ${addedCount} high-priority tasks into active worker queue.`;
    this.saveJobState();
  }

  public mapTaskTypeToOperation(type: string): string {
    switch (type) {
      case 'artwork_reverify': return 'Re-verify';
      case 'artwork_search_again': return 'Search Again';
      case 'artwork_fix': return 'Fix Artwork';
      case 'fix_missing': return 'Fix Missing Artwork';
      case 'artwork_verification': default: return 'Verify Artwork';
    }
  }

  public updateWorkerProgress(workerId: number, update: Partial<WorkerInfo>) {
    const worker = this.workerMap.get(workerId);
    if (worker) {
      if (update.status !== undefined) worker.status = update.status;
      if (update.currentStep !== undefined) worker.currentStep = update.currentStep;
      if (update.currentSource !== undefined) worker.currentSource = update.currentSource;
      if (update.operation !== undefined) worker.operation = update.operation;
      if (update.retryCount !== undefined) worker.retryCount = update.retryCount;
      if (update.health !== undefined) worker.health = update.health;
      if (update.lastError !== undefined) worker.lastError = update.lastError;
      worker.lastHeartbeat = Date.now();
    }
  }

  // --- Task Claiming & Worker Leasing ---
  public claimTask(workerId: number): JobTask | null {
    // 1. Recover stale claims (>30s)
    const now = Date.now();
    for (const [taskId, claim] of this.claimedTasks.entries()) {
      if (now - claim.claimedAt > 30000) {
        console.warn(`[WorkerEngine] Heartbeat timeout on task ${taskId} (worker #${claim.workerId}). Recovering task...`);
        this.claimedTasks.delete(taskId);
        const task = this.tasksMap.get(taskId);
        if (task && task.status === 'claimed') {
          task.status = 'queued';
          this.priorityQueues[task.priority].unshift(taskId);
          this.recordActivityEvent({
            workerId: claim.workerId,
            taskId,
            animeTitle: task?.title || null,
            eventType: 'stale_task_recovered',
            details: `Worker #${claim.workerId} heartbeat timeout (>30s). Task recovered and re-queued.`
          });
        }
      }
    }

    // 2. Pick highest priority task
    let targetTaskId: string | undefined;
    for (const prio of ['HIGH', 'MEDIUM', 'NORMAL', 'LOW'] as TaskPriority[]) {
      if (this.priorityQueues[prio] && this.priorityQueues[prio].length > 0) {
        targetTaskId = this.priorityQueues[prio].shift();
        break;
      }
    }

    if (!targetTaskId) return null;

    const task = this.tasksMap.get(targetTaskId);
    if (!task) return null;

    task.status = 'claimed';
    task.claimedByWorkerId = workerId;
    task.claimedAt = Date.now();

    this.claimedTasks.set(targetTaskId, { workerId, claimedAt: Date.now(), taskId: targetTaskId });

    const worker = this.workerMap.get(workerId);
    if (worker) {
      worker.status = 'working';
      worker.currentTaskId = targetTaskId;
      worker.currentAnimeId = task.payload?.id || targetTaskId;
      worker.currentAnimeTitle = task.title;
      worker.seasonName = task.payload?.season ? `Season ${task.payload.season}` : (task.payload?.seasonName || null);
      worker.operation = this.mapTaskTypeToOperation(task.type);
      worker.currentSource = 'Local Catalogue';
      worker.currentStep = 'Claimed task & initializing...';
      worker.taskStartedAt = Date.now();
      worker.lastHeartbeat = Date.now();
      worker.retryCount = task.retryCount || 0;
      worker.health = 'healthy';
      worker.lastError = null;
    }

    this.recordActivityEvent({
      workerId,
      taskId: targetTaskId,
      animeId: task.payload?.id || targetTaskId,
      animeTitle: task.title,
      operation: this.mapTaskTypeToOperation(task.type),
      eventType: 'task_claimed',
      source: 'Queue',
      step: 'Task claimed from worker queue',
      details: `Worker #${workerId} claimed task "${task.title}"`
    });

    this.lastLog = `[Worker #${workerId}] Claimed task: ${task.title}`;
    this.saveJobState();
    return task;
  }

  public completeTask(workerId: number, taskId: string, result: any, isError = false) {
    this.claimedTasks.delete(taskId);
    const task = this.tasksMap.get(taskId);

    if (task) {
      task.completedAt = new Date().toISOString();
      task.result = result;

      if (!isError && result) {
        task.status = 'completed';
        this.completedTaskSet.add(taskId);
        this.failedTaskSet.delete(taskId);
      } else {
        task.status = 'failed';
        this.failedTaskSet.add(taskId);
        this.completedTaskSet.delete(taskId);
      }
    }

    const worker = this.workerMap.get(workerId);
    if (worker) {
      if (!worker.recentCompletedTasks) worker.recentCompletedTasks = [];
      if (task) {
        worker.recentCompletedTasks.unshift({
          taskId,
          animeId: task.payload?.id || taskId,
          animeTitle: task.title || 'Anime Task',
          operation: this.mapTaskTypeToOperation(task.type),
          completedAt: new Date().toISOString(),
          status: isError ? 'failed' : 'completed',
          details: typeof result === 'string' ? result : (result?.message || result?.error || (isError ? 'Failed' : 'Completed'))
        });
        if (worker.recentCompletedTasks.length > 10) worker.recentCompletedTasks.pop();
      }

      worker.lastHeartbeat = Date.now();
      if (!isError) {
        worker.tasksCompleted++;
        worker.status = 'idle';
      } else {
        worker.tasksFailed++;
        worker.status = 'error';
        worker.lastError = typeof result === 'string' ? result : (result?.error || 'Task failed');
      }
      worker.currentTaskId = null;
      worker.currentAnimeId = null;
      worker.currentAnimeTitle = null;
      worker.seasonName = null;
      worker.operation = null;
      worker.currentSource = null;
      worker.currentStep = null;
      worker.taskStartedAt = null;
      worker.health = 'healthy';
    }

    if (task) {
      this.recordActivityEvent({
        workerId,
        taskId,
        animeId: task.payload?.id || taskId,
        animeTitle: task.title,
        operation: this.mapTaskTypeToOperation(task.type),
        eventType: isError ? 'task_failed' : 'task_completed',
        step: isError ? 'Task processing failed' : 'Task processing completed',
        details: typeof result === 'string' ? result : (result?.message || result?.error || (isError ? 'Failed' : 'Completed successfully')),
        result
      });
    }

    const processed = this.completedTaskSet.size + this.failedTaskSet.size;
    this.rateSamples.push({ timestamp: Date.now(), count: processed });
    if (this.rateSamples.length > 20) this.rateSamples.shift();

    if (task) {
      this.lastLog = `[Worker #${workerId}] Completed: ${task.title} (${processed}/${this.tasksMap.size})`;
    }

    this.saveJobState();
  }

  // --- Worker Processing Loop ---
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

    const workerTaskLoop = async (workerId: number) => {
      const worker = this.workerMap.get(workerId) || {
        workerId,
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
        lastHeartbeat: Date.now()
      };

      while (!this.shouldPause && !this.shouldStop) {
        worker.lastHeartbeat = Date.now();
        const task = this.claimTask(workerId);
        if (!task) {
          break; // Queue empty
        }

        try {
          const result = await processor(task, workerId);
          this.completeTask(workerId, task.taskId, result, false);
        } catch (err: any) {
          console.error(`[Worker #${workerId}] Error processing task ${task.title}:`, err.message);
          this.completeTask(workerId, task.taskId, { error: err.message }, true);
        }

        worker.status = 'idle';
        worker.currentTaskId = null;
        worker.currentAnimeId = null;
        worker.currentAnimeTitle = null;
        worker.seasonName = null;
        worker.operation = null;
        worker.currentSource = null;
        worker.currentStep = null;
        worker.taskStartedAt = null;

        // Micro spacing (100ms) to ensure thread yielding
        await new Promise(r => setTimeout(r, 100));
      }

      worker.status = 'idle';
      worker.currentTaskId = null;
      worker.currentAnimeId = null;
      worker.currentAnimeTitle = null;
      worker.seasonName = null;
      worker.operation = null;
      worker.currentSource = null;
      worker.currentStep = null;
      worker.taskStartedAt = null;
    };

    const workerPromises: Promise<void>[] = [];
    for (let i = 1; i <= this.poolConfig.currentWorkers; i++) {
      workerPromises.push(workerTaskLoop(i));
    }

    await Promise.all(workerPromises);

    this.isProcessing = false;

    if (this.shouldPause) {
      this.status = 'paused';
      this.lastLog = 'Job paused. Completed progress saved.';
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
  }

  public pauseJob() {
    this.shouldPause = true;
    this.status = 'paused';
    this.lastLog = 'Job paused by owner.';
    this.recordActivityEvent({
      workerId: 1,
      eventType: 'worker_paused',
      step: 'Job pool paused',
      details: 'Job execution paused by owner request.'
    });
    this.saveJobState();
  }

  public stopJob() {
    this.shouldStop = true;
    this.shouldPause = true;
    this.isProcessing = false;
    this.status = 'idle';
    this.lastLog = 'Job stopped by owner.';
    this.recordActivityEvent({
      workerId: 1,
      eventType: 'worker_stopped',
      step: 'Job pool stopped',
      details: 'Job execution stopped by owner request.'
    });
    this.saveJobState();
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
