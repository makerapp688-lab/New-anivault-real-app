import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Tv,
  Film,
  Calendar,
  Layers,
  Sparkles,
  Play,
  Heart,
  Bookmark,
  Check,
  RotateCcw,
  Dice5
} from 'lucide-react';
import { Anime } from '../types.ts';
import { AnimeArtwork } from './AnimeArtwork.tsx';
import {
  resolveWatchUrl,
  calculateTotalEpisodes,
  calculateSeasonEpisodes,
  RARETOON_BASE_URL,
  RARETOON_PROVIDER_NAME
} from '../utils/provider.ts';
import { useUserData } from '../hooks/useUserData.ts';

interface AnimeDetailsModalProps {
  anime: Anime | null;
  onClose: () => void;
  onRollAgain?: () => void;
}

export const AnimeDetailsModal: React.FC<AnimeDetailsModalProps> = ({
  anime,
  onClose,
  onRollAgain
}) => {
  const [activeSeasonNumber, setActiveSeasonNumber] = useState<number>(
    anime?.seasons?.[0]?.seasonNumber || 1
  );

  const { isFavorite, isWatchlist, isCompleted, toggleFavorite, toggleWatchlist, toggleCompleted } = useUserData();

  React.useEffect(() => {
    if (anime?.seasons?.[0]?.seasonNumber) {
      setActiveSeasonNumber(anime.seasons[0].seasonNumber);
    }
  }, [anime?.id]);

  if (!anime) return null;

  const favorited = isFavorite(anime.id);
  const inWatchlist = isWatchlist(anime.id);
  const completed = isCompleted(anime.id);

  // Calculate Whole Anime Total Episodes
  const totalAnimeEpisodes = calculateTotalEpisodes(anime);

  // Find currently selected season
  const activeSeason =
    anime.seasons?.find(s => s.seasonNumber === activeSeasonNumber) || anime.seasons?.[0];

  // Calculate Current Season Episode Count
  const currentSeasonEpisodes = calculateSeasonEpisodes(activeSeason);

  // Resolve verified watch URL (never points to old raretoonindia.in; falls back to https://www.rareanimes.mov/home/ if unverified)
  const watchResolution = resolveWatchUrl(anime, activeSeasonNumber);

  const handleOpenToWatch = () => {
    if (watchResolution.url) {
      window.open(watchResolution.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      id="anime-details-modal-overlay"
    >
      <div
        className="relative w-full max-w-3xl bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col transition-colors"
        onClick={e => e.stopPropagation()}
        id={`anime-details-${anime.id}`}
      >
        {/* Sticky Header with Close & Action Buttons */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 dark:text-slate-300 light:text-slate-700">
              AniVault Anime Details
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onRollAgain && (
              <button
                type="button"
                id="btn-roll-again-details"
                onClick={onRollAgain}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/40 transition-colors"
              >
                <Dice5 className="w-3.5 h-3.5" />
                <span>Roll Again</span>
              </button>
            )}
            <button
              type="button"
              id="btn-close-details-modal"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-300 hover:text-white dark:text-slate-300 light:text-slate-700 flex items-center justify-center transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Container */}
        <div className="overflow-y-auto p-4 md:p-6 space-y-6 flex-1 text-slate-200 dark:text-slate-200 light:text-slate-800">
          {/* Hero Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            <div className="md:col-span-1 w-full">
              <AnimeArtwork
                src={anime.artwork?.verifiedArtworkUrl}
                alt={anime.title}
                aspectRatio="aspect-video md:aspect-[3/4]"
                className="shadow-xl rounded-xl"
              />
              
              {/* Quick Action Buttons (Favorite, Watch Later, Completed) */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <button
                  type="button"
                  id={`btn-fav-${anime.id}`}
                  onClick={() => toggleFavorite(anime.id)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border ${
                    favorited
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-sm'
                      : 'bg-slate-800/80 hover:bg-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 border-slate-700/50'
                  }`}
                  title={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
                >
                  <Heart className={`w-4 h-4 mb-1 ${favorited ? 'fill-rose-500 text-rose-500' : ''}`} />
                  <span>{favorited ? 'Favorited' : 'Favorite'}</span>
                </button>

                <button
                  type="button"
                  id={`btn-watchlater-${anime.id}`}
                  onClick={() => toggleWatchlist(anime.id)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border ${
                    inWatchlist
                      ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50 shadow-sm'
                      : 'bg-slate-800/80 hover:bg-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 border-slate-700/50'
                  }`}
                  title={inWatchlist ? 'In Watch Later' : 'Add to Watch Later'}
                >
                  <Bookmark className={`w-4 h-4 mb-1 ${inWatchlist ? 'fill-indigo-400 text-indigo-400' : ''}`} />
                  <span>{inWatchlist ? 'Saved' : 'Watch Later'}</span>
                </button>

                <button
                  type="button"
                  id={`btn-completed-${anime.id}`}
                  onClick={() => toggleCompleted(anime.id)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border ${
                    completed
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-sm'
                      : 'bg-slate-800/80 hover:bg-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 border-slate-700/50'
                  }`}
                  title={completed ? 'Marked as Watched' : 'Mark as Watched'}
                >
                  <Check className={`w-4 h-4 mb-1 ${completed ? 'text-emerald-400 font-bold' : ''}`} />
                  <span>{completed ? 'Watched' : 'Watched'}</span>
                </button>
              </div>

              <div className="mt-2 text-center">
                <span className="text-[10px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-mono">
                  ID: {anime.id}
                </span>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-700/60">
                    {anime.type === 'Movie' ? <Film className="w-3.5 h-3.5" /> : <Tv className="w-3.5 h-3.5" />}
                    {anime.type}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {anime.releaseYear}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-950/80 text-amber-300 border border-amber-700/50">
                    {anime.providers?.raretoonIndia?.dubLanguage || 'Hindi Dubbed'}
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-md text-xs font-medium border ${
                    anime.status === 'Ongoing'
                      ? 'bg-amber-950/80 text-amber-400 border-amber-700/50'
                      : 'bg-emerald-950/80 text-emerald-400 border-emerald-700/50'
                  }`}>
                    {anime.status}
                  </span>
                </div>

                <h1 className="text-xl md:text-2xl font-black text-white dark:text-white light:text-slate-900 tracking-tight">
                  {anime.title}
                </h1>
                {anime.alternateTitle && (
                  <p className="text-sm text-slate-400 dark:text-slate-400 light:text-slate-600 italic mt-0.5">
                    {anime.alternateTitle}
                  </p>
                )}
              </div>

              {/* MANDATORY REQUIREMENT 1: EPISODE COUNTS (WHOLE ANIME + CURRENT SEASON) */}
              <div className="p-3.5 bg-slate-950/80 dark:bg-slate-950/80 light:bg-slate-100 border border-slate-800 dark:border-slate-800 light:border-slate-300 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 dark:border-slate-800 light:border-slate-200 pb-2">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600 font-medium">Whole Anime:</span>
                  <span className="font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-rose-500" />
                    {totalAnimeEpisodes !== null ? (
                      <span>Total Episodes: <strong className="text-rose-400 text-sm">{totalAnimeEpisodes}</strong></span>
                    ) : (
                      <span className="text-slate-400 italic">Episodes: Not available</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-0.5">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600 font-medium">Current Season:</span>
                  <span className="font-semibold text-white dark:text-white light:text-slate-900 flex items-center gap-1.5">
                    <Tv className="w-3.5 h-3.5 text-cyan-400" />
                    {currentSeasonEpisodes !== null ? (
                      <span>{activeSeason?.title || `Season ${activeSeasonNumber}`} • <strong className="text-cyan-400">{currentSeasonEpisodes} Episodes</strong></span>
                    ) : (
                      <span>{activeSeason?.title || `Season ${activeSeasonNumber}`} • <span className="text-slate-400 italic">Episodes: Not available</span></span>
                    )}
                  </span>
                </div>
              </div>

              {/* Active Provider Status */}
              <div className="p-3 bg-slate-950/70 dark:bg-slate-950/70 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600">Active Provider:</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    RareToon India ({RARETOON_PROVIDER_NAME})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600">Audio &amp; Quality:</span>
                  <span className="text-slate-200 dark:text-slate-200 light:text-slate-800 font-medium">
                    {anime.providers?.raretoonIndia?.dubLanguage} • {anime.providers?.raretoonIndia?.quality || '1080p FHD'}
                  </span>
                </div>
              </div>

              {/* MANDATORY REQUIREMENT 2: OPEN THIS ANIME TO WATCH */}
              <div className="pt-2">
                {watchResolution.isAvailable && watchResolution.url ? (
                  <>
                    <button
                      type="button"
                      id="btn-open-anime-to-watch"
                      onClick={handleOpenToWatch}
                      className="w-full py-3 px-5 rounded-xl font-bold text-sm md:text-base bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500 hover:from-rose-500 hover:to-pink-400 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] cursor-pointer"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      <span>OPEN THIS ANIME TO WATCH</span>
                      <ExternalLink className="w-4 h-4 ml-1 opacity-80" />
                    </button>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 mt-1.5 px-1 font-mono">
                      <span className="truncate max-w-[260px] md:max-w-md">
                        Destination: {watchResolution.url}
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        ✓ Verified Match
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-center space-y-1">
                    <p className="text-xs font-bold text-slate-400">Stream Not Available on RareAnimes</p>
                    <p className="text-[11px] text-slate-500">This specific title does not have a verified direct streaming link on RareAnimes.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Synopsis */}
          <div className="bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-50 p-4 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-rose-500" />
              Synopsis &amp; Details
            </h3>
            <p className="text-sm text-slate-300 dark:text-slate-300 light:text-slate-700 leading-relaxed max-w-prose">
              {anime.synopsis}
            </p>

            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-800 dark:border-slate-800 light:border-slate-200">
              <span className="text-xs text-slate-400 mr-1 self-center">Genres:</span>
              {anime.genres.map(g => (
                <span
                  key={g}
                  className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-800 dark:bg-slate-800 light:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-700 dark:border-slate-700 light:border-slate-300"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>

          {/* Strict Season & Episode Architecture */}
          {anime.seasons && anime.seasons.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200 dark:text-slate-200 light:text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>Seasons &amp; Episodes ({anime.seasons.length} Available)</span>
                </h3>
              </div>

              {/* Season Selection Tabs */}
              {anime.seasons.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  {anime.seasons.map(s => {
                    const epCount = calculateSeasonEpisodes(s);
                    return (
                      <button
                        key={s.seasonNumber}
                        type="button"
                        id={`btn-season-${s.seasonNumber}`}
                        onClick={() => setActiveSeasonNumber(s.seasonNumber)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                          activeSeasonNumber === s.seasonNumber
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-slate-800 dark:bg-slate-800 light:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        <span>{s.title || `Season ${s.seasonNumber}`}</span>
                        {epCount !== null && (
                          <span className="text-[10px] opacity-80">({epCount} Eps)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Active Season Information */}
              {activeSeason && (
                <div className="p-3.5 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-semibold text-slate-200 dark:text-slate-200 light:text-slate-900">
                      {activeSeason.title || `Season ${activeSeason.seasonNumber}`}
                      {currentSeasonEpisodes !== null && (
                        <span className="ml-2 font-normal text-cyan-400">({currentSeasonEpisodes} Episodes)</span>
                      )}
                    </span>
                    {watchResolution.url && (
                      <a
                        href={watchResolution.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors"
                      >
                        <span>Open on RareAnimes</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Episodes Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-2">
                    {activeSeason.episodes && activeSeason.episodes.length > 0 ? (
                      activeSeason.episodes.map(ep => {
                        const epUrl =
                          ep.canonicalUrl && ep.canonicalUrl.startsWith('https://www.rareanimes.mov')
                            ? ep.canonicalUrl
                            : watchResolution.url;
                        return epUrl ? (
                          <a
                            key={ep.episodeNumber}
                            href={epUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 rounded-lg bg-slate-800/90 dark:bg-slate-800/90 light:bg-white hover:bg-slate-700 dark:hover:bg-slate-700 light:hover:bg-slate-100 border border-slate-700/60 dark:border-slate-700/60 light:border-slate-300 flex items-center justify-between text-xs text-slate-200 dark:text-slate-200 light:text-slate-800 transition-colors group"
                          >
                            <span className="font-medium group-hover:text-rose-400 truncate">
                              {ep.title}
                            </span>
                            <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-rose-400 shrink-0 ml-1" />
                          </a>
                        ) : (
                          <div
                            key={ep.episodeNumber}
                            className="p-2.5 rounded-lg bg-slate-800/60 text-slate-400 border border-slate-800 flex items-center justify-between text-xs"
                          >
                            <span className="truncate">{ep.title}</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-full py-4 text-center text-xs text-slate-400">
                        Episodes: Not available for individual direct selection. Use “OPEN THIS ANIME TO WATCH” to browse all available episodes on RareAnimes.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between text-xs text-slate-400">
          <span>Provider: RareToon India ({RARETOON_PROVIDER_NAME})</span>
          <button
            type="button"
            id="btn-footer-close"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
