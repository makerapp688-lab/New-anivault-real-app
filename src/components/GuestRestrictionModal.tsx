import React from 'react';
import {
  X,
  Lock,
  UserPlus,
  LogIn,
  Heart,
  Bookmark,
  Camera,
  Scale,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { RestrictedGuestFeature } from '../utils/userStorage.ts';
import { AnivexLogo } from './AnivexLogo.tsx';

interface GuestRestrictionModalProps {
  isOpen: boolean;
  feature: RestrictedGuestFeature | null;
  onClose: () => void;
  onMakeAccount: () => void;
  onLogin: () => void;
}

const FEATURE_LABELS: Record<RestrictedGuestFeature, { label: string; icon: React.ReactNode }> = {
  favorites: {
    label: 'Add to Favorites',
    icon: <Heart className="w-4 h-4 text-rose-400" />
  },
  watchlist: {
    label: 'Add to Watch Later',
    icon: <Bookmark className="w-4 h-4 text-indigo-400" />
  },
  avatar: {
    label: 'Custom Profile Photo',
    icon: <Camera className="w-4 h-4 text-emerald-400" />
  },
  compare: {
    label: 'Compare Anime',
    icon: <Scale className="w-4 h-4 text-cyan-400" />
  },
  theme: {
    label: 'Zenime Visual Themes',
    icon: <Sparkles className="w-4 h-4 text-amber-400" />
  }
};

export const GuestRestrictionModal: React.FC<GuestRestrictionModalProps> = ({
  isOpen,
  feature,
  onClose,
  onMakeAccount,
  onLogin
}) => {
  if (!isOpen) return null;

  const currentFeature = feature ? FEATURE_LABELS[feature] : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
      id="guest-restriction-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-restriction-title"
    >
      <div
        className="relative w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5 text-slate-100"
        onClick={e => e.stopPropagation()}
        id="guest-restriction-modal"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AnivexLogo size="sm" />
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-400">
              <Lock className="w-3.5 h-3.5" />
              <span>Account Required</span>
            </div>
          </div>

          <button
            type="button"
            id="btn-close-guest-restriction"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Required Message */}
        <div className="space-y-3 text-center pt-1">
          {currentFeature && (
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
              {currentFeature.icon}
              <span>{currentFeature.label}</span>
            </div>
          )}

          <h2
            id="guest-restriction-title"
            className="text-lg sm:text-xl font-black text-white tracking-tight leading-snug"
          >
            Make an account to access these features. It's free.
          </h2>

          <p className="text-xs text-slate-400 leading-relaxed max-w-sm mx-auto">
            Create a free Zenime account in seconds to unlock Favorites, Watch Later, Compare Anime, custom profile photos, and all 8 visual themes.
          </p>
        </div>

        {/* Feature Checklist */}
        <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/90 grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Save Favorites</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Watch Later List</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Compare Anime</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>8 Visual Themes</span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            id="btn-guest-notice-make-account"
            onClick={onMakeAccount}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Make an Account</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              id="btn-guest-notice-login"
              onClick={onLogin}
              className="py-2 px-3 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-rose-400" />
              <span>Log In</span>
            </button>

            <button
              type="button"
              id="btn-guest-notice-dismiss"
              onClick={onClose}
              className="py-2 px-3 rounded-xl text-xs font-semibold bg-slate-900/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800/70 transition-colors cursor-pointer"
            >
              Continue as Guest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
