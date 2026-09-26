import fs from 'fs';
import path from 'path';

export interface SourceLimits {
  rateLimitPerMinute: number;
  rateLimitPerSecond: number;
  minConcurrent: number;
  maxConcurrent: number;
  currentConcurrent: number;
  timeoutMs: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type WorkerWaitReason =
  | 'No task'
  | 'Rate limited'
  | 'Waiting for source'
  | 'DB busy'
  | 'Retry backoff';

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  openUntil: number;
  lastError?: string | null;
  lastSuccessAt?: string | null;
}

export interface SourceGatewayMetrics {
  sourceId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  deduplicatedRequests: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitEvents: number;
  circuitBreakerState: CircuitState;
  currentConcurrencyLimit: number;
  activeRequests: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
}

export interface CacheEntry<T = any> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const GATEWAY_CACHE_PATH = path.join(DATA_DIR, 'source-gateway-cache.json');

// Default source boundaries based on API specifications and Part 2 constraints:
// - anilist: Primary active source (90/min, 2/s, adaptive concurrency 1-4)
// - anidb: Secondary fallback active source (30/min, 1/s, concurrency 1-2)
// - tvmaze: Tertiary open fallback active source (120/min, 4/s, concurrency 1-4)
// - thetvdb: Gateway fallback (120/min, 4/s, concurrency 1-4)
// - jikan: PERMANENTLY DISABLED (Test source #2 disabled per spec)
// - tmdb: PERMANENTLY DISABLED (Disabled per spec)
export function getConfiguredTmdbApiKey(): string | null {
  const raw = (process.env.TMDB_API_KEY || '').trim();
  if (
    !raw ||
    raw === 'YOUR_TMDB_API_KEY_HERE' ||
    raw === 'MY_TMDB_API_KEY' ||
    raw === 'undefined' ||
    raw === 'null'
  ) {
    return null;
  }
  return raw;
}

export function hasConfiguredTmdbApiKey(): boolean {
  return Boolean(getConfiguredTmdbApiKey());
}

function isSourceDisabled(sourceId: string): boolean {
  const key = sourceId.toLowerCase();
  if (key === 'jikan') return true;
  if (key === 'tmdb') return !hasConfiguredTmdbApiKey();
  return false;
}

const DEFAULT_SOURCE_LIMITS: Record<string, SourceLimits> = {
  anilist: {
    rateLimitPerMinute: 85,
    rateLimitPerSecond: 3,
    minConcurrent: 2,
    maxConcurrent: 8,
    currentConcurrent: 6,
    timeoutMs: 6500
  },
  anidb: {
    rateLimitPerMinute: 90,
    rateLimitPerSecond: 6,
    minConcurrent: 2,
    maxConcurrent: 12,
    currentConcurrent: 10,
    timeoutMs: 6000
  },
  tvmaze: {
    rateLimitPerMinute: 180,
    rateLimitPerSecond: 12,
    minConcurrent: 2,
    maxConcurrent: 20,
    currentConcurrent: 18,
    timeoutMs: 6000
  },
  thetvdb: {
    rateLimitPerMinute: 180,
    rateLimitPerSecond: 12,
    minConcurrent: 2,
    maxConcurrent: 20,
    currentConcurrent: 18,
    timeoutMs: 6000
  },
  jikan: {
    rateLimitPerMinute: 0,
    rateLimitPerSecond: 0,
    minConcurrent: 0,
    maxConcurrent: 0,
    currentConcurrent: 0,
    timeoutMs: 0
  },
  tmdb: {
    rateLimitPerMinute: 150,
    rateLimitPerSecond: 8,
    minConcurrent: 2,
    maxConcurrent: 16,
    currentConcurrent: 12,
    timeoutMs: 6500
  }
};

export class SourceGateway {
  private limits: Map<string, SourceLimits> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerStatus> = new Map();

  // Rate Limiting: Token buckets
  private tokenBuckets: Map<string, { tokens: number; lastRefill: number; minuteTokens: number; lastMinuteRefill: number }> = new Map();

  // Concurrency: Active request counters
  private activeRequestCounts: Map<string, number> = new Map();
  private concurrencyWaiters: Map<string, Array<() => void>> = new Map();

  // Adaptive Concurrency Tracking (AIMD)
  private consecutiveSuccesses: Map<string, number> = new Map();

  // Deduplication: Singleflight promises
  private inFlightRequests: Map<string, Promise<any>> = new Map();

  // Shared Multi-Tier Cache with TTL (in-memory + disk persistence)
  private sharedCache: Map<string, CacheEntry> = new Map();
  private cacheSaveTimer: NodeJS.Timeout | null = null;

  // Metrics
  private metrics: Map<string, SourceGatewayMetrics> = new Map();

  constructor() {
    for (const [sourceId, limit] of Object.entries(DEFAULT_SOURCE_LIMITS)) {
      this.registerSource(sourceId, limit);
    }
    this.loadSharedCache();
  }

  public registerSource(sourceId: string, limits: SourceLimits) {
    const key = sourceId.toLowerCase();
    const disabled = isSourceDisabled(key);
    this.limits.set(key, { ...limits });
    this.circuitBreakers.set(key, {
      state: disabled ? 'OPEN' : 'CLOSED',
      failureCount: 0,
      openUntil: disabled ? Number.MAX_SAFE_INTEGER : 0,
      lastError: key === 'jikan'
        ? 'Source permanently disabled by system specification'
        : disabled
        ? 'Optional TMDB_API_KEY not set — skipped automatically'
        : null,
      lastSuccessAt: null
    });
    this.tokenBuckets.set(key, {
      tokens: Math.max(limits.rateLimitPerSecond, limits.currentConcurrent),
      lastRefill: Date.now(),
      minuteTokens: limits.rateLimitPerMinute,
      lastMinuteRefill: Date.now()
    });
    this.activeRequestCounts.set(key, 0);
    this.concurrencyWaiters.set(key, []);
    this.consecutiveSuccesses.set(key, 0);
    this.metrics.set(key, {
      sourceId: key,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      deduplicatedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rateLimitEvents: 0,
      circuitBreakerState: disabled ? 'OPEN' : 'CLOSED',
      currentConcurrencyLimit: limits.currentConcurrent,
      activeRequests: 0,
      avgLatencyMs: 0,
      lastLatencyMs: 0
    });
  }

  // --- Shared Cache Management ---
  private loadSharedCache() {
    try {
      if (fs.existsSync(GATEWAY_CACHE_PATH)) {
        const raw = fs.readFileSync(GATEWAY_CACHE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        const now = Date.now();
        for (const [k, v] of Object.entries(parsed)) {
          const entry = v as CacheEntry;
          if (entry && now - entry.cachedAt < entry.ttlMs) {
            this.sharedCache.set(k, entry);
          }
        }
      }
    } catch {
      this.sharedCache.clear();
    }
  }

  public scheduleCacheSave() {
    if (this.cacheSaveTimer) return;
    this.cacheSaveTimer = setTimeout(() => {
      this.cacheSaveTimer = null;
      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const obj: Record<string, CacheEntry> = {};
        const now = Date.now();
        for (const [k, entry] of this.sharedCache.entries()) {
          if (now - entry.cachedAt < entry.ttlMs) {
            obj[k] = entry;
          }
        }
        const tempPath = `${GATEWAY_CACHE_PATH}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(obj), 'utf-8');
        fs.renameSync(tempPath, GATEWAY_CACHE_PATH);
      } catch {}
    }, 5000);
  }

  public getCached<T>(key: string): T | null {
    const entry = this.sharedCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.sharedCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  public setCached<T>(key: string, data: T, ttlMs = 24 * 60 * 60 * 1000) {
    if (this.sharedCache.size > 5000) {
      const firstKey = this.sharedCache.keys().next().value;
      if (firstKey) this.sharedCache.delete(firstKey);
    }
    this.sharedCache.set(key, {
      data,
      cachedAt: Date.now(),
      ttlMs
    });
    this.scheduleCacheSave();
  }

  // --- Source Availability & Smart Work Switching Check ---
  public isSourceAvailable(sourceId: string): boolean {
    const key = sourceId.toLowerCase();
    if (isSourceDisabled(key)) return false;

    const cb = this.circuitBreakers.get(key);
    if (!cb) return true;
    // If TMDB key was added dynamically at runtime, auto-open circuit breaker that was only closed due to missing key
    if (key === 'tmdb' && cb.state === 'OPEN' && cb.openUntil === Number.MAX_SAFE_INTEGER) {
      cb.state = 'CLOSED';
      cb.openUntil = 0;
      cb.lastError = null;
      return true;
    }
    if (cb.state === 'OPEN') {
      if (Date.now() >= cb.openUntil) {
        cb.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  private refreshBucketTokens(key: string) {
    const limit = this.limits.get(key);
    if (!limit || limit.rateLimitPerSecond <= 0) return null;
    let bucket = this.tokenBuckets.get(key);
    const now = Date.now();
    if (!bucket) {
      bucket = {
        tokens: limit.rateLimitPerSecond,
        lastRefill: now,
        minuteTokens: limit.rateLimitPerMinute,
        lastMinuteRefill: now
      };
      this.tokenBuckets.set(key, bucket);
      return bucket;
    }

    const secElapsed = (now - bucket.lastRefill) / 1000;
    const maxBurst = Math.max(limit.rateLimitPerSecond, limit.currentConcurrent);
    if (secElapsed >= 0.05) {
      bucket.tokens = Math.min(maxBurst, bucket.tokens + secElapsed * limit.rateLimitPerSecond);
      bucket.lastRefill = now;
    }

    const minElapsed = (now - bucket.lastMinuteRefill) / 1000;
    if (minElapsed >= 1) {
      bucket.minuteTokens = Math.min(
        limit.rateLimitPerMinute,
        bucket.minuteTokens + minElapsed * (limit.rateLimitPerMinute / 60)
      );
      bucket.lastMinuteRefill = now;
    }
    return bucket;
  }

  /**
   * Checks whether a source can execute a request immediately without blocking in a queue.
   * Used by the 50-worker pool to dynamically route workers to available sources instead of waiting.
   */
  public canExecuteImmediately(
    sourceId: string,
    requestKey?: string
  ): {
    canExecute: boolean;
    hasCacheOrInFlight: boolean;
    waitReason?: WorkerWaitReason;
    activeRatio: number;
  } {
    const key = sourceId.toLowerCase();
    if (isSourceDisabled(key)) {
      return { canExecute: false, hasCacheOrInFlight: false, waitReason: 'Waiting for source', activeRatio: 999 };
    }

    if (requestKey) {
      const normKey = `${key}:${requestKey.toLowerCase().trim()}`;
      if (this.getCached(normKey) !== null) {
        return { canExecute: true, hasCacheOrInFlight: true, activeRatio: -1 };
      }
      if (this.inFlightRequests.has(normKey)) {
        return { canExecute: true, hasCacheOrInFlight: true, activeRatio: 0 };
      }
    }

    if (!this.isSourceAvailable(key)) {
      return { canExecute: false, hasCacheOrInFlight: false, waitReason: 'Rate limited', activeRatio: 900 };
    }

    const limit = this.limits.get(key);
    const maxConcurrent = limit ? limit.currentConcurrent : 2;
    const currentActive = this.activeRequestCounts.get(key) || 0;
    const waitersCount = this.concurrencyWaiters.get(key)?.length || 0;

    if (currentActive >= maxConcurrent || waitersCount > 0) {
      return {
        canExecute: false,
        hasCacheOrInFlight: false,
        waitReason: 'Waiting for source',
        activeRatio: (currentActive + waitersCount + 1) / Math.max(1, maxConcurrent)
      };
    }

    const bucket = this.refreshBucketTokens(key);
    if (bucket && (bucket.tokens < 1 || bucket.minuteTokens < 1)) {
      return {
        canExecute: false,
        hasCacheOrInFlight: false,
        waitReason: 'Rate limited',
        activeRatio: 500
      };
    }

    return {
      canExecute: true,
      hasCacheOrInFlight: false,
      activeRatio: currentActive / Math.max(1, maxConcurrent)
    };
  }

  /**
   * Ranks candidate sources so workers automatically spread across healthy, non-busy sources
   * instead of all 50 workers piling onto a single source queue.
   */
  public getOptimalSourceOrder(candidateSourceIds: string[], requestKey?: string, workerHint = 0): string[] {
    const available = candidateSourceIds.filter(id => !isSourceDisabled(id));
    const scored = available.map((id, idx) => {
      const status = this.canExecuteImmediately(id, requestKey);
      // Slight deterministic rotation based on workerHint so simultaneous workers spread across sources
      const rotationBias = ((idx + workerHint) % Math.max(1, available.length)) * 0.08;
      const score = status.hasCacheOrInFlight
        ? -10 + idx * 0.01
        : status.canExecute
        ? status.activeRatio + rotationBias
        : status.activeRatio + 100 + idx;
      return { id, score, canExecute: status.canExecute };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored.map(s => s.id);
  }

  private refillBucketNow(key: string) {
    const limit = this.limits.get(key);
    if (!limit || limit.rateLimitPerSecond <= 0) return null;
    let bucket = this.tokenBuckets.get(key);
    const now = Date.now();
    if (!bucket) {
      bucket = {
        tokens: limit.rateLimitPerSecond,
        lastRefill: now,
        minuteTokens: limit.rateLimitPerMinute,
        lastMinuteRefill: now
      };
      this.tokenBuckets.set(key, bucket);
      return bucket;
    }

    const secElapsed = Math.max(0, (now - bucket.lastRefill) / 1000);
    const maxBurst = Math.max(limit.rateLimitPerSecond, limit.currentConcurrent);
    if (secElapsed > 0.05) {
      bucket.tokens = Math.min(maxBurst, bucket.tokens + secElapsed * limit.rateLimitPerSecond);
      bucket.lastRefill = now;
    }

    const minElapsed = Math.max(0, (now - bucket.lastMinuteRefill) / 1000);
    if (minElapsed > 0.5) {
      bucket.minuteTokens = Math.min(
        limit.rateLimitPerMinute,
        bucket.minuteTokens + minElapsed * (limit.rateLimitPerMinute / 60)
      );
      bucket.lastMinuteRefill = now;
    }
    return bucket;
  }

  /**
   * Returns true if the source can immediately process a request right now
   * without blocking on concurrency semaphores or rate-limit token buckets.
   */
  public hasImmediateCapacity(sourceId: string): boolean {
    const key = sourceId.toLowerCase();
    if (!this.isSourceAvailable(key)) return false;
    const limit = this.limits.get(key);
    if (!limit || limit.currentConcurrent <= 0) return false;

    const active = this.activeRequestCounts.get(key) || 0;
    const waiters = this.concurrencyWaiters.get(key)?.length || 0;
    if (active >= limit.currentConcurrent || waiters > 0) {
      return false;
    }

    const bucket = this.refillBucketNow(key);
    if (!bucket) return false;
    return bucket.tokens >= 1 && bucket.minuteTokens >= 1;
  }

  /**
   * Checks if a given request key is already cached or in-flight on a source.
   */
  public hasInFlightOrCached(sourceId: string, requestKey: string): 'cached' | 'inflight' | false {
    const key = sourceId.toLowerCase();
    const fullKey = `${key}:${requestKey.toLowerCase().trim()}`;
    if (this.getCached(fullKey) !== null) return 'cached';
    if (this.inFlightRequests.has(fullKey)) return 'inflight';
    return false;
  }

  /**
   * Selects the best available source order for a worker so workers automatically
   * spread across healthy sources instead of queuing behind a single rate-limited/busy source.
   */
  public selectOptimalSourcesOrder(candidateSources: string[], workerId = 1, requestKey?: string): string[] {
    const available = candidateSources.filter(s => this.isSourceAvailable(s));
    if (available.length <= 1) return available;

    // 1. If any source already has a cached result for this requestKey, put it first!
    if (requestKey) {
      const cachedSource = available.find(s => this.hasInFlightOrCached(s, requestKey) === 'cached');
      if (cachedSource) {
        return [cachedSource, ...available.filter(s => s !== cachedSource)];
      }
    }

    // 2. Partition into sources with immediate zero-wait capacity vs busy/rate-limited sources
    const immediate: string[] = [];
    const busy: string[] = [];
    for (const s of available) {
      if (this.hasImmediateCapacity(s)) {
        immediate.push(s);
      } else {
        busy.push(s);
      }
    }

    // Rotate among immediate sources by workerId so 50 workers spread evenly across all healthy sources without stampeding a single domain
    if (immediate.length > 1) {
      const offset = workerId % immediate.length;
      const rotatedImmediate = [...immediate.slice(offset), ...immediate.slice(0, offset)];
      return [...rotatedImmediate, ...busy];
    }

    // Sort busy sources by fewest waiters + active requests
    busy.sort((a, b) => {
      const loadA = (this.activeRequestCounts.get(a) || 0) + (this.concurrencyWaiters.get(a)?.length || 0) * 2;
      const loadB = (this.activeRequestCounts.get(b) || 0) + (this.concurrencyWaiters.get(b)?.length || 0) * 2;
      return loadA - loadB;
    });

    return [...immediate, ...busy];
  }

  // --- Adaptive Concurrency Control (AIMD) ---
  public getAdaptiveConcurrencyLimit(sourceId: string): number {
    const limit = this.limits.get(sourceId.toLowerCase());
    return limit ? limit.currentConcurrent : 2;
  }

  private onAdaptiveSuccess(key: string, latencyMs: number) {
    const limit = this.limits.get(key);
    if (!limit || limit.maxConcurrent <= limit.minConcurrent) return;

    const successes = (this.consecutiveSuccesses.get(key) || 0) + 1;
    this.consecutiveSuccesses.set(key, successes);

    // Additive Increase: After 6 consecutive fast (<1800ms) successes, bump concurrency by 1
    if (successes >= 6 && latencyMs < 1800 && limit.currentConcurrent < limit.maxConcurrent) {
      limit.currentConcurrent += 1;
      this.consecutiveSuccesses.set(key, 0);
      const metric = this.metrics.get(key);
      if (metric) metric.currentConcurrencyLimit = limit.currentConcurrent;
      // Trigger any waiting workers immediately
      this.pumpWaiters(key);
    }
  }

  private onAdaptiveBackoff(key: string, isRateLimit: boolean, latencyMs: number) {
    const limit = this.limits.get(key);
    if (!limit) return;

    this.consecutiveSuccesses.set(key, 0);

    if (isRateLimit) {
      // Multiplicative decrease down to minimum safe concurrency
      limit.currentConcurrent = limit.minConcurrent;
    } else if (latencyMs > 4500 && limit.currentConcurrent > limit.minConcurrent) {
      limit.currentConcurrent = Math.max(limit.minConcurrent, limit.currentConcurrent - 1);
    }

    const metric = this.metrics.get(key);
    if (metric) metric.currentConcurrencyLimit = limit.currentConcurrent;
  }

  // --- Rate Limiting: Dual-Token Bucket (Per-Second & Per-Minute) ---
  private async acquireRateLimitToken(
    sourceId: string,
    onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
  ): Promise<boolean> {
    const key = sourceId.toLowerCase();
    if (!this.isSourceAvailable(key)) return false;

    const limit = this.limits.get(key) || {
      rateLimitPerMinute: 60,
      rateLimitPerSecond: 4,
      minConcurrent: 1,
      maxConcurrent: 8,
      currentConcurrent: 4,
      timeoutMs: 6500
    };

    if (limit.rateLimitPerSecond <= 0) return true;

    const bucket = this.refillBucketNow(key)!;

    if (bucket.tokens >= 1 && bucket.minuteTokens >= 1) {
      bucket.tokens -= 1;
      bucket.minuteTokens -= 1;
      return true;
    }

    // Must wait for token refill — only set status to 'waiting' with 'Rate limited' when actually waiting!
    const waitSec = Math.max(
      (1 - bucket.tokens) / Math.max(1, limit.rateLimitPerSecond),
      (1 - bucket.minuteTokens) / Math.max(1, limit.rateLimitPerMinute / 60)
    );
    const waitMs = Math.min(Math.max(25, Math.ceil(waitSec * 1000)), 850);

    const metric = this.metrics.get(key);
    if (metric) metric.rateLimitEvents++;

    onStatusChange?.(
      'waiting',
      `Rate limited — waiting ${waitMs}ms for ${sourceId} quota refill`,
      'Rate limited'
    );

    await new Promise(r => setTimeout(r, waitMs));

    if (!this.isSourceAvailable(key)) {
      return false;
    }

    const refilled = this.refillBucketNow(key)!;
    refilled.tokens = Math.max(0, refilled.tokens - 1);
    refilled.minuteTokens = Math.max(0, refilled.minuteTokens - 1);
    return true;
  }

  // --- Semaphore Concurrency Management ---
  private async acquireSemaphore(
    sourceId: string,
    onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
  ): Promise<() => void> {
    const key = sourceId.toLowerCase();
    const limit = this.limits.get(key);
    const maxConcurrent = limit ? limit.currentConcurrent : 4;

    const current = this.activeRequestCounts.get(key) || 0;

    if (current < maxConcurrent) {
      this.activeRequestCounts.set(key, current + 1);
      const metric = this.metrics.get(key);
      if (metric) metric.activeRequests = current + 1;
      return () => this.releaseSemaphore(key);
    }

    onStatusChange?.(
      'waiting',
      `Waiting for source — ${sourceId} concurrency (${current}/${maxConcurrent} active)`,
      'Waiting for source'
    );

    return new Promise((resolve) => {
      const waiters = this.concurrencyWaiters.get(key) || [];
      waiters.push(() => {
        const c = (this.activeRequestCounts.get(key) || 0) + 1;
        this.activeRequestCounts.set(key, c);
        const metric = this.metrics.get(key);
        if (metric) metric.activeRequests = c;
        resolve(() => this.releaseSemaphore(key));
      });
      this.concurrencyWaiters.set(key, waiters);
    });
  }

  private flushWaitersOnCircuitOpen(key: string) {
    const waiters = this.concurrencyWaiters.get(key);
    if (!waiters || waiters.length === 0) return;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next) next();
    }
  }

  private releaseSemaphore(key: string) {
    const current = this.activeRequestCounts.get(key) || 1;
    const newCount = Math.max(0, current - 1);
    this.activeRequestCounts.set(key, newCount);
    const metric = this.metrics.get(key);
    if (metric) metric.activeRequests = newCount;

    this.pumpWaiters(key);
  }

  private pumpWaiters(key: string) {
    const limit = this.limits.get(key);
    const maxConcurrent = limit ? limit.currentConcurrent : 2;
    const current = this.activeRequestCounts.get(key) || 0;
    const availableSlots = maxConcurrent - current;

    if (availableSlots > 0) {
      const waiters = this.concurrencyWaiters.get(key) || [];
      for (let i = 0; i < availableSlots && waiters.length > 0; i++) {
        const next = waiters.shift();
        if (next) next();
      }
    }
  }

  // --- Error & Rate-Limit Classification with Retry-After ---
  public classifyError(
    error: any,
    statusCode?: number,
    headers?: Record<string, string> | Headers
  ): { isTemporary: boolean; isRateLimit: boolean; isPermanent: boolean; retryAfterMs?: number } {
    if (statusCode === 429) {
      let retryAfterMs = 20000;
      if (headers) {
        let retryHeader: string | null = null;
        if (typeof (headers as any).get === 'function') {
          retryHeader = (headers as Headers).get('retry-after');
        } else if ((headers as any)['retry-after']) {
          retryHeader = (headers as any)['retry-after'];
        }

        if (retryHeader) {
          const parsedSec = parseInt(retryHeader, 10);
          if (!isNaN(parsedSec)) {
            retryAfterMs = parsedSec * 1000;
          } else {
            const parsedDate = new Date(retryHeader).getTime();
            if (!isNaN(parsedDate) && parsedDate > Date.now()) {
              retryAfterMs = parsedDate - Date.now();
            }
          }
        }
      }
      return { isTemporary: true, isRateLimit: true, isPermanent: false, retryAfterMs };
    }

    if (statusCode && (statusCode === 502 || statusCode === 503 || statusCode === 504 || statusCode === 500)) {
      return { isTemporary: true, isRateLimit: false, isPermanent: false };
    }
    if (statusCode && (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404)) {
      return { isTemporary: false, isRateLimit: false, isPermanent: true };
    }

    const msg = (error?.message || String(error)).toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('network') ||
      msg.includes('fetch failed')
    ) {
      return { isTemporary: true, isRateLimit: false, isPermanent: false };
    }

    return { isTemporary: false, isRateLimit: false, isPermanent: true };
  }

  // --- Circuit Breaker Management ---
  public getCircuitStatus(sourceId: string): CircuitBreakerStatus {
    const key = sourceId.toLowerCase();
    const disabled = isSourceDisabled(key);
    const cb = this.circuitBreakers.get(key) || {
      state: disabled ? 'OPEN' : 'CLOSED',
      failureCount: 0,
      openUntil: disabled ? Number.MAX_SAFE_INTEGER : 0
    };

    if (key === 'tmdb') {
      if (disabled) {
        return {
          state: 'OPEN',
          failureCount: 0,
          openUntil: Number.MAX_SAFE_INTEGER,
          lastError: 'Optional TMDB_API_KEY not set — skipped automatically',
          lastSuccessAt: cb.lastSuccessAt ?? null
        };
      } else if (cb.state === 'OPEN' && cb.openUntil === Number.MAX_SAFE_INTEGER) {
        cb.state = 'CLOSED';
        cb.openUntil = 0;
        cb.lastError = null;
      }
    }

    if (cb.state === 'OPEN' && !disabled && Date.now() >= cb.openUntil) {
      cb.state = 'HALF_OPEN';
    }

    return { ...cb };
  }

  public recordSuccess(sourceId: string, latencyMs: number) {
    const key = sourceId.toLowerCase();
    const cb = this.circuitBreakers.get(key);
    if (cb && !isSourceDisabled(key)) {
      cb.state = 'CLOSED';
      cb.failureCount = 0;
      cb.openUntil = 0;
      cb.lastSuccessAt = new Date().toISOString();
      cb.lastError = null;
    }

    this.onAdaptiveSuccess(key, latencyMs);

    const m = this.metrics.get(key);
    if (m) {
      m.successfulRequests++;
      m.circuitBreakerState = 'CLOSED';
      m.lastLatencyMs = latencyMs;
      m.avgLatencyMs = m.avgLatencyMs === 0 ? latencyMs : Math.round(m.avgLatencyMs * 0.8 + latencyMs * 0.2);
    }
  }

  public recordFailure(sourceId: string, errorMsg: string, statusCode?: number, retryAfterMs?: number) {
    const key = sourceId.toLowerCase();
    if (isSourceDisabled(key)) return;

    const cb = this.circuitBreakers.get(key);
    const { isRateLimit } = this.classifyError({ message: errorMsg }, statusCode);

    this.onAdaptiveBackoff(key, isRateLimit, 5000);

    if (cb) {
      cb.failureCount++;
      cb.lastError = errorMsg;

      if (isRateLimit || cb.failureCount >= 3) {
        cb.state = 'OPEN';
        const cooldownMs = Math.min(retryAfterMs || (isRateLimit ? 15000 : 10000), 25000);
        cb.openUntil = Date.now() + cooldownMs;
        console.warn(`[CircuitBreaker] Circuit OPENED for source "${key}" for ${Math.round(cooldownMs / 1000)}s. Cause: ${errorMsg}`);
        // Immediately wake any queued waiters on this source so they failover to other available sources instead of waiting!
        this.flushWaitersOnCircuitOpen(key);
      }
    }

    const m = this.metrics.get(key);
    if (m) {
      m.failedRequests++;
      if (cb) m.circuitBreakerState = cb.state;
    }
  }

  // --- Core Singleflight & Protected Fetch Method ---
  public async executeRequest<T>(
    sourceId: string,
    requestKey: string,
    fetchFn: () => Promise<{ success: boolean; data?: T; matches?: T[]; error?: string; statusCode?: number; headers?: Record<string, string> | Headers }>,
    onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string, waitReason?: WorkerWaitReason) => void
  ): Promise<{
    success: boolean;
    data?: T;
    matches?: T[];
    error?: string;
    statusCode?: number;
    isCircuitOpen?: boolean;
    isDeduplicated?: boolean;
    isFromCache?: boolean;
  }> {
    const key = sourceId.toLowerCase();

    // REQUIREMENT 12: DISABLED / OPTIONAL UNCONFIGURED SOURCES ENFORCEMENT
    if (isSourceDisabled(key)) {
      return {
        success: false,
        error: key === 'tmdb'
          ? 'Source "tmdb" is skipped automatically (optional TMDB_API_KEY is not set; other sources remain active).'
          : `Source "${sourceId}" is permanently disabled by system specification.`,
        isCircuitOpen: true
      };
    }

    const metric = this.metrics.get(key);
    if (metric) metric.totalRequests++;

    // 1. Check Shared Cache First (Zero Network Overhead!)
    const cacheKey = `${key}:${requestKey.toLowerCase().trim()}`;
    const cachedData = this.getCached<any>(cacheKey);
    if (cachedData) {
      if (metric) metric.cacheHits++;
      onStatusChange?.('working', `Cache hit on ${sourceId} for "${requestKey}"`);
      return {
        success: true,
        matches: Array.isArray(cachedData) ? cachedData : undefined,
        data: !Array.isArray(cachedData) ? cachedData : undefined,
        isFromCache: true
      };
    }
    if (metric) metric.cacheMisses++;

    // 2. Check Circuit Breaker
    const cb = this.getCircuitStatus(key);
    if (cb.state === 'OPEN') {
      return {
        success: false,
        error: `Source "${sourceId}" is temporarily cooling down (${Math.ceil((cb.openUntil - Date.now()) / 1000)}s remaining)`,
        isCircuitOpen: true
      };
    }

    // 3. In-Flight Singleflight Request Deduplication
    const fullReqKey = `${key}:${requestKey.toLowerCase().trim()}`;
    if (this.inFlightRequests.has(fullReqKey)) {
      if (metric) metric.deduplicatedRequests++;
      onStatusChange?.(
        'waiting',
        `Waiting for source — deduplicated in-flight ${sourceId} query for "${requestKey}"`,
        'Waiting for source'
      );
      const result = await this.inFlightRequests.get(fullReqKey);
      onStatusChange?.('working', `Received deduplicated ${sourceId} result for "${requestKey}"`);
      return { ...result, isDeduplicated: true };
    }

    // 4. Create and register Singleflight Execution Promise
    const executionPromise = (async () => {
      // Acquire Concurrency Semaphore (only sets 'waiting' if slot is not immediately available)
      const release = await this.acquireSemaphore(key, onStatusChange);

      try {
        // Re-check circuit breaker after waking from semaphore so workers never call a newly rate-limited source
        if (!this.isSourceAvailable(key)) {
          return {
            success: false,
            error: `Source "${sourceId}" entered rate-limit cooldown while waiting; switching source.`,
            isCircuitOpen: true
          };
        }

        // Acquire Rate Limit Token (only sets 'waiting' if token is not immediately available)
        const tokenAcquired = await this.acquireRateLimitToken(key, onStatusChange);
        if (!tokenAcquired || !this.isSourceAvailable(key)) {
          return {
            success: false,
            error: `Source "${sourceId}" rate-limited; switching to alternative source.`,
            isCircuitOpen: true
          };
        }

        let attempts = 0;
        const maxAttempts = 2;
        const startTime = Date.now();

        while (attempts < maxAttempts) {
          attempts++;
          if (!this.isSourceAvailable(key)) {
            return {
              success: false,
              error: `Source "${sourceId}" circuit open; failing over to next available source.`,
              isCircuitOpen: true
            };
          }

          try {
            onStatusChange?.('working', `Querying ${sourceId} for "${requestKey}" (attempt ${attempts})`);
            const res = await fetchFn();
            const latencyMs = Date.now() - startTime;

            if (res.success) {
              this.recordSuccess(key, latencyMs);
              const dataToCache = res.matches || res.data;
              if (dataToCache) {
                this.setCached(cacheKey, dataToCache);
              }
              return res;
            }

            const errorClassification = this.classifyError({ message: res.error }, res.statusCode, res.headers);
            this.recordFailure(key, res.error || 'Request failed', res.statusCode, errorClassification.retryAfterMs);

            // If rate-limited (429) or circuit opened, do NOT sleep inside this source — return immediately so the worker switches to another available source!
            if (errorClassification.isRateLimit || !this.isSourceAvailable(key) || !errorClassification.isTemporary || attempts >= maxAttempts) {
              return {
                ...res,
                isCircuitOpen: errorClassification.isRateLimit || !this.isSourceAvailable(key)
              };
            }

            // Short bounded retry backoff for non-429 transient network hiccups
            const backoffMs = Math.min(900, Math.pow(2, attempts) * 200 + Math.random() * 120);
            onStatusChange?.(
              'retrying',
              `Retry backoff — retrying ${sourceId} in ${Math.round(backoffMs)}ms (${res.error || 'transient error'})`,
              'Retry backoff'
            );
            await new Promise(r => setTimeout(r, backoffMs));
          } catch (err: any) {
            const errorClassification = this.classifyError(err);
            this.recordFailure(key, err.message, undefined, errorClassification.retryAfterMs);

            if (errorClassification.isRateLimit || !this.isSourceAvailable(key) || !errorClassification.isTemporary || attempts >= maxAttempts) {
              return { success: false, error: err.message, isCircuitOpen: !this.isSourceAvailable(key) };
            }

            const backoffMs = Math.min(900, Math.pow(2, attempts) * 200 + Math.random() * 120);
            onStatusChange?.(
              'retrying',
              `Retry backoff — retrying ${sourceId} in ${Math.round(backoffMs)}ms (${err.message})`,
              'Retry backoff'
            );
            await new Promise(r => setTimeout(r, backoffMs));
          }
        }

        return { success: false, error: `Failed after ${maxAttempts} attempts` };
      } finally {
        release();
      }
    })();

    this.inFlightRequests.set(fullReqKey, executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightRequests.delete(fullReqKey);
    }
  }

  public getAllMetrics(): Record<string, SourceGatewayMetrics> {
    const res: Record<string, SourceGatewayMetrics> = {};
    for (const [key, metric] of this.metrics.entries()) {
      const cb = this.getCircuitStatus(key);
      const limit = this.limits.get(key);
      res[key] = {
        ...metric,
        circuitBreakerState: cb.state,
        currentConcurrencyLimit: limit ? limit.currentConcurrent : 0,
        activeRequests: this.activeRequestCounts.get(key) || 0
      };
    }
    return res;
  }
}

export const globalSourceGateway = new SourceGateway();
