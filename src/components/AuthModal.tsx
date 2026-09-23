import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  User,
  Mail,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FolderSync,
  Heart,
  Bookmark,
  Check,
  Edit2,
  Users,
  LogOut,
  Loader2,
  KeyRound,
  RotateCcw,
  Eye,
  EyeOff
} from 'lucide-react';
import { UserAccount } from '../types.ts';
import { AniVaultLogo } from './AniVaultLogo.tsx';
import { OtpInput } from './OtpInput.tsx';
import {
  getCurrentAccount,
  logoutToGuest,
  logoutFromServer,
  setSessionAccount,
  updateUsername,
  hasGuestDataToMigrate,
  migrateGuestDataToAccount,
  getGuestData,
  getUserData,
  getSavedAccounts,
  switchAccount,
  getAccountAvatar
} from '../utils/userStorage.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountChanged?: () => void;
  initialMode?: 'login' | 'register';
  initialView?: 'overview' | 'email' | 'edit_username';
}

interface ProviderStatus {
  email: { configured: boolean; missing: string[] };
  google: { configured: boolean; missing: string[] };
  apple: { configured: boolean; missing: string[] };
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAccountChanged,
  initialMode,
  initialView
}) => {
  const currentAccount = getCurrentAccount();
  const isGuest = currentAccount.provider === 'guest';
  const userData = getUserData();
  const guestData = getGuestData();
  const canMigrate = isGuest && hasGuestDataToMigrate();
  const savedAccounts = getSavedAccounts();

  // Mode: 'overview' | 'email' | 'edit_username'
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [activeView, setActiveView] = useState<'overview' | 'email' | 'edit_username'>('overview');
  
  // Registration / verification step
  const [registerStep, setRegisterStep] = useState<'form' | 'verify'>('form');
  const [verificationCode, setVerificationCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [chosenUsername, setChosenUsername] = useState(currentAccount.username || 'AnimeExplorer');
  
  // Live username uniqueness validation state
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'unavailable' | 'invalid'>('idle');
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const [configNotice, setConfigNotice] = useState<{ provider: 'google' | 'apple' | 'email'; message: string } | null>(null);
  const [showMigratePrompt, setShowMigratePrompt] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<UserAccount | null>(null);
  const [migrationStats, setMigrationStats] = useState<{
    favoritesCount: number;
    watchlistCount: number;
    completedCount: number;
  } | null>(null);

  const [providersStatus, setProvidersStatus] = useState<ProviderStatus | null>(null);

  // Live debounced username uniqueness check with database backend
  useEffect(() => {
    if (!isOpen || authMode !== 'register' || registerStep !== 'form') {
      return;
    }

    const clean = (chosenUsername || '').trim();
    if (!clean) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username cannot be empty.');
      return;
    }

    if (clean.length < 2 || clean.length > 30) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username must be 2 to 30 characters.');
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) {
      setUsernameStatus('invalid');
      setUsernameMessage('Only letters, numbers, hyphens, and underscores allowed.');
      return;
    }

    setUsernameStatus('checking');
    setUsernameMessage('Checking availability with database...');

    const timer = setTimeout(async () => {
      try {
        const cleanEmail = (emailInput || '').trim().toLowerCase();
        const res = await fetch(
          `/api/auth/check-username?username=${encodeURIComponent(clean)}&excludeEmail=${encodeURIComponent(cleanEmail)}`
        );
        if (!res.ok) {
          setUsernameStatus('unavailable');
          setUsernameMessage('Unable to verify username availability right now.');
          return;
        }
        const data = await res.json();
        if (data.available) {
          setUsernameStatus('available');
          setUsernameMessage('Username is available');
        } else {
          setUsernameStatus('unavailable');
          setUsernameMessage(data.reason || 'Username already taken');
        }
      } catch {
        setUsernameStatus('unavailable');
        setUsernameMessage('Network error checking username');
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [isOpen, authMode, registerStep, chosenUsername, emailInput]);

  useEffect(() => {
    let timer: any;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (isOpen) {
      fetchAuthStatus();
      setAuthError(null);
      setConfigNotice(null);
      setAuthSuccess(null);
      setRegisterStep('form');
      setVerificationCode('');
      setShowPassword(false);
      if (initialMode) {
        setAuthMode(initialMode);
      }
      if (initialView) {
        setActiveView(initialView);
      } else if (initialMode) {
        setActiveView('email');
      }
    }
  }, [isOpen, initialMode, initialView]);

  // Listen for OAuth postMessage callbacks from Google / Apple popups
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'ANIVAULT_OAUTH_SUCCESS') {
        const user = event.data.user;
        const sessionToken = event.data.sessionToken;
        if (user) {
          const acc: UserAccount = {
            id: user.id,
            username: user.username,
            name: user.name || user.username,
            email: user.email,
            provider: user.provider,
            createdAt: user.createdAt
          };
          setSessionAccount(acc, sessionToken);

          if (canMigrate) {
            setPendingAccount(acc);
            setShowMigratePrompt(true);
          } else {
            onAccountChanged?.();
            onClose();
          }
        }
      } else if (event.data?.type === 'ANIVAULT_OAUTH_ERROR') {
        setAuthError(event.data.error || 'OAuth authentication failed.');
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [canMigrate, onAccountChanged, onClose]);

  const fetchAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        setProvidersStatus(data.providers);
      }
    } catch (err) {
      console.warn('Failed to fetch auth status', err);
    }
  };

  if (!isOpen) return null;

  const handleUpdateUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = chosenUsername.trim();
    if (!clean) return;

    setAuthError(null);

    if (currentAccount.provider !== 'guest') {
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
          setAuthError(data.error || 'Failed to update username.');
          return;
        }
      } catch (err: any) {
        setAuthError(err.message || 'Failed to communicate with server.');
        return;
      }
    }

    updateUsername(clean);
    setActiveView('overview');
    onAccountChanged?.();
  };

  // Submit email auth: Login or Register-Init
  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setConfigNotice(null);
    setAuthSuccess(null);

    const cleanEmail = emailInput.trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setAuthError('Please enter a valid email address (e.g. user@gmail.com).');
      return;
    }

    if (!passwordInput || passwordInput.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      return;
    }

    if (authMode === 'register') {
      if (usernameStatus !== 'available') {
        setAuthError(usernameMessage || 'Please choose an available username before registering.');
        return;
      }
    }

    const cleanUsername = chosenUsername.trim() || cleanEmail.split('@')[0] || 'AnimeExplorer';

    setLoading(true);

    try {
      if (authMode === 'register') {
        // Step 1: Register-Init
        const res = await fetch('/api/auth/register-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            username: cleanUsername,
            password: passwordInput
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Email verification is temporarily unavailable. Please try again later.');
        }

        setAuthSuccess(data.message || 'Verification code sent to your email.');
        setRegisterStep('verify');
        setResendCooldown(60);
      } else {
        // Real Login
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: passwordInput
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Login failed. Please check your credentials.');
        }

        const user = data.user;
        const acc: UserAccount = {
          id: user.id,
          username: user.username,
          name: user.name || user.username,
          email: user.email,
          provider: user.provider,
          createdAt: user.createdAt
        };

        setSessionAccount(acc, data.sessionToken);

        if (canMigrate) {
          setPendingAccount(acc);
          setShowMigratePrompt(true);
        } else {
          onAccountChanged?.();
          onClose();
        }
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Register-Verify
  const handleVerifyCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!verificationCode || verificationCode.trim().length !== 6) {
      setAuthError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    const cleanEmail = emailInput.trim().toLowerCase();

    try {
      const res = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          code: verificationCode.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Email verification failed.');
      }

      const user = data.user;
      const acc: UserAccount = {
        id: user.id,
        username: user.username,
        name: user.name || user.username,
        email: user.email,
        provider: user.provider,
        createdAt: user.createdAt
      };

      setSessionAccount(acc, data.sessionToken);

      if (canMigrate) {
        setPendingAccount(acc);
        setShowMigratePrompt(true);
      } else {
        onAccountChanged?.();
        onClose();
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Resend code for registration
  const handleResendRegisterCode = async () => {
    if (resendCooldown > 0 || loading) return;
    setAuthError(null);
    setLoading(true);

    const cleanEmail = emailInput.trim().toLowerCase();
    try {
      const res = await fetch('/api/auth/register-resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend code.');
      }
      setAuthSuccess('New verification code sent to your email.');
      setResendCooldown(60);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Trigger real OAuth flow via server popup
  const handleRealOAuthAttempt = async (provider: 'google' | 'apple') => {
    setAuthError(null);
    setConfigNotice(null);

    try {
      const origin = window.location.origin;
      const res = await fetch(`/api/auth/${provider}/url?origin=${encodeURIComponent(origin)}`);
      const data = await res.json();

      if (!res.ok || !data.configured) {
        setConfigNotice({
          provider,
          message: data.message || `${provider === 'google' ? 'Google' : 'Apple'} authentication requires environment configuration.`
        });
        return;
      }

      // Open OAuth popup window
      const width = 520;
      const height = 640;
      const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2));
      
      const popup = window.open(
        data.url,
        `anivault_${provider}_oauth`,
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,status=no`
      );

      if (!popup) {
        setAuthError('Popup was blocked by your browser. Please allow popups for AniVault to authenticate.');
      }
    } catch (err: any) {
      setAuthError(err.message || `Failed to initiate ${provider} sign in.`);
    }
  };

  const confirmMigration = (doMigrate: boolean) => {
    if (!pendingAccount) return;

    if (doMigrate) {
      const stats = migrateGuestDataToAccount(pendingAccount.id);
      setMigrationStats(stats);
    }

    setShowMigratePrompt(false);
    onAccountChanged?.();
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const handleLogout = async () => {
    await logoutFromServer();
    onAccountChanged?.();
  };

  const handleSwitchToSaved = (acc: UserAccount) => {
    switchAccount(acc);
    onAccountChanged?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      id="auth-modal-overlay"
    >
      <div
        className="relative w-full max-w-md bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col transition-colors"
        onClick={e => e.stopPropagation()}
        id="auth-modal-content"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-b border-slate-800 dark:border-slate-800 light:border-slate-200">
          <div className="flex items-center gap-2.5">
            <AniVaultLogo size="xs" />
            <h2 className="text-base font-bold text-white dark:text-white light:text-slate-900">
              AniVault Account &amp; Profile
            </h2>
          </div>
          <button
            type="button"
            id="btn-close-auth-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 text-slate-200 dark:text-slate-200 light:text-slate-800">
          {/* Active Account Status */}
          <div className="p-4 bg-slate-950/80 dark:bg-slate-950/80 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {(() => {
                  const isOwner = currentAccount.role === 'owner';
                  const isGuestUser = isGuest || currentAccount.id === 'guest_user' || currentAccount.provider === 'guest';
                  const avatarUrl = isOwner ? getAccountAvatar('usr_owner') : (!isGuestUser ? getAccountAvatar(currentAccount.id) : null);
                  return avatarUrl ? (
                    <div className="w-11 h-11 rounded-full overflow-hidden border border-rose-400/40 shrink-0 shadow-md">
                      <img src={avatarUrl} alt="DP" className="w-full h-full object-cover rounded-full" />
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 border border-rose-400/40 flex items-center justify-center text-white font-black text-sm shadow-md">
                      {(currentAccount.username || currentAccount.name || 'A').charAt(0).toUpperCase()}
                    </div>
                  );
                })()}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white dark:text-white light:text-slate-900">
                      {currentAccount.username || 'AnimeExplorer'}
                    </span>
                    <button
                      type="button"
                      id="btn-edit-username-toggle"
                      onClick={() => {
                        setChosenUsername(currentAccount.username || 'AnimeExplorer');
                        setActiveView(activeView === 'edit_username' ? 'overview' : 'edit_username');
                      }}
                      className="text-slate-400 hover:text-rose-400 p-0.5 transition-colors cursor-pointer"
                      title="Change display username"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500">
                    {isGuest ? 'Guest Session' : `${currentAccount.name} (${currentAccount.email})`}
                  </div>
                </div>
              </div>

              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  currentAccount.provider === 'apple'
                    ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                    : currentAccount.provider === 'google'
                    ? 'bg-blue-950/80 text-blue-300 border border-blue-700/50'
                    : isGuest
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-700/50'
                    : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                }`}
              >
                {currentAccount.provider === 'apple'
                  ? 'Apple ID'
                  : currentAccount.provider === 'google'
                  ? 'Google'
                  : currentAccount.provider}
              </span>
            </div>

            {/* Quick edit username form */}
            {activeView === 'edit_username' && (
              <form
                noValidate
                onSubmit={handleUpdateUsernameSubmit}
                className="pt-2 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 space-y-2"
              >
                <label className="block text-[11px] font-semibold text-slate-300 dark:text-slate-300 light:text-slate-700">
                  Custom Display Username
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="input-change-username"
                    value={chosenUsername}
                    onChange={e => setChosenUsername(e.target.value)}
                    placeholder="e.g. AnimeExplorer"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-700 dark:border-slate-700 light:border-slate-300 text-xs text-white dark:text-white light:text-slate-900 focus:outline-none focus:border-rose-500"
                    required
                  />
                  <button
                    type="submit"
                    id="btn-save-username"
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {/* Account Specific Data Stats */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 text-center">
              <div className="p-2 bg-slate-900 dark:bg-slate-900 light:bg-white rounded-lg border border-slate-800 dark:border-slate-800 light:border-slate-200">
                <div className="text-xs text-rose-400 font-bold flex items-center justify-center gap-1">
                  <Heart className="w-3 h-3 fill-rose-500" />
                  <span>{userData.favorites.length}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Favorites</div>
              </div>

              <div className="p-2 bg-slate-900 dark:bg-slate-900 light:bg-white rounded-lg border border-slate-800 dark:border-slate-800 light:border-slate-200">
                <div className="text-xs text-indigo-400 font-bold flex items-center justify-center gap-1">
                  <Bookmark className="w-3 h-3 fill-indigo-400" />
                  <span>{userData.watchlist.length}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Watch Later</div>
              </div>

              <div className="p-2 bg-slate-900 dark:bg-slate-900 light:bg-white rounded-lg border border-slate-800 dark:border-slate-800 light:border-slate-200">
                <div className="text-xs text-emerald-400 font-bold flex items-center justify-center gap-1">
                  <Check className="w-3 h-3" />
                  <span>{userData.completed.length}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Watched</div>
              </div>
            </div>

            {!isGuest && (
              <button
                type="button"
                id="btn-logout-account"
                onClick={handleLogout}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-rose-400 hover:text-rose-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out (Return to Guest Mode)</span>
              </button>
            )}
          </div>

          {/* Migration Success Banner */}
          {migrationStats && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-700/50 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>
                Successfully imported {migrationStats.favoritesCount} favorites and{' '}
                {migrationStats.watchlistCount} watchlist items to your account!
              </span>
            </div>
          )}

          {/* Migration Confirmation Prompt */}
          {showMigratePrompt && (
            <div className="p-4 bg-indigo-950/60 border border-indigo-700/60 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs uppercase tracking-wide">
                <FolderSync className="w-4 h-4 text-indigo-400" />
                <span>Migrate Guest Data?</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                You have <strong>{guestData.favorites.length} favorites</strong> and{' '}
                <strong>{guestData.watchlist.length} saved watchlist items</strong> in your guest session. Would you like to migrate them to your new account?
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  id="btn-confirm-migrate"
                  onClick={() => confirmMigration(true)}
                  className="flex-1 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                >
                  Import My Data
                </button>
                <button
                  type="button"
                  id="btn-skip-migrate"
                  onClick={() => confirmMigration(false)}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                >
                  Start Fresh
                </button>
              </div>
            </div>
          )}

          {/* Sign In & Registration Section for Guests */}
          {isGuest && !showMigratePrompt && (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-center">
                Sign In or Register
              </div>

              {/* STEP 1: Registration or Login Form */}
              {registerStep === 'form' ? (
                <div className="space-y-3">
                  {/* Mode Toggle: Register vs Login */}
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('register');
                        setAuthError(null);
                        setAuthSuccess(null);
                        setConfigNotice(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                        authMode === 'register'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Create Account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('login');
                        setAuthError(null);
                        setAuthSuccess(null);
                        setConfigNotice(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                        authMode === 'login'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Sign In
                    </button>
                  </div>

                    {/* EMAIL FORM */}
                    <form noValidate onSubmit={handleEmailAuthSubmit} className="space-y-3">
                      {authMode === 'register' && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-400 light:text-slate-600">
                              AniVault Display Username
                            </label>
                            {usernameStatus === 'checking' && (
                              <span className="text-[10px] text-amber-400 flex items-center gap-1 font-medium">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Checking database...</span>
                              </span>
                            )}
                            {usernameStatus === 'available' && (
                              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Username available</span>
                              </span>
                            )}
                            {(usernameStatus === 'unavailable' || usernameStatus === 'invalid') && (
                              <span className="text-[10px] text-rose-400 flex items-center gap-1 font-semibold">
                                <AlertCircle className="w-3 h-3 text-rose-400" />
                                <span>{usernameMessage || 'Unavailable'}</span>
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <User className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                            <input
                              type="text"
                              id="input-auth-name"
                              value={chosenUsername}
                              onChange={e => {
                                setChosenUsername(e.target.value);
                                setAuthError(null);
                              }}
                              placeholder="e.g. AnimeExplorer"
                              className={`w-full pl-9 pr-9 py-2 rounded-xl bg-slate-950/70 dark:bg-slate-950/70 light:bg-slate-100 border text-xs text-white dark:text-white light:text-slate-900 placeholder-slate-500 focus:outline-none transition-colors ${
                                usernameStatus === 'available'
                                  ? 'border-emerald-500/70 focus:border-emerald-500'
                                  : usernameStatus === 'unavailable' || usernameStatus === 'invalid'
                                  ? 'border-rose-500/80 focus:border-rose-500'
                                  : 'border-slate-700/80 dark:border-slate-700/80 light:border-slate-300 focus:border-rose-500'
                              }`}
                              required
                            />
                            <div className="absolute right-3 top-2.5 pointer-events-none">
                              {usernameStatus === 'checking' && (
                                <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                              )}
                              {usernameStatus === 'available' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              )}
                              {(usernameStatus === 'unavailable' || usernameStatus === 'invalid') && (
                                <AlertCircle className="w-4 h-4 text-rose-400" />
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-400 light:text-slate-600 mb-1">
                          Email Address
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                          <input
                            type="email"
                            id="input-auth-email"
                            value={emailInput}
                            onChange={e => {
                              setEmailInput(e.target.value);
                              setAuthError(null);
                            }}
                            placeholder="you@example.com"
                            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950/70 dark:bg-slate-950/70 light:bg-slate-100 border border-slate-700/80 dark:border-slate-700/80 light:border-slate-300 text-xs text-white dark:text-white light:text-slate-900 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-400 dark:text-slate-400 light:text-slate-600 mb-1">
                          Password (min 8 characters)
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                          <input
                            type={showPassword ? "text" : "password"}
                            id="input-auth-password"
                            value={passwordInput}
                            onChange={e => {
                              setPasswordInput(e.target.value);
                              setAuthError(null);
                            }}
                            minLength={8}
                            placeholder="••••••••••••"
                            className="w-full pl-9 pr-10 py-2 rounded-xl bg-slate-950/70 dark:bg-slate-950/70 light:bg-slate-100 border border-slate-700/80 dark:border-slate-700/80 light:border-slate-300 text-xs text-white dark:text-white light:text-slate-900 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(p => !p)}
                            className="absolute right-3 top-2.5 p-0.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {authMode === 'register' && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-600 leading-normal">
                          Remember these details — you’ll need them later to sign in.
                        </p>
                      )}

                      {authError && (
                        <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300 flex items-start gap-1.5">
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{authError}</span>
                        </div>
                      )}

                      {authSuccess && (
                        <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800 text-[11px] text-emerald-300 flex items-start gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{authSuccess}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        id="btn-auth-submit"
                        disabled={loading || (authMode === 'register' && usernameStatus !== 'available')}
                        className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-md shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <span>
                              {authMode === 'register'
                                ? usernameStatus === 'checking'
                                  ? 'Checking Username...'
                                  : usernameStatus === 'unavailable'
                                  ? 'Username Unavailable'
                                  : usernameStatus === 'invalid'
                                  ? 'Enter Valid Username'
                                  : 'Send Verification Code'
                                : 'Sign In to Account'}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>

                      {loading && authMode === 'register' && (
                        <p className="text-[11px] text-center text-slate-400 animate-pulse pt-1">
                          It may take some time. Please be patient.
                        </p>
                      )}
                    </form>
                </div>
              ) : (
                /* STEP 2: Real Email Verification Code Form */
                <form noValidate onSubmit={handleVerifyCodeSubmit} className="space-y-4 animate-fade-in">
                  <div className="p-3.5 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border border-slate-800 dark:border-slate-800 light:border-slate-300 rounded-xl space-y-1.5 text-center">
                    <div className="font-bold text-sm text-white dark:text-white light:text-slate-900 flex items-center justify-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-rose-500" />
                      <span>Verify your account</span>
                    </div>
                    <p className="text-slate-400 dark:text-slate-400 light:text-slate-600 text-xs">
                      We sent a verification code to:
                    </p>
                    <p className="text-rose-400 font-mono font-bold text-xs break-all">
                      {emailInput}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 pt-0.5">
                      Remember these details — you’ll need them later to sign in.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-300 dark:text-slate-300 light:text-slate-700 text-center">
                      Enter 6-digit code
                    </label>
                    <OtpInput
                      value={verificationCode}
                      onChange={val => {
                        setVerificationCode(val);
                        setAuthError(null);
                      }}
                      disabled={loading}
                      autoFocus
                      idPrefix="register-otp"
                    />
                  </div>

                  {authError && (
                    <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-[11px] text-rose-300 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{authError}</span>
                    </div>
                  )}

                  {authSuccess && (
                    <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800 text-[11px] text-emerald-300 flex items-start gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{authSuccess}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || verificationCode.length !== 6}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-md shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Verify Email</span>
                        <Check className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="pt-2 border-t border-slate-800/80 text-center space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Didn't receive the code?</span>
                      <button
                        type="button"
                        onClick={handleResendRegisterCode}
                        disabled={resendCooldown > 0 || loading}
                        className="font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        {resendCooldown > 0 ? `Resend Code (${resendCooldown}s)` : 'Resend Code'}
                      </button>
                    </div>

                    {loading && (
                      <p className="text-[11px] text-center text-slate-400 animate-pulse">
                        It may take some time. Please be patient.
                      </p>
                    )}
                  </div>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRegisterStep('form');
                        setAuthError(null);
                        setAuthSuccess(null);
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer transition-colors"
                    >
                      ← Back to Registration Details
                    </button>
                  </div>
                </form>
              )}

              {/* Saved accounts list */}
              {savedAccounts.length > 0 && (
                <div className="pt-2 border-t border-slate-800 dark:border-slate-800 light:border-slate-200 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    <span>Saved Accounts on This Device</span>
                  </div>
                  <div className="space-y-1">
                    {savedAccounts.map(acc => {
                      const isOwner = acc.role === 'owner';
                      if (isOwner) {
                        return (
                          <div
                            key={acc.id}
                            onClick={() => handleSwitchToSaved(acc)}
                            className="p-2.5 rounded-xl bg-black border-2 border-amber-500/70 hover:border-amber-400 shadow-md shadow-amber-950/40 cursor-pointer flex items-center justify-between text-xs transition-all"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 text-[11px] font-black flex items-center justify-center shrink-0 border border-amber-300 shadow-sm">
                                <Shield className="w-3.5 h-3.5 text-slate-950" />
                              </div>
                              <div className="space-y-0.5 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-black text-white tracking-tight truncate">
                                    {acc.username || acc.name || 'Owner'}
                                  </span>
                                  <span className="text-[10px] font-mono font-bold text-amber-400 border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.2 rounded">
                                    &#123;owner&#125;
                                  </span>
                                </div>
                                <div className="text-[10px] text-amber-300 font-semibold">Owner</div>
                                <div className="text-[10px] text-amber-200/70 font-mono truncate">
                                  {acc.email || 'makerapp688@gmail.com'}
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-amber-300 font-bold px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-400/40 shrink-0">
                              Switch
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={acc.id}
                          onClick={() => handleSwitchToSaved(acc)}
                          className="p-2 rounded-lg bg-slate-950/60 dark:bg-slate-950/60 light:bg-slate-50 hover:bg-slate-800 dark:hover:bg-slate-800 light:hover:bg-slate-100 border border-slate-800/80 dark:border-slate-800/80 light:border-slate-200 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-bold flex items-center justify-center">
                              {(acc.username || acc.name).charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-white dark:text-white light:text-slate-900">
                                {acc.username || acc.name}
                              </span>
                              <span className="text-[10px] text-slate-400 ml-1.5">
                                ({acc.email || acc.provider})
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] text-rose-400 font-semibold">Switch</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Continue Browsing */}
          <div className="pt-2 border-t border-slate-800 dark:border-slate-800 light:border-slate-200">
            <button
              type="button"
              id="btn-auth-continue-guest"
              onClick={onClose}
              className="w-full py-2 px-3 rounded-xl text-xs font-semibold bg-slate-800/60 hover:bg-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 text-slate-300 dark:text-slate-300 light:text-slate-700 transition-colors text-center cursor-pointer"
            >
              Continue Browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
