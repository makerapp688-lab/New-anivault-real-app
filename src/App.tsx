import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Dice5,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Film,
  Tv,
  CheckCircle2,
  Clock,
  Heart,
  Bookmark,
  Check,
  Layers,
  ArrowRight,
  X,
  Bug
} from 'lucide-react';
import { Anime, CatalogueStats } from './types.ts';
import { Navbar, NavTabType } from './components/Navbar.tsx';
import { CategoryFilter } from './components/CategoryFilter.tsx';
import { AnimeCard } from './components/AnimeCard.tsx';
import { AnimeDetailsModal } from './components/AnimeDetailsModal.tsx';
import { StatsModal } from './components/StatsModal.tsx';
import { MobileBottomNav } from './components/MobileBottomNav.tsx';
import { SurpriseMeModal } from './components/SurpriseMeModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { BugReportModal } from './components/BugReportModal.tsx';
import { AnimeArtwork } from './components/AnimeArtwork.tsx';
import { CompareAnimeView } from './components/CompareAnimeView.tsx';
import { AccountView } from './components/AccountView.tsx';
import { AniVaultLogo } from './components/AniVaultLogo.tsx';
import {
  RARETOON_BASE_URL,
  RARETOON_PROVIDER_NAME,
  calculateTotalEpisodes,
  resolveWatchUrl
} from './utils/provider.ts';
import { useUserData } from './hooks/useUserData.ts';
import { applyThemeClass, syncWithServerSession } from './utils/userStorage.ts';

// Static fallback bundle
import fallbackCatalogue from './data/anivault-catalogue.json';
import fallbackReport from './data/sync-report.json';

export function App() {
  const [allAnime, setAllAnime] = useState<Anime[]>(fallbackCatalogue as Anime[]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('All');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedAudioFilter, setSelectedAudioFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'popular' | 'title' | 'year' | 'seasons'>('popular');
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [isFromSurprise, setIsFromSurprise] = useState<boolean>(false);

  // Modals & Navigation
  const [isStatsOpen, setIsStatsOpen] = useState<boolean>(false);
  const [isSurpriseOpen, setIsSurpriseOpen] = useState<boolean>(false);
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [isGlobalBugReportOpen, setIsGlobalBugReportOpen] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<NavTabType>('browse');
  const [myListSubTab, setMyListSubTab] = useState<'favorites' | 'watchlist'>('favorites');

  const [stats, setStats] = useState<CatalogueStats | null>((fallbackReport as unknown) as CatalogueStats);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 24;

  const categoriesSectionRef = useRef<HTMLDivElement>(null);

  const {
    account,
    userData,
    isGuest,
    authStatus,
    isFavorite,
    isWatchlist,
    isCompleted,
    addToHistory,
    clearHistory
  } = useUserData();

  const isSessionChecking = authStatus === 'AUTH_LOADING';

  // Apply theme on initial load
  useEffect(() => {
    applyThemeClass(userData.theme);
  }, [userData.theme]);

  // Restore and synchronize authenticated session with server on startup
  useEffect(() => {
    syncWithServerSession();
  }, []);

  // Fetch from backend API
  const fetchCatalogue = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/anime?limit=300');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.anime) && data.anime.length > 0) {
          setAllAnime(data.anime);
        }
      }
      const statsRes = await fetch('/api/stats');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.stats) {
          setStats(statsData.stats);
        }
      }
    } catch (err) {
      console.warn('API fetch warning, using pre-bundled catalogue data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalogue();
  }, []);

  // Compute genre list with accurate counts
  const genresWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of allAnime) {
      if (Array.isArray(a.genres)) {
        for (const g of a.genres) {
          counts[g] = (counts[g] || 0) + 1;
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({ genre, count }));
  }, [allAnime]);

  // Filter and sort anime based on active tab and search/filter states
  const filteredAnime = useMemo(() => {
    let result = [...allAnime];

    // Filter by tab
    if (activeTab === 'mylist') {
      const targetIds = myListSubTab === 'favorites' ? userData.favorites : userData.watchlist;
      result = result.filter(item => targetIds.includes(item.id));
    } else if (activeTab === 'watchlist') {
      result = result.filter(item => userData.watchlist.includes(item.id));
    } else if (activeTab === 'favorites') {
      result = result.filter(item => userData.favorites.includes(item.id));
    } else if (activeTab === 'completed') {
      result = result.filter(item => userData.completed.includes(item.id));
    }

    // Search filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(item => {
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchAlt = item.alternateTitle?.toLowerCase().includes(q);
        const matchDesc = item.synopsis?.toLowerCase().includes(q);
        const matchGenres = item.genres?.some(g => g.toLowerCase().includes(q));
        const matchDub = item.providers?.raretoonIndia?.dubLanguage?.toLowerCase().includes(q);
        const matchProviderId = item.providers?.raretoonIndia?.providerAnimeId?.toLowerCase().includes(q);
        return matchTitle || matchAlt || matchDesc || matchGenres || matchDub || matchProviderId;
      });
    }

    // Genre filter
    if (selectedGenre !== 'All') {
      result = result.filter(item =>
        item.genres?.some(g => g.toLowerCase() === selectedGenre.toLowerCase())
      );
    }

    // Type filter (TV / Movie)
    if (selectedType !== 'All') {
      result = result.filter(item => item.type === selectedType);
    }

    // Audio filter
    if (selectedAudioFilter === 'hindi') {
      result = result.filter(item => {
        const dub = (item.providers?.raretoonIndia?.dubLanguage || '').toLowerCase();
        return dub.includes('hindi') || dub.includes('dual') || dub.includes('multi');
      });
    } else if (selectedAudioFilter === 'dual') {
      result = result.filter(item => {
        const dub = (item.providers?.raretoonIndia?.dubLanguage || '').toLowerCase();
        return dub.includes('dual') || (dub.includes('hindi') && dub.includes('english'));
      });
    }

    // Status filter
    if (selectedStatusFilter !== 'all') {
      result = result.filter(item => item.status === selectedStatusFilter);
    }

    // Sorting
    if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'year') {
      result.sort((a, b) => (b.releaseYear || 0) - (a.releaseYear || 0));
    } else if (sortBy === 'seasons') {
      result.sort((a, b) => (b.seasons?.length || 0) - (a.seasons?.length || 0));
    } else {
      // Default 'popular': multi-season titles first, then by title
      result.sort((a, b) => {
        const aSeasons = a.seasons?.length || 0;
        const bSeasons = b.seasons?.length || 0;
        if (bSeasons !== aSeasons) return bSeasons - aSeasons;
        return a.title.localeCompare(b.title);
      });
    }

    return result;
  }, [
    allAnime,
    activeTab,
    userData.watchlist,
    userData.favorites,
    userData.completed,
    searchQuery,
    selectedGenre,
    selectedType,
    selectedAudioFilter,
    selectedStatusFilter,
    sortBy
  ]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    activeTab,
    searchQuery,
    selectedGenre,
    selectedType,
    selectedAudioFilter,
    selectedStatusFilter,
    sortBy
  ]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredAnime.length / ITEMS_PER_PAGE));
  const paginatedAnime = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAnime.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAnime, currentPage]);

  const handleSelectAnime = (anime: Anime) => {
    setIsFromSurprise(false);
    setSelectedAnime(anime);
    addToHistory(anime.id);
  };

  const handleSurpriseSelectAnime = (anime: Anime) => {
    setIsFromSurprise(true);
    setSelectedAnime(anime);
    addToHistory(anime.id);
  };

  const handleSurpriseRollAgain = () => {
    if (allAnime.length > 0) {
      const randomIndex = Math.floor(Math.random() * allAnime.length);
      const randomItem = allAnime[randomIndex];
      setSelectedAnime(randomItem);
      addToHistory(randomItem.id);
    }
  };

  const handleTriggerSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (res.ok) {
        const interval = setInterval(async () => {
          try {
            const statusRes = await fetch('/api/sync-status');
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              if (!statusData.isSyncing) {
                clearInterval(interval);
                setIsSyncing(false);
                fetchCatalogue();
              }
            }
          } catch {
            clearInterval(interval);
            setIsSyncing(false);
          }
        }, 2000);
      } else {
        setIsSyncing(false);
      }
    } catch {
      setIsSyncing(false);
    }
  };

  // Instant scroll jump to position 0 without visible scrolling animation
  const jumpToTopInstant = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // Recently viewed history list
  const recentHistoryAnime = useMemo(() => {
    const list: Anime[] = [];
    for (const h of userData.history) {
      const found = allAnime.find(a => a.id === h.animeId);
      if (found && !list.some(x => x.id === found.id)) {
        list.push(found);
      }
      if (list.length >= 8) break;
    }
    return list;
  }, [allAnime, userData.history]);

  if (isSessionChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-6 text-slate-100 antialiased select-none">
        <div className="relative flex flex-col items-center">
          {/* Pulsing beautiful logo container */}
          <div className="w-20 h-20 rounded-2xl bg-rose-600 flex items-center justify-center font-black text-white text-3xl shadow-xl shadow-rose-600/30 animate-pulse">
            AV
          </div>
          <div className="mt-8 flex flex-col items-center space-y-2">
            <h2 className="text-lg font-bold tracking-wider text-slate-200">Restoring Session...</h2>
            <p className="text-xs text-slate-400">Verifying secure credentials with AniVault</p>
          </div>
          {/* Spinner track */}
          <div className="mt-6 w-32 h-1 bg-slate-900 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full w-12 bg-rose-500 rounded-full animate-[loading_1.5s_infinite_ease-in-out]"></div>
          </div>
        </div>
        <style>{`
          @keyframes loading {
            0% { transform: translate3d(-100%, 0, 0); }
            100% { transform: translate3d(300%, 0, 0); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 dark:bg-slate-950 light:bg-slate-50 text-slate-100 dark:text-slate-100 light:text-slate-900 flex flex-col antialiased selection:bg-rose-600 selection:text-white pb-20 md:pb-0 transition-colors">
      {/* Navigation Bar */}
      <Navbar
        onOpenStats={() => setIsStatsOpen(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Page Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-6">
        {/* Only show Hero & Featured Banner when in default Browse tab without a query */}
        {activeTab === 'browse' && !searchQuery && selectedGenre === 'All' && selectedType === 'All' && selectedAudioFilter === 'all' && selectedStatusFilter === 'all' && (
          <div className="space-y-4">
            {/* Subtle Home Screen Bug Report Notice */}
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-100/80 border border-slate-800/60 dark:border-slate-800/60 light:border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setIsGlobalBugReportOpen(true)}
                className="text-slate-400 hover:text-slate-200 dark:hover:text-slate-200 light:hover:text-slate-900 transition-colors cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium"
              >
                <Bug className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>Please report any bug in Settings if you find one.</span>
              </button>
            </div>

            {/* Hero Welcome Bar (Matching Screenshot 1 & 2) */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-rose-950/40 to-slate-900 dark:from-slate-900 dark:via-rose-950/40 dark:to-slate-900 light:from-white light:via-rose-50 light:to-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 p-5 md:p-6 shadow-xl">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active Provider: RareToon India ({RARETOON_PROVIDER_NAME})
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 font-mono">
                      {allAnime.length} Verified Anime Titles
                    </span>
                  </div>
                  <h1 className="text-xl md:text-2xl font-black text-white dark:text-white light:text-slate-900 tracking-tight">
                    Welcome, {account.username || (isGuest ? 'AnimeExplorer' : account.name || 'AnimeExplorer')}!
                  </h1>
                  <p className="text-xs md:text-sm text-slate-300 dark:text-slate-300 light:text-slate-600 max-w-2xl leading-relaxed">
                    Discover authentic Hindi Dubbed and Dual Audio anime. Pressing{' '}
                    <strong className="text-rose-400 font-semibold">“OPEN THIS ANIME TO WATCH”</strong>{' '}
                    takes you directly to the exact corresponding anime page on the new RareToon India website.
                  </p>
                </div>

                {/* Right Hero Action Buttons */}
                <div className="flex items-center gap-2.5 self-stretch md:self-auto shrink-0 flex-wrap">
                  <button
                    type="button"
                    id="btn-hero-surprise-me"
                    onClick={() => setIsSurpriseOpen(true)}
                    className="flex-1 md:flex-none px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 transition-all transform active:scale-95"
                  >
                    <Dice5 className="w-4 h-4" />
                    <span>Surprise Me</span>
                  </button>

                  <a
                    href={RARETOON_BASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    id="btn-hero-provider-site"
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-700 dark:border-slate-700 light:border-slate-300 flex items-center gap-1.5 transition-colors"
                  >
                    <span>RareAnimes</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </a>
                </div>
              </div>
            </div>

            {/* "Continue Exploring" / Recently Viewed Row */}
            {recentHistoryAnime.length > 0 && (
              <div className="space-y-2.5 p-4 rounded-2xl bg-slate-900/60 dark:bg-slate-900/60 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300 dark:text-slate-300 light:text-slate-700">
                      Continue Exploring
                    </span>
                  </div>
                  <button
                    type="button"
                    id="btn-clear-history"
                    onClick={clearHistory}
                    className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Clear History
                  </button>
                </div>

                <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin">
                  {recentHistoryAnime.map(anime => (
                    <div
                      key={anime.id}
                      id={`history-item-${anime.id}`}
                      onClick={() => handleSelectAnime(anime)}
                      className="shrink-0 w-28 group cursor-pointer space-y-1"
                    >
                      <div className="w-28 aspect-[3/4] rounded-lg overflow-hidden border border-slate-800 dark:border-slate-800 light:border-slate-300 group-hover:border-rose-500 transition-all shadow-sm">
                        <AnimeArtwork
                          src={anime.artwork?.verifiedArtworkUrl}
                          alt={anime.title}
                          aspectRatio="aspect-[3/4]"
                          className="group-hover:scale-105 transition-transform"
                        />
                      </div>
                      <p className="text-[11px] font-semibold text-slate-200 dark:text-slate-200 light:text-slate-800 truncate group-hover:text-rose-400">
                        {anime.title}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dedicated View Header for My List (Favorites & Watch Later) or Watched Tabs */}
        {activeTab !== 'browse' && activeTab !== 'compare' && activeTab !== 'account' && (
          <div className="p-5 sm:p-6 rounded-2xl bg-slate-900/80 dark:bg-slate-900/80 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 space-y-4">
            {activeTab === 'mylist' || activeTab === 'watchlist' || activeTab === 'favorites' ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-black text-white dark:text-white light:text-slate-900 tracking-tight flex items-center gap-2.5">
                      <Bookmark className="w-6 h-6 text-rose-500 fill-rose-500/20" />
                      <span>My List</span>
                    </h1>
                    <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 mt-1">
                      Your personal anime library saved securely on your device and account.
                    </p>
                  </div>

                  <button
                    type="button"
                    id="btn-return-browse"
                    onClick={() => setActiveTab('browse')}
                    className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors self-start sm:self-auto"
                  >
                    ← Return to Browse
                  </button>
                </div>

                {/* Clearly Separated Subsections / Tabs */}
                <div className="flex items-center gap-2 p-1.5 bg-slate-950/80 dark:bg-slate-950/80 light:bg-slate-100 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-300 max-w-md" id="mylist-subtabs-container">
                  <button
                    type="button"
                    id="subtab-favorites"
                    onClick={() => {
                      setActiveTab('mylist');
                      setMyListSubTab('favorites');
                      setCurrentPage(1);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      (activeTab === 'mylist' && myListSubTab === 'favorites') || activeTab === 'favorites'
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-950/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900 dark:hover:bg-slate-900 light:hover:bg-slate-200'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${(activeTab === 'mylist' && myListSubTab === 'favorites') || activeTab === 'favorites' ? 'fill-white' : 'text-rose-400'}`} />
                    <span>❤️ Favorites</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      (activeTab === 'mylist' && myListSubTab === 'favorites') || activeTab === 'favorites' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {userData.favorites.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    id="subtab-watchlist"
                    onClick={() => {
                      setActiveTab('mylist');
                      setMyListSubTab('watchlist');
                      setCurrentPage(1);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      (activeTab === 'mylist' && myListSubTab === 'watchlist') || activeTab === 'watchlist'
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-950/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900 dark:hover:bg-slate-900 light:hover:bg-slate-200'
                    }`}
                  >
                    <Bookmark className={`w-4 h-4 ${(activeTab === 'mylist' && myListSubTab === 'watchlist') || activeTab === 'watchlist' ? 'fill-white' : 'text-indigo-400'}`} />
                    <span>🔖 Watch Later</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      (activeTab === 'mylist' && myListSubTab === 'watchlist') || activeTab === 'watchlist' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {userData.watchlist.length}
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Check className="w-6 h-6 text-emerald-400" />
                  <div>
                    <h1 className="text-xl font-bold text-white dark:text-white light:text-slate-900">
                      Completed &amp; Watched Anime
                    </h1>
                    <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 mt-0.5">
                      All series and movies you have marked as completed.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  id="btn-return-browse-completed"
                  onClick={() => setActiveTab('browse')}
                  className="text-xs font-semibold text-rose-400 hover:underline"
                >
                  ← Return to Browse
                </button>
              </div>
            )}
          </div>
        )}

        {/* View Switcher: Compare, Account, or Catalogue View */}
        {activeTab === 'compare' ? (
          <CompareAnimeView
            allAnime={allAnime}
            onOpenDetails={handleSelectAnime}
          />
        ) : activeTab === 'account' ? (
          <AccountView onOpenAuthModal={() => setIsAuthOpen(true)} />
        ) : (
          <>
            {/* Global Instant Search Bar (Matching Screenshot 1 & 2) */}
            <div className="relative">
              <Search className="w-5 h-5 text-slate-500 absolute left-4 top-3.5 pointer-events-none" />
              <input
                type="text"
                id="global-anime-search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search anime by title, Hindi dub, English dub, or genre..."
                className="w-full pl-12 pr-10 py-3 rounded-2xl bg-slate-900/90 dark:bg-slate-900/90 light:bg-white border border-slate-800/90 dark:border-slate-800/90 light:border-slate-300 text-sm text-white dark:text-white light:text-slate-900 placeholder-slate-500 focus:outline-none focus:border-rose-500 shadow-inner transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  id="btn-clear-search-input"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-3.5 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Category & Format Filter Navigation */}
            <div ref={categoriesSectionRef}>
              <CategoryFilter
                selectedGenre={selectedGenre}
                onSelectGenre={setSelectedGenre}
                selectedType={selectedType}
                onSelectType={setSelectedType}
                selectedAudioFilter={selectedAudioFilter}
                onSelectAudioFilter={setSelectedAudioFilter}
                selectedStatusFilter={selectedStatusFilter}
                onSelectStatusFilter={setSelectedStatusFilter}
                genres={genresWithCounts}
                totalResults={filteredAnime.length}
              />
            </div>

            {/* Results Bar & Sort Order Selector */}
            <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-slate-800/60 dark:border-slate-800/60 light:border-slate-200">
              <div className="text-xs font-semibold text-slate-400">
                Showing <strong className="text-white dark:text-white light:text-slate-900">{filteredAnime.length}</strong> anime titles
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Sort:</span>
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-rose-500 font-medium cursor-pointer"
                >
                  <option value="popular">Popular (Multi-Season First)</option>
                  <option value="title">Title (A - Z)</option>
                  <option value="year">Release Year (Newest)</option>
                  <option value="seasons">Season Count</option>
                </select>
              </div>
            </div>

            {/* Anime Catalogue Grid */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 py-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-2.5 space-y-2 animate-pulse"
                  >
                    <div className="w-full aspect-[3/4] bg-slate-800 rounded-xl" />
                    <div className="h-3.5 bg-slate-800 rounded w-3/4" />
                    <div className="h-3 bg-slate-800 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : paginatedAnime.length === 0 ? (
              <div
                id="empty-catalogue-state"
                className="p-12 text-center bg-slate-900/50 dark:bg-slate-900/50 light:bg-white border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 rounded-2xl my-6 space-y-3"
              >
                <div className="w-12 h-12 rounded-full bg-slate-800 dark:bg-slate-800 light:bg-slate-100 flex items-center justify-center mx-auto text-slate-500">
                  <Search className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white dark:text-white light:text-slate-900">
                  {activeTab === 'mylist'
                    ? `No items in ${myListSubTab === 'favorites' ? 'Favorites' : 'Watch Later'}`
                    : activeTab === 'watchlist'
                    ? 'No items in Watch Later'
                    : activeTab === 'favorites'
                    ? 'No items in Favorites'
                    : activeTab === 'completed'
                    ? 'No Watched Anime'
                    : 'No Anime Found'}
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 max-w-sm mx-auto">
                  {activeTab === 'mylist'
                    ? `Add anime to your ${myListSubTab === 'favorites' ? 'Favorites' : 'Watch Later'} using the ${myListSubTab === 'favorites' ? 'heart' : 'bookmark'} button on any anime card.`
                    : activeTab === 'completed'
                    ? 'Use the checkmark button on anime cards to mark series as completed.'
                    : `No anime matches your filter criteria "${searchQuery || selectedGenre}". Try searching another title or resetting your filters.`}
                </p>
                <button
                  type="button"
                  id="btn-clear-search-empty"
                  onClick={() => {
                    setActiveTab('browse');
                    setSearchQuery('');
                    setSelectedGenre('All');
                    setSelectedType('All');
                    setSelectedAudioFilter('all');
                    setSelectedStatusFilter('all');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-500 transition-colors inline-block"
                >
                  Browse All Titles
                </button>
              </div>
            ) : (
              <div
                id="anime-catalogue-grid"
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5"
              >
                {paginatedAnime.map(anime => (
                  <AnimeCard
                    key={anime.id}
                    anime={anime}
                    onSelect={handleSelectAnime}
                  />
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between py-6 border-t border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
                <button
                  type="button"
                  id="btn-prev-page"
                  disabled={currentPage <= 1}
                  onClick={() => {
                    setCurrentPage(p => Math.max(1, p - 1));
                    jumpToTopInstant();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 dark:bg-slate-900 light:bg-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                <span className="text-xs text-slate-400">
                  Page <strong className="text-white dark:text-white light:text-slate-900">{currentPage}</strong> of{' '}
                  <strong className="text-white dark:text-white light:text-slate-900">{totalPages}</strong> ({filteredAnime.length} anime)
                </span>

                <button
                  type="button"
                  id="btn-next-page"
                  disabled={currentPage >= totalPages}
                  onClick={() => {
                    setCurrentPage(p => Math.min(totalPages, p + 1));
                    jumpToTopInstant();
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 dark:bg-slate-900 light:bg-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-800 dark:border-slate-800 light:border-slate-300 text-slate-200 dark:text-slate-200 light:text-slate-800 transition-colors cursor-pointer"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 bg-slate-950 dark:bg-slate-950 light:bg-white py-8 text-slate-400 dark:text-slate-400 light:text-slate-600 text-xs transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-rose-600 flex items-center justify-center font-black text-white text-xs">
                AV
              </div>
              <span className="font-bold text-white dark:text-white light:text-slate-900">AniVault Foundation</span>
              <span className="text-slate-500">•</span>
              <span>Anime Discovery &amp; Metadata Engine</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Provider: RareToon India ({RARETOON_PROVIDER_NAME})
              </span>
              <button
                type="button"
                onClick={() => setIsGlobalBugReportOpen(true)}
                className="text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors font-medium cursor-pointer"
              >
                <Bug className="w-3.5 h-3.5" />
                <span>Report a Bug</span>
              </button>
              <a
                href={RARETOON_BASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-slate-300 flex items-center gap-1 transition-colors font-medium"
              >
                <span>Visit Source Site</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="border-t border-slate-900 dark:border-slate-900 light:border-slate-200 pt-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
            <p>
              AniVault is a catalogue and discovery platform. We do not host or stream media files.
              All watch links connect directly to verified pages on RareToon India (<a href={RARETOON_BASE_URL} className="text-rose-400 hover:underline">{RARETOON_BASE_URL}</a>).
            </p>
            <p>Guest Mode &amp; Account Architecture</p>
          </div>
        </div>
      </footer>

      {/* Global Bug Report Modal */}
      <BugReportModal
        isOpen={isGlobalBugReportOpen}
        onClose={() => setIsGlobalBugReportOpen(false)}
        activeFeature={activeTab}
      />

      {/* Anime Details Modal */}
      {selectedAnime && (
        <AnimeDetailsModal
          anime={selectedAnime}
          onClose={() => {
            setSelectedAnime(null);
            setIsFromSurprise(false);
          }}
          onRollAgain={isFromSurprise ? handleSurpriseRollAgain : undefined}
        />
      )}

      {/* Production Catalogue Report Modal */}
      {isStatsOpen && (
        <StatsModal
          isOpen={isStatsOpen}
          onClose={() => setIsStatsOpen(false)}
          stats={stats}
          totalAnime={allAnime.length}
          isSyncing={isSyncing}
          onTriggerSync={handleTriggerSync}
        />
      )}

      {/* Surprise Me / Dice Rolling Modal */}
      {isSurpriseOpen && (
        <SurpriseMeModal
          isOpen={isSurpriseOpen}
          onClose={() => setIsSurpriseOpen(false)}
          catalogue={allAnime}
          onSelectAnime={handleSurpriseSelectAnime}
        />
      )}

      {/* Account & Guest Mode Modal */}
      {isAuthOpen && (
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
        />
      )}

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={() => setIsAuthOpen(true)}
        onScrollToCategories={() => {
          if (categoriesSectionRef.current) {
            categoriesSectionRef.current.scrollIntoView({ behavior: 'smooth' });
          }
        }}
      />
    </div>
  );
}

export default App;
