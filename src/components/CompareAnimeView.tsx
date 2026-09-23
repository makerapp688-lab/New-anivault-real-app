import React, { useState, useMemo } from 'react';
import {
  Scale,
  ArrowLeftRight,
  Search,
  X,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Tv,
  Film,
  Calendar,
  Layers,
  Clock,
  RotateCcw,
  Check,
  ArrowRight,
  ChevronRight,
  Info,
  HelpCircle
} from 'lucide-react';
import { Anime } from '../types.ts';
import { AnimeArtwork } from './AnimeArtwork.tsx';
import { calculateTotalEpisodes, resolveWatchUrl } from '../utils/provider.ts';

interface CompareAnimeViewProps {
  allAnime: Anime[];
  initialAnimeId1?: string;
  initialAnimeId2?: string;
  onOpenDetails: (anime: Anime) => void;
}

export const CompareAnimeView: React.FC<CompareAnimeViewProps> = ({
  allAnime,
  initialAnimeId1,
  initialAnimeId2,
  onOpenDetails
}) => {
  // Selected Anime for Slot 1 and Slot 2
  const [anime1, setAnime1] = useState<Anime | null>(() => {
    if (initialAnimeId1) {
      return allAnime.find(a => a.id === initialAnimeId1) || null;
    }
    return null;
  });

  const [anime2, setAnime2] = useState<Anime | null>(() => {
    if (initialAnimeId2) {
      return allAnime.find(a => a.id === initialAnimeId2) || null;
    }
    return null;
  });

  // Explicit comparison trigger state: User MUST press "START COMPARING" button to start comparison
  const [isComparing, setIsComparing] = useState<boolean>(false);

  // Selector modal state (1 = slot 1, 2 = slot 2, null = closed)
  const [activeSelectingSlot, setActiveSelectingSlot] = useState<1 | 2 | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'All' | 'TV' | 'Movie'>('All');

  // Swap Anime 1 and Anime 2
  const handleSwap = () => {
    const temp = anime1;
    setAnime1(anime2);
    setAnime2(temp);
  };

  // Clear selections & return to selector
  const handleReset = () => {
    setAnime1(null);
    setAnime2(null);
    setIsComparing(false);
  };

  // Filter catalogue for search and selection
  const searchResults = useMemo(() => {
    return allAnime.filter(a => {
      if (selectedTypeFilter !== 'All' && a.type !== selectedTypeFilter) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = a.title?.toLowerCase().includes(q);
      const matchAlt = a.alternateTitle?.toLowerCase().includes(q);
      const matchGenres = Array.isArray(a.genres) && a.genres.some(g => g.toLowerCase().includes(q));
      return matchTitle || matchAlt || matchGenres;
    });
  }, [allAnime, searchQuery, selectedTypeFilter]);

  const handleSelectAnime = (selected: Anime) => {
    if (activeSelectingSlot === 1) {
      setAnime1(selected);
      setActiveSelectingSlot(null);
    } else if (activeSelectingSlot === 2) {
      setAnime2(selected);
      setActiveSelectingSlot(null);
    } else {
      // Auto-assign to first empty slot
      if (!anime1) {
        setAnime1(selected);
      } else if (!anime2) {
        setAnime2(selected);
      } else {
        setAnime2(selected);
      }
    }
    // When an anime is changed, user must press START COMPARING again
    setIsComparing(false);
    setSearchQuery('');
  };

  // Shared genres computation
  const sharedGenres = useMemo(() => {
    if (!anime1 || !anime2 || !Array.isArray(anime1.genres) || !Array.isArray(anime2.genres)) {
      return new Set<string>();
    }
    const g1 = new Set(anime1.genres);
    return new Set(anime2.genres.filter(g => g1.has(g)));
  }, [anime1, anime2]);

  const bothSelected = anime1 !== null && anime2 !== null;

  // Resolve watch URLs
  const watchResolution1 = anime1 ? resolveWatchUrl(anime1) : null;
  const watchResolution2 = anime2 ? resolveWatchUrl(anime2) : null;

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6" id="compare-anime-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800 dark:border-slate-800 light:border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 shadow-sm">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white dark:text-white light:text-slate-900 tracking-tight">
              Compare Anime
            </h1>
            <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 mt-0.5">
              Select exactly two verified anime to compare factual metadata side-by-side
            </p>
          </div>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {isComparing && (
            <button
              type="button"
              id="btn-back-to-selector"
              onClick={() => setIsComparing(false)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <span>← Change Selection</span>
            </button>
          )}

          <button
            type="button"
            id="btn-swap-compare-sides"
            onClick={handleSwap}
            disabled={!anime1 && !anime2}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-800 dark:border-slate-800 light:border-slate-300 flex items-center gap-2 transition-all shadow-sm disabled:opacity-40 cursor-pointer active:scale-95"
          >
            <ArrowLeftRight className="w-4 h-4 text-rose-500" />
            <span>Swap Sides</span>
          </button>

          <button
            type="button"
            id="btn-reset-compare"
            onClick={handleReset}
            disabled={!anime1 && !anime2}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 text-slate-400 hover:text-rose-400 border border-slate-800 dark:border-slate-800 light:border-slate-300 flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          STEP 1: SELECT TWO ANIME (Artwork Cards Display)
          ========================================================================= */}
      {!isComparing ? (
        <div className="space-y-6" id="compare-selection-stage">
          {/* Two Large Artwork Selection Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Anime 1 Slot Card */}
            <div
              id="compare-card-slot-1"
              className={`relative rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                anime1
                  ? 'bg-slate-950/90 dark:bg-slate-950/90 light:bg-white border-rose-500/50 shadow-xl ring-1 ring-rose-500/20'
                  : 'bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-50 border-dashed border-slate-800 dark:border-slate-800 light:border-slate-300'
              }`}
            >
              <div className="space-y-4">
                {/* Header Tag */}
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    Slot 1 (Anime 1)
                  </span>
                  {anime1 && (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Selected ✓</span>
                    </span>
                  )}
                </div>

                {/* Artwork and Info */}
                {anime1 ? (
                  <div className="flex gap-4 items-center">
                    <div className="w-24 sm:w-28 aspect-[3/4] rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-800 shadow-md">
                      <AnimeArtwork
                        artwork={anime1.artwork}
                        title={anime1.title}
                        aspectRatio="3:4"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-black text-white dark:text-white light:text-slate-900 line-clamp-2">
                        {anime1.title}
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-1 italic">
                        {anime1.alternateTitle || 'No alternate title'}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs pt-1">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
                          {anime1.type}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
                          {anime1.releaseYear ? String(anime1.releaseYear) : 'Not available'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-rose-400 font-semibold">
                          {calculateTotalEpisodes(anime1) !== null ? `${calculateTotalEpisodes(anime1)} Eps` : 'Episodes: Not available'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                      <Scale className="w-7 h-7" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-300 dark:text-slate-300 light:text-slate-700">
                        No Anime Selected
                      </h4>
                      <p className="text-xs text-slate-500 max-w-xs mt-0.5">
                        Choose your first anime from the catalogue to compare
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 mt-4 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between gap-2">
                <button
                  type="button"
                  id="btn-search-anime-slot-1"
                  onClick={() => {
                    setActiveSelectingSlot(1);
                    setSearchQuery('');
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  <span>{anime1 ? 'Change Anime 1' : 'Search & Select Anime 1'}</span>
                </button>
                {anime1 && (
                  <button
                    type="button"
                    id="btn-remove-anime-slot-1"
                    onClick={() => setAnime1(null)}
                    className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors cursor-pointer"
                    title="Remove Anime 1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Anime 2 Slot Card */}
            <div
              id="compare-card-slot-2"
              className={`relative rounded-2xl p-5 border transition-all flex flex-col justify-between ${
                anime2
                  ? 'bg-slate-950/90 dark:bg-slate-950/90 light:bg-white border-indigo-500/50 shadow-xl ring-1 ring-indigo-500/20'
                  : 'bg-slate-950/50 dark:bg-slate-950/50 light:bg-slate-50 border-dashed border-slate-800 dark:border-slate-800 light:border-slate-300'
              }`}
            >
              <div className="space-y-4">
                {/* Header Tag */}
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    Slot 2 (Anime 2)
                  </span>
                  {anime2 && (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Selected ✓</span>
                    </span>
                  )}
                </div>

                {/* Artwork and Info */}
                {anime2 ? (
                  <div className="flex gap-4 items-center">
                    <div className="w-24 sm:w-28 aspect-[3/4] rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-slate-800 shadow-md">
                      <AnimeArtwork
                        artwork={anime2.artwork}
                        title={anime2.title}
                        aspectRatio="3:4"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <h3 className="text-base sm:text-lg font-black text-white dark:text-white light:text-slate-900 line-clamp-2">
                        {anime2.title}
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-1 italic">
                        {anime2.alternateTitle || 'No alternate title'}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs pt-1">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
                          {anime2.type}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
                          {anime2.releaseYear ? String(anime2.releaseYear) : 'Not available'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-400 font-semibold">
                          {calculateTotalEpisodes(anime2) !== null ? `${calculateTotalEpisodes(anime2)} Eps` : 'Episodes: Not available'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                      <Scale className="w-7 h-7" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-300 dark:text-slate-300 light:text-slate-700">
                        No Anime Selected
                      </h4>
                      <p className="text-xs text-slate-500 max-w-xs mt-0.5">
                        Choose your second anime from the catalogue to compare
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 mt-4 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between gap-2">
                <button
                  type="button"
                  id="btn-search-anime-slot-2"
                  onClick={() => {
                    setActiveSelectingSlot(2);
                    setSearchQuery('');
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                  <span>{anime2 ? 'Change Anime 2' : 'Search & Select Anime 2'}</span>
                </button>
                {anime2 && (
                  <button
                    type="button"
                    id="btn-remove-anime-slot-2"
                    onClick={() => setAnime2(null)}
                    className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors cursor-pointer"
                    title="Remove Anime 2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* =========================================================================
              STEP 2: START COMPARING BUTTON (Appears when both anime are selected)
              ========================================================================= */}
          <div className="pt-4 pb-2 text-center" id="compare-start-action-container">
            {bothSelected ? (
              <button
                type="button"
                id="btn-start-comparing"
                onClick={() => setIsComparing(true)}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-wider bg-gradient-to-r from-rose-600 via-rose-500 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white shadow-xl shadow-rose-600/30 flex items-center justify-center gap-3 mx-auto transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <Scale className="w-5 h-5" />
                <span>START COMPARING</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 max-w-md mx-auto text-xs text-slate-400 flex items-center justify-center gap-2">
                <Info className="w-4 h-4 text-rose-500 shrink-0" />
                <span>
                  {!anime1 && !anime2
                    ? 'Please select both Anime 1 and Anime 2 above to begin comparing.'
                    : !anime1
                    ? 'Please select Anime 1 to enable side-by-side comparison.'
                    : 'Please select Anime 2 to enable side-by-side comparison.'}
                </span>
              </div>
            )}
          </div>

          {/* Quick Pick Catalogue Grid */}
          <div className="pt-6 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-rose-500" />
                <span>Quick Pick from Catalogue</span>
              </h3>
              <span className="text-xs text-slate-500">
                Click any title to fill {!anime1 ? 'Slot 1' : 'Slot 2'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {allAnime.slice(0, 6).map(a => (
                <div
                  key={a.id}
                  onClick={() => handleSelectAnime(a)}
                  className="group cursor-pointer p-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-rose-500/60 transition-all text-xs"
                >
                  <div className="aspect-[3/4] rounded-lg overflow-hidden bg-slate-900 mb-2">
                    <AnimeArtwork
                      artwork={a.artwork}
                      title={a.title}
                      aspectRatio="3:4"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <div className="font-bold text-white dark:text-white light:text-slate-900 truncate">
                    {a.title}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {a.type} • {a.releaseYear || 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* =========================================================================
            STEP 3: LINE-BY-LINE 50/50 COMPARISON (Clean Side-by-Side Structure)
            ========================================================================= */
        anime1 && anime2 && (
          <div className="space-y-6" id="comparison-display-view">
            {/* 50/50 Comparison Container */}
            <div className="rounded-2xl border border-slate-800 dark:border-slate-800 light:border-slate-200 bg-slate-950/90 dark:bg-slate-950/90 light:bg-white shadow-2xl overflow-hidden divide-y divide-slate-800/80 dark:divide-slate-800/80 light:divide-slate-200">
              
              {/* Row 1: Headers & Artwork (50% Anime 1 | 50% Anime 2) */}
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200">
                {/* Anime 1 Header */}
                <div className="p-5 space-y-3 bg-gradient-to-b from-rose-950/20 to-transparent">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                      Anime 1
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDetails(anime1)}
                      className="text-xs font-bold text-rose-400 hover:text-rose-300 underline cursor-pointer"
                    >
                      View Full Details →
                    </button>
                  </div>

                  <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-900 border border-slate-800 shadow-md">
                    <AnimeArtwork
                      artwork={anime1.artwork}
                      title={anime1.title}
                      aspectRatio="16:9"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-white dark:text-white light:text-slate-900 tracking-tight">
                      {anime1.title}
                    </h2>
                    <p className="text-xs text-slate-400 italic mt-0.5">
                      {anime1.alternateTitle || 'Not available'}
                    </p>
                  </div>
                </div>

                {/* Anime 2 Header */}
                <div className="p-5 space-y-3 bg-gradient-to-b from-indigo-950/20 to-transparent">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                      Anime 2
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenDetails(anime2)}
                      className="text-xs font-bold text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                    >
                      View Full Details →
                    </button>
                  </div>

                  <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-900 border border-slate-800 shadow-md">
                    <AnimeArtwork
                      artwork={anime2.artwork}
                      title={anime2.title}
                      aspectRatio="16:9"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-white dark:text-white light:text-slate-900 tracking-tight">
                      {anime2.title}
                    </h2>
                    <p className="text-xs text-slate-400 italic mt-0.5">
                      {anime2.alternateTitle || 'Not available'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Row 2: Type / Format */}
              <div className="p-4 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Format / Type
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-1 px-4 font-bold text-white dark:text-white light:text-slate-900 flex items-center justify-center gap-1.5">
                    {anime1.type === 'Movie' ? <Film className="w-3.5 h-3.5 text-amber-400" /> : <Tv className="w-3.5 h-3.5 text-cyan-400" />}
                    <span>{anime1.type || 'Not available'}</span>
                  </div>
                  <div className="py-1 px-4 font-bold text-white dark:text-white light:text-slate-900 flex items-center justify-center gap-1.5">
                    {anime2.type === 'Movie' ? <Film className="w-3.5 h-3.5 text-amber-400" /> : <Tv className="w-3.5 h-3.5 text-cyan-400" />}
                    <span>{anime2.type || 'Not available'}</span>
                  </div>
                </div>
              </div>

              {/* Row 3: Release Year */}
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Release Year
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-1 px-4 font-bold text-white dark:text-white light:text-slate-900">
                    {anime1.releaseYear ? String(anime1.releaseYear) : 'Not available'}
                  </div>
                  <div className="py-1 px-4 font-bold text-white dark:text-white light:text-slate-900">
                    {anime2.releaseYear ? String(anime2.releaseYear) : 'Not available'}
                  </div>
                </div>
              </div>

              {/* Row 4: Status (Completed / Ongoing) */}
              <div className="p-4 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Status
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-1 px-4 flex items-center justify-center">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-bold text-xs ${
                        anime1.status === 'Completed'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : anime1.status === 'Ongoing'
                          ? 'bg-blue-950 text-blue-300 border border-blue-700/60'
                          : 'bg-slate-900 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {anime1.status || 'Not available'}
                    </span>
                  </div>
                  <div className="py-1 px-4 flex items-center justify-center">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-bold text-xs ${
                        anime2.status === 'Completed'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                          : anime2.status === 'Ongoing'
                          ? 'bg-blue-950 text-blue-300 border border-blue-700/60'
                          : 'bg-slate-900 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {anime2.status || 'Not available'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 5: Total Episodes */}
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Total Episodes
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-1 px-4 font-black text-rose-400 text-sm">
                    {calculateTotalEpisodes(anime1) !== null ? String(calculateTotalEpisodes(anime1)) : 'Not available'}
                  </div>
                  <div className="py-1 px-4 font-black text-indigo-400 text-sm">
                    {calculateTotalEpisodes(anime2) !== null ? String(calculateTotalEpisodes(anime2)) : 'Not available'}
                  </div>
                </div>
              </div>

              {/* Row 6: Seasons & Season Breakdown */}
              <div className="p-4 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Seasons &amp; Episode Breakdown
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-xs">
                  {/* Left Anime Seasons */}
                  <div className="py-2 px-4 space-y-1.5">
                    <div className="font-bold text-white dark:text-white light:text-slate-900 mb-1">
                      {anime1.seasons?.length ? `${anime1.seasons.length} Season(s)` : anime1.type === 'Movie' ? 'Feature Film (1 Season)' : 'Not available'}
                    </div>
                    {Array.isArray(anime1.seasons) && anime1.seasons.length > 0 ? (
                      anime1.seasons.map(s => (
                        <div
                          key={s.seasonNumber}
                          className="p-1.5 rounded bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 flex items-center justify-between text-[11px]"
                        >
                          <span className="truncate">{s.title || `Season ${s.seasonNumber}`}</span>
                          <span className="font-bold text-rose-400 ml-1 shrink-0">{s.episodeCount || 0} eps</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-400 text-[11px]">Season breakdown not available</div>
                    )}
                  </div>

                  {/* Right Anime Seasons */}
                  <div className="py-2 px-4 space-y-1.5">
                    <div className="font-bold text-white dark:text-white light:text-slate-900 mb-1">
                      {anime2.seasons?.length ? `${anime2.seasons.length} Season(s)` : anime2.type === 'Movie' ? 'Feature Film (1 Season)' : 'Not available'}
                    </div>
                    {Array.isArray(anime2.seasons) && anime2.seasons.length > 0 ? (
                      anime2.seasons.map(s => (
                        <div
                          key={s.seasonNumber}
                          className="p-1.5 rounded bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 flex items-center justify-between text-[11px]"
                        >
                          <span className="truncate">{s.title || `Season ${s.seasonNumber}`}</span>
                          <span className="font-bold text-indigo-400 ml-1 shrink-0">{s.episodeCount || 0} eps</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-400 text-[11px]">Season breakdown not available</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 7: Genres */}
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Genres
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-xs">
                  <div className="py-2 px-4 flex flex-wrap gap-1.5 justify-center">
                    {Array.isArray(anime1.genres) && anime1.genres.length > 0 ? (
                      anime1.genres.map(g => {
                        const isShared = sharedGenres.has(g);
                        return (
                          <span
                            key={g}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              isShared
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                : 'bg-slate-900 text-slate-300 border border-slate-800'
                            }`}
                          >
                            {g} {isShared && '★'}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-slate-500">Not available</span>
                    )}
                  </div>

                  <div className="py-2 px-4 flex flex-wrap gap-1.5 justify-center">
                    {Array.isArray(anime2.genres) && anime2.genres.length > 0 ? (
                      anime2.genres.map(g => {
                        const isShared = sharedGenres.has(g);
                        return (
                          <span
                            key={g}
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              isShared
                                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                                : 'bg-slate-900 text-slate-300 border border-slate-800'
                            }`}
                          >
                            {g} {isShared && '★'}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-slate-500">Not available</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 8: Runtime */}
              <div className="p-4 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Runtime / Duration
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-1 px-4 font-medium text-slate-300 dark:text-slate-300 light:text-slate-700">
                    {anime1.runtime || (anime1.type === 'Movie' ? 'Feature Film' : '24 min / episode')}
                  </div>
                  <div className="py-1 px-4 font-medium text-slate-300 dark:text-slate-300 light:text-slate-700">
                    {anime2.runtime || (anime2.type === 'Movie' ? 'Feature Film' : '24 min / episode')}
                  </div>
                </div>
              </div>

              {/* Row 9: Synopsis */}
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Synopsis
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-xs">
                  <div className="py-2 px-4 text-slate-300 dark:text-slate-300 light:text-slate-700 leading-relaxed line-clamp-6">
                    {anime1.synopsis || 'Not available'}
                  </div>
                  <div className="py-2 px-4 text-slate-300 dark:text-slate-300 light:text-slate-700 leading-relaxed line-clamp-6">
                    {anime2.synopsis || 'Not available'}
                  </div>
                </div>
              </div>

              {/* Row 10: Verified Streaming Link */}
              <div className="p-4 bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 text-center mb-2">
                  Verified Streaming Destination
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800 dark:divide-slate-800 light:divide-slate-200 text-center text-xs">
                  <div className="py-2 px-4 flex items-center justify-center">
                    {watchResolution1?.isAvailable && watchResolution1.url ? (
                      <a
                        href={watchResolution1.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Stream on RareAnimes</span>
                        <ExternalLink className="w-3 h-3 text-emerald-400" />
                      </a>
                    ) : (
                      <span className="text-slate-500 font-medium">Stream: Not available</span>
                    )}
                  </div>

                  <div className="py-2 px-4 flex items-center justify-center">
                    {watchResolution2?.isAvailable && watchResolution2.url ? (
                      <a
                        href={watchResolution2.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Stream on RareAnimes</span>
                        <ExternalLink className="w-3 h-3 text-emerald-400" />
                      </a>
                    ) : (
                      <span className="text-slate-500 font-medium">Stream: Not available</span>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Change Selection Call-To-Action */}
            <div className="pt-4 text-center">
              <button
                type="button"
                id="btn-return-to-selector-bottom"
                onClick={() => setIsComparing(false)}
                className="px-6 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
              >
                ← Back to Selection / Compare Different Anime
              </button>
            </div>
          </div>
        )
      )}

      {/* =========================================================================
          VISUAL SEARCH & SELECTION MODAL (Artwork Cards with Search & Filters)
          ========================================================================= */}
      {activeSelectingSlot !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm"
          onClick={() => setActiveSelectingSlot(null)}
          id="compare-selection-modal-overlay"
        >
          <div
            className="relative w-full max-w-4xl bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
            onClick={e => e.stopPropagation()}
            id="compare-selection-modal"
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-b border-slate-800 dark:border-slate-800 light:border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-black text-white dark:text-white light:text-slate-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                  <span>Select Anime for Slot {activeSelectingSlot}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Browse or search verified anime cards from the AniVault catalogue
                </p>
              </div>
              <button
                type="button"
                id="btn-close-selector-modal"
                onClick={() => setActiveSelectingSlot(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Clear Search & Filter Bar */}
            <div className="p-4 border-b border-slate-800 dark:border-slate-800 light:border-slate-200 flex flex-col sm:flex-row gap-3 items-center bg-slate-900/50">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  type="text"
                  id="compare-search-input"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by anime title, Hindi dub, English dub, or genre..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 dark:bg-slate-950 light:bg-slate-100 border border-slate-700 dark:border-slate-700 light:border-slate-300 text-base sm:text-sm text-white dark:text-white light:text-slate-900 focus:outline-none focus:border-rose-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Format Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-950 dark:bg-slate-950 light:bg-slate-100 p-1 rounded-xl border border-slate-800 self-start sm:self-auto shrink-0">
                {(['All', 'TV', 'Movie'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSelectedTypeFilter(f)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      selectedTypeFilter === f
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Anime Card Grid with Artwork */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              {searchResults.length === 0 ? (
                <div className="py-12 text-center text-slate-400 space-y-2">
                  <Search className="w-8 h-8 mx-auto text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">No matching anime found</p>
                  <p className="text-xs text-slate-500">Try searching for a different keyword or resetting your filter.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                  {searchResults.map(a => {
                    const isSelectedOther =
                      (activeSelectingSlot === 1 && anime2?.id === a.id) ||
                      (activeSelectingSlot === 2 && anime1?.id === a.id);
                    const isCurrentSelection =
                      (activeSelectingSlot === 1 && anime1?.id === a.id) ||
                      (activeSelectingSlot === 2 && anime2?.id === a.id);

                    return (
                      <div
                        key={a.id}
                        id={`compare-option-${a.id}`}
                        onClick={() => handleSelectAnime(a)}
                        className={`group cursor-pointer relative rounded-xl overflow-hidden bg-slate-950 border transition-all duration-200 flex flex-col p-2 ${
                          isCurrentSelection
                            ? 'border-rose-500 ring-2 ring-rose-500/40'
                            : isSelectedOther
                            ? 'border-indigo-500/60 opacity-80'
                            : 'border-slate-800/90 hover:border-rose-500/60 hover:shadow-lg'
                        }`}
                      >
                        {/* Artwork Thumbnail */}
                        <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden mb-2 bg-slate-900">
                          <AnimeArtwork
                            artwork={a.artwork}
                            title={a.title}
                            aspectRatio="3:4"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-950/85 text-slate-200 border border-slate-700/50">
                            {a.type}
                          </div>
                          {isSelectedOther && (
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-black bg-indigo-900/90 text-indigo-300 border border-indigo-600/50">
                              Slot {activeSelectingSlot === 1 ? '2' : '1'}
                            </div>
                          )}
                          {isCurrentSelection && (
                            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-600 text-white">
                              Selected ✓
                            </div>
                          )}
                        </div>

                        {/* Card Info */}
                        <div className="flex-1 flex flex-col justify-between">
                          <h4 className="text-xs font-bold text-white dark:text-white light:text-slate-900 line-clamp-1 group-hover:text-rose-400 transition-colors">
                            {a.title}
                          </h4>
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                            <span>{a.releaseYear ? String(a.releaseYear) : 'Not available'}</span>
                            <span className="font-semibold text-rose-400">
                              {a.seasons?.length ? `${a.seasons.length} Seas` : a.type === 'Movie' ? 'Movie' : '1 Seas'}
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
        </div>
      )}
    </div>
  );
};
