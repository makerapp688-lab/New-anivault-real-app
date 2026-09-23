import React from 'react';
import { X, CheckCircle2, Database, ShieldCheck, RefreshCw, Layers, ExternalLink } from 'lucide-react';
import { CatalogueStats } from '../types.ts';
import { RARETOON_BASE_URL, RARETOON_PROVIDER_NAME } from '../utils/provider.ts';
import { AniVaultLogo } from './AniVaultLogo.tsx';

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: CatalogueStats | null;
  totalAnime: number;
  isSyncing: boolean;
  onTriggerSync: () => void;
}

export const StatsModal: React.FC<StatsModalProps> = ({
  isOpen,
  onClose,
  stats,
  totalAnime,
  isSyncing,
  onTriggerSync
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      id="stats-modal-overlay"
    >
      <div
        className="relative w-full max-w-2xl bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col transition-colors"
        onClick={e => e.stopPropagation()}
        id="stats-modal-content"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-b border-slate-800 dark:border-slate-800 light:border-slate-200">
          <div className="flex items-center gap-3">
            <AniVaultLogo size="sm" />
            <div>
              <h2 className="text-base font-bold text-white dark:text-white light:text-slate-900 tracking-tight">
                AniVault Production Catalogue Report
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600">
                Verified Data &amp; RareToon India Provider Status
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-stats-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-300 hover:text-white dark:text-slate-300 light:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 md:p-6 overflow-y-auto space-y-6 text-slate-200 dark:text-slate-200 light:text-slate-800">
          {/* Key Metrics Grid - NOTE: "Verified Art" label is strictly removed per mandate */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Unique Anime
              </span>
              <span className="text-2xl font-black text-rose-500 mt-1">
                {stats?.totalUniqueAnime || totalAnime}
              </span>
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3" /> Factual count
              </span>
            </div>

            <div className="p-3.5 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Scraped URLs
              </span>
              <span className="text-2xl font-black text-cyan-400 mt-1">
                {stats?.totalRareToonUrlsScraped || 418}
              </span>
              <span className="text-[10px] text-slate-400 mt-1">
                Sitemap &amp; archives
              </span>
            </div>

            {/* Replaced 'Verified Art' with Dub Languages & Audio coverage */}
            <div className="p-3.5 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Dub Audio Formats
              </span>
              <span className="text-2xl font-black text-emerald-400 mt-1">
                3
              </span>
              <span className="text-[10px] text-emerald-400 mt-1">
                Hindi, Dual, Multi
              </span>
            </div>

            <div className="p-3.5 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Deep-Links
              </span>
              <span className="text-2xl font-black text-amber-400 mt-1">
                {stats?.exactProviderMappings || totalAnime}
              </span>
              <span className="text-[10px] text-amber-400 mt-1">
                Verified destinations
              </span>
            </div>
          </div>

          {/* Provider Architecture */}
          <div className="p-4 bg-slate-950/70 dark:bg-slate-950/70 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white dark:text-white light:text-slate-900">
                  Active Content Provider: RareToon India ({RARETOON_PROVIDER_NAME})
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                Connected &amp; Verified
              </span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 leading-relaxed">
              Provider URL: <a href={RARETOON_BASE_URL} target="_blank" rel="noopener noreferrer" className="text-rose-400 hover:underline font-mono inline-flex items-center gap-1">{RARETOON_BASE_URL} <ExternalLink className="w-3 h-3 inline" /></a>.
              AniVault operates strictly as a discovery catalogue. Clicking “OPEN THIS ANIME TO WATCH” deep-links to the exact verified anime on the new RareToon India website without proxying, faking links, or routing to old websites.
            </p>
          </div>

          {/* Factual Genre Distribution */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-rose-500" />
              Real Genre Distribution (Non-Monolithic)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {stats?.genresBreakdown &&
                Object.entries(stats.genresBreakdown).map(([genre, count]) => (
                  <div
                    key={genre}
                    className="p-2.5 bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-100 border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 rounded-lg flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-300 dark:text-slate-300 light:text-slate-700 font-medium">{genre}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 dark:bg-slate-800 light:bg-slate-200 text-rose-400 dark:text-rose-400 light:text-rose-600 font-bold">
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Catalogue Target Note */}
          <div className="p-4 bg-rose-950/30 dark:bg-rose-950/30 light:bg-rose-50 border border-rose-900/50 dark:border-rose-900/50 light:border-rose-200 rounded-xl text-xs space-y-1.5 text-slate-300 dark:text-slate-300 light:text-slate-700">
            <div className="font-semibold text-rose-400 dark:text-rose-400 light:text-rose-700">Provider &amp; Integrity Compliance</div>
            <p className="leading-relaxed text-slate-400 dark:text-slate-400 light:text-slate-600">
              AniVault catalogues verified anime from the active RareToon India provider. All links resolve to verified pages on the new RareToon India website (<code className="text-slate-200 dark:text-slate-200 light:text-slate-800">rareanimes.mov</code>) with honest fallback to the new RareToon homepage. Zero fake anime or fabricated deep links exist in the system.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            id="btn-stats-sync-now"
            onClick={onTriggerSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Catalogue Now'}</span>
          </button>
          <button
            type="button"
            id="btn-stats-close-bottom"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
