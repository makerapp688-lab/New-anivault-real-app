import React, { useState, useEffect } from 'react';
import {
  Shield,
  X,
  Mail,
  Lock,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  LogIn,
  UserPlus,
  RotateCcw
} from 'lucide-react';
import { OtpInput } from './OtpInput.tsx';
import { AnivexLogo } from './AnivexLogo.tsx';

interface OwnerLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (owner: { email: string; username: string; role: string }) => void;
}

export const OwnerLoginModal: React.FC<OwnerLoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [ownerExists, setOwnerExists] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'login' | 'login_verify' | 'setup_init' | 'setup_verify'>('login');

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (isOpen) {
      checkOwnerStatus();
      setError(null);
      setSuccessMsg(null);
      setVerificationCode('');
      setResendCooldown(0);
      setShowLoginPassword(false);
      setShowSetupPassword(false);
    }
  }, [isOpen]);

  const checkOwnerStatus = async () => {
    try {
      const res = await fetch('/api/owner/session');
      const data = await res.json();
      setOwnerExists(data.ownerExists);
      if (!data.ownerExists) {
        setMode('setup_init');
      } else {
        setMode('login');
      }
    } catch (err) {
      console.error('Failed to check owner status', err);
    }
  };

  if (!isOpen) return null;

  const handleLoginInit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const cleanEmail = (email || '').trim().toLowerCase();
      const res = await fetch('/api/owner/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password })
      });
      let data: any = {};
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: `HTTP Error ${res.status}` };
      }
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      if (data.requiresVerification) {
        setEmail(data.email || cleanEmail);
        setVerificationCode('');
        setResendCooldown(data.cooldownSeconds || 30);
        setSuccessMsg(data.message || 'Verification code sent to your Owner email.');
        setMode('login_verify');
        return;
      }
      if (data.sessionToken) {
        try {
          localStorage.setItem('anivault_owner_session_token', data.sessionToken);
        } catch {}
      }
      onLoginSuccess(data.owner);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoginVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const cleanCode = verificationCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/owner/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: cleanCode
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed.');
      }
      if (data.sessionToken) {
        try {
          localStorage.setItem('anivault_owner_session_token', data.sessionToken);
        } catch {}
      }
      onLoginSuccess(data.owner);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/owner/login-resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend verification code.');
      }
      setVerificationCode('');
      setResendCooldown(data.cooldownSeconds || 30);
      setSuccessMsg(data.message || 'A new verification code has been sent to your Owner email.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupInit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) {
      setError('Email address is required.');
      return;
    }
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    const cleanUsername = (username || '').trim();
    if (!cleanUsername) {
      setError('Owner username is required.');
      return;
    }
    if (cleanUsername.length < 2 || cleanUsername.length > 30 || !/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
      setError('Username must be between 2 and 30 characters and can only contain letters, numbers, hyphens, and underscores.');
      return;
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/owner/setup-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, username: cleanUsername, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Owner setup failed.');
      }
      setVerificationCode('');
      setResendCooldown(data.cooldownSeconds || 30);
      setSuccessMsg(data.message || 'Verification code sent to your Owner email.');
      setMode('setup_verify');
    } catch (err: any) {
      setError(err.message || 'Owner setup failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const cleanCode = verificationCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/owner/setup-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: cleanCode
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Owner setup verification failed.');
      }
      if (data.sessionToken) {
        try {
          localStorage.setItem('anivault_owner_session_token', data.sessionToken);
        } catch {}
      }
      onLoginSuccess(data.owner);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Owner setup verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/owner/setup-resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resend verification code.');
      }
      setVerificationCode('');
      setResendCooldown(data.cooldownSeconds || 30);
      setSuccessMsg(data.message || 'A new verification code has been sent to your Owner email.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const isLoginTab = mode === 'login' || mode === 'login_verify';
  const isSetupTab = mode === 'setup_init' || mode === 'setup_verify';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in" id="owner-login-modal">
      <div className="relative w-full max-w-md bg-black border-2 border-amber-500/60 rounded-3xl shadow-2xl shadow-amber-950/50 overflow-hidden text-slate-100 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-4">
          <div className="flex items-center gap-3">
            <AnivexLogo size="sm" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight text-white uppercase">Zenime Owner</h2>
                <span className="text-[10px] font-mono font-bold text-amber-400 border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 rounded">
                  &#123;owner&#125;
                </span>
              </div>
              <p className="text-xs text-amber-300/80 font-medium">
                {isLoginTab
                  ? 'Sign in to permanent Owner account'
                  : 'First-time Owner setup only'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* OWNER ACCOUNT OPTIONS SELECTOR */}
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-950 border border-amber-500/30 rounded-2xl" id="owner-account-options-tabs">
          <button
            type="button"
            id="btn-owner-opt-login"
            onClick={() => {
              setMode('login');
              setVerificationCode('');
              setError(null);
              setSuccessMsg(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              isLoginTab
                ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 shadow-md shadow-amber-500/30 border border-amber-300 scale-[1.02]'
                : 'text-amber-200/70 hover:text-white hover:bg-slate-900/80'
            }`}
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            <span>Login Account</span>
          </button>
          <button
            type="button"
            id="btn-owner-opt-create"
            onClick={() => {
              setMode('setup_init');
              setVerificationCode('');
              setError(null);
              setSuccessMsg(null);
            }}
            className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              isSetupTab
                ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-950 shadow-md shadow-amber-500/30 border border-amber-300 scale-[1.02]'
                : 'text-amber-200/70 hover:text-white hover:bg-slate-900/80'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5 shrink-0" />
            <span>Create Owner Account</span>
          </button>
        </div>

        {/* Error / Success Banners */}
        {error && (
          <div className="p-3.5 bg-rose-950/80 border border-rose-800/80 rounded-2xl text-xs text-rose-300 flex items-start gap-2.5 shadow-md">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 bg-emerald-950/80 border border-emerald-800/80 rounded-2xl text-xs text-emerald-300 flex items-start gap-2.5 shadow-md">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{successMsg}</span>
          </div>
        )}

        {/* 1. LOGIN ACCOUNT FORM */}
        {mode === 'login' && (
          <form noValidate onSubmit={handleLoginInit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-amber-200">Owner Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="owner@zenime.app"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-amber-200">Owner Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500 pointer-events-none" />
                <input
                  type={showLoginPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(p => !p)}
                  className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                  aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border border-amber-300"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Send Owner Verification Code</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* 1b. LOGIN OTP VERIFY FORM */}
        {mode === 'login_verify' && (
          <form noValidate onSubmit={handleLoginVerify} className="space-y-4">
            <div className="p-3.5 bg-slate-950 border border-amber-500/40 rounded-2xl space-y-1 text-xs">
              <div className="text-sm font-black text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <span>Verify Owner Sign-In</span>
              </div>
              <p className="text-slate-400 text-xs">
                Enter the 6-digit verification code sent to your authorized Owner email:
              </p>
              <p className="text-amber-400 font-mono font-bold text-xs break-all">
                {email.trim().toLowerCase()}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-amber-200 text-center">
                Enter 6-Digit Verification Code
              </label>
              <OtpInput
                value={verificationCode}
                onChange={val => {
                  setVerificationCode(val);
                  setError(null);
                }}
                disabled={loading}
                autoFocus
                theme="owner"
                idPrefix="owner-login-otp"
              />
            </div>

            <button
              type="submit"
              disabled={loading || verificationCode.trim().length !== 6}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border border-amber-300"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify &amp; Sign In as Owner</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setVerificationCode('');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="text-slate-400 hover:text-amber-300 cursor-pointer transition-colors"
              >
                ← Back to Login
              </button>
              <button
                type="button"
                onClick={handleLoginResend}
                disabled={resendCooldown > 0 || loading}
                className="font-bold text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{resendCooldown > 0 ? `Resend (${resendCooldown}s)` : 'Resend Code'}</span>
              </button>
            </div>
          </form>
        )}

        {/* 2. CREATE OWNER ACCOUNT FORM (First-Time Setup Only) */}
        {mode === 'setup_init' && (
          <div className="space-y-4">
            {ownerExists ? (
              <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-2xl space-y-2 text-xs text-amber-200">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Permanent Owner Account Already Exists</span>
                </div>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
                  Zenime enforces exactly ONE permanent Owner account. The permanent Owner account has already been initialized. Please use <strong>Login Account</strong> to sign in.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Switch to Login Account</span>
                  </button>
                </div>
              </div>
            ) : (
              <form noValidate onSubmit={handleSetupInit} className="space-y-4">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-[11px] text-amber-300 leading-relaxed">
                  <strong>First-Time Setup:</strong> Zenime supports exactly ONE permanent Owner account restricted to the authorized Owner email. A 6-digit verification code will be sent to complete setup.
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-amber-200">Owner Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="owner@zenime.app"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-amber-200">Owner Username</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="e.g. ZenimeOwner"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-amber-200">Owner Password (min 8 chars)</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      type={showSetupPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-950 border border-amber-500/40 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSetupPassword(p => !p)}
                      className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                      aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                    >
                      {showSetupPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal pt-0.5">
                    Remember these credentials — you will use them to log into the Owner account.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border border-amber-300"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  ) : (
                    <>
                      <span>Send Verification Code</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* 3. SETUP VERIFY FORM (Dedicated OTP Screen) */}
        {mode === 'setup_verify' && (
          <form noValidate onSubmit={handleSetupVerify} className="space-y-4">
            <div className="p-3.5 bg-slate-950 border border-amber-500/40 rounded-2xl space-y-1 text-xs">
              <div className="text-sm font-black text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <span>Verify Owner Email</span>
              </div>
              <p className="text-slate-400 text-xs">
                We sent a 6-digit verification code to:
              </p>
              <p className="text-amber-400 font-mono font-bold text-xs break-all">
                {email.trim().toLowerCase()}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-amber-200 text-center">
                Enter 6-Digit Verification Code
              </label>
              <OtpInput
                value={verificationCode}
                onChange={val => {
                  setVerificationCode(val);
                  setError(null);
                }}
                disabled={loading}
                autoFocus
                theme="owner"
                idPrefix="owner-setup-otp"
              />
            </div>

            <button
              type="submit"
              disabled={loading || verificationCode.trim().length !== 6}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border border-amber-300"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify Email &amp; Create Owner</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('setup_init');
                  setVerificationCode('');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="text-slate-400 hover:text-amber-300 cursor-pointer transition-colors"
              >
                ← Back to Setup Details
              </button>
              <button
                type="button"
                onClick={handleSetupResend}
                disabled={resendCooldown > 0 || loading}
                className="font-bold text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{resendCooldown > 0 ? `Resend (${resendCooldown}s)` : 'Resend Code'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
