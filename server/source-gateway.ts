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
const DEFAULT_SOURCE_LIMITS: Record<string, SourceLimits> = {
  anilist: {
    rateLimitPerMinute: 90,
    rateLimitPerSecond: 2,
    minConcurrent: 1,
    maxConcurrent: 4,
    currentConcurrent: 2,
    timeoutMs: 8000
  },
  anidb: {
    rateLimitPerMinute: 30,
    rateLimitPerSecond: 1,
    minConcurrent: 1,
    maxConcurrent: 2,
    currentConcurrent: 1,
    timeoutMs: 8000
  },
  tvmaze: {
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 4,
    minConcurrent: 1,
    maxConcurrent: 5,
    currentConcurrent: 3,
    timeoutMs: 8000
  },
  thetvdb: {
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 4,
    minConcurrent: 1,
    maxConcurrent: 5,
    currentConcurrent: 3,
    timeoutMs: 8000
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
    rateLimitPerMinute: 0,
    rateLimitPerSecond: 0,
    minConcurrent: 0,
    maxConcurrent: 0,
    currentConcurrent: 0,
    timeoutMs: 0
  }
};

const DISABLED_SOURCES = new Set(['jikan', 'tmdb']);

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
    this.limits.set(key, { ...limits });
    this.circuitBreakers.set(key, {
      state: DISABLED_SOURCES.has(key) ? 'OPEN' : 'CLOSED',
      failureCount: 0,
      openUntil: DISABLED_SOURCES.has(key) ? Number.MAX_SAFE_INTEGER : 0,
      lastError: DISABLED_SOURCES.has(key) ? 'Source permanently disabled by system specification' : null,
      lastSuccessAt: null
    });
    this.tokenBuckets.set(key, {
      tokens: limits.rateLimitPerSecond,
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
      circuitBreakerState: DISABLED_SOURCES.has(key) ? 'OPEN' : 'CLOSED',
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
    if (DISABLED_SOURCES.has(key)) return false;

    const cb = this.circuitBreakers.get(key);
    if (!cb) return true;
    if (cb.state === 'OPEN') {
      if (Date.now() >= cb.openUntil) {
        cb.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
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
  private async acquireRateLimitToken(sourceId: string): Promise<void> {
    const key = sourceId.toLowerCase();
    const limit = this.limits.get(key) || {
      rateLimitPerMinute: 60,
      rateLimitPerSecond: 2,
      minConcurrent: 1,
      maxConcurrent: 2,
      currentConcurrent: 2,
      timeoutMs: 8000
    };

    if (limit.rateLimitPerSecond <= 0) return;

    const bucket = this.tokenBuckets.get(key) || {
      tokens: limit.rateLimitPerSecond,
      lastRefill: Date.now(),
      minuteTokens: limit.rateLimitPerMinute,
      lastMinuteRefill: Date.now()
    };

    const now = Date.now();

    // Refill per-second tokens
    const secElapsed = (now - bucket.lastRefill) / 1000;
    if (secElapsed >= 0.5) {
      bucket.tokens = Math.min(limit.rateLimitPerSecond, bucket.tokens + secElapsed * limit.rateLimitPerSecond);
      bucket.lastRefill = now;
    }

    // Refill per-minute tokens
    const minElapsed = (now - bucket.lastMinuteRefill) / 1000;
    if (minElapsed >= 5) {
      bucket.minuteTokens = Math.min(
        limit.rateLimitPerMinute,
        bucket.minuteTokens + (minElapsed * (limit.rateLimitPerMinute / 60))
      );
      bucket.lastMinuteRefill = now;
    }

    if (bucket.tokens >= 1 && bucket.minuteTokens >= 1) {
      bucket.tokens -= 1;
      bucket.minuteTokens -= 1;
      return;
    }

    // Must wait for token refill
    const waitSec = Math.max(
      (1 - bucket.tokens) / Math.max(1, limit.rateLimitPerSecond),
      (1 - bucket.minuteTokens) / Math.max(1, limit.rateLimitPerMinute / 60)
    );
    const waitMs = Math.min(Math.ceil(waitSec * 1000), 2000);

    const metric = this.metrics.get(key);
    if (metric) metric.rateLimitEvents++;

    await new Promise(r => setTimeout(r, waitMs));

    // Consume token after wait
    bucket.tokens = Math.max(0, bucket.tokens - 1);
    bucket.minuteTokens = Math.max(0, bucket.minuteTokens - 1);
    bucket.lastRefill = Date.now();
  }

  // --- Semaphore Concurrency Management ---
  private async acquireSemaphore(sourceId: string): Promise<() => void> {
    const key = sourceId.toLowerCase();
    const limit = this.limits.get(key);
    const maxConcurrent = limit ? limit.currentConcurrent : 2;

    const current = this.activeRequestCounts.get(key) || 0;

    if (current < maxConcurrent) {
      this.activeRequestCounts.set(key, current + 1);
      const metric = this.metrics.get(key);
      if (metric) metric.activeRequests = current + 1;
      return () => this.releaseSemaphore(key);
    }

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
    const cb = this.circuitBreakers.get(key) || {
      state: DISABLED_SOURCES.has(key) ? 'OPEN' : 'CLOSED',
      failureCount: 0,
      openUntil: DISABLED_SOURCES.has(key) ? Number.MAX_SAFE_INTEGER : 0
    };

    if (cb.state === 'OPEN' && !DISABLED_SOURCES.has(key) && Date.now() >= cb.openUntil) {
      cb.state = 'HALF_OPEN';
    }

    return { ...cb };
  }

  public recordSuccess(sourceId: string, latencyMs: number) {
    const key = sourceId.toLowerCase();
    const cb = this.circuitBreakers.get(key);
    if (cb && !DISABLED_SOURCES.has(key)) {
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
    if (DISABLED_SOURCES.has(key)) return;

    const cb = this.circuitBreakers.get(key);
    const { isRateLimit } = this.classifyError({ message: errorMsg }, statusCode);

    this.onAdaptiveBackoff(key, isRateLimit, 5000);

    if (cb) {
      cb.failureCount++;
      cb.lastError = errorMsg;

      if (isRateLimit || cb.failureCount >= 3) {
        cb.state = 'OPEN';
        const cooldownMs = retryAfterMs || (isRateLimit ? 25000 : 15000);
        cb.openUntil = Date.now() + cooldownMs;
        console.warn(`[CircuitBreaker] Circuit OPENED for source "${key}" for ${Math.round(cooldownMs / 1000)}s. Cause: ${errorMsg}`);
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
    onStatusChange?: (status: 'waiting' | 'working' | 'retrying', step: string) => void
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

    // REQUIREMENT 12: DISABLED SOURCES ENFORCEMENT
    if (DISABLED_SOURCES.has(key)) {
      return {
        success: false,
        error: `Source "${sourceId}" is permanently disabled by system specification.`,
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
      onStatusChange?.('waiting', `Awaiting shared in-flight ${sourceId} query for "${requestKey}"`);
      const result = await this.inFlightRequests.get(fullReqKey);
      return { ...result, isDeduplicated: true };
    }

    // 4. Create and register Singleflight Execution Promise
    const executionPromise = (async () => {
      const limit = this.limits.get(key);
      const maxConcurrent = limit ? limit.currentConcurrent : 2;
      const currentActive = this.activeRequestCounts.get(key) || 0;
      if (currentActive >= maxConcurrent) {
        onStatusChange?.('waiting', `Waiting for ${sourceId} concurrency slot (${currentActive}/${maxConcurrent} busy)`);
      }

      // Acquire Concurrency Semaphore
      const release = await this.acquireSemaphore(key);

      try {
        // Acquire Rate Limit Token
        onStatusChange?.('waiting', `Acquiring ${sourceId} rate-limit token`);
        await this.acquireRateLimitToken(key);

        let attempts = 0;
        const maxAttempts = 2;
        const startTime = Date.now();

        while (attempts < maxAttempts) {
          attempts++;
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

            if (!errorClassification.isTemporary || attempts >= maxAttempts) {
              return res;
            }

            // Exponential backoff + jitter for retry
            const backoffMs = errorClassification.retryAfterMs || Math.min(2500, Math.pow(2, attempts) * 350 + Math.random() * 200);
            onStatusChange?.('retrying', `Retrying ${sourceId} after ${Math.round(backoffMs)}ms backoff (${res.error || 'transient error'})`);
            await new Promise(r => setTimeout(r, backoffMs));
          } catch (err: any) {
            const errorClassification = this.classifyError(err);
            this.recordFailure(key, err.message, undefined, errorClassification.retryAfterMs);

            if (!errorClassification.isTemporary || attempts >= maxAttempts) {
              return { success: false, error: err.message };
            }

            const backoffMs = Math.min(2500, Math.pow(2, attempts) * 350 + Math.random() * 200);
            onStatusChange?.('retrying', `Retrying ${sourceId} after ${Math.round(backoffMs)}ms backoff (${err.message})`);
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
