import React from 'react';
import { Home, Bookmark, Scale, User, Shield } from 'lucide-react';
import { useUserData } from '../hooks/useUserData.ts';
import { getAccountAvatar } from '../utils/userStorage.ts';
import { NavTabType } from './Navbar.tsx';

interface MobileBottomNavProps {
  activeTab: NavTabType;
  setActiveTab: (tab: NavTabType) => void;
  onOpenAuth: () => void;
  onScrollToCategories: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  setActiveTab,
  onOpenAuth,
  onScrollToCategories
}) => {
  const { userData, account, isGuest } = useUserData();
  const totalMyListCount = userData.favorites.length + userData.watchlist.length;
  const isMyListActive = activeTab === 'mylist' || activeTab === 'watchlist' || activeTab === 'favorites';

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 dark:bg-slate-950/95 light:bg-white/95 backdrop-blur-lg border-t border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 px-2 py-1.5 transition-colors safe-area-pb">
      <div className="flex items-center justify-around">
        <button
          type="button"
          id="mobile-nav-home"
          onClick={() => setActiveTab('browse')}
          className={`flex flex-col items-center justify-center p-1 rounded-xl transition-colors ${
            activeTab === 'browse'
              ? 'text-rose-500 font-bold'
              : 'text-slate-400 hover:text-slate-200 dark:text-slate-400 light:text-slate-600'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Browse</span>
        </button>

        {/* Combined My List Tab */}
        <button
          type="button"
          id="mobile-nav-mylist"
          onClick={() => setActiveTab('mylist')}
          className={`relative flex flex-col items-center justify-center p-1 rounded-xl transition-colors ${
            isMyListActive
              ? 'text-rose-500 font-bold'
              : 'text-slate-400 hover:text-slate-200 dark:text-slate-400 light:text-slate-600'
          }`}
        >
          <Bookmark className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">My List</span>
          {totalMyListCount > 0 && (
            <span className="absolute top-0 right-1 w-4 h-4 rounded-full bg-rose-600 text-[9px] font-bold text-white flex items-center justify-center">
              {totalMyListCount}
            </span>
          )}
        </button>

        <button
          type="button"
          id="mobile-nav-compare"
          onClick={() => setActiveTab('compare')}
          className={`flex flex-col items-center justify-center p-1 rounded-xl transition-colors ${
            activeTab === 'compare'
              ? 'text-rose-500 font-bold'
              : 'text-slate-400 hover:text-slate-200 dark:text-slate-400 light:text-slate-600'
          }`}
        >
          <Scale className="w-5 h-5" />
          <span className="text-[10px] mt-0.5">Compare</span>
        </button>

        <button
          type="button"
          id="mobile-nav-account"
          onClick={() => setActiveTab('account')}
          className={`flex flex-col items-center justify-center p-1 rounded-xl transition-colors ${
            activeTab === 'account'
              ? 'text-rose-500 font-bold'
              : 'text-slate-400 hover:text-slate-200 dark:text-slate-400 light:text-slate-600'
          }`}
        >
          {(() => {
            const isOwner = account.role === 'owner';
            const isGuestUser = isGuest || account.id === 'guest_user' || account.provider === 'guest';
            const avatarUrl = isOwner ? getAccountAvatar('usr_owner') : (!isGuestUser ? getAccountAvatar(account.id) : null);
            return avatarUrl ? (
              <img
                src={avatarUrl}
                alt="DP"
                className={`w-5 h-5 rounded-full object-cover ${
                  isOwner ? 'border border-amber-400 ring-1 ring-amber-500/40' : 'border border-white/50'
                }`}
              />
            ) : isOwner ? (
              <Shield className="w-5 h-5 text-amber-400" />
            ) : (
              <User className="w-5 h-5" />
            );
          })()}
          <span className="text-[10px] mt-0.5 max-w-[50px] truncate">
            {account.role === 'owner' ? 'Owner' : account.username || (isGuest ? 'Guest' : 'Account')}
          </span>
        </button>
      </div>
    </nav>
  );
};
