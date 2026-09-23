import React, { useState, useEffect } from 'react';
import {
  User,
  Shield,
  Moon,
  Sun,
  Monitor,
  CheckCircle2,
  Edit2,
  Check,
  Heart,
  Bookmark,
  LogOut,
  FolderSync,
  History,
  Trash2,
  Users,
  Database,
  Image as ImageIcon,
  RefreshCw,
  Settings,
  Activity,
  Lock,
  Sparkles,
  Info,
  Camera,
  UserPlus,
  LogIn,
  AlertTriangle,
  ShieldAlert,
  Bug,
  MessageSquare,
  Download
} from 'lucide-react';
import { useUserData } from '../hooks/useUserData.ts';
import {
  updateUsername,
  setThemeMode,
  logoutToGuest,
  logoutFromServer,
  clearHistory,
  setSessionAccount,
  getSavedAccounts,
  switchActiveAccount,
  getAccountAvatar
} from '../utils/userStorage.ts';
import { ThemeMode } from '../types.ts';
import { AniVaultLogo } from './AniVaultLogo.tsx';
import { OwnerLoginModal } from './OwnerLoginModal.tsx';
import { OwnerDashboardModal } from './OwnerDashboardModal.tsx';
import { AccountSwitcherModal } from './AccountSwitcherModal.tsx';
import { ProfilePhotoModal } from './ProfilePhotoModal.tsx';
import { AuthModal } from './AuthModal.tsx';
import { DeleteAccountModal } from './DeleteAccountModal.tsx';
import { BugReportModal } from './BugReportModal.tsx';
import { OwnerBugReportsModal } from './OwnerBugReportsModal.tsx';

interface AccountViewProps {
  onOpenAuthModal: () => void;
}

export const AccountView: React.FC<AccountViewProps> = ({ onOpenAuthModal }) => {
  const { account, userData, isGuest } = useUserData();
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState(account.username || 'AnimeExplorer');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Account Switcher State
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);

  // Profile Photo Modal State
  const [isProfilePhotoModalOpen, setIsProfilePhotoModalOpen] = useState(false);

  // Auth Modal State for Make New Account / Log In
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('register');
  const [authModalView, setAuthModalView] = useState<'overview' | 'email'>('overview');

  // Delete Account Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Owner System State
  const [ownerSession, setOwnerSession] = useState<{ authenticated: boolean; owner?: { email: string; username: string; role: string } } | null>(null);
  const [isOwnerLoginOpen, setIsOwnerLoginOpen] = useState(false);
  const [isOwnerDashboardOpen, setIsOwnerDashboardOpen] = useState(false);

  // Bug Report System State
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const [isOwnerBugReportsOpen, setIsOwnerBugReportsOpen] = useState(false);
  const [newBugCount, setNewBugCount] = useState<number>(0);

  const isOwner = account.role === 'owner' || account.id === 'usr_owner' || Boolean(ownerSession?.authenticated);
  const ownerUsername = account.role === 'owner' ? account.username : ownerSession?.owner?.username || 'Owner';
  const currentAvatarUrl = isOwner ? getAccountAvatar('usr_owner') : (isGuest || account.id === 'guest_user' ? null : getAccountAvatar(account.id));

  useEffect(() => {
    checkOwnerSession();
  }, []);

  useEffect(() => {
    if (isOwner) {
      fetchNewBugCount();
    }
  }, [isOwner]);

  const fetchNewBugCount = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/bug-reports/owner/list', {
        headers: { 'X-Owner-Session': token }
      });
      if (res.ok) {
        const data = await res.json();
        setNewBugCount(data.newCount || 0);
      }
    } catch (err) {
      // quiet catch
    }
  };

  const checkOwnerSession = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['x-anivault-owner-session'] = token;
      }
      const res = await fetch('/api/owner/session', {
        headers,
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        setOwnerSession(data);
        if (!data.authenticated && token) {
          localStorage.removeItem('anivault_owner_session_token');
        }
      }
    } catch (err) {
      console.error('Failed to check owner session', err);
    }
  };

  const handleOwnerLogout = async () => {
    try {
      await logoutFromServer();
      setOwnerSession({ authenticated: false });
    } catch (err) {
      console.error('Failed to log out owner', err);
    }
  };

  const [usernameError, setUsernameError] = useState<string | null>(null);

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = usernameInput.trim();
    if (!clean) return;

    setUsernameError(null);

    if (!isGuest) {
      try {
        const token = localStorage.getItem('anivault_user_session_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          headers['x-anivault-user-session'] = token;
        }

        const res = await fetch('/api/auth/update-username', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ username: clean })
        });

        const data = await res.json();
        if (!res.ok) {
          setUsernameError(data.error || 'Failed to update username.');
          return;
        }
      } catch (err: any) {
        setUsernameError(err.message || 'Failed to update username.');
        return;
      }
    }

    updateUsername(clean);
    setEditingUsername(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleThemeSelect = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  return (
    <div
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-36 md:pb-24 space-y-6 sm:space-y-8"
      id="account-view-container"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {/* 1. Header */}
      <div className="pb-4 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white dark:text-white light:text-slate-900 tracking-tight">
            Account &amp; Preferences
          </h1>
          <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 mt-1">
            Manage your AniVault profile, customization settings, and account session
          </p>
        </div>
        <AniVaultLogo size="lg" className="hidden sm:inline-flex" />
      </div>

      {/* 2. Profile Overview Card */}
      <div className="bg-slate-950/80 dark:bg-slate-950/80 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-6 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Clickable Profile Photo with Camera Badge */}
            <div
              onClick={() => setIsProfilePhotoModalOpen(true)}
              className="relative group cursor-pointer shrink-0"
              title="Change Profile Photo"
              id="btn-change-profile-photo"
            >
              {currentAvatarUrl ? (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden shadow-lg border border-slate-700 bg-transparent shrink-0">
                  <img
                    src={currentAvatarUrl}
                    alt={isOwner ? (ownerUsername || 'Owner') : (account.username || 'User')}
                    className="w-full h-full rounded-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-white text-2xl font-black shadow-lg shrink-0 ${
                    isOwner
                      ? 'bg-gradient-to-tr from-amber-600 to-yellow-500 shadow-amber-600/30 text-slate-950 border border-amber-400'
                      : 'bg-gradient-to-tr from-rose-600 to-pink-500 shadow-rose-600/30'
                  }`}
                >
                  {isOwner ? (
                    <Shield className="w-8 h-8 text-slate-950" />
                  ) : (
                    (account.username || account.name || 'A').charAt(0).toUpperCase()
                  )}
                </div>
              )}

              {/* Camera Hover Overlay */}
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <Camera className="w-5 h-5" />
              </div>
              <div
                className={`absolute -bottom-1 -right-1 p-1 rounded-full shadow-md border ${
                  isOwner
                    ? 'bg-amber-500 text-slate-950 border-amber-300'
                    : 'bg-rose-600 text-white border-rose-400'
                }`}
              >
                <Camera className="w-3 h-3" />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-2">
                  {isOwner ? (
                    <>
                      <span>{ownerUsername}</span>
                      <span className="text-amber-400 font-black tracking-wide text-xs bg-amber-500/10 px-2.5 py-0.5 rounded-md border border-amber-500/30">
                        &#123;owner&#125;
                      </span>
                    </>
                  ) : (
                    <span>{account.username || 'AnimeExplorer'}</span>
                  )}
                </h2>

                {!isOwner && (
                  <button
                    type="button"
                    id="btn-edit-username"
                    onClick={() => {
                      setUsernameInput(account.username || 'AnimeExplorer');
                      setEditingUsername(!editingUsername);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                    title="Edit username"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Personalized Welcome line for Normal Users */}
              {!isOwner && (
                <div className="text-xs font-medium text-slate-300 dark:text-slate-300 light:text-slate-700">
                  Welcome, <span className="font-semibold text-rose-400 dark:text-rose-400 light:text-rose-600">{account.username || account.name || 'AnimeExplorer'}</span>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    isOwner
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/50'
                      : account.provider === 'apple'
                      ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                      : account.provider === 'google'
                      ? 'bg-blue-950/80 text-blue-300 border border-blue-700/50'
                      : isGuest
                      ? 'bg-amber-950/80 text-amber-300 border border-amber-700/50'
                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                  }`}
                >
                  {isOwner ? 'Owner' : account.provider === 'apple' ? 'Apple ID' : account.provider === 'google' ? 'Google Account' : isGuest ? 'Guest' : 'Verified Account'}
                </span>

                <span className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 truncate max-w-[200px] sm:max-w-xs font-mono">
                  {isOwner ? (ownerSession?.owner?.email || 'makerapp688@gmail.com') : account.email ? account.email : 'Local Guest Session'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2 sm:pt-0">
            {/* Switch Account Trigger */}
            <button
              type="button"
              id="btn-switch-account-header"
              onClick={() => setIsAccountSwitcherOpen(true)}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/60 shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-rose-500" />
              <span>Switch Account</span>
            </button>

            {!isOwner && (
              <button
                type="button"
                id="btn-owner-login-trigger"
                onClick={() => setIsOwnerLoginOpen(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900/90 hover:bg-slate-800 text-amber-400 border border-amber-500/40 shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>Owner Portal</span>
              </button>
            )}

            {isGuest && !isOwner && (
              <button
                type="button"
                id="btn-connect-account-main"
                onClick={onOpenAuthModal}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 transition-all cursor-pointer"
              >
                Sign In / Connect
              </button>
            )}
          </div>
        </div>

        {/* Username Edit Form for normal users */}
        {!isOwner && editingUsername && (
          <form
            onSubmit={handleSaveUsername}
            className="p-4 bg-slate-900/90 dark:bg-slate-900/90 light:bg-slate-100 rounded-xl border border-slate-800 dark:border-slate-800 light:border-slate-300 space-y-3"
          >
            <div className="text-xs font-bold text-white dark:text-white light:text-slate-900">
              Change Display Username
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-600 leading-relaxed">
              This username is shown across your AniVault browsing session.
            </p>
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                id="input-account-username"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                placeholder="Enter AniVault username"
                className="flex-1 px-3 py-2 rounded-xl bg-slate-950 dark:bg-slate-950 light:bg-white border border-slate-700 dark:border-slate-700 light:border-slate-300 text-xs text-white dark:text-white light:text-slate-900 focus:outline-none focus:border-rose-500"
                required
              />
              <button
                type="submit"
                id="btn-submit-account-username"
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingUsername(false)}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 dark:bg-slate-800 light:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
            </div>
            {usernameError && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300 flex items-start gap-1.5">
                <Info className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{usernameError}</span>
              </div>
            )}
          </form>
        )}

        {saveSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-700/60 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Display username updated successfully!</span>
          </div>
        )}

        {/* Account Library Summary Grid */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 text-center">
          <div className="p-3 bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
            <div className="flex items-center justify-center gap-1.5 text-sm font-black text-rose-500">
              <Heart className="w-4 h-4 fill-rose-500" />
              <span>{userData.favorites.length}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Favorites</div>
          </div>

          <div className="p-3 bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
            <div className="flex items-center justify-center gap-1.5 text-sm font-black text-indigo-400">
              <Bookmark className="w-4 h-4 fill-indigo-400" />
              <span>{userData.watchlist.length}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Watch Later</div>
          </div>

          <div className="p-3 bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 rounded-xl border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
            <div className="flex items-center justify-center gap-1.5 text-sm font-black text-emerald-400">
              <Check className="w-4 h-4" />
              <span>{userData.completed.length}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Watched</div>
          </div>
        </div>
      </div>

      {/* 3. OWNER ADMINISTRATION SECTION (Only visible to authenticated Owner) */}
      {isOwner && (
        <div
          className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-2 border-amber-500/50 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5 transition-colors"
          id="owner-settings-section"
        >
          <div className="flex items-center justify-between border-b border-amber-500/30 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white tracking-wide uppercase">
                  OWNER ADMINISTRATION
                </h3>
                <p className="text-xs text-amber-300/80">
                  Authorized Owner system entry points &amp; security command center
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setIsOwnerDashboardOpen(true)}
              className="p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-amber-500/40 hover:border-amber-500 text-left transition-all group cursor-pointer shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Owner Dashboard</div>
                  <div className="text-[11px] text-slate-400">System overview &amp; status</div>
                </div>
              </div>
            </button>

            {/* Owner Bug Reports Section */}
            <button
              type="button"
              id="btn-owner-bug-reports"
              onClick={() => setIsOwnerBugReportsOpen(true)}
              className="p-4 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-amber-500/50 hover:border-amber-400 text-left transition-all group cursor-pointer shadow-sm relative overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 group-hover:scale-110 transition-transform">
                  <Bug className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Bug Reports</span>
                    {newBugCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white animate-pulse">
                        {newBugCount} new
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">User feedback &amp; attachments</div>
                </div>
              </div>
            </button>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Catalogue Management</div>
                <div className="text-[11px] text-slate-400">Protected administrative view</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-pink-500/10 text-pink-400">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Artwork Management</div>
                <div className="text-[11px] text-slate-400">Posters &amp; asset registry</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Catalogue Sync</div>
                <div className="text-[11px] text-slate-400">RareToon India ingestion</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-yellow-500/10 text-yellow-400">
                <FolderSync className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Full Catalogue Import</div>
                <div className="text-[11px] text-slate-400">Batch pipeline control</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">User Management</div>
                <div className="text-[11px] text-slate-400">Roles &amp; access control</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">System Settings</div>
                <div className="text-[11px] text-slate-400">Environment &amp; runtime</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Security Settings</div>
                <div className="text-[11px] text-slate-400">Auth &amp; rate limits</div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-left flex items-center gap-3 opacity-90">
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Audit Logs</div>
                <div className="text-[11px] text-slate-400">Telemetry &amp; access trail</div>
              </div>
            </div>
          </div>

          {/* Normal Account Access for Owner (Requirement 7 & 8) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-amber-500/40 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Create Account / Log In
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Manage access to AniVault user accounts on this device
                  </p>
                </div>
              </div>
              <span className="text-[10px] text-amber-400/90 font-mono px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                Max 3 accounts total
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Open registration or login for user accounts. Accounts can be freely created and verified. Note: The Owner role is permanently restricted to the verified system owner; additional owners cannot be created.
            </p>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                id="btn-owner-create-normal-account"
                onClick={() => {
                  setAuthModalMode('register');
                  setAuthModalView('email');
                  setShowAuthModal(true);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 flex items-center gap-1.5 transition-all cursor-pointer border border-rose-500/40"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>

              <button
                type="button"
                id="btn-owner-login-normal-account"
                onClick={() => {
                  setAuthModalMode('login');
                  setAuthModalView('email');
                  setShowAuthModal(true);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-rose-400" />
                <span>Log In</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Display Theme Settings Card */}
      <div className="bg-slate-950/80 dark:bg-slate-950/80 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 transition-colors">
        <div>
          <h3 className="text-base font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-500" />
            <span>Display Theme</span>
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 mt-0.5">
            Select your preferred visual appearance. Persists immediately across sessions.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            id="theme-btn-dark"
            onClick={() => handleThemeSelect('dark')}
            className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              userData.theme === 'dark'
                ? 'bg-slate-900 border-rose-500 shadow-md'
                : 'bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 border-slate-800 dark:border-slate-800 light:border-slate-200 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                <Moon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white dark:text-white light:text-slate-900">Dark Mode</div>
                <div className="text-[11px] text-slate-400">Deep obsidian background</div>
              </div>
            </div>
            {userData.theme === 'dark' && <Check className="w-4 h-4 text-rose-500" />}
          </button>

          <button
            type="button"
            id="theme-btn-light"
            onClick={() => handleThemeSelect('light')}
            className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              userData.theme === 'light'
                ? 'bg-slate-100 dark:bg-slate-900 border-amber-500 shadow-md'
                : 'bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 border-slate-800 dark:border-slate-800 light:border-slate-200 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <Sun className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white dark:text-white light:text-slate-900">Light Mode</div>
                <div className="text-[11px] text-slate-400">Crisp high-contrast theme</div>
              </div>
            </div>
            {userData.theme === 'light' && <Check className="w-4 h-4 text-amber-500" />}
          </button>

          <button
            type="button"
            id="theme-btn-system"
            onClick={() => handleThemeSelect('system')}
            className={`p-4 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
              userData.theme === 'system'
                ? 'bg-slate-900 dark:bg-slate-900 light:bg-slate-100 border-cyan-500 shadow-md'
                : 'bg-slate-900/60 dark:bg-slate-900/60 light:bg-slate-50 border-slate-800 dark:border-slate-800 light:border-slate-200 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                <Monitor className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white dark:text-white light:text-slate-900">System Sync</div>
                <div className="text-[11px] text-slate-400">Matches device settings</div>
              </div>
            </div>
            {userData.theme === 'system' && <Check className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {/* 5. History & Other Account Information */}
      <div className="bg-slate-950/80 dark:bg-slate-950/80 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-400" />
            <h3 className="text-base font-bold text-white dark:text-white light:text-slate-900">
              Recently Viewed History
            </h3>
          </div>
          {userData.history.length > 0 && (
            <button
              type="button"
              onClick={clearHistory}
              className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {userData.history.length === 0 ? (
          <p className="text-xs text-slate-400">No recently viewed anime yet. Titles you browse will be logged here.</p>
        ) : (
          <div className="text-xs text-slate-400">
            You have <strong className="text-slate-200 dark:text-slate-200 light:text-slate-800">{userData.history.length}</strong> anime entries in your recent viewing log.
          </div>
        )}
      </div>

      {/* 6. STANDALONE LOGOUT BUTTON (Requirement 3: Dedicated section at the bottom of the page) */}
      <div className="pt-2 border-t border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 space-y-3" id="account-logout-section">
        {isOwner ? (
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 dark:bg-slate-950/90 light:bg-white border border-amber-500/30 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <span>Owner Session Active</span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-600">
                Ending your Owner session returns AniVault to guest mode on this device.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                id="btn-owner-switch-bottom"
                onClick={() => setIsAccountSwitcherOpen(true)}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span>Switch Account</span>
              </button>
              <button
                type="button"
                id="btn-owner-logout-bottom"
                onClick={handleOwnerLogout}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 hover:border-rose-700 shadow-md shadow-rose-950/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>Owner Logout</span>
              </button>
            </div>
          </div>
        ) : !isGuest ? (
          <div className="space-y-3">
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 dark:bg-slate-950/90 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-2">
                  <User className="w-4 h-4 text-rose-500" />
                  <span>Signed in as {account.username || account.name}</span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-600">
                  Signing out keeps your library saved to your account while switching this device to guest mode.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  id="btn-switch-account-bottom"
                  onClick={() => setIsAccountSwitcherOpen(true)}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/60 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-rose-500" />
                  <span>Switch Account</span>
                </button>
                <button
                  type="button"
                  id="btn-user-logout-bottom"
                  onClick={async () => {
                    await logoutFromServer();
                  }}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 text-rose-400 border border-slate-800 dark:border-slate-800 light:border-slate-300 hover:border-rose-500/40 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>

            {/* Danger Zone: Delete Account */}
            <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Delete Account</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Permanently erase this account, favorites, and watch history with email verification.
                </p>
              </div>
              <button
                type="button"
                id="btn-delete-account"
                onClick={() => setIsDeleteModalOpen(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 hover:border-rose-700 transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Delete Account</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 dark:bg-slate-950/90 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-white dark:text-white light:text-slate-900 flex items-center gap-2">
                <Info className="w-4 h-4 text-slate-400" />
                <span>Guest Mode Active</span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-600">
                Connect your account to sync your watchlist and favorites across devices.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                id="btn-guest-switch-bottom"
                onClick={() => setIsAccountSwitcherOpen(true)}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/60 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5 text-rose-500" />
                <span>Switch Account</span>
              </button>
              <button
                type="button"
                id="btn-guest-connect-bottom"
                onClick={onOpenAuthModal}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <User className="w-4 h-4" />
                <span>Sign In / Connect</span>
              </button>
            </div>
          </div>
        )}

        {/* Public Report a Bug / Feedback Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <Bug className="w-4 h-4 text-rose-500" />
              <span>Report a Bug / Provide Feedback</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Found an issue, missing episode link, or artwork problem? Let us know!
            </p>
          </div>

          <button
            type="button"
            id="btn-open-bug-report"
            onClick={() => setIsBugReportOpen(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <Bug className="w-4 h-4" />
            <span>Report a Bug</span>
          </button>
        </div>

        {/* Download App Source Code Card - Owner Account Only */}
        {isOwner && (
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-emerald-500/30 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Download App Source Code Archive (.tar.gz)</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  OWNER ONLY
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Download the complete AniVault project codebase to test or run locally.
              </p>
            </div>

            <button
              type="button"
              onClick={async () => {
                try {
                  const ownerToken = localStorage.getItem('anivault_owner_session_token');
                  const headers: Record<string, string> = {};
                  if (ownerToken) {
                    headers['Authorization'] = `Bearer ${ownerToken}`;
                    headers['x-anivault-owner-session'] = ownerToken;
                  }
                  const res = await fetch('/api/download-source', { headers });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Download failed' }));
                    alert(err.error || 'Failed to download source archive.');
                    return;
                  }
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'anivault-source-code.tar.gz';
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                } catch {
                  alert('An error occurred while downloading source code.');
                }
              }}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Download Source Code</span>
            </button>
          </div>
        )}
      </div>

      {/* Bug Report Modal for Users & Guests */}
      <BugReportModal
        isOpen={isBugReportOpen}
        onClose={() => setIsBugReportOpen(false)}
        activeFeature="Account & Settings"
      />

      {/* Owner Bug Reports Dashboard */}
      {isOwner && (
        <OwnerBugReportsModal
          isOpen={isOwnerBugReportsOpen}
          onClose={() => {
            setIsOwnerBugReportsOpen(false);
            fetchNewBugCount();
          }}
          sessionToken={localStorage.getItem('anivault_owner_session_token') || undefined}
        />
      )}

      {/* Account Switcher Modal */}
      <AccountSwitcherModal
        isOpen={isAccountSwitcherOpen}
        onClose={() => setIsAccountSwitcherOpen(false)}
        currentAccountId={account.id}
        isOwnerActive={Boolean(isOwner)}
        onOpenMakeAccount={() => {
          setAuthModalMode('register');
          setAuthModalView('email');
          setShowAuthModal(true);
        }}
        onOpenLoginAccount={() => {
          setAuthModalMode('login');
          setAuthModalView('email');
          setShowAuthModal(true);
        }}
        onOpenOwnerLogin={() => setIsOwnerLoginOpen(true)}
        onAccountSwitched={(switchedAcc) => {
          checkOwnerSession();
          setUsernameInput(switchedAcc.username || 'AnimeExplorer');
        }}
      />

      {/* Owner Login Modal */}
      <OwnerLoginModal
        isOpen={isOwnerLoginOpen}
        onClose={() => setIsOwnerLoginOpen(false)}
        onLoginSuccess={(owner) => {
          setOwnerSession({ authenticated: true, owner });
          setIsOwnerLoginOpen(false);
          const ownerToken = localStorage.getItem('anivault_owner_session_token') || undefined;
          setSessionAccount({
            id: 'usr_owner',
            username: owner.username,
            name: owner.username,
            email: owner.email,
            provider: 'email',
            role: 'owner',
            createdAt: new Date().toISOString()
          }, ownerToken);
        }}
      />

      {/* Owner Dashboard Modal */}
      <OwnerDashboardModal
        isOpen={isOwnerDashboardOpen}
        onClose={() => setIsOwnerDashboardOpen(false)}
        onLogout={handleOwnerLogout}
        onOpenCreateAccount={() => {
          setAuthModalMode('register');
          setAuthModalView('email');
          setShowAuthModal(true);
        }}
        onOpenLoginAccount={() => {
          setAuthModalMode('login');
          setAuthModalView('email');
          setShowAuthModal(true);
        }}
        onOpenProfilePhoto={() => setIsProfilePhotoModalOpen(true)}
      />

      {/* Profile Photo Modal (Normal Users + Owner) */}
      <ProfilePhotoModal
        isOpen={isProfilePhotoModalOpen}
        onClose={() => setIsProfilePhotoModalOpen(false)}
        accountId={isOwner ? 'usr_owner' : account.id}
        username={isOwner ? (ownerUsername || 'Owner') : (account.username || 'AnimeExplorer')}
        isOwner={Boolean(isOwner)}
        currentAvatar={currentAvatarUrl}
        onAvatarUpdated={() => {
          checkOwnerSession();
        }}
      />

      {/* Delete Account Modal (with email OTP verification) */}
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        account={account}
        onAccountDeleted={() => {
          setIsDeleteModalOpen(false);
          checkOwnerSession();
        }}
      />

      {/* Auth Modal for programmatic Make New Account / Log In */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialMode={authModalMode}
        initialView={authModalView}
        onAccountChanged={() => {
          checkOwnerSession();
        }}
      />
    </div>
  );
};
