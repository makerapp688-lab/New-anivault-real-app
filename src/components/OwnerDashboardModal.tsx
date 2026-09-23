import React, { useState, useEffect } from 'react';
import {
  Shield,
  X,
  User,
  Mail,
  Lock,
  Settings,
  Database,
  Image as ImageIcon,
  Users,
  Activity,
  Terminal,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  Camera,
  UserPlus,
  LogIn
} from 'lucide-react';
import { getAccountAvatar } from '../utils/userStorage.ts';

interface OwnerDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onOpenCreateAccount?: () => void;
  onOpenLoginAccount?: () => void;
  onOpenProfilePhoto?: () => void;
}

export const OwnerDashboardModal: React.FC<OwnerDashboardModalProps> = ({
  isOpen,
  onClose,
  onLogout,
  onOpenCreateAccount,
  onOpenLoginAccount,
  onOpenProfilePhoto
}) => {
  const [statusData, setStatusData] = useState<any>(null);
  const [emailStatus, setEmailStatus] = useState<{
    configured: boolean;
    missing: string[];
    hostConfigured: boolean;
    userConfigured: boolean;
    passConfigured: boolean;
    fromConfigured: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; step?: string } | null>(null);
  const [testRecipient, setTestRecipient] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchOwnerStatus();
      fetchEmailStatus();
      setTestResult(null);
    }
  }, [isOpen]);

  const fetchOwnerStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/owner/status');
      if (res.ok) {
        const data = await res.json();
        setStatusData(data);
      }
    } catch (err) {
      console.error('Failed to fetch owner status', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmailStatus = async () => {
    try {
      const res = await fetch('/api/owner/email-status');
      if (res.ok) {
        const data = await res.json();
        setEmailStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch email status', err);
    }
  };

  const handleTestEmailService = async () => {
    setTestingEmail(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/owner/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: testRecipient.trim() || undefined })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message:
            data.step === 'EMAIL_ACCEPTED'
              ? 'SMTP transport connection verified and test message accepted by provider.'
              : 'SMTP transport connection and authentication verified successfully.',
          step: data.step
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'SMTP test failed. Check host, credentials, or network permissions.',
          step: data.step
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to communicate with email testing endpoint.'
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (!isOpen) return null;

  const ownerInfo = statusData?.owner || {
    username: 'Owner',
    email: 'makerapp688@gmail.com',
    role: 'owner'
  };

  const ownerAvatar = getAccountAvatar('usr_owner');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      id="owner-dashboard-modal"
    >
      <div className="relative w-full max-w-2xl bg-slate-950 border-2 border-amber-500/50 rounded-3xl shadow-2xl overflow-y-auto max-h-[90vh] text-slate-100 p-5 sm:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/10">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-white">OWNER DASHBOARD</h2>
              <p className="text-xs text-amber-300/80">AniVault System Administration &amp; Security Command</p>
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

        {/* Owner Profile Identity Card (BLACK + GOLD) */}
        <div className="bg-black border-2 border-amber-500/60 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Owner Avatar with tap to change photo */}
              <div
                onClick={() => {
                  if (onOpenProfilePhoto) {
                    onOpenProfilePhoto();
                  }
                }}
                className="relative group cursor-pointer"
                title="Change Owner Profile Photo"
              >
                {ownerAvatar ? (
                  <div className="w-16 h-16 rounded-full overflow-hidden border border-slate-700 shadow-lg shrink-0">
                    <img
                      src={ownerAvatar}
                      alt="Owner Avatar"
                      className="w-full h-full object-cover rounded-full"
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center text-slate-950 text-xl font-black shadow-lg shadow-amber-600/30 border border-amber-400 shrink-0">
                    <Shield className="w-8 h-8 text-slate-950" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-amber-300">
                  <Camera className="w-5 h-5" />
                </div>
              </div>

              <div className="space-y-1">
                {/* OwnerUsername + {owner} badge (GOLD) */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-black text-white tracking-tight">
                    {ownerInfo.username || 'Owner'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold text-amber-400 border border-amber-400/60 bg-amber-500/15">
                    &#123;owner&#125;
                  </span>
                </div>

                {/* Role line: Owner */}
                <div className="text-xs font-semibold text-amber-300/90">
                  Owner
                </div>

                {/* Dynamic Email line */}
                <div className="text-xs text-amber-200/70 font-mono">
                  {ownerInfo.email}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              {onOpenProfilePhoto && (
                <button
                  type="button"
                  onClick={onOpenProfilePhoto}
                  className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Photo</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Owner Logout</span>
              </button>
            </div>
          </div>
        </div>

        {/* SECTION: Normal Account Access (Create Account / Log In) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                User Account Access
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Max 3 switcher accounts
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Create or log in to AniVault user accounts on this device. (The Owner role remains permanently restricted to the single verified system owner).
          </p>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenCreateAccount) onOpenCreateAccount();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/20 flex items-center gap-1.5 transition-all cursor-pointer border border-rose-500/40"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenLoginAccount) onOpenLoginAccount();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-rose-400" />
              <span>Log In</span>
            </button>
          </div>
        </div>

        {/* Requirement 6: Owner-Only Email Service Status Area */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Email Service Status (Owner Diagnostics)
              </span>
            </div>
            <button
              type="button"
              onClick={fetchEmailStatus}
              className="text-[11px] text-slate-400 hover:text-amber-400 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Status</span>
            </button>
          </div>

          {/* Status Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-medium">Email Service:</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  emailStatus?.configured
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {emailStatus?.configured ? 'Configured' : 'Not Configured'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-medium">SMTP Host:</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  emailStatus?.hostConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {emailStatus?.hostConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-medium">SMTP User:</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  emailStatus?.userConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {emailStatus?.userConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-400 font-medium">SMTP Password:</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  emailStatus?.passConfigured
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                }`}
              >
                {emailStatus?.passConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>
          </div>

          {/* Test Email Transmitter */}
          <div className="pt-2 border-t border-slate-800/80 space-y-3">
            <div className="text-xs font-semibold text-slate-300">
              Send Test Email from AniVault Server
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={testRecipient}
                onChange={e => setTestRecipient(e.target.value)}
                placeholder={`Recipient email (defaults to ${ownerInfo.email})`}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleTestEmailService}
                disabled={testingEmail}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {testingEmail ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Send Test</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                    : 'bg-rose-950/80 border border-rose-800 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <p className="font-semibold">{testResult.success ? 'SMTP Success' : 'SMTP Error'}</p>
                  <p className="text-[11px] opacity-90">{testResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
