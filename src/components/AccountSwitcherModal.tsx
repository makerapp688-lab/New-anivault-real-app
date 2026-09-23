import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  Shield,
  User,
  CheckCircle2,
  ArrowRight,
  Trash2,
  Loader2,
  AlertCircle,
  LogIn,
  UserPlus,
  Sparkles
} from 'lucide-react';
import { UserAccount } from '../types.ts';
import {
  getSavedAccounts,
  switchActiveAccount,
  removeSavedAccount,
  getAccountAvatar,
  getAccountsDb,
  saveAccountsDb
} from '../utils/userStorage.ts';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccountId: string;
  isOwnerActive: boolean;
  onOpenMakeAccount: () => void;
  onOpenLoginAccount: () => void;
  onOpenOwnerLogin: () => void;
  onAccountSwitched?: (account: UserAccount) => void;
}

export const AccountSwitcherModal: React.FC<AccountSwitcherModalProps> = ({
  isOpen,
  onClose,
  currentAccountId,
  isOwnerActive,
  onOpenMakeAccount,
  onOpenLoginAccount,
  onOpenOwnerLogin,
  onAccountSwitched
}) => {
  const [savedAccounts, setSavedAccounts] = useState<UserAccount[]>([]);
  const [ownerInfo, setOwnerInfo] = useState<{
    exists: boolean;
    username?: string;
    email?: string;
    avatar?: string | null;
  }>({ exists: false });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAccounts();
      fetchOwnerStatus();
      setErrorMsg(null);
    }
  }, [isOpen]);

  const loadAccounts = () => {
    const list = getSavedAccounts();
    // Saved accounts only, strictly capped at 3
    const normalUsers = list
      .filter(a => a.id && a.id !== 'guest_user' && a.id !== 'usr_owner' && a.role !== 'owner')
      .slice(0, 3);
    setSavedAccounts(normalUsers);
  };

  const fetchOwnerStatus = async () => {
    try {
      const ownerToken = localStorage.getItem('anivault_owner_session_token');
      const headers: Record<string, string> = {};
      if (ownerToken) {
        headers['Authorization'] = `Bearer ${ownerToken}`;
        headers['x-anivault-owner-session'] = ownerToken;
      }

      const res = await fetch('/api/owner/session', {
        headers,
        credentials: 'include'
      });

      if (res.ok) {
        const data = await res.json();
        const db = getAccountsDb();
        if (data.authenticated && data.ownerExists && data.owner && data.owner.email === 'makerapp688@gmail.com') {
          db['usr_owner'] = {
            id: 'usr_owner',
            username: data.owner.username,
            name: data.owner.username,
            email: data.owner.email,
            avatar: getAccountAvatar('usr_owner') || undefined,
            provider: 'email',
            role: 'owner',
            createdAt: db['usr_owner']?.createdAt || new Date().toISOString(),
            lastLoginAt: new Date().toISOString()
          };
          saveAccountsDb(db);
          setOwnerInfo({
            exists: true,
            username: data.owner.username,
            email: data.owner.email,
            avatar: getAccountAvatar('usr_owner')
          });
        } else {
          setOwnerInfo({ exists: false });
        }
      } else {
        setOwnerInfo({ exists: false });
      }
    } catch (err) {
      setOwnerInfo({ exists: false });
    }
  };

  const handleSelectAccount = async (account: UserAccount) => {
    if (account.id === currentAccountId && !isOwnerActive) {
      onClose();
      return;
    }

    setSwitchingId(account.id);
    setErrorMsg(null);

    const result = await switchActiveAccount(account.id);
    setSwitchingId(null);

    if (result.success) {
      if (result.account && onAccountSwitched) {
        onAccountSwitched(result.account);
      }
      onClose();
    } else {
      setErrorMsg(result.error || 'Failed to switch account.');
    }
  };

  const handleSelectOwner = async () => {
    if (isOwnerActive) {
      onClose();
      return;
    }

    setSwitchingId('usr_owner');
    setErrorMsg(null);

    const result = await switchActiveAccount('usr_owner');
    setSwitchingId(null);

    if (result.success) {
      if (result.account && onAccountSwitched) {
        onAccountSwitched(result.account);
      }
      onClose();
    } else {
      setErrorMsg(result.error || 'Failed to switch to Owner account.');
    }
  };

  const handleRemoveAccount = (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    removeSavedAccount(accountId);
    loadAccounts();
  };

  const isMaxAccountsReached = savedAccounts.length >= 3;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-switcher-title"
    >
      <div
        className="w-full max-w-md bg-slate-950 dark:bg-slate-950 light:bg-white border border-slate-800/90 dark:border-slate-800/90 light:border-slate-200 rounded-3xl shadow-2xl p-4 sm:p-6 space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        id="account-switcher-modal"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 dark:border-slate-800/80 light:border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-600/10 border border-rose-500/30 flex items-center justify-center text-rose-500 shadow-sm">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="account-switcher-title"
                className="text-base sm:text-lg font-black text-white dark:text-white light:text-slate-900 tracking-tight"
              >
                Switch Account
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500">
                Switch between saved accounts or connect another
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
            aria-label="Close Account Switcher"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 rounded-2xl bg-rose-950/80 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <p>{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Quick Actions: Make New Account / Log In */}
        <div className="space-y-2">
          {isMaxAccountsReached ? (
            <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 space-y-1">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Maximum 3 accounts reached</span>
              </div>
              <p className="text-[11px] text-amber-300/80 pl-6">
                Remove an existing saved account below to add or connect another.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                id="btn-switcher-make-account"
                onClick={() => {
                  onClose();
                  onOpenMakeAccount();
                }}
                className="py-2.5 px-3 rounded-2xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-rose-500/40 active:scale-[0.98]"
              >
                <UserPlus className="w-4 h-4 shrink-0" />
                <span className="truncate">Make New Account</span>
              </button>

              <button
                type="button"
                id="btn-switcher-login-account"
                onClick={() => {
                  onClose();
                  onOpenLoginAccount();
                }}
                className="py-2.5 px-3 rounded-2xl text-xs font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 light:bg-slate-100 light:hover:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-800 dark:border-slate-800 light:border-slate-300 active:scale-[0.98]"
              >
                <LogIn className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">Log In to Account</span>
              </button>
            </div>
          )}
        </div>

        {/* OWNER ACCOUNT CARD (DISTINCTIVE BLACK + GOLD LUXURY TREATMENT) */}
        {ownerInfo.exists && (
          <div className="space-y-1.5" id="owner-account-card-section">
            <div
              onClick={handleSelectOwner}
              className={`relative p-3.5 sm:p-4 rounded-2xl transition-all cursor-pointer border-2 bg-gradient-to-br from-neutral-950 via-black to-neutral-950 select-none ${
                isOwnerActive
                  ? 'border-amber-400 shadow-xl shadow-amber-500/25 ring-2 ring-amber-400/50'
                  : 'border-amber-500/70 hover:border-amber-400 shadow-lg shadow-amber-950/60 hover:shadow-amber-500/15'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Owner Avatar / DP with gold border */}
                  <div className="relative shrink-0">
                    {ownerInfo.avatar ? (
                      <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-amber-400 shrink-0 shadow-md shadow-amber-500/30">
                        <img
                          src={ownerInfo.avatar}
                          alt="Owner"
                          className="w-full h-full object-cover rounded-full"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 flex items-center justify-center font-black text-xl shadow-md shadow-amber-500/30 shrink-0 border-2 border-amber-300">
                        <Shield className="w-6 h-6 text-slate-950" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-0.5 min-w-0">
                    {/* [Owner Username] {owner} */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-black text-white tracking-tight truncate">
                        {ownerInfo.username || 'Owner'}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-amber-400 border border-amber-400/70 bg-amber-500/15 px-1.5 py-0.5 rounded-md shadow-xs shadow-amber-500/10 inline-flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                        &#123;owner&#125;
                      </span>
                    </div>

                    {/* Owner Role line */}
                    <p className="text-xs text-amber-300 font-semibold tracking-wide flex items-center gap-1">
                      Owner
                    </p>

                    {/* [Owner Email] */}
                    <p className="text-[11px] text-amber-200/70 font-mono truncate">
                      {ownerInfo.email || 'makerapp688@gmail.com'}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {switchingId === 'usr_owner' ? (
                    <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                  ) : isOwnerActive ? (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-950/90 text-amber-300 border border-amber-400/80 shadow-md shadow-amber-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Active</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="px-3.5 py-1.5 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/25 flex items-center gap-1 transition-all cursor-pointer border border-amber-400 active:scale-95"
                    >
                      <span>Switch</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SAVED NORMAL ACCOUNTS SECTION */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-300 dark:text-slate-300 light:text-slate-700">
              Accounts ({savedAccounts.length}/3)
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              Max 3 saved accounts
            </span>
          </div>

          {savedAccounts.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-900/40 dark:bg-slate-900/40 light:bg-slate-50 border border-dashed border-slate-800 dark:border-slate-800 light:border-slate-300 text-center space-y-1">
              <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600">
                No saved accounts on this device.
              </p>
              <p className="text-[11px] text-slate-500">
                Tap &ldquo;Make New Account&rdquo; or &ldquo;Log In to Account&rdquo; above.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {savedAccounts.map((acc, index) => {
                const isAccOwner = acc.role === 'owner';
                const isActive = isAccOwner ? isOwnerActive : (!isOwnerActive && currentAccountId === acc.id);
                const isSwitching = switchingId === acc.id;
                const avatarUrl = isAccOwner ? getAccountAvatar('usr_owner') : getAccountAvatar(acc.id);

                return (
                  <div
                    key={acc.id}
                    onClick={() => handleSelectAccount(acc)}
                    className={`group p-3 sm:p-3.5 rounded-2xl transition-all cursor-pointer border flex items-center justify-between gap-3 select-none ${
                      isActive
                        ? 'bg-rose-950/30 border-rose-600/70 shadow-md ring-1 ring-rose-500/30'
                        : 'bg-slate-900/70 dark:bg-slate-900/70 light:bg-slate-50 hover:bg-slate-900 border-slate-800 dark:border-slate-800 light:border-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Number indicator: 1., 2., 3. */}
                      <span className="text-xs font-mono font-bold text-slate-500 shrink-0 w-4">
                        {index + 1}.
                      </span>

                      {/* Profile Photo / Avatar */}
                      <div className="relative shrink-0">
                        {avatarUrl ? (
                          <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-700 shrink-0 shadow-sm">
                            <img
                              src={avatarUrl}
                              alt={acc.username || 'User'}
                              className="w-full h-full object-cover rounded-full"
                            />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-600 to-pink-500 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
                            {(acc.username || acc.name || 'A').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Account Identity */}
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs sm:text-sm font-bold text-white dark:text-white light:text-slate-900 truncate">
                            {acc.username || acc.name || 'AnimeExplorer'}
                          </span>
                          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {acc.provider === 'google' ? 'Google' : acc.provider === 'apple' ? 'Apple' : 'Verified'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-400 light:text-slate-500 font-mono truncate">
                          {acc.email || 'Email account'}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {isSwitching ? (
                        <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
                      ) : isActive ? (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 shadow-sm">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white transition-colors cursor-pointer active:scale-95"
                        >
                          Switch
                        </button>
                      )}

                      {!isActive && (
                        <button
                          type="button"
                          onClick={e => handleRemoveAccount(e, acc.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800/80 transition-colors cursor-pointer ml-1"
                          title="Remove saved account"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
