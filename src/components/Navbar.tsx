import React from 'react';
import {
  Database,
  ExternalLink,
  Bookmark,
  Check,
  Scale,
  User,
  Shield
} from 'lucide-react';
import { RARETOON_BASE_URL, RARETOON_PROVIDER_NAME } from '../utils/provider.ts';
import { useUserData } from '../hooks/useUserData.ts';
import { getAccountAvatar } from '../utils/userStorage.ts';
import { AniVaultLogo } from './AniVaultLogo.tsx';

export type NavTabType = 'browse' | 'mylist' | 'completed' | 'compare' | 'account' | 'watchlist' | 'favorites';

interface NavbarProps {
  onOpenStats: () => void;
  activeTab: NavTabType;
  setActiveTab: (tab: NavTabType) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenStats,
  activeTab,
  setActiveTab
}) => {
  const { account, userData, isGuest } = useUserData();

  const totalMyListCount = userData.favorites.length + userData.watchlist.length;
  const isMyListActive = activeTab === 'mylist' || activeTab === 'watchlist' || activeTab === 'favorites';

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950/95 dark:bg-slate-950/95 light:bg-white/95 backdrop-blur-md border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand / Logo */}
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          onClick={() => setActiveTab('browse')}
          id="nav-logo-group"
        >
          <AniVaultLogo size="md" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black text-white dark:text-white light:text-slate-900 tracking-tight font-display">
                Ani<span className="text-rose-500">Vault</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/40">
                CATALOGUE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 hidden sm:block -mt-0.5">
              Discovery &amp; Metadata Browser
            </p>
          </div>
        </div>

        {/* Center Navigation Tabs (Desktop) */}
        <div className="hidden md:flex items-center gap-1 bg-slate-900/80 dark:bg-slate-900/80 light:bg-slate-100 p-1 rounded-xl border border-slate-800 dark:border-slate-800 light:border-slate-300">
          <button
            type="button"
            id="nav-tab-browse"
            onClick={() => setActiveTab('browse')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'browse'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200'
            }`}
          >
            Browse All
          </button>
          
          {/* Combined My List Tab */}
          <button
            type="button"
            id="nav-tab-mylist"
            onClick={() => setActiveTab('mylist')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              isMyListActive
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>My List</span>
            {totalMyListCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                {totalMyListCount}
              </span>
            )}
          </button>

          <button
            type="button"
            id="nav-tab-completed"
            onClick={() => setActiveTab('completed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'completed'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>Watched</span>
            {userData.completed.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500 text-white font-bold">
                {userData.completed.length}
              </span>
            )}
          </button>
          <button
            type="button"
            id="nav-tab-compare"
            onClick={() => setActiveTab('compare')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'compare'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Compare Anime</span>
          </button>
          <button
            type="button"
            id="nav-tab-account"
            onClick={() => setActiveTab('account')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'account'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-300 dark:text-slate-300 light:text-slate-700 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-200'
            }`}
          >
          {(() => {
            const isOwner = account.role === 'owner';
            const isGuest = account.id === 'guest_user' || account.provider === 'guest';
            const avatarUrl = isOwner ? getAccountAvatar('usr_owner') : (!isGuest ? getAccountAvatar(account.id) : null);
            return avatarUrl ? (
              <img
                src={avatarUrl}
                alt="DP"
                className={`w-4 h-4 rounded-full object-cover ${
                  isOwner ? 'border border-amber-400' : 'border border-white/50'
                }`}
              />
            ) : isOwner ? (
              <Shield className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <User className="w-3.5 h-3.5" />
            );
          })()}
            <span>Account</span>
          </button>
        </div>

        {/* Right Tools: Cleaned up as requested in Rule 6 */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Active Provider Pill - points to new RareToon website */}
          <a
            href={RARETOON_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            id="nav-provider-pill"
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 shadow-sm transition-colors"
            title="Active Content Provider: RareToon India (Site: rareanimes.mov)"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{RARETOON_PROVIDER_NAME}</span>
            <ExternalLink className="w-3 h-3 text-emerald-400" />
          </a>

          {/* Button 4: Production Catalogue - Kept in its exact location */}
          <button
            type="button"
            id="nav-btn-stats"
            onClick={onOpenStats}
            className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 border border-slate-800 dark:border-slate-800 light:border-slate-300 flex items-center gap-2 text-xs font-semibold text-slate-200 dark:text-slate-200 light:text-slate-800 hover:text-white transition-colors shadow-sm"
            title="Open AniVault Production Catalogue Report"
          >
            <Database className="w-4 h-4 text-rose-500" />
            <span className="hidden sm:inline">Production Catalogue</span>
          </button>
        </div>
      </div>
    </header>
  );
};
