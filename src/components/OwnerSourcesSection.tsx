import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Ban,
  RefreshCw,
  Play,
  RotateCcw,
  Loader2,
  Clock,
  Activity,
  ShieldCheck
} from 'lucide-react';

export interface ConfiguredSourceItem {
  id: string;
  name: string;
  group: 'artwork' | 'watch_order';
  purpose: string;
  priority: number;
  enabled: boolean;
  canToggle: boolean;
  toggleReason: string | null;
  rawStatus: string;
  status: 'Operational' | 'Failed' | 'Disabled';
  lastTested: string | null;
  responseTimeMs: number | null;
  lastMessage: string | null;
  lastError: string | null;
  description: string;
}

export interface SourcesSummary {
  passed: number;
  failed: number;
  disabled: number;
  totalTested: number;
  totalConfigured: number;
}

export const OwnerSourcesSection: React.FC = () => {
  const [sources, setSources] = useState<ConfiguredSourceItem[]>([]);
  const [summary, setSummary] = useState<SourcesSummary>({
    passed: 0,
    failed: 0,
    disabled: 0,
    totalTested: 0,
    totalConfigured: 0
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [testingAll, setTestingAll] = useState<boolean>(false);
  const [retryingFailed, setRetryingFailed] = useState<boolean>(false);
  const [testingSourceId, setTestingSourceId] = useState<string | null>(null);
  const [togglingSourceId, setTogglingSourceId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const getOwnerHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('anivault_owner_session_token') || '';
    return {
      'Content-Type': 'application/json',
      'X-Owner-Session': token,
      'x-anivault-owner-session': token,
      Authorization: `Bearer ${token}`
    };
  };

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/owner/sources-registry', {
        headers: getOwnerHeaders(),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSources(Array.isArray(data.sources) ? data.sources : []);
        if (data.summary) setSummary(data.summary);
      } else {
        setBannerMsg({
          type: 'error',
          text: data?.error || 'Failed to load Artwork & Metadata Sources.'
        });
      }
    } catch (err: any) {
      setBannerMsg({
        type: 'error',
        text: err?.message || 'Network error while loading sources.'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleTestSingle = async (sourceId: string, sourceName: string) => {
    if (testingSourceId || testingAll || retryingFailed) return;
    setTestingSourceId(sourceId);
    setBannerMsg(null);
    try {
      const res = await fetch(`/api/owner/sources-registry/${encodeURIComponent(sourceId)}/test`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSources(Array.isArray(data.sources) ? data.sources : []);
        if (data.summary) setSummary(data.summary);
        const tr = data.testResult;
        setBannerMsg({
          type: tr?.status === 'operational' || tr?.status === 'disabled' ? 'success' : 'error',
          text: `${sourceName}: ${tr?.message || 'Test completed.'}`
        });
      } else {
        setBannerMsg({
          type: 'error',
          text: data?.error || `Failed to test ${sourceName}.`
        });
      }
    } catch (err: any) {
      setBannerMsg({
        type: 'error',
        text: err?.message || `Failed to test ${sourceName}.`
      });
    } finally {
      setTestingSourceId(null);
    }
  };

  const handleTestAll = async () => {
    if (testingAll || retryingFailed || testingSourceId) return;
    setTestingAll(true);
    setBannerMsg(null);
    try {
      const res = await fetch('/api/owner/sources-registry/test-all', {
        method: 'POST',
        headers: getOwnerHeaders(),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSources(Array.isArray(data.sources) ? data.sources : []);
        if (data.summary) setSummary(data.summary);
        const s: SourcesSummary = data.summary || summary;
        setBannerMsg({
          type: s.failed === 0 ? 'success' : 'error',
          text: `All sources tested — Passed: ${s.passed} | Failed: ${s.failed} | Disabled: ${s.disabled} | Total tested: ${s.totalTested}`
        });
      } else {
        setBannerMsg({
          type: 'error',
          text: data?.error || 'Failed to test all sources.'
        });
      }
    } catch (err: any) {
      setBannerMsg({
        type: 'error',
        text: err?.message || 'Failed to test all sources.'
      });
    } finally {
      setTestingAll(false);
    }
  };

  const handleRetryFailed = async () => {
    if (testingAll || retryingFailed || testingSourceId) return;
    setRetryingFailed(true);
    setBannerMsg(null);
    try {
      const res = await fetch('/api/owner/sources-registry/retry-failed', {
        method: 'POST',
        headers: getOwnerHeaders(),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSources(Array.isArray(data.sources) ? data.sources : []);
        if (data.summary) setSummary(data.summary);
        const s: SourcesSummary = data.summary || summary;
        setBannerMsg({
          type: s.failed === 0 ? 'success' : 'error',
          text:
            data.retriedCount === 0
              ? 'No failed enabled sources to retry.'
              : `Retried ${data.retriedCount} failed source(s) — Passed: ${s.passed} | Failed: ${s.failed} | Disabled: ${s.disabled} | Total tested: ${s.totalTested}`
        });
      } else {
        setBannerMsg({
          type: 'error',
          text: data?.error || 'Failed to retry failed sources.'
        });
      }
    } catch (err: any) {
      setBannerMsg({
        type: 'error',
        text: err?.message || 'Failed to retry failed sources.'
      });
    } finally {
      setRetryingFailed(false);
    }
  };

  const handleToggleSource = async (source: ConfiguredSourceItem) => {
    if (!source.canToggle || togglingSourceId || testingAll || retryingFailed) return;
    setTogglingSourceId(source.id);
    setBannerMsg(null);
    try {
      const nextEnabled = !source.enabled;
      const res = await fetch(`/api/owner/sources-registry/${encodeURIComponent(source.id)}/toggle`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        credentials: 'include',
        body: JSON.stringify({ enabled: nextEnabled })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSources(Array.isArray(data.sources) ? data.sources : []);
        if (data.summary) setSummary(data.summary);
        setBannerMsg({
          type: 'success',
          text: `${source.name} is now ${nextEnabled ? 'Enabled (Operational)' : 'Disabled'}.`
        });
      } else {
        setBannerMsg({
          type: 'error',
          text: data?.error || `Failed to update ${source.name}.`
        });
      }
    } catch (err: any) {
      setBannerMsg({
        type: 'error',
        text: err?.message || `Failed to update ${source.name}.`
      });
    } finally {
      setTogglingSourceId(null);
    }
  };

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return 'Not tested yet';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return 'Not tested yet';
      return d.toLocaleString();
    } catch {
      return 'Not tested yet';
    }
  };

  return (
    <div className="space-y-5" id="owner-artwork-metadata-sources-section">
      {/* Header & Global Action Bar */}
      <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
            <h3 className="text-base sm:text-lg font-black text-white tracking-tight uppercase">
              Artwork &amp; Metadata Sources
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Live connectivity, priority order, and status diagnostics for all configured Zenime artwork, metadata, and verification sources.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            id="btn-test-all-sources"
            onClick={handleTestAll}
            disabled={testingAll || retryingFailed || loading}
            className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            {testingAll ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Testing All...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Test All Sources</span>
              </>
            )}
          </button>

          <button
            type="button"
            id="btn-retry-failed-sources"
            onClick={handleRetryFailed}
            disabled={testingAll || retryingFailed || loading || summary.failed === 0}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-700/70 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {retryingFailed ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Retrying Failed...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Failed Sources ({summary.failed})</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={fetchSources}
            disabled={loading || testingAll || retryingFailed}
            className="p-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh Sources Status"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Clear Final Result Summary Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" id="sources-test-summary-grid">
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Passed</div>
            <div className="text-2xl font-black text-white mt-0.5" id="sources-summary-passed">
              {summary.passed}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-rose-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-400">Failed</div>
            <div className="text-2xl font-black text-white mt-0.5" id="sources-summary-failed">
              {summary.failed}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-700/70 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Disabled</div>
            <div className="text-2xl font-black text-white mt-0.5" id="sources-summary-disabled">
              {summary.disabled}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700">
            <Ban className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Total Tested</div>
            <div className="text-2xl font-black text-white mt-0.5" id="sources-summary-total-tested">
              {summary.totalTested}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Activity className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            bannerMsg.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
              : 'bg-rose-950/60 border-rose-700/60 text-rose-200'
          }`}
        >
          <span>{bannerMsg.text}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Configured Sources List */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Configured Sources ({sources.length}) — Preserving Priority &amp; Fallback Order
          </span>
          <span className="text-[11px] text-slate-400">Owner-Only Diagnostics</span>
        </div>

        {loading && sources.length === 0 ? (
          <div className="py-14 flex flex-col items-center justify-center space-y-2">
            <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
            <span className="text-xs text-slate-400">Loading configured sources...</span>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {sources.map(src => {
              const isTestingThis = testingSourceId === src.id || testingAll || (retryingFailed && src.status === 'Failed');
              const isTogglingThis = togglingSourceId === src.id;

              const statusBadgeClass =
                src.status === 'Operational'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : src.status === 'Failed'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700';

              return (
                <div
                  key={src.id}
                  id={`owner-source-row-${src.id}`}
                  className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-900/60 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-amber-300 border border-slate-700">
                        {src.group === 'artwork' ? `Priority #${src.priority}` : `Watch Order #${src.priority}`}
                      </span>
                      <h4 className="text-sm font-black text-white tracking-tight">{src.name}</h4>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border inline-flex items-center gap-1 ${statusBadgeClass}`}
                      >
                        {src.status === 'Operational' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        {src.status === 'Failed' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                        {src.status === 'Disabled' && <Ban className="w-3 h-3 text-slate-400" />}
                        <span>{src.status}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                        Purpose: {src.purpose}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{src.description}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>Last tested:</span>
                        <strong className="text-slate-200">{formatTimestamp(src.lastTested)}</strong>
                      </span>

                      <span className="inline-flex items-center gap-1">
                        <Activity className="w-3 h-3 text-slate-500" />
                        <span>Response time:</span>
                        <strong className="text-slate-200">
                          {typeof src.responseTimeMs === 'number' && src.responseTimeMs > 0
                            ? `${src.responseTimeMs} ms`
                            : 'N/A'}
                        </strong>
                      </span>

                      {src.lastMessage && (
                        <span className="text-slate-300 truncate max-w-md" title={src.lastMessage}>
                          • {src.lastMessage}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row Actions: Enable/Disable (if supported) + Test */}
                  <div className="flex items-center gap-2 shrink-0">
                    {src.canToggle ? (
                      <button
                        type="button"
                        id={`btn-toggle-source-${src.id}`}
                        onClick={() => handleToggleSource(src)}
                        disabled={isTogglingThis || isTestingThis}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                          src.enabled
                            ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                            : 'bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border-emerald-700/60'
                        }`}
                      >
                        {isTogglingThis ? '...' : src.enabled ? 'Disable' : 'Enable'}
                      </button>
                    ) : (
                      <span
                        className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-950 text-slate-500 border border-slate-800 select-none"
                        title={src.toggleReason || 'Fixed state'}
                      >
                        {src.id === 'jikan' ? 'Spec Disabled' : 'Optional (No Key)'}
                      </span>
                    )}

                    <button
                      type="button"
                      id={`btn-test-source-${src.id}`}
                      onClick={() => handleTestSingle(src.id, src.name)}
                      disabled={isTestingThis}
                      className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isTestingThis ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Test</span>
                        </>
                      )}
                    </button>
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
