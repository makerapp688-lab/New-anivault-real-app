import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Clock,
  Layers,
  X,
  Search,
  Loader2,
  Lock
} from 'lucide-react';

function getOwnerHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('anivault_owner_session_token') || '';
    return token
      ? {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Owner-Session': token,
          'x-anivault-owner-session': token
        }
      : { 'Content-Type': 'application/json' };
  } catch {
    return { 'Content-Type': 'application/json' };
  }
}

function toSafeNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toSafeText(val: unknown, fallback = 'Not available'): string {
  if (typeof val === 'string' && val.trim().length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return fallback;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms < 0 || !Number.isFinite(ms)) return 'Not available';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${mins}m ${remSec}s`;
}

type WorkerFilter = 'all' | 'busy' | 'artwork' | 'information' | 'idle' | 'unhealthy';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class OwnerWorkersErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected rendering error in Workers view.'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[OwnerWorkersSection] Render boundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          id="owner-workers-error-boundary"
          className="p-6 rounded-2xl bg-slate-900 border border-rose-500/50 text-slate-200 space-y-3"
        >
          <div className="flex items-center gap-2 text-rose-400 font-black text-sm uppercase">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>Workers View Rendering Error</span>
          </div>
          <p className="text-xs text-slate-300">{this.state.errorMessage}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            Retry Rendering Workers View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const OwnerWorkersSectionInner: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [workerFilter, setWorkerFilter] = useState<WorkerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [banner, setBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const fetchWorkersStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/owner/workers/status', {
        headers: getOwnerHeaders(),
        credentials: 'include'
      });

      if (res.status === 401 || res.status === 403) {
        let errText = 'Unauthorized: Owner authentication session is required to inspect worker telemetry.';
        try {
          const errJson = await res.json();
          if (typeof errJson?.error === 'string') errText = errJson.error;
        } catch {}
        setAuthError(errText);
        setFetchError(null);
        return;
      }

      if (!res.ok) {
        let errText = `Failed to load worker telemetry (HTTP ${res.status}).`;
        try {
          const errJson = await res.json();
          if (typeof errJson?.error === 'string') errText = errJson.error;
        } catch {}
        setFetchError(errText);
        return;
      }

      const json = await res.json();
      if (!json || typeof json !== 'object') {
        setFetchError('Malformed response received from /api/owner/workers/status.');
        return;
      }

      setData(json);
      setAuthError(null);
      setFetchError(null);
    } catch (err: any) {
      console.error('[OwnerWorkersSection] Failed to load worker status:', err);
      setFetchError(err?.message || 'Network error while connecting to worker telemetry endpoint.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkersStatus(false);
    const interval = setInterval(() => {
      fetchWorkersStatus(true);
    }, 1500);
    return () => clearInterval(interval);
  }, [fetchWorkersStatus]);

  const handleControlAction = async (
    action: 'pause' | 'resume' | 'stop' | 'reset' | 'retry_failed',
    jobSystem?: 'ARTWORK_VERIFICATION' | 'INFORMATION_VERIFICATION'
  ) => {
    const key = `${action}_${jobSystem || 'all'}`;
    setActionBusy(key);
    setBanner(null);
    try {
      const res = await fetch('/api/owner/workers/control', {
        method: 'POST',
        headers: getOwnerHeaders(),
        credentials: 'include',
        body: JSON.stringify({ action, jobSystem })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setBanner({ type: 'success', message: toSafeText(json?.message, `Executed ${action}.`) });
        await fetchWorkersStatus(true);
      } else {
        setBanner({ type: 'error', message: toSafeText(json?.error, 'Worker control action failed.') });
      }
    } catch (err: any) {
      setBanner({ type: 'error', message: err?.message || 'Network error while sending worker command.' });
    } finally {
      setActionBusy(null);
    }
  };

  const shared = data?.sharedSnapshot && typeof data.sharedSnapshot === 'object' ? data.sharedSnapshot : null;
  const artworkSnap = data?.artworkSnapshot && typeof data.artworkSnapshot === 'object' ? data.artworkSnapshot : null;
  const infoSnap = data?.infoSnapshot && typeof data.infoSnapshot === 'object' ? data.infoSnapshot : null;
  const artworkStats = data?.artworkStats && typeof data.artworkStats === 'object' ? data.artworkStats : null;
  const infoStats = data?.infoStats && typeof data.infoStats === 'object' ? data.infoStats : null;
  const healthMetrics = data?.healthMetrics && typeof data.healthMetrics === 'object' ? data.healthMetrics : null;

  const rawWorkers: any[] = Array.isArray(shared?.workers)
    ? shared.workers
    : Array.isArray(shared?.activeWorkers)
      ? shared.activeWorkers
      : [];

  const workers = rawWorkers.filter(w => w && typeof w === 'object' && w.workerId !== undefined);

  // Authoritative numeric metrics from globalWorkerJobEngine.getSnapshot()
  const totalWorkersNum =
    toSafeNumber(shared?.workerCount) ??
    toSafeNumber(shared?.poolConfig?.currentWorkers) ??
    (workers.length > 0 ? workers.length : null);

  const activeWorkersNum =
    workers.length > 0
      ? workers.filter(w => w.status !== 'stopped' && w.status !== 'paused').length
      : typeof shared?.activeWorkers === 'number'
        ? shared.activeWorkers
        : totalWorkersNum;

  const busyWorkersNum =
    toSafeNumber(shared?.busyWorkers) ??
    (workers.length > 0
      ? workers.filter(w => w.status === 'working' || w.status === 'busy' || w.status === 'claiming').length
      : null);

  const idleWorkersNum =
    toSafeNumber(shared?.idleWorkers) ??
    (workers.length > 0 ? workers.filter(w => w.status === 'idle').length : null);

  const unhealthyWorkersNum =
    toSafeNumber(shared?.unhealthyWorkers) ??
    (workers.length > 0
      ? workers.filter(
          w => w.status === 'error' || w.status === 'stalled' || w.health === 'error' || w.health === 'stale'
        ).length
      : null);

  const queueSizeNum = toSafeNumber(shared?.queuedCount);
  const completedJobsNum = toSafeNumber(shared?.completedCount);
  const failedJobsNum = toSafeNumber(shared?.failedCount);
  const retriedJobsNum = toSafeNumber(shared?.retryingCount);
  const archCapacityNum =
    toSafeNumber(shared?.architectureCapacity) ??
    toSafeNumber(shared?.poolConfig?.maxWorkers) ??
    toSafeNumber(shared?.maxArchitectureCapacity);

  const artworkBusyNum =
    toSafeNumber(shared?.busyArtworkWorkers) ??
    toSafeNumber(shared?.artworkBusyWorkers) ??
    (workers.length > 0
      ? workers.filter(
          w =>
            (w.status === 'working' || w.status === 'busy' || w.status === 'claiming') &&
            w.jobSystem === 'ARTWORK_VERIFICATION'
        ).length
      : 0);

  const infoBusyNum =
    toSafeNumber(shared?.busyInfoWorkers) ??
    toSafeNumber(shared?.infoBusyWorkers) ??
    (workers.length > 0
      ? workers.filter(
          w =>
            (w.status === 'working' || w.status === 'busy' || w.status === 'claiming') &&
            w.jobSystem === 'INFORMATION_VERIFICATION'
        ).length
      : 0);

  const throughputNum = toSafeNumber(shared?.tasksPerMinute) ?? toSafeNumber(shared?.throughputPerMin) ?? 0;
  const avgTaskDurationNum = toSafeNumber(shared?.avgTaskDurationMs);
  const activeAnimeLeasesNum = Array.isArray(shared?.activeAnimeLocks)
    ? shared.activeAnimeLocks.length
    : toSafeNumber(shared?.activeAnimeLeasesCount) ?? 0;

  const awaitingReviewNum =
    toSafeNumber(data?.awaitingReviewTotal) ??
    (artworkStats || infoStats
      ? (toSafeNumber(artworkStats?.needsReview) ?? 0) + (toSafeNumber(infoStats?.needsReview) ?? 0)
      : null);

  const poolStatus = toSafeText(shared?.status, 'idle');
  const isAllIdle =
    shared !== null &&
    (busyWorkersNum === 0 || busyWorkersNum === null) &&
    (queueSizeNum === 0 || queueSizeNum === null) &&
    poolStatus !== 'running';

  const filteredWorkers = workers.filter(w => {
    const isBusy = w.status === 'working' || w.status === 'busy' || w.status === 'claiming';
    const isUnhealthy =
      w.status === 'error' || w.status === 'stalled' || w.health === 'error' || w.health === 'stale';
    if (workerFilter === 'busy' && !isBusy) return false;
    if (workerFilter === 'idle' && w.status !== 'idle') return false;
    if (workerFilter === 'artwork' && w.jobSystem !== 'ARTWORK_VERIFICATION') return false;
    if (workerFilter === 'information' && w.jobSystem !== 'INFORMATION_VERIFICATION') return false;
    if (workerFilter === 'unhealthy' && !isUnhealthy && !((w.retryCount || 0) > 0)) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const idStr = `worker #${String(w.workerId).padStart(2, '0')} ${w.workerId}`;
      const titleStr = String(w.currentAnimeTitle || w.currentTaskId || '').toLowerCase();
      const sysStr = String(w.jobSystem || '').toLowerCase();
      const opStr = String(w.operation || w.currentStep || '').toLowerCase();
      const statusStr = String(w.status || '').toLowerCase();
      return (
        idStr.includes(q) ||
        titleStr.includes(q) ||
        sysStr.includes(q) ||
        opStr.includes(q) ||
        statusStr.includes(q)
      );
    }
    return true;
  });

  const nowMs = Date.now();

  return (
    <div className="space-y-5 animate-fade-in" id="owner-workers-section">
      {/* Authentication Failure State */}
      {authError && (
        <div
          id="owner-workers-auth-error"
          className="p-5 rounded-2xl bg-rose-950/60 border border-rose-500/50 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-black uppercase tracking-wider text-white">
                Owner Authentication Required
              </div>
              <p className="text-xs text-rose-200/90">{authError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchWorkersStatus(false)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white shrink-0 cursor-pointer"
          >
            Retry Session Check
          </button>
        </div>
      )}

      {/* API Error State */}
      {fetchError && !authError && (
        <div
          id="owner-workers-api-error"
          className="p-5 rounded-2xl bg-rose-950/50 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-black uppercase tracking-wider text-white">
                Worker Telemetry Request Failed
              </div>
              <p className="text-xs text-rose-200/90">{fetchError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchWorkersStatus(false)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Now</span>
          </button>
        </div>
      )}

      {/* Initial Loading State (when no snapshot data has been loaded yet) */}
      {loading && !data && !authError && !fetchError && (
        <div
          id="owner-workers-loading"
          className="p-8 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col items-center justify-center text-center space-y-3"
        >
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <div className="text-xs font-bold text-white uppercase tracking-wider">
            Loading Shared Worker Infrastructure...
          </div>
          <p className="text-[11px] text-slate-400">
            Fetching real-time worker pool state, queues, and job telemetry from the server.
          </p>
        </div>
      )}

      {/* Header & Shared Pool Controls */}
      <div className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wide">
                Shared Worker Infrastructure
              </h3>
              <span className="text-[10px] font-mono text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                POOL STATUS: {poolStatus.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Central administration and real-time telemetry for the unified worker pool powering both{' '}
              <span className="text-amber-300 font-semibold">Artwork Verification (ARTWORK_VERIFICATION)</span> and{' '}
              <span className="text-sky-300 font-semibold">Information Manager (INFORMATION_VERIFICATION)</span> jobs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {poolStatus === 'running' && (
              <button
                type="button"
                onClick={() => handleControlAction('pause')}
                disabled={Boolean(actionBusy)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-950 text-amber-300 border border-amber-600/50 flex items-center gap-1.5 cursor-pointer"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause Pool</span>
              </button>
            )}

            {poolStatus === 'paused' && (
              <button
                type="button"
                onClick={() => handleControlAction('resume')}
                disabled={Boolean(actionBusy)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/50 flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume Pool</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleControlAction('retry_failed')}
              disabled={Boolean(actionBusy)}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Failed Jobs</span>
            </button>

            {(poolStatus === 'running' || poolStatus === 'paused') && (
              <button
                type="button"
                onClick={() => handleControlAction('stop')}
                disabled={Boolean(actionBusy)}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-950 text-rose-300 border border-rose-700/60 flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Stop All</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleControlAction('reset')}
              disabled={Boolean(actionBusy)}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-1.5 cursor-pointer"
              title="Reset completed/idle queue counters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Queue</span>
            </button>

            <button
              type="button"
              onClick={() => fetchWorkersStatus(false)}
              className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-amber-300 border border-slate-800 cursor-pointer"
              title="Refresh Worker Telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 1. WORKER POOL OVERVIEW GRID (Real Backend Values Only) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-11 gap-2" id="owner-workers-overview-grid">
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] font-bold uppercase text-slate-400">Total Workers</div>
            <div className="text-base font-black text-white mt-0.5">
              {totalWorkersNum !== null ? totalWorkersNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-500/30">
            <div className="text-[10px] font-bold uppercase text-amber-400">Active Workers</div>
            <div className="text-base font-black text-amber-300 mt-0.5">
              {activeWorkersNum !== null ? activeWorkersNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30">
            <div className="text-[10px] font-bold uppercase text-emerald-400">Busy Workers</div>
            <div className="text-base font-black text-emerald-300 mt-0.5">
              {busyWorkersNum !== null ? busyWorkersNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] font-bold uppercase text-slate-400">Idle Workers</div>
            <div className="text-base font-black text-slate-200 mt-0.5">
              {idleWorkersNum !== null ? idleWorkersNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-rose-500/30">
            <div className="text-[10px] font-bold uppercase text-rose-400">Unhealthy / Stalled</div>
            <div className="text-base font-black text-rose-300 mt-0.5">
              {unhealthyWorkersNum !== null ? unhealthyWorkersNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-500/30">
            <div className="text-[10px] font-bold uppercase text-amber-400">Queue Size</div>
            <div className="text-base font-black text-amber-300 mt-0.5">
              {queueSizeNum !== null ? queueSizeNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30">
            <div className="text-[10px] font-bold uppercase text-emerald-400">Completed Jobs</div>
            <div className="text-base font-black text-emerald-300 mt-0.5">
              {completedJobsNum !== null ? completedJobsNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-rose-500/30">
            <div className="text-[10px] font-bold uppercase text-rose-400">Failed Jobs</div>
            <div className="text-base font-black text-rose-300 mt-0.5">
              {failedJobsNum !== null ? failedJobsNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-orange-500/30">
            <div className="text-[10px] font-bold uppercase text-orange-400">Retried Jobs</div>
            <div className="text-base font-black text-orange-300 mt-0.5">
              {retriedJobsNum !== null ? retriedJobsNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-purple-500/30">
            <div className="text-[10px] font-bold uppercase text-purple-400">Awaiting Review</div>
            <div className="text-base font-black text-purple-300 mt-0.5">
              {awaitingReviewNum !== null ? awaitingReviewNum : 'Not available'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-sky-500/30">
            <div className="text-[10px] font-bold uppercase text-sky-400">Max Capacity</div>
            <div className="text-base font-black text-sky-300 mt-0.5">
              {archCapacityNum !== null ? archCapacityNum : 'Not available'}
            </div>
          </div>
        </div>

        {/* Idle State Status Banner (when 0 busy workers and 0 queued jobs) */}
        {isAllIdle && (
          <div
            id="owner-workers-idle-banner"
            className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-white">Workers are currently idle.</span>{' '}
                <span className="text-slate-400">
                  All {totalWorkersNum ?? 50} worker threads in the shared pool are standing by for Artwork Verification or Information Manager jobs.
                </span>
              </div>
            </div>
            <span className="text-[11px] font-mono text-slate-400 shrink-0">
              Last Log: {toSafeText(shared?.lastLog, 'Standing by')}
            </span>
          </div>
        )}

        {/* Unhealthy / Stalled Worker Alert Banner */}
        {unhealthyWorkersNum !== null && unhealthyWorkersNum > 0 && (
          <div
            id="owner-workers-unhealthy-banner"
            className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-center justify-between gap-3 text-xs text-rose-200"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                <strong>{unhealthyWorkersNum}</strong> worker(s) currently report an unhealthy, error, or stalled state. Watchdog recovery is active.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setWorkerFilter('unhealthy')}
              className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-bold cursor-pointer shrink-0"
            >
              Inspect Unhealthy Workers
            </button>
          </div>
        )}

        {/* Subsystem Breakdown Bar (Artwork Verification vs Information Manager) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <div className="font-black text-amber-300 uppercase">
                Artwork Verification (ARTWORK_VERIFICATION)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Queue: <span className="text-white font-mono">{toSafeNumber(artworkSnap?.queuedCount) ?? 'Not available'}</span> ·{' '}
                In Progress: <span className="text-emerald-300 font-mono">{toSafeNumber(artworkSnap?.claimedCount) ?? 'Not available'}</span> ·{' '}
                Completed: <span className="text-emerald-400 font-mono">{toSafeNumber(artworkSnap?.completedCount) ?? 'Not available'}</span> ·{' '}
                Failed: <span className="text-rose-300 font-mono">{toSafeNumber(artworkSnap?.failedCount) ?? 'Not available'}</span> ·{' '}
                Review: <span className="text-amber-300 font-mono">{toSafeNumber(artworkStats?.needsReview) ?? 'Not available'}</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-amber-300 shrink-0">
              {artworkBusyNum} busy
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <div className="font-black text-sky-300 uppercase">
                Information Manager (INFORMATION_VERIFICATION)
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Queue: <span className="text-white font-mono">{toSafeNumber(infoSnap?.queuedCount) ?? 'Not available'}</span> ·{' '}
                In Progress: <span className="text-emerald-300 font-mono">{toSafeNumber(infoSnap?.claimedCount) ?? 'Not available'}</span> ·{' '}
                Completed: <span className="text-emerald-400 font-mono">{toSafeNumber(infoSnap?.completedCount) ?? 'Not available'}</span> ·{' '}
                Failed: <span className="text-rose-300 font-mono">{toSafeNumber(infoSnap?.failedCount) ?? 'Not available'}</span> ·{' '}
                Review: <span className="text-amber-300 font-mono">{toSafeNumber(infoStats?.needsReview) ?? 'Not available'}</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-sky-300 shrink-0">
              {infoBusyNum} busy
            </span>
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{banner.message}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. WORKER HEALTH & SAFEGUARDS */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-black uppercase tracking-wider text-white">
              Worker Health, Concurrency Locks &amp; Recovery Safeguards
            </h4>
          </div>
          <span className="text-[11px] font-mono text-emerald-400">
            Throughput: {throughputNum} jobs/min · Avg Processing Time:{' '}
            {avgTaskDurationNum && avgTaskDurationNum > 0 ? `${avgTaskDurationNum} ms` : 'Not available'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <div className="font-bold text-emerald-300">Heartbeat &amp; Stalled Detection</div>
            <div className="text-[11px] text-slate-400">
              Heartbeat every {((toSafeNumber(healthMetrics?.heartbeatIntervalMs) ?? 2500) / 1000).toFixed(1)}s · Stalled-worker detection &amp; auto-requeue active
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <div className="font-bold text-sky-300">Job Timeout &amp; Lease Locking</div>
            <div className="text-[11px] text-slate-400">
              {Math.round((toSafeNumber(healthMetrics?.leaseDurationMs) ?? 30000) / 1000)}s atomic task lease · Active Anime Leases:{' '}
              {activeAnimeLeasesNum}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <div className="font-bold text-amber-300">Retry &amp; Rate-Limit Backoff</div>
            <div className="text-[11px] text-slate-400">
              {toSafeText(healthMetrics?.backoffStrategy, 'Exponential Backoff with Jitter')}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <div className="font-bold text-purple-300">Duplicate Protection &amp; Persistence</div>
            <div className="text-[11px] text-slate-400">
              {toSafeText(
                healthMetrics?.duplicateJobProtection,
                'Deterministic Task IDs + Per-Anime / Per-Season Atomic Leases'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. INDIVIDUAL WORKERS (Worker #01 .. Worker #50) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `All Workers (${workers.length})` },
              { id: 'busy', label: `Busy (${busyWorkersNum ?? 0})` },
              { id: 'artwork', label: `Artwork Verification (${artworkBusyNum})` },
              { id: 'information', label: `Information Manager (${infoBusyNum})` },
              { id: 'idle', label: `Idle (${idleWorkersNum ?? 0})` },
              { id: 'unhealthy', label: `Unhealthy / Retrying (${unhealthyWorkersNum ?? 0})` }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setWorkerFilter(tab.id as WorkerFilter)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  workerFilter === tab.id
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter worker ID, anime, job type..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Empty State if no workers match filter or no workers reported */}
        {filteredWorkers.length === 0 ? (
          <div
            id="owner-workers-empty-state"
            className="p-8 rounded-2xl bg-slate-950 border border-slate-800 text-center space-y-2.5"
          >
            <Clock className="w-7 h-7 text-amber-400 mx-auto opacity-80" />
            <div className="text-sm font-black text-white">
              {workers.length === 0
                ? 'Workers are currently idle.'
                : workerFilter === 'busy' || workerFilter === 'artwork' || workerFilter === 'information'
                  ? 'Workers are currently idle.'
                  : workerFilter === 'unhealthy'
                    ? 'No unhealthy or stalled workers detected.'
                    : 'No workers match your current search filter.'}
            </div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {workers.length === 0
                ? 'No active worker threads were returned in the current snapshot.'
                : workerFilter !== 'all' || searchQuery.trim()
                  ? `0 of ${workers.length} shared workers match the "${workerFilter}" filter${searchQuery.trim() ? ` and query "${searchQuery.trim()}"` : ''}. Switch to "All Workers (${workers.length})" to inspect all idle worker threads.`
                  : 'Workers are standing by for the next Artwork Verification or Information Manager task.'}
            </p>
            {(workerFilter !== 'all' || searchQuery.trim()) && workers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setWorkerFilter('all');
                  setSearchQuery('');
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
              >
                Show All {workers.length} Workers
              </button>
            )}
          </div>
        ) : (
          <div
            id="owner-workers-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[58vh] overflow-y-auto pr-1"
          >
            {filteredWorkers.map((w: any) => {
              const workerIdNum = toSafeNumber(w.workerId) ?? 0;
              const statusStr = toSafeText(w.status, 'idle');
              const healthStr = toSafeText(w.health, 'healthy');
              const isWorking = statusStr === 'working' || statusStr === 'busy' || statusStr === 'claiming';
              const isError =
                statusStr === 'error' ||
                statusStr === 'stalled' ||
                healthStr === 'error' ||
                healthStr === 'stale';

              const startedAtMs = toSafeNumber(w.taskStartedAt);
              const elapsedMs = startedAtMs ? Math.max(0, nowMs - startedAtMs) : null;
              const lastHbMs = toSafeNumber(w.lastHeartbeat);
              const heartbeatAgeSec = lastHbMs ? Math.max(0, Math.round((nowMs - lastHbMs) / 1000)) : null;

              const rawJobSystem = toSafeText(w.jobSystem, '');
              const operationText = toSafeText(w.operation, '');
              const jobTypeDisplay =
                rawJobSystem === 'INFORMATION_VERIFICATION'
                  ? operationText !== 'Not available'
                    ? `Information Manager · ${operationText}`
                    : 'Information Manager (INFORMATION_VERIFICATION)'
                  : rawJobSystem === 'ARTWORK_VERIFICATION'
                    ? operationText !== 'Not available'
                      ? `Artwork Verification · ${operationText}`
                      : 'Artwork Verification (ARTWORK_VERIFICATION)'
                    : 'Shared Pool (Standby — Artwork & Information)';

              const currentJobDisplay =
                typeof w.currentAnimeTitle === 'string' && w.currentAnimeTitle.trim()
                  ? w.currentAnimeTitle
                  : typeof w.currentTaskId === 'string' && w.currentTaskId.trim()
                    ? w.currentTaskId
                    : 'None (Idle)';

              const startTimeDisplay = startedAtMs
                ? new Date(startedAtMs).toLocaleTimeString()
                : 'Not available (Idle)';

              const processingTimeDisplay =
                isWorking && elapsedMs !== null ? formatDurationMs(elapsedMs) : 'Not available (Idle)';

              const heartbeatDisplay =
                heartbeatAgeSec !== null && lastHbMs
                  ? `${heartbeatAgeSec}s ago (${new Date(lastHbMs).toLocaleTimeString()})`
                  : 'Not available';

              const errorDisplay =
                typeof w.lastError === 'string' && w.lastError.trim().length > 0 ? w.lastError : 'None';

              return (
                <div
                  key={workerIdNum || String(w.workerId)}
                  className={`p-3.5 rounded-xl border text-xs space-y-2 transition-all ${
                    isWorking
                      ? rawJobSystem === 'INFORMATION_VERIFICATION'
                        ? 'bg-sky-950/30 border-sky-500/50'
                        : 'bg-amber-950/25 border-amber-500/50'
                      : isError
                        ? 'bg-rose-950/30 border-rose-500/50'
                        : 'bg-slate-950 border-slate-800/90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-black text-white text-sm">
                      Worker #{String(workerIdNum).padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span
                        className={`px-1.5 py-0.5 rounded font-black uppercase ${
                          isWorking
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : isError
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              : 'bg-slate-900 text-slate-300 border border-slate-800'
                        }`}
                      >
                        {statusStr}
                      </span>
                      {healthStr === 'stale' && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase">
                          STALLED
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-[11px]">
                    <div className="text-slate-200 font-semibold truncate">
                      Current Job:{' '}
                      <span className="font-normal text-slate-300">{currentJobDisplay}</span>
                    </div>
                    <div className="text-slate-400 truncate">
                      Job Type:{' '}
                      <span
                        className={
                          rawJobSystem === 'INFORMATION_VERIFICATION'
                            ? 'text-sky-300 font-semibold'
                            : rawJobSystem === 'ARTWORK_VERIFICATION'
                              ? 'text-amber-300 font-semibold'
                              : 'text-slate-300'
                        }
                      >
                        {jobTypeDisplay}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                    <div className="truncate">
                      Start Time: <span className="text-slate-200">{startTimeDisplay}</span>
                    </div>
                    <div className="truncate">
                      Processing Time: <span className="text-slate-200">{processingTimeDisplay}</span>
                    </div>
                    <div className="col-span-2 truncate">
                      Last Heartbeat: <span className="text-emerald-400">{heartbeatDisplay}</span>
                    </div>
                    <div>
                      Completed: <span className="text-emerald-300">{toSafeNumber(w.tasksCompleted) ?? 0}</span> · Failed:{' '}
                      <span className="text-rose-300">{toSafeNumber(w.tasksFailed) ?? 0}</span> · Retried:{' '}
                      <span className="text-amber-300">{toSafeNumber(w.retryCount) ?? 0}</span>
                    </div>
                    <div className="truncate">
                      Current Error:{' '}
                      <span className={errorDisplay !== 'None' ? 'text-rose-300 font-bold' : 'text-slate-400'}>
                        {errorDisplay}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const OwnerWorkersSection: React.FC = () => (
  <OwnerWorkersErrorBoundary>
    <OwnerWorkersSectionInner />
  </OwnerWorkersErrorBoundary>
);
