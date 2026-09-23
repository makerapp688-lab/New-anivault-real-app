import React from 'react';
import { Layers, Tv, Heart, Bookmark, Mic, Film } from 'lucide-react';
import { Anime } from '../types.ts';
import { AnimeArtwork } from './AnimeArtwork.tsx';
import { calculateTotalEpisodes } from '../utils/provider.ts';
import { useUserData } from '../hooks/useUserData.ts';

interface AnimeCardProps {
  anime: Anime;
  onSelect: (anime: Anime) => void;
}

export const AnimeCard: React.FC<AnimeCardProps> = ({ anime, onSelect }) => {
  const { isFavorite, isWatchlist, isCompleted, toggleFavorite, toggleWatchlist } = useUserData();

  const favorited = isFavorite(anime.id);
  const inWatchlist = isWatchlist(anime.id);
  const completed = isCompleted(anime.id);

  const totalSeasons = anime.seasons?.length || 1;
  const totalEpisodes = calculateTotalEpisodes(anime);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(anime.id);
  };

  const handleWatchlistClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleWatchlist(anime.id);
  };

  // Audio flags
  const dubString = (anime.providers?.raretoonIndia?.dubLanguage || 'Hindi Dubbed').toLowerCase();
  const hasHindi = dubString.includes('hindi') || dubString.includes('dual') || dubString.includes('multi');
  const hasEnglish = dubString.includes('english') || dubString.includes('dual');

  return (
    <div
      id={`anime-card-${anime.id}`}
      onClick={() => onSelect(anime)}
      className="group relative flex flex-col bg-slate-900/90 dark:bg-slate-900/90 light:bg-white hover:bg-slate-850 dark:hover:bg-slate-850 light:hover:bg-slate-50 border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 hover:border-rose-500/50 rounded-2xl overflow-hidden transition-all duration-200 shadow-md hover:shadow-rose-950/20 cursor-pointer"
    >
      {/* Artwork Container */}
      <div className="relative w-full aspect-[3/4] overflow-hidden bg-slate-950">
        <AnimeArtwork
          src={anime.artwork?.verifiedArtworkUrl}
          alt={anime.title}
          aspectRatio="aspect-[3/4]"
          className="group-hover:scale-105 transition-transform duration-300"
        />

        {/* Top-Left: Status Badge */}
        <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold backdrop-blur-md border shadow-sm ${
              anime.status === 'Ongoing'
                ? 'bg-amber-950/85 text-amber-300 border-amber-600/50'
                : 'bg-emerald-950/85 text-emerald-300 border-emerald-600/50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                anime.status === 'Ongoing' ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            />
            <span>{anime.status}</span>
          </span>
        </div>

        {/* Top-Right: Quick Action Icons (Watchlist & Favorite) */}
        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">
          <button
            type="button"
            id={`btn-card-watchlist-${anime.id}`}
            onClick={handleWatchlistClick}
            aria-label={inWatchlist ? 'Remove from Watch Later' : 'Add to Watch Later'}
            className={`w-7 h-7 rounded-full backdrop-blur-md border flex items-center justify-center transition-all ${
              inWatchlist
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-md scale-105'
                : 'bg-slate-950/70 text-slate-300 border-slate-700/60 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${inWatchlist ? 'fill-white' : ''}`} />
          </button>

          <button
            type="button"
            id={`btn-card-fav-${anime.id}`}
            onClick={handleFavoriteClick}
            aria-label={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
            className={`w-7 h-7 rounded-full backdrop-blur-md border flex items-center justify-center transition-all ${
              favorited
                ? 'bg-rose-600 text-white border-rose-400 shadow-md scale-105'
                : 'bg-slate-950/70 text-slate-300 border-slate-700/60 hover:bg-slate-900 hover:text-rose-400'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-white' : ''}`} />
          </button>
        </div>

        {/* Completed Indicator Badge if marked watched */}
        {completed && (
          <div className="absolute top-10 left-2.5 z-20 pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-600 text-white shadow-sm">
              ✓ Watched
            </span>
          </div>
        )}

        {/* Bottom Poster Overlay: Season and Episode counts matching screenshot */}
        <div className="absolute bottom-2.5 inset-x-2.5 z-20 flex items-center gap-1.5 flex-wrap pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-950/85 backdrop-blur-md text-white border border-slate-700/60">
            {anime.type === 'Movie' ? (
              <>
                <Film className="w-3 h-3 text-amber-400" />
                <span>Movie</span>
              </>
            ) : (
              <>
                <Layers className="w-3 h-3 text-cyan-400" />
                <span>
                  {totalSeasons} {totalSeasons === 1 ? 'Season' : 'Seasons'}
                </span>
              </>
            )}
          </span>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-950/85 backdrop-blur-md text-white border border-slate-700/60">
            <Tv className="w-3 h-3 text-rose-400" />
            <span>
              {totalEpisodes !== null ? `${totalEpisodes} Eps` : 'Not available'}
            </span>
          </span>
        </div>
      </div>

      {/* Content Section below poster */}
      <div className="p-3 flex flex-col flex-1 justify-between gap-2 text-slate-200 dark:text-slate-200 light:text-slate-800">
        <div>
          <h3 className="font-bold text-white dark:text-white light:text-slate-900 text-sm leading-snug line-clamp-1 group-hover:text-rose-400 transition-colors">
            {anime.title}
          </h3>
          {anime.alternateTitle && (
            <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 italic line-clamp-1 mt-0.5">
              {anime.alternateTitle}
            </p>
          )}
        </div>

        {/* Audio Pills matching Screenshots 4 & 5 */}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          {hasHindi && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-950/70 text-rose-300 border border-rose-800/40">
              <Mic className="w-2.5 h-2.5 text-rose-400" />
              <span>Hindi Dub</span>
            </span>
          )}
          {hasEnglish && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-950/70 text-indigo-300 border border-indigo-800/40">
              <Mic className="w-2.5 h-2.5 text-indigo-400" />
              <span>Eng Dub</span>
            </span>
          )}
          {!hasHindi && !hasEnglish && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
              <Mic className="w-2.5 h-2.5 text-slate-400" />
              <span>Subbed</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
