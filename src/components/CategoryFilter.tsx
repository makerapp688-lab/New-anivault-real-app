import React from 'react';
import {
  Flame,
  Compass,
  Smile,
  Zap,
  Sparkles,
  Heart,
  Shield,
  Layers,
  Award,
  Globe,
  Film,
  Tv,
  CheckCircle2,
  Clock,
  Skull,
  Brain,
  Search,
  Coffee,
  Moon,
  GraduationCap
} from 'lucide-react';

interface CategoryFilterProps {
  selectedGenre: string;
  onSelectGenre: (genre: string) => void;
  genres: { genre: string; count: number }[];
  selectedType: string;
  onSelectType: (type: string) => void;
  selectedAudioFilter: string;
  onSelectAudioFilter: (audio: string) => void;
  selectedStatusFilter: string;
  onSelectStatusFilter: (status: string) => void;
  totalResults: number;
}

const GENRE_ICON_MAP: Record<string, React.ReactNode> = {
  Action: <Flame className="w-4 h-4 text-orange-400" />,
  Adventure: <Compass className="w-4 h-4 text-emerald-400" />,
  Comedy: <Smile className="w-4 h-4 text-amber-400" />,
  'Sci-Fi': <Zap className="w-4 h-4 text-cyan-400" />,
  Fantasy: <Sparkles className="w-4 h-4 text-purple-400" />,
  Isekai: <Layers className="w-4 h-4 text-rose-400" />,
  Drama: <Heart className="w-4 h-4 text-pink-400" />,
  Sports: <Award className="w-4 h-4 text-blue-400" />,
  Romance: <Heart className="w-4 h-4 text-rose-400" />,
  Horror: <Skull className="w-4 h-4 text-red-400" />,
  Psychological: <Brain className="w-4 h-4 text-violet-400" />,
  Mystery: <Search className="w-4 h-4 text-yellow-400" />,
  Supernatural: <Moon className="w-4 h-4 text-indigo-400" />,
  'Slice of Life': <Coffee className="w-4 h-4 text-emerald-400" />,
  School: <GraduationCap className="w-4 h-4 text-blue-400" />,
  Historical: <Shield className="w-4 h-4 text-amber-500" />,
  Thriller: <Skull className="w-4 h-4 text-rose-400" />
};

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  selectedGenre,
  onSelectGenre,
  genres,
  selectedType,
  onSelectType,
  selectedAudioFilter,
  onSelectAudioFilter,
  selectedStatusFilter,
  onSelectStatusFilter,
  totalResults
}) => {
  // Top 8 genres for the prominent category grid in Screenshot 1
  const top8Genres = [
    'Action',
    'Adventure',
    'Comedy',
    'Sci-Fi',
    'Fantasy',
    'Isekai',
    'Drama',
    'Sports'
  ];

  return (
    <div className="space-y-6">
      {/* 🧭 EXPLORE BY GENRE Grid (Matching Screenshot 1) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-rose-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 dark:text-slate-300 light:text-slate-700">
              EXPLORE BY GENRE
            </span>
          </div>
          <span className="text-xs text-slate-400">
            {totalResults} titles available
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {top8Genres.map(genreName => {
            const match = genres.find(g => g.genre.toLowerCase() === genreName.toLowerCase());
            const count = match ? match.count : 0;
            const isSelected = selectedGenre.toLowerCase() === genreName.toLowerCase();

            return (
              <button
                key={genreName}
                type="button"
                id={`genre-tile-${genreName.toLowerCase()}`}
                onClick={() => onSelectGenre(isSelected ? 'All' : genreName)}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-rose-950/80 dark:bg-rose-950/80 light:bg-rose-50 border-rose-500/80 text-white shadow-md'
                    : 'bg-slate-900/80 dark:bg-slate-900/80 light:bg-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-50 border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-100">
                    {GENRE_ICON_MAP[genreName] || <Sparkles className="w-4 h-4 text-rose-400" />}
                  </div>
                  <span className="text-xs font-bold tracking-tight">
                    {genreName}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-400 light:text-slate-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Discovery Filters: Horizontal Pills & Quick Filter Chips */}
      <div className="space-y-3 pt-1">
        {/* Horizontal Category Pill Scrollbar (Screenshot 1 & 2) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            id="genre-pill-all"
            onClick={() => onSelectGenre('All')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedGenre === 'All'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-slate-900/90 dark:bg-slate-900/90 light:bg-slate-100 hover:bg-slate-800 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300'
            }`}
          >
            All Titles
          </button>

          {genres.map(({ genre, count }) => {
            const isSelected = selectedGenre.toLowerCase() === genre.toLowerCase();
            return (
              <button
                key={genre}
                type="button"
                id={`genre-pill-${genre.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                onClick={() => onSelectGenre(genre)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-900/90 dark:bg-slate-900/90 light:bg-slate-100 hover:bg-slate-800 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300'
                }`}
              >
                <span>{genre}</span>
                <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Discovery Filter Chips (Audio & Status & Format) */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-400 font-semibold mr-1">Quick Filters:</span>

          {/* Hindi Dub Chip */}
          <button
            type="button"
            id="filter-chip-hindi"
            onClick={() => onSelectAudioFilter(selectedAudioFilter === 'hindi' ? 'all' : 'hindi')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              selectedAudioFilter === 'hindi'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-slate-800'
            }`}
          >
            <span>🎙️ Hindi Dub</span>
          </button>

          {/* Dual Audio Chip */}
          <button
            type="button"
            id="filter-chip-dual"
            onClick={() => onSelectAudioFilter(selectedAudioFilter === 'dual' ? 'all' : 'dual')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              selectedAudioFilter === 'dual'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-slate-800'
            }`}
          >
            <span>🎧 Dual Audio (Eng + Hindi)</span>
          </button>

          {/* Completed Status Chip */}
          <button
            type="button"
            id="filter-chip-completed"
            onClick={() => onSelectStatusFilter(selectedStatusFilter === 'Completed' ? 'all' : 'Completed')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              selectedStatusFilter === 'Completed'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Completed</span>
          </button>

          {/* Ongoing Status Chip */}
          <button
            type="button"
            id="filter-chip-ongoing"
            onClick={() => onSelectStatusFilter(selectedStatusFilter === 'Ongoing' ? 'all' : 'Ongoing')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              selectedStatusFilter === 'Ongoing'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Ongoing</span>
          </button>

          {/* Format / Type: Movies Only */}
          <button
            type="button"
            id="filter-chip-movies"
            onClick={() => onSelectType(selectedType === 'Movie' ? 'All' : 'Movie')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              selectedType === 'Movie'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 text-slate-300 dark:text-slate-300 light:text-slate-700 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:bg-slate-800'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Movies</span>
          </button>

          {/* Reset Filters if any active */}
          {(selectedGenre !== 'All' || selectedType !== 'All' || selectedAudioFilter !== 'all' || selectedStatusFilter !== 'all') && (
            <button
              type="button"
              id="btn-clear-all-filters"
              onClick={() => {
                onSelectGenre('All');
                onSelectType('All');
                onSelectAudioFilter('all');
                onSelectStatusFilter('all');
              }}
              className="px-2.5 py-1 rounded-lg text-rose-400 hover:text-rose-300 hover:underline font-semibold ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
