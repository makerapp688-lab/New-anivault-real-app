import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  CheckCircle2,
  Tv,
  Film,
  Calendar,
  Layers,
  Sparkles,
  Play,
  Heart,
  Bookmark,
  Check,
  Dice5,
  Share2,
  Copy,
  Link2,
  Globe,
  GitBranch,
  Info,
  ArrowRight
} from 'lucide-react';
import { Anime } from '../types.ts';
import { AnimeArtwork } from './AnimeArtwork.tsx';
import {
  resolveWatchUrl,
  calculateTotalEpisodes,
  calculateSeasonEpisodes,
  calculateImportedEpisodes,
  calculateSeasonImportedEpisodes,
  getSeasonEpisodeStatus,
  resolveAnimeLanguages,
  resolveRelatedAnimeItems,
  getAnimeDetailsPath,
  getAnimeShareUrl,
  copyTextToClipboard,
  RARETOON_PROVIDER_NAME
} from '../utils/provider.ts';
import { useUserData } from '../hooks/useUserData.ts';

interface AnimeDetailsModalProps {
  anime: Anime | null;
  allAnime?: Anime[];
  onClose: () => void;
  onSelectAnime?: (anime: Anime) => void;
  onRollAgain?: () => void;
}

export const AnimeDetailsModal: React.FC<AnimeDetailsModalProps> = ({
  anime,
  allAnime = [],
  onClose,
  onSelectAnime,
  onRollAgain
}) => {
  const [activeSeasonNumber, setActiveSeasonNumber] = useState<number>(
    anime?.seasons?.[0]?.seasonNumber || 1
  );
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'shared' | 'error'>('idle');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');

  const { isFavorite, isWatchlist, isCompleted, toggleFavorite, toggleWatchlist, toggleCompleted } = useUserData();

  useEffect(() => {
    if (anime?.seasons?.[0]?.seasonNumber) {
      setActiveSeasonNumber(anime.seasons[0].seasonNumber);
    } else {
      setActiveSeasonNumber(1);
    }
    setCopyFeedback('idle');
    setFeedbackMessage('');
  }, [anime?.id]);

  useEffect(() => {
    if (copyFeedback === 'idle') return;
    const timer = window.setTimeout(() => {
      setCopyFeedback('idle');
      setFeedbackMessage('');
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  if (!anime) return null;

  const favorited = isFavorite(anime.id);
  const inWatchlist = isWatchlist(anime.id);
  const completed = isCompleted(anime.id);

  // Authoritative vs Imported episode counts (strictly separated)
  const totalAnimeEpisodes = calculateTotalEpisodes(anime);
  const totalImportedEpisodes = calculateImportedEpisodes(anime);
  const totalSeasonsCount =
    Array.isArray(anime.seasons) && anime.seasons.length > 0
      ? anime.seasons.length
      : typeof anime.totalSeasons === 'number' && anime.totalSeasons > 0
      ? anime.totalSeasons
      : typeof anime.seasonsCount === 'number' && anime.seasonsCount > 0
      ? anime.seasonsCount
      : null;

  // Currently selected season
  const activeSeason =
    anime.seasons?.find(s => s.seasonNumber === activeSeasonNumber) || anime.seasons?.[0];

  const currentSeasonEpisodes = calculateSeasonEpisodes(activeSeason);
  const currentSeasonImported = calculateSeasonImportedEpisodes(activeSeason);
  const currentSeasonStatus = getSeasonEpisodeStatus(activeSeason);

  // Languages & Related Anime from verified catalogue data (never invented)
  const availableLanguages = resolveAnimeLanguages(anime);
  const relatedAnimeItems = resolveRelatedAnimeItems(anime, allAnime);

  // Release year / date (never invented)
  const releaseDisplay =
    anime.releaseDate && anime.releaseDate.trim().length > 0
      ? anime.releaseDate.trim()
      : typeof anime.releaseYear === 'number' && anime.releaseYear > 0
      ? String(anime.releaseYear)
      : null;

  // Distinct Japanese title & Alternate title
  const japaneseTitle =
    anime.japaneseTitle && anime.japaneseTitle.trim().length > 0
      ? anime.japaneseTitle.trim()
      : null;
  const alternateTitle =
    anime.alternateTitle &&
    anime.alternateTitle.trim().length > 0 &&
    anime.alternateTitle.trim().toLowerCase() !== anime.title.trim().toLowerCase() &&
    anime.alternateTitle.trim() !== japaneseTitle
      ? anime.alternateTitle.trim()
      : null;

  // Canonical Zenime Anime Details URL
  const canonicalPath = getAnimeDetailsPath(anime.id);
  const canonicalShareUrl = getAnimeShareUrl(anime.id);

  // Resolve verified watch URL on RareToon India (rareanimes.mov)
  const watchResolution = resolveWatchUrl(anime, activeSeasonNumber);

  const handleOpenToWatch = () => {
    if (watchResolution.url) {
      window.open(watchResolution.url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyAnimeLink = async () => {
    const ok = await copyTextToClipboard(canonicalShareUrl);
    if (ok) {
      setCopyFeedback('copied');
      setFeedbackMessage(`Copied link: ${canonicalShareUrl}`);
    } else {
      setCopyFeedback('error');
      setFeedbackMessage('Unable to copy automatically — select the link below.');
    }
  };

  const handleShareAnime = async () => {
    const shareData = {
      title: `${anime.title} — Zenime`,
      text: `Explore ${anime.title}${releaseDisplay ? ` (${releaseDisplay})` : ''} on Zenime`,
      url: canonicalShareUrl
    };

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        setCopyFeedback('shared');
        setFeedbackMessage('Shared anime link successfully!');
        return;
      } catch (err: any) {
        if (err && err.name === 'AbortError') {
          return;
        }
        // If Web Share fails in desktop/iframe contexts, fall back to copying canonical link
      }
    }

    const ok = await copyTextToClipboard(canonicalShareUrl);
    if (ok) {
      setCopyFeedback('shared');
      setFeedbackMessage(`Share link copied to clipboard: ${canonicalShareUrl}`);
    } else {
      setCopyFeedback('error');
      setFeedbackMessage('Share unavailable — copy the canonical link below.');
    }
  };

  const getStatusBadgeClasses = (status?: string) => {
    switch (status) {
      case 'Ongoing':
        return 'bg-amber-950/80 text-amber-300 border-amber-700/50';
      case 'Completed':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50';
      case 'Upcoming':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-700/50';
      default:
        return 'bg-slate-800/90 text-slate-300 border-slate-700';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      id="anime-details-modal-overlay"
    >
      <div
        className="relative w-full max-w-4xl bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col transition-colors"
        onClick={e => e.stopPropagation()}
        id={`anime-details-${anime.id}`}
      >
        {/* Sticky Header with Share, Copy Link, Roll Again & Close */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 bg-slate-950/95 dark:bg-slate-950/95 light:bg-slate-100 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 sticky top-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 dark:text-slate-300 light:text-slate-700 truncate">
              Zenime Anime Details
            </span>
            <span className="hidden sm:inline-block text-[11px] font-mono text-slate-500 truncate">
              {canonicalPath}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              id="btn-share-anime"
              onClick={handleShareAnime}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-700 dark:border-slate-700 light:border-slate-300 transition-colors cursor-pointer"
              title="Share Anime"
            >
              <Share2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Share Anime</span>
            </button>

            <button
              type="button"
              id="btn-copy-anime-link"
              onClick={handleCopyAnimeLink}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                copyFeedback === 'copied'
                  ? 'bg-emerald-950/90 text-emerald-300 border-emerald-600/60'
                  : 'bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 border-slate-700 dark:border-slate-700 light:border-slate-300'
              }`}
              title="Copy Anime Link"
            >
              {copyFeedback === 'copied' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Copy Anime Link</span>
                </>
              )}
            </button>

            {onRollAgain && (
              <button
                type="button"
                id="btn-roll-again-details"
                onClick={onRollAgain}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/40 transition-colors cursor-pointer"
              >
                <Dice5 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Roll Again</span>
              </button>
            )}

            <button
              type="button"
              id="btn-close-details-modal"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-300 hover:text-white dark:text-slate-300 light:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Share / Copy Feedback Banner */}
        {copyFeedback !== 'idle' && feedbackMessage && (
          <div
            id="anime-share-feedback-banner"
            className={`px-4 py-2 text-xs font-medium flex items-center justify-between border-b ${
              copyFeedback === 'error'
                ? 'bg-amber-950/90 text-amber-200 border-amber-800/60'
                : 'bg-emerald-950/90 text-emerald-200 border-emerald-800/60'
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">{feedbackMessage}</span>
            </span>
            <button
              type="button"
              onClick={() => setCopyFeedback('idle')}
              className="text-[11px] text-slate-300 hover:text-white ml-2 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Scrollable Content Container following: Anime -> Description/Metadata -> Season selector -> Episodes */}
        <div className="overflow-y-auto p-4 md:p-6 space-y-6 flex-1 text-slate-200 dark:text-slate-200 light:text-slate-800">
          {/* ==============================================================
              SECTION 1: ANIME HERO (Artwork, Official & Japanese Titles, Watch & Share)
             ============================================================== */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            <div className="md:col-span-1 w-full">
              <AnimeArtwork
                src={anime.artwork?.verifiedArtworkUrl}
                alt={anime.title}
                aspectRatio="aspect-video md:aspect-[3/4]"
                className="shadow-xl rounded-xl"
              />

              {/* Quick User Action Buttons (Favorite, Watch Later, Watched) */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <button
                  type="button"
                  id={`btn-fav-${anime.id}`}
                  onClick={() => toggleFavorite(anime.id)}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border cursor-pointer ${
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
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border cursor-pointer ${
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
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-semibold transition-all border cursor-pointer ${
                    completed
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-sm'
                      : 'bg-slate-800/80 hover:bg-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 border-slate-700/50'
                  }`}
                  title={completed ? 'Marked as Watched' : 'Mark as Watched'}
                >
                  <Check className={`w-4 h-4 mb-1 ${completed ? 'text-emerald-400 font-bold' : ''}`} />
                  <span>Watched</span>
                </button>
              </div>

              <div className="mt-2 text-center">
                <span className="text-[10px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-mono">
                  ID: {anime.id}
                </span>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col justify-between space-y-3.5">
              <div>
                {/* Top Status / Format / Year / Language Summary Pills */}
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-700/60">
                    {anime.type === 'Movie' ? <Film className="w-3.5 h-3.5" /> : <Tv className="w-3.5 h-3.5" />}
                    <span>{anime.type || 'Unknown'}</span>
                  </span>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{releaseDisplay || 'Year Unavailable'}</span>
                  </span>

                  <span className={`px-2.5 py-0.5 rounded-md text-xs font-medium border ${getStatusBadgeClasses(anime.status)}`}>
                    {anime.status || 'Unknown'}
                  </span>

                  {availableLanguages.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-medium bg-amber-950/80 text-amber-300 border border-amber-700/50">
                      <Globe className="w-3.5 h-3.5 text-amber-400" />
                      <span>{availableLanguages.join(' • ')}</span>
                    </span>
                  )}
                </div>

                {/* Official Anime Title */}
                <h1
                  id="anime-details-official-title"
                  className="text-xl md:text-2xl font-black text-white dark:text-white light:text-slate-900 tracking-tight"
                >
                  {anime.title}
                </h1>

                {/* Japanese Title & Alternate Title when available */}
                {(japaneseTitle || alternateTitle) && (
                  <div className="mt-1 space-y-0.5">
                    {japaneseTitle && (
                      <p
                        id="anime-details-japanese-title"
                        className="text-xs sm:text-sm text-rose-300/90 dark:text-rose-300/90 light:text-rose-700 font-medium"
                      >
                        <span className="text-slate-400 dark:text-slate-400 light:text-slate-500 text-xs mr-1.5">
                          Japanese:
                        </span>
                        {japaneseTitle}
                      </p>
                    )}
                    {alternateTitle && (
                      <p
                        id="anime-details-alternate-title"
                        className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 italic"
                      >
                        Also known as: {alternateTitle}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Authoritative vs Imported Episode Summary Box */}
              <div className="p-3.5 bg-slate-950/80 dark:bg-slate-950/80 light:bg-slate-100 border border-slate-800 dark:border-slate-800 light:border-slate-300 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs border-b border-slate-800 dark:border-slate-800 light:border-slate-200 pb-2">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600 font-medium">
                    Total Authoritative Episodes:
                  </span>
                  <span className="font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-rose-500" />
                    {totalAnimeEpisodes !== null ? (
                      <span>
                        <strong className="text-rose-400 text-sm">{totalAnimeEpisodes}</strong>{' '}
                        {totalAnimeEpisodes === 1 ? 'Episode' : 'Episodes'}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Unavailable (Unknown)</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs pt-0.5">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600 font-medium">
                    Selected Season ({activeSeason?.title || `Season ${activeSeasonNumber}`}):
                  </span>
                  <span className="font-semibold text-white dark:text-white light:text-slate-900 flex items-center gap-1.5">
                    <Tv className="w-3.5 h-3.5 text-cyan-400" />
                    {currentSeasonEpisodes !== null ? (
                      <strong className="text-cyan-400">{currentSeasonEpisodes} Authoritative Eps</strong>
                    ) : (
                      <span className="text-slate-400 italic">Authoritative Count: Unavailable</span>
                    )}
                  </span>
                </div>

                {activeSeason && (
                  <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-800/70 dark:border-slate-800/70 light:border-slate-200">
                    <span className="text-slate-400 dark:text-slate-400 light:text-slate-600">
                      Season Imported Episode Records:
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="text-slate-300 dark:text-slate-300 light:text-slate-700">
                        {currentSeasonEpisodes !== null
                          ? `${currentSeasonImported} of ${currentSeasonEpisodes} imported`
                          : `${currentSeasonImported} imported`}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          currentSeasonStatus === 'complete'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : currentSeasonStatus === 'partial'
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'bg-slate-700/40 text-slate-300 border border-slate-600/40'
                        }`}
                      >
                        {currentSeasonStatus === 'complete'
                          ? 'Complete List'
                          : currentSeasonStatus === 'partial'
                          ? 'Partial List'
                          : 'No Records'}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Active Provider & Canonical Share Link Box */}
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
                    {availableLanguages.length > 0 ? availableLanguages.join(', ') : 'Unavailable'} •{' '}
                    {anime.providers?.raretoonIndia?.quality || 'HD'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70 dark:border-slate-800/70 light:border-slate-200">
                  <span className="text-slate-400 dark:text-slate-400 light:text-slate-600 flex items-center gap-1 shrink-0">
                    <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Anime Link:</span>
                  </span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <code
                      id="anime-canonical-link-text"
                      className="text-[11px] font-mono text-cyan-300 dark:text-cyan-300 light:text-cyan-700 truncate max-w-[190px] sm:max-w-xs"
                    >
                      {canonicalShareUrl}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyAnimeLink}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 border border-slate-700 shrink-0 cursor-pointer"
                    >
                      {copyFeedback === 'copied' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* WATCH BUTTON (Preserving canonical RareToon destination behavior) */}
              <div className="pt-1">
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
                    <p className="text-[11px] text-slate-500">
                      This specific title does not have a verified direct streaming link on RareAnimes.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ==============================================================
              SECTION 2: DESCRIPTION / SYNOPSIS, GENRES, METADATA & RELATED ANIME
             ============================================================== */}
          <div className="bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-50 p-4 sm:p-5 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-rose-500" />
                <span>Description &amp; Synopsis</span>
              </h3>
              {anime.synopsis && anime.synopsis.trim().length > 0 ? (
                <p
                  id="anime-details-synopsis"
                  className="text-sm text-slate-300 dark:text-slate-300 light:text-slate-700 leading-relaxed max-w-prose"
                >
                  {anime.synopsis}
                </p>
              ) : (
                <p
                  id="anime-details-synopsis-unavailable"
                  className="text-sm text-slate-500 italic"
                >
                  Synopsis unavailable for this title.
                </p>
              )}
            </div>

            {/* Genres */}
            <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-800 dark:border-slate-800 light:border-slate-200">
              <span className="text-xs text-slate-400 mr-1 font-medium">Genres:</span>
              {Array.isArray(anime.genres) && anime.genres.length > 0 ? (
                anime.genres.map(g => (
                  <span
                    key={g}
                    className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-800 dark:bg-slate-800 light:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-700 dark:border-slate-700 light:border-slate-300"
                  >
                    {g}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500 italic">Unavailable</span>
              )}
            </div>

            {/* Complete Verified Metadata Grid */}
            <div
              id="anime-details-metadata-grid"
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-3 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 text-xs"
            >
              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Official Title</div>
                <div className="font-semibold text-white dark:text-white light:text-slate-900 mt-0.5 truncate" title={anime.title}>
                  {anime.title}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Japanese Title</div>
                <div
                  className={`font-medium mt-0.5 truncate ${
                    japaneseTitle ? 'text-slate-200 dark:text-slate-200 light:text-slate-800' : 'text-slate-500 italic'
                  }`}
                  title={japaneseTitle || 'Unavailable'}
                >
                  {japaneseTitle || 'Unavailable'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Format / Type</div>
                <div className="font-semibold text-white dark:text-white light:text-slate-900 mt-0.5">
                  {anime.type || 'Unavailable'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Release Year / Date</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    releaseDisplay ? 'text-white dark:text-white light:text-slate-900' : 'text-slate-500 italic font-normal'
                  }`}
                >
                  {releaseDisplay || 'Unavailable'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Status</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    anime.status && anime.status !== 'Unknown'
                      ? 'text-white dark:text-white light:text-slate-900'
                      : 'text-slate-400 italic font-normal'
                  }`}
                >
                  {anime.status || 'Unknown'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Total Seasons</div>
                <div className="font-semibold text-white dark:text-white light:text-slate-900 mt-0.5">
                  {totalSeasonsCount !== null
                    ? `${totalSeasonsCount} ${totalSeasonsCount === 1 ? 'Season' : 'Seasons'}`
                    : 'Unavailable'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Authoritative Episodes</div>
                <div className="font-semibold text-white dark:text-white light:text-slate-900 mt-0.5">
                  {totalAnimeEpisodes !== null ? (
                    <span>
                      {totalAnimeEpisodes} Total ({totalImportedEpisodes} Imported)
                    </span>
                  ) : (
                    <span className="text-slate-400 font-normal italic">
                      Unknown ({totalImportedEpisodes} Imported)
                    </span>
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Available Languages</div>
                <div
                  className={`font-semibold mt-0.5 truncate ${
                    availableLanguages.length > 0
                      ? 'text-amber-300 dark:text-amber-300 light:text-amber-700'
                      : 'text-slate-500 italic font-normal'
                  }`}
                  title={availableLanguages.join(', ') || 'Unavailable'}
                >
                  {availableLanguages.length > 0 ? availableLanguages.join(', ') : 'Unavailable'}
                </div>
              </div>
            </div>

            {/* Related Anime Section (Uses verified catalogue data only; clickable when matched in Zenime catalogue) */}
            <div
              id="anime-details-related-section"
              className="pt-3 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Related Anime</span>
                </span>
                {relatedAnimeItems.length > 0 && (
                  <span className="text-[11px] text-slate-400">
                    {relatedAnimeItems.length} {relatedAnimeItems.length === 1 ? 'Relation' : 'Relations'}
                  </span>
                )}
              </div>

              {relatedAnimeItems.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {relatedAnimeItems.map((rel, idx) =>
                    rel.matchedAnime && onSelectAnime ? (
                      <button
                        key={`${rel.title}-${idx}`}
                        type="button"
                        onClick={() => onSelectAnime(rel.matchedAnime!)}
                        className="p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 dark:bg-slate-900/90 dark:hover:bg-slate-800 light:bg-white light:hover:bg-slate-100 border border-slate-800 hover:border-rose-500/50 flex items-center justify-between gap-2 text-left transition-colors group cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {rel.relationType && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                                {rel.relationType}
                              </span>
                            )}
                            {rel.formatHint && (
                              <span className="text-[10px] text-slate-400">({rel.formatHint})</span>
                            )}
                          </div>
                          <div className="text-xs font-semibold text-white dark:text-white light:text-slate-900 group-hover:text-rose-400 truncate">
                            {rel.matchedAnime.title}
                          </div>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 shrink-0" />
                      </button>
                    ) : (
                      <div
                        key={`${rel.title}-${idx}`}
                        className="p-2.5 rounded-lg bg-slate-900/60 dark:bg-slate-900/60 light:bg-white border border-slate-800/70 dark:border-slate-800/70 light:border-slate-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {rel.relationType && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                                {rel.relationType}
                              </span>
                            )}
                            {rel.formatHint && (
                              <span className="text-[10px] text-slate-400">({rel.formatHint})</span>
                            )}
                          </div>
                          <div className="text-xs font-medium text-slate-200 dark:text-slate-200 light:text-slate-800 truncate">
                            {rel.title}
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  No verified related anime linked for this entry.
                </p>
              )}
            </div>
          </div>

          {/* ==============================================================
              SECTION 3 & 4: SEASON SELECTOR -> SELECTED SEASON EPISODES
             ============================================================== */}
          {anime.seasons && anime.seasons.length > 0 ? (
            <div className="space-y-3.5" id="anime-details-seasons-section">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-bold text-slate-100 dark:text-slate-100 light:text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>
                    Season Selector ({anime.seasons.length}{' '}
                    {anime.seasons.length === 1 ? 'Season' : 'Seasons'} Available)
                  </span>
                </h3>
                <span className="text-xs text-slate-400">
                  Select a season to inspect its verified episode records
                </span>
              </div>

              {/* Season Selector Tabs (Shown for all anime with seasons so season selection is always clear) */}
              <div
                id="anime-season-selector-tabs"
                className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin"
              >
                {anime.seasons.map(s => {
                  const epAuthCount = calculateSeasonEpisodes(s);
                  const epImpCount = calculateSeasonImportedEpisodes(s);
                  const isSelected = activeSeason?.seasonNumber === s.seasonNumber;
                  return (
                    <button
                      key={s.seasonNumber}
                      type="button"
                      id={`btn-season-${s.seasonNumber}`}
                      onClick={() => setActiveSeasonNumber(s.seasonNumber)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 border cursor-pointer ${
                        isSelected
                          ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-950/30'
                          : 'bg-slate-800/90 dark:bg-slate-800/90 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border-slate-700/70 hover:bg-slate-700'
                      }`}
                    >
                      <span>{s.title || `Season ${s.seasonNumber}`}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-900/80 text-slate-300'
                        }`}
                      >
                        {epAuthCount !== null ? `${epAuthCount} Eps` : `${epImpCount} Imported`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Selected Season Details & Real Episodes List */}
              {activeSeason && (
                <div
                  id={`season-panel-${activeSeason.seasonNumber}`}
                  className="p-4 bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl space-y-3"
                >
                  {/* Selected Season Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white dark:text-white light:text-slate-900">
                          {activeSeason.title || `Season ${activeSeason.seasonNumber}`}
                        </span>
                        <span className="text-xs font-medium text-cyan-400">
                          • Authoritative Count:{' '}
                          {currentSeasonEpisodes !== null ? `${currentSeasonEpisodes} Episodes` : 'Unknown'}
                        </span>
                        <span className="text-xs text-slate-400">
                          • Imported Records: {currentSeasonImported}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            currentSeasonStatus === 'complete'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : currentSeasonStatus === 'partial'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {currentSeasonStatus === 'complete'
                            ? 'Complete Episode List'
                            : currentSeasonStatus === 'partial'
                            ? 'Partial Episode List'
                            : 'No Episode Records'}
                        </span>
                      </div>
                    </div>

                    {watchResolution.url && (
                      <a
                        href={watchResolution.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors shrink-0"
                      >
                        <span>Open Season on RareAnimes</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Partial Episode List Notice when imported < authoritative or status is partial */}
                  {currentSeasonStatus === 'partial' && (
                    <div
                      id="partial-episode-list-notice"
                      className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 flex items-start gap-2 text-xs text-amber-200/90"
                    >
                      <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        Showing <strong>{currentSeasonImported}</strong> real imported episode{' '}
                        {currentSeasonImported === 1 ? 'record' : 'records'}
                        {currentSeasonEpisodes !== null
                          ? ` out of ${currentSeasonEpisodes} authoritative episodes for this season.`
                          : ' (total authoritative episode count is not yet specified by the source).'}{' '}
                        Missing episodes are never fabricated — use{' '}
                        <strong className="text-white">“OPEN THIS ANIME TO WATCH”</strong> to access all
                        available episodes on RareAnimes.
                      </span>
                    </div>
                  )}

                  {/* Real Episodes Grid */}
                  <div
                    id="season-episodes-grid"
                    className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1"
                  >
                    {activeSeason.episodes && activeSeason.episodes.length > 0 ? (
                      activeSeason.episodes.map(ep => {
                        const epUrl =
                          ep.canonicalUrl &&
                          (ep.canonicalUrl.startsWith('https://www.rareanimes.mov') ||
                            ep.canonicalUrl.startsWith('https://rareanimes.mov'))
                            ? ep.canonicalUrl
                            : watchResolution.url;
                        const epDisplayTitle =
                          ep.title && ep.title.trim().length > 0
                            ? ep.title.trim()
                            : `Episode ${ep.episodeNumber}`;

                        return epUrl ? (
                          <a
                            key={ep.episodeNumber}
                            href={epUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 rounded-lg bg-slate-800/90 dark:bg-slate-800/90 light:bg-white hover:bg-slate-700 dark:hover:bg-slate-700 light:hover:bg-slate-100 border border-slate-700/60 dark:border-slate-700/60 light:border-slate-300 flex items-center justify-between gap-2 text-xs text-slate-200 dark:text-slate-200 light:text-slate-800 transition-colors group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-rose-400 font-mono text-[10px] font-bold shrink-0">
                                EP {ep.episodeNumber}
                              </span>
                              <span className="font-medium group-hover:text-rose-400 truncate">
                                {epDisplayTitle}
                              </span>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 shrink-0" />
                          </a>
                        ) : (
                          <div
                            key={ep.episodeNumber}
                            className="p-2.5 rounded-lg bg-slate-800/60 text-slate-300 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-slate-400 font-mono text-[10px] font-bold shrink-0">
                                EP {ep.episodeNumber}
                              </span>
                              <span className="truncate">{epDisplayTitle}</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-full py-4 text-center text-xs text-slate-400">
                        No individual episode records imported for this season. Use “OPEN THIS ANIME TO WATCH” to browse available episodes on RareAnimes.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
              Season and episode records are unavailable for this entry.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-400">
          <span>Provider: RareToon India ({RARETOON_PROVIDER_NAME})</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAnimeLink}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
              <span>{copyFeedback === 'copied' ? 'Copied!' : 'Copy Anime Link'}</span>
            </button>
            <button
              type="button"
              id="btn-footer-close"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
