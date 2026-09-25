import fs from 'fs';
import path from 'path';

export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

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

export interface WorkerInfo {
  workerId: number;
  status: 'idle' | 'busy' | 'backing_off';
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  lastHeartbeat: number;
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
  activeWorkers: WorkerInfo[];
  sourceHealth: Record<string, SourceHealthStatus>;
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
    LOW: []
  };
  private claimedTasks = new Map<string, { workerId: number; claimedAt: number; taskId: string }>();
  private completedTaskSet = new Set<string>();
  private failedTaskSet = new Set<string>();

  // Worker Pool (Hard max 5)
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
  }

  private initWorkers() {
    this.workerMap.clear();
    for (let i = 1; i <= STRICT_MAX_WORKERS; i++) {
      this.workerMap.set(i, {
        workerId: i,
        status: 'idle',
        tasksCompleted: 0,
        tasksFailed: 0,
        lastHeartbeat: Date.now()
      });
    }
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
      fs.writeFileSync(JOB_STATE_PATH, JSON.stringify({
        ...snapshot,
        completedTaskIds: Array.from(this.completedTaskSet),
        failedTaskIds: Array.from(this.failedTaskSet)
      }, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[WorkerEngine] Error saving state:', err.message);
    }
  }

  // --- Snapshot Generation ---
  public getSnapshot(): JobStateSnapshot {
    const totalTasks = this.tasksMap.size || (this.completedTaskSet.size + this.failedTaskSet.size);
    const completedCount = this.completedTaskSet.size;
    const failedCount = this.failedTaskSet.size;
    const processed = completedCount + failedCount;

    const queuedCount = this.priorityQueues.HIGH.length + this.priorityQueues.MEDIUM.length + this.priorityQueues.LOW.length;
    const claimedCount = this.claimedTasks.size;

    const progressPercent = totalTasks > 0 ? Math.min(100, Math.round((processed / totalTasks) * 100)) : 0;

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
      workerCount: STRICT_MAX_WORKERS,
      activeWorkers: Array.from(this.workerMap.values()),
      sourceHealth: { ...this.sourceHealth }
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
    this.priorityQueues = { HIGH: [], MEDIUM: [], LOW: [] };

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

    this.lastLog = `Launched ${mode} job with ${candidateTasks.length} tasks across ${STRICT_MAX_WORKERS} workers.`;
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
        }
      }
    }

    // 2. Pick highest priority task
    let targetTaskId: string | undefined;
    for (const prio of ['HIGH', 'MEDIUM', 'LOW'] as TaskPriority[]) {
      if (this.priorityQueues[prio].length > 0) {
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
      worker.status = 'busy';
      worker.currentTaskId = targetTaskId;
      worker.currentTaskTitle = task.title;
      worker.lastHeartbeat = Date.now();
    }

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
      worker.lastHeartbeat = Date.now();
      if (!isError) worker.tasksCompleted++;
      else worker.tasksFailed++;
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
        worker.currentTaskTitle = null;

        // Micro spacing (100ms) to ensure thread yielding
        await new Promise(r => setTimeout(r, 100));
      }

      worker.status = 'idle';
      worker.currentTaskId = null;
      worker.currentTaskTitle = null;
    };

    const workerPromises: Promise<void>[] = [];
    for (let i = 1; i <= STRICT_MAX_WORKERS; i++) {
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
    this.saveJobState();
  }

  public stopJob() {
    this.shouldStop = true;
    this.shouldPause = true;
    this.isProcessing = false;
    this.status = 'idle';
    this.lastLog = 'Job stopped by owner.';
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
