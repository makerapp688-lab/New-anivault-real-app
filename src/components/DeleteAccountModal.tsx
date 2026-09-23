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
  RotateCcw
} from 'lucide-react';
import { UserAccount } from '../types.ts';
import { OtpInput } from './OtpInput.tsx';
import { removeSavedAccount, logoutToGuest, removeSessionTokenForAccount } from '../utils/userStorage.ts';

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
  const [verificationCode, setVerificationCode] = useState('');
  const [deletionToken, setDeletionToken] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const isOwner = account.role === 'owner' || account.id === 'usr_owner';

  useEffect(() => {
    if (isOpen) {
      setStep('warning');
      setVerificationCode('');
      setDeletionToken(null);
      setError(null);
      setLoading(false);
      setResendCooldown(0);
    }
  }, [isOpen, account.id]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setInterval(() => {
        setResendCooldown(c => (c > 0 ? c - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [resendCooldown]);

  if (!isOpen) return null;

  const maskEmailAddress = (emailStr?: string) => {
    if (!emailStr || !emailStr.includes('@')) return 'your email';
    const [name, domain] = emailStr.split('@');
    if (name.length <= 2) return `${name[0]}***@${domain}`;
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
  };

  const handleRequestOtp = async () => {
    if (isOwner) {
      setError('The permanent Owner account cannot be deleted from account settings.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const userToken = localStorage.getItem('anivault_user_session_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
        headers['x-anivault-user-session'] = userToken;
      }

      const res = await fetch('/api/auth/delete-account-init', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ accountId: account.id, email: account.email })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send deletion verification code.');
      }

      setMaskedEmail(data.maskedEmail || maskEmailAddress(account.email));
      setStep('otp');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message || 'Could not initiate account deletion.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const userToken = localStorage.getItem('anivault_user_session_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
        headers['x-anivault-user-session'] = userToken;
      }

      const res = await fetch('/api/auth/delete-account-verify', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          accountId: account.id,
          code: verificationCode.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid verification code.');
      }

      setDeletionToken(data.deletionToken);
      setStep('final_confirm');
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please check the code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;

    setLoading(true);
    setError(null);

    try {
      const userToken = localStorage.getItem('anivault_user_session_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
        headers['x-anivault-user-session'] = userToken;
      }

      const res = await fetch('/api/auth/delete-account-resend', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ accountId: account.id })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend verification code.');
      }

      setVerificationCode('');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDeletion = async () => {
    if (!deletionToken) {
      setError('Deletion authorization expired. Please verify again.');
      setStep('otp');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('deleting');

    try {
      const userToken = localStorage.getItem('anivault_user_session_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (userToken) {
        headers['Authorization'] = `Bearer ${userToken}`;
        headers['x-anivault-user-session'] = userToken;
      }

      const res = await fetch('/api/auth/delete-account-confirm', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          accountId: account.id,
          deletionToken
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete account deletion.');
      }

      // 1. Clean up local client-side storage for this account
      try {
        localStorage.removeItem(`anivault_user_data_${account.id}`);
        localStorage.removeItem(`anivault_avatar_${account.id}`);
      } catch {}

      removeSessionTokenForAccount(account.id);
      removeSavedAccount(account.id);
      logoutToGuest();

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
                Delete Account
              </h3>
              <p className="text-xs text-slate-400">
                Permanent deletion of account and saved data
              </p>
            </div>
          </div>

          {step !== 'deleting' && step !== 'success' && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
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

        {/* STEP 1: WARNING & CONFIRMATION */}
        {step === 'warning' && (
          <div className="space-y-4">
            {isOwner ? (
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>Owner Account Protected</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  The permanent Owner account cannot be deleted from account settings. The Owner role is fixed and required to maintain AniVault system governance.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
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
                  <div className="text-slate-300 font-semibold">Security Verification Required:</div>
                  <p>
                    A 6-digit verification code will be dispatched to your account's email ({maskEmailAddress(account.email)}) before deletion can occur.
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
                        <span>Continue</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2: OTP VERIFICATION */}
        {step === 'otp' && (
          <div className="space-y-4">
            <div className="text-center space-y-1.5">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/20">
                <KeyRound className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">
                Verify it's your account
              </h4>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Enter the verification code sent to <span className="font-mono text-rose-300 font-semibold">{maskedEmail}</span> to confirm that you own this account.
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
                disabled={loading || verificationCode.length !== 6}
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
                Code verified. Are you absolutely certain you want to permanently delete <strong className="text-white font-mono">{account.username}</strong>? This action cannot be reversed.
              </p>
            </div>

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
                onClick={handleConfirmDeletion}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white shadow-xl shadow-rose-900/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 border border-rose-500"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>Delete Account</span>}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: DELETING IN PROGRESS */}
        {step === 'deleting' && (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin mx-auto" />
            <h4 className="text-sm font-bold text-white">Permanently deleting account...</h4>
            <p className="text-xs text-slate-400">Cleaning up saved data and revoking sessions.</p>
          </div>
        )}

        {/* STEP 5: SUCCESS */}
        {step === 'success' && (
          <div className="py-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/40">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white">Account Successfully Deleted</h4>
            <p className="text-xs text-slate-400">You have been returned to Guest mode.</p>
          </div>
        )}
      </div>
    </div>
  );
};
export default DeleteAccountModal;
