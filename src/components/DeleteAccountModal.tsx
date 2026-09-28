import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  X,
  KeyRound,
  Trash2,
  Loader2,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  RotateCcw,
  Lock
} from 'lucide-react';
import { UserAccount } from '../types.ts';
import { removeSavedAccount, logoutToGuest, removeSessionTokenForAccount } from '../utils/userStorage.ts';
import { OtpInput } from './OtpInput.tsx';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: UserAccount;
  onAccountDeleted?: () => void;
}

type Step = 'warning' | 'otp' | 'final_confirm' | 'deleting' | 'success';

export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({
  isOpen,
  onClose,
  account,
  onAccountDeleted
}) => {
  const [step, setStep] = useState<Step>('warning');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = account.role === 'owner' || account.id === 'usr_owner';

  useEffect(() => {
    if (isOpen) {
      setStep('warning');
      setOwnerPassword('');
      setVerificationCode('');
      setConfirmInput('');
      setResendCooldown(0);
      setError(null);
      setLoading(false);
    }
  }, [isOpen, account.id]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (isOwner) {
      const ownerToken = localStorage.getItem('anivault_owner_session_token');
      if (ownerToken) {
        headers['Authorization'] = `Bearer ${ownerToken}`;
        headers['x-anivault-owner-session'] = ownerToken;
      }
    } else {
      const userToken = localStorage.getItem('anivault_user_session_token');
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
        headers['x-anivault-user-session'] = userToken;
      }
    }
    return headers;
  };

  const handleRequestOtp = async () => {
    if (isOwner && !ownerPassword.trim()) {
      setError('Please enter your current Owner password to verify ownership.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = isOwner ? '/api/owner/delete-account-init' : '/api/auth/delete-account-init';
      const bodyPayload = isOwner
        ? { password: ownerPassword }
        : { accountId: account.id };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send verification code.');
      }
      setVerificationCode('');
      setResendCooldown(data.cooldownSeconds || (isOwner ? 30 : 20));
      setStep('otp');
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;
    setLoading(true);
    setError(null);

    try {
      const endpoint = isOwner ? '/api/owner/delete-account-resend' : '/api/auth/delete-account-resend';
      const bodyPayload = isOwner ? {} : { accountId: account.id };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend verification code.');
      }
      setVerificationCode('');
      setResendCooldown(data.cooldownSeconds || (isOwner ? 30 : 20));
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanCode = verificationCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const endpoint = isOwner ? '/api/owner/delete-account-verify' : '/api/auth/delete-account-verify';
      const bodyPayload = isOwner
        ? { code: cleanCode }
        : { accountId: account.id, code: cleanCode };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid verification code.');
      }
      setConfirmInput('');
      setStep('final_confirm');
    } catch (err: any) {
      setError(err.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDeletion = async () => {
    if (isOwner && confirmInput.trim().toUpperCase() !== 'DELETE OWNER ACCOUNT') {
      setError('Please type DELETE OWNER ACCOUNT to confirm deletion.');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('deleting');

    try {
      const endpoint = isOwner ? '/api/owner/delete-account-confirm' : '/api/auth/delete-account-confirm';
      const bodyPayload = isOwner
        ? { confirmText: confirmInput.trim() }
        : { accountId: account.id };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete account deletion.');
      }

      if (isOwner) {
        try {
          localStorage.removeItem('anivault_owner_session_token');
        } catch {}
        removeSessionTokenForAccount('usr_owner');
        removeSavedAccount('usr_owner');
        logoutToGuest();
      } else {
        try {
          localStorage.removeItem(`anivault_user_data_${account.id}`);
          localStorage.removeItem(`anivault_avatar_${account.id}`);
        } catch {}
        removeSessionTokenForAccount(account.id);
        removeSavedAccount(account.id);
        logoutToGuest();
      }

      setStep('success');

      setTimeout(() => {
        if (onAccountDeleted) {
          onAccountDeleted();
        }
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete account.');
      setStep('final_confirm');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      onClick={step === 'deleting' ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-modal-title"
    >
      <div
        className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-6 space-y-5 relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 id="delete-account-modal-title" className="text-base font-bold text-white tracking-tight">
                {isOwner ? 'Delete Owner Account' : 'Delete Zenime Account'}
              </h3>
              <p className="text-xs text-slate-400">
                {isOwner
                  ? 'Deletes ONLY the Owner authentication account'
                  : 'Permanent deletion of account and saved data'}
              </p>
            </div>
          </div>

          {step !== 'deleting' && step !== 'success' && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Error notification */}
        {error && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-xs text-rose-300 flex items-start gap-2 animate-shake">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">{error}</div>
          </div>
        )}

        {/* STEP 1: WARNING & OTP DISPATCH */}
        {step === 'warning' && (
          <div className="space-y-4">
            {isOwner ? (
              <>
                <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-900/60 space-y-2.5">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span>Owner Account Deletion Scope</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    This action resets and deletes <strong>ONLY</strong> the Owner authentication account (<span className="font-mono text-white">{account.username}</span>) and invalidates all active Owner sessions.
                  </p>
                  <div className="text-[11px] text-emerald-300/90 bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-2.5 space-y-1">
                    <div className="font-bold text-emerald-300">Protected Application Data (NOT Deleted):</div>
                    <div>• Anime catalogue, verified artwork &amp; watch orders</div>
                    <div>• User accounts, user favorites &amp; watch history</div>
                    <div>• Worker data, source files &amp; website state</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="owner-delete-password-input" className="block text-xs font-bold text-slate-300">
                    Current Owner Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="owner-delete-password-input"
                      type="password"
                      value={ownerPassword}
                      onChange={e => {
                        setOwnerPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Enter current Owner password"
                      disabled={loading}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    After password verification, a 6-digit OTP code will be sent to <span className="font-mono text-slate-200">{account.email}</span>.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="btn-owner-delete-send-otp"
                    onClick={handleRequestOtp}
                    disabled={loading || !ownerPassword.trim()}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Verify &amp; Send OTP</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-900/60 space-y-2.5">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>Permanent Action Notice</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Deleting your account is permanent. All your data will be permanently erased:
                  </p>
                  <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 pl-1">
                    <li>Anime Favorites and Custom Watchlists</li>
                    <li>Recently Viewed History &amp; Completed anime</li>
                    <li>Account profile photo and display preferences</li>
                    <li>Sign-in access for <span className="font-mono text-slate-200">{account.username}</span></li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400 space-y-1">
                  <div className="text-slate-300 font-semibold">Email OTP Verification Required:</div>
                  <p>
                    A 6-digit verification code will be sent to <span className="font-mono text-slate-200">{account.email}</span> to confirm account ownership before deletion.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Send Verification Code</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2: 6-DIGIT OTP VERIFICATION */}
        {step === 'otp' && (
          <div className="space-y-4">
            <div className="text-center space-y-1.5">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/20">
                <KeyRound className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">
                {isOwner ? 'Verify Owner Account Deletion' : 'Verify Account Ownership'}
              </h4>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Enter the 6-digit verification code sent to <span className="font-mono text-rose-300 font-semibold">{account.email}</span>.
              </p>
            </div>

            <div className="space-y-2">
              <OtpInput
                value={verificationCode}
                onChange={val => {
                  setVerificationCode(val);
                  setError(null);
                }}
                disabled={loading}
                autoFocus
                idPrefix="delete-otp"
              />
            </div>

            <div className="text-center pt-1">
              <button
                type="button"
                disabled={resendCooldown > 0 || loading}
                onClick={handleResendOtp}
                className={`text-xs font-semibold inline-flex items-center gap-1 transition-colors ${
                  resendCooldown > 0
                    ? 'text-slate-500 cursor-not-allowed'
                    : 'text-rose-400 hover:text-rose-300 cursor-pointer'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                <span>
                  {resendCooldown > 0
                    ? `Resend Code in ${resendCooldown}s`
                    : "Didn't receive the code? Resend Code"}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep('warning')}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                id="btn-delete-verify-otp"
                disabled={loading || verificationCode.trim().length !== 6}
                onClick={handleVerifyOtp}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Verify Code</span>}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: FINAL DELETION CONFIRMATION */}
        {step === 'final_confirm' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-800 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-600/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/40">
                <Trash2 className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-black text-white uppercase tracking-wider">
                Final Deletion Confirmation
              </h4>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                {isOwner ? (
                  <>
                    Code verified. Confirming will delete ONLY the Owner authentication account (<strong className="text-white font-mono">{account.username}</strong>) and immediately invalidate all active Owner sessions.
                  </>
                ) : (
                  <>
                    Code verified. Are you absolutely certain you want to permanently delete <strong className="text-white font-mono">{account.username}</strong>? This action cannot be reversed.
                  </>
                )}
              </p>
            </div>

            {isOwner && (
              <div className="space-y-1.5">
                <label htmlFor="owner-delete-confirm-text" className="block text-xs font-bold text-slate-300">
                  Type <span className="font-mono text-rose-400">DELETE OWNER ACCOUNT</span> to confirm:
                </label>
                <input
                  id="owner-delete-confirm-text"
                  type="text"
                  value={confirmInput}
                  onChange={e => {
                    setConfirmInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="DELETE OWNER ACCOUNT"
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
              >
                Cancel &amp; Keep Account
              </button>
              <button
                type="button"
                id="btn-confirm-final-delete"
                onClick={handleConfirmDeletion}
                disabled={loading || (isOwner && confirmInput.trim().toUpperCase() !== 'DELETE OWNER ACCOUNT')}
                className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white shadow-xl shadow-rose-900/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 border border-rose-500"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>{isOwner ? 'Delete Owner Account' : 'Delete Account'}</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: DELETING IN PROGRESS */}
        {step === 'deleting' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin mx-auto" />
            <h4 className="text-sm font-bold text-white">
              {isOwner ? 'Deleting Owner account...' : 'Permanently deleting account...'}
            </h4>
            <p className="text-xs text-slate-400">
              {isOwner
                ? 'Removing Owner authentication record and invalidating all active Owner sessions.'
                : 'Cleaning up saved data and revoking sessions.'}
            </p>
          </div>
        )}

        {/* STEP 5: SUCCESS */}
        {step === 'success' && (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/40">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white">
              {isOwner ? 'Owner Account Deleted' : 'Account Successfully Deleted'}
            </h4>
            <p className="text-xs text-slate-400">
              {isOwner
                ? 'All active Owner sessions have been invalidated. Catalogue and website data remain intact.'
                : 'You have been returned to Guest mode.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
export default DeleteAccountModal;
