import fs from 'fs';
import path from 'path';

export interface SourceLimits {
  rateLimitPerMinute: number;
  rateLimitPerSecond: number;
  maxConcurrent: number;
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
  rateLimitEvents: number;
  circuitBreakerState: CircuitState;
  avgLatencyMs: number;
  lastLatencyMs: number;
}

// Default source boundaries based on official documentation/API guidelines
const DEFAULT_SOURCE_LIMITS: Record<string, SourceLimits> = {
  anilist: { rateLimitPerMinute: 90, rateLimitPerSecond: 2, maxConcurrent: 2, timeoutMs: 8000 },
  jikan: { rateLimitPerMinute: 60, rateLimitPerSecond: 3, maxConcurrent: 2, timeoutMs: 8000 },
  anidb: { rateLimitPerMinute: 30, rateLimitPerSecond: 1, maxConcurrent: 1, timeoutMs: 8000 },
  tmdb: { rateLimitPerMinute: 120, rateLimitPerSecond: 4, maxConcurrent: 3, timeoutMs: 8000 },
  tvmaze: { rateLimitPerMinute: 120, rateLimitPerSecond: 4, maxConcurrent: 3, timeoutMs: 8000 },
  thetvdb: { rateLimitPerMinute: 120, rateLimitPerSecond: 4, maxConcurrent: 3, timeoutMs: 8000 }
};

export class SourceGateway {
  private limits: Map<string, SourceLimits> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerStatus> = new Map();

  // Rate Limiting: Token buckets
  private tokenBuckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

  // Concurrency: Active request counters
  private activeRequestCounts: Map<string, number> = new Map();
  private concurrencyWaiters: Map<string, Array<() => void>> = new Map();

  // Deduplication: Singleflight promises
  private inFlightRequests: Map<string, Promise<any>> = new Map();

  // Metrics
  private metrics: Map<string, SourceGatewayMetrics> = new Map();

  constructor() {
    for (const [sourceId, limit] of Object.entries(DEFAULT_SOURCE_LIMITS)) {
      this.registerSource(sourceId, limit);
    }
  }

  public registerSource(sourceId: string, limits: SourceLimits) {
    const key = sourceId.toLowerCase();
    this.limits.set(key, limits);
    this.circuitBreakers.set(key, {
      state: 'CLOSED',
      failureCount: 0,
      openUntil: 0,
      lastError: null,
      lastSuccessAt: null
    });
    this.tokenBuckets.set(key, { tokens: limits.rateLimitPerSecond, lastRefill: Date.now() });
    this.activeRequestCounts.set(key, 0);
    this.concurrencyWaiters.set(key, []);
    this.metrics.set(key, {
      sourceId: key,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      deduplicatedRequests: 0,
      rateLimitEvents: 0,
      circuitBreakerState: 'CLOSED',
      avgLatencyMs: 0,
      lastLatencyMs: 0
    });
  }

  // --- Rate Limiter Token Refill & Acquisition ---
  private async acquireRateLimitToken(sourceId: string): Promise<void> {
    const key = sourceId.toLowerCase();
    const limit = this.limits.get(key) || { rateLimitPerMinute: 60, rateLimitPerSecond: 2, maxConcurrent: 2, timeoutMs: 8000 };
    const bucket = this.tokenBuckets.get(key) || { tokens: limit.rateLimitPerSecond, lastRefill: Date.now() };

    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefill) / 1000;

    if (elapsedSec >= 1) {
      bucket.tokens = Math.min(limit.rateLimitPerSecond, bucket.tokens + elapsedSec * limit.rateLimitPerSecond);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Must wait for next token refill
    const waitMs = Math.ceil((1 - bucket.tokens) * (1000 / limit.rateLimitPerSecond));
    const metric = this.metrics.get(key);
    if (metric) metric.rateLimitEvents++;

    await new Promise(r => setTimeout(r, Math.min(waitMs, 2500)));

    // Recheck after wait
    bucket.tokens = Math.max(0, bucket.tokens - 1);
    bucket.lastRefill = Date.now();
  }

  // --- Concurrency Semaphore Control ---
  private async acquireSemaphore(sourceId: string): Promise<() => void> {
    const key = sourceId.toLowerCase();
    const limit = this.limits.get(key) || { maxConcurrent: 2 } as any;
    const maxConcurrent = limit.maxConcurrent || 2;

    const current = this.activeRequestCounts.get(key) || 0;

    if (current < maxConcurrent) {
      this.activeRequestCounts.set(key, current + 1);
      return () => this.releaseSemaphore(key);
    }

    // Queue up waiter
    return new Promise((resolve) => {
      const waiters = this.concurrencyWaiters.get(key) || [];
      waiters.push(() => {
        this.activeRequestCounts.set(key, (this.activeRequestCounts.get(key) || 0) + 1);
        resolve(() => this.releaseSemaphore(key));
      });
      this.concurrencyWaiters.set(key, waiters);
    });
  }

  private releaseSemaphore(key: string) {
    const current = this.activeRequestCounts.get(key) || 1;
    this.activeRequestCounts.set(key, Math.max(0, current - 1));

    const waiters = this.concurrencyWaiters.get(key) || [];
    if (waiters.length > 0) {
      const next = waiters.shift();
      if (next) next();
    }
  }

  // --- Error Classification ---
  public classifyError(error: any, statusCode?: number): { isTemporary: boolean; isRateLimit: boolean; isPermanent: boolean } {
    if (statusCode === 429) {
      return { isTemporary: true, isRateLimit: true, isPermanent: false };
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
      state: 'CLOSED',
      failureCount: 0,
      openUntil: 0
    };

    if (cb.state === 'OPEN' && Date.now() >= cb.openUntil) {
      cb.state = 'HALF_OPEN';
    }

    return { ...cb };
  }

  public recordSuccess(sourceId: string, latencyMs: number) {
    const key = sourceId.toLowerCase();
    const cb = this.circuitBreakers.get(key);
    if (cb) {
      cb.state = 'CLOSED';
      cb.failureCount = 0;
      cb.openUntil = 0;
      cb.lastSuccessAt = new Date().toISOString();
      cb.lastError = null;
    }

    const m = this.metrics.get(key);
    if (m) {
      m.successfulRequests++;
      m.circuitBreakerState = 'CLOSED';
      m.lastLatencyMs = latencyMs;
      m.avgLatencyMs = m.avgLatencyMs === 0 ? latencyMs : Math.round((m.avgLatencyMs * 0.8) + (latencyMs * 0.2));
    }
  }

  public recordFailure(sourceId: string, errorMsg: string, statusCode?: number) {
    const key = sourceId.toLowerCase();
    const cb = this.circuitBreakers.get(key);
    const { isRateLimit } = this.classifyError({ message: errorMsg }, statusCode);

    if (cb) {
      cb.failureCount++;
      cb.lastError = errorMsg;

      if (isRateLimit || cb.failureCount >= 3) {
        cb.state = 'OPEN';
        const cooldownMs = isRateLimit ? 25000 : 15000;
        cb.openUntil = Date.now() + cooldownMs;
        console.warn(`[CircuitBreaker] Circuit OPENED for source "${key}" for ${cooldownMs}ms. Cause: ${errorMsg}`);
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
    fetchFn: () => Promise<{ success: boolean; data?: T; matches?: T[]; error?: string; statusCode?: number }>
  ): Promise<{ success: boolean; data?: T; matches?: T[]; error?: string; statusCode?: number; isCircuitOpen?: boolean; isDeduplicated?: boolean }> {
    const key = sourceId.toLowerCase();
    const metric = this.metrics.get(key);
    if (metric) metric.totalRequests++;

    // 1. Check Circuit Breaker
    const cb = this.getCircuitStatus(key);
    if (cb.state === 'OPEN') {
      return {
        success: false,
        error: `Source "${sourceId}" is temporarily cooling down (${Math.ceil((cb.openUntil - Date.now()) / 1000)}s remaining)`,
        isCircuitOpen: true
      };
    }

    // 2. Singleflight Deduplication
    const fullReqKey = `${key}:${requestKey}`;
    if (this.inFlightRequests.has(fullReqKey)) {
      if (metric) metric.deduplicatedRequests++;
      const result = await this.inFlightRequests.get(fullReqKey);
      return { ...result, isDeduplicated: true };
    }

    // Create execution promise
    const executionPromise = (async () => {
      // 3. Acquire Concurrency Semaphore
      const release = await this.acquireSemaphore(key);

      try {
        // 4. Acquire Rate Limit Token
        await this.acquireRateLimitToken(key);

        // 5. Execute with Exponential Backoff + Jitter
        let attempts = 0;
        const maxAttempts = 2;
        const startTime = Date.now();

        while (attempts < maxAttempts) {
          attempts++;
          try {
            const res = await fetchFn();
            const latencyMs = Date.now() - startTime;

            if (res.success) {
              this.recordSuccess(key, latencyMs);
              return res;
            }

            const errorClassification = this.classifyError({ message: res.error }, res.statusCode);
            this.recordFailure(key, res.error || 'Request failed', res.statusCode);

            if (!errorClassification.isTemporary || attempts >= maxAttempts) {
              return res;
            }

            // Exponential backoff + jitter
            const backoffMs = Math.min(2000, Math.pow(2, attempts) * 300 + Math.random() * 200);
            await new Promise(r => setTimeout(r, backoffMs));
          } catch (err: any) {
            const latencyMs = Date.now() - startTime;
            const errorClassification = this.classifyError(err);
            this.recordFailure(key, err.message);

            if (!errorClassification.isTemporary || attempts >= maxAttempts) {
              return { success: false, error: err.message };
            }

            const backoffMs = Math.min(2000, Math.pow(2, attempts) * 300 + Math.random() * 200);
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
      res[key] = {
        ...metric,
        circuitBreakerState: cb.state
      };
    }
    return res;
  }
}

export const globalSourceGateway = new SourceGateway();
