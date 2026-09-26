import React, { useState, useEffect, useMemo } from 'react';
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
  LogIn,
  Search,
  Trash2,
  Edit2,
  Filter,
  Check,
  AlertTriangle,
  Info,
  Clock,
  ExternalLink,
  ChevronRight,
  Eye,
  FileText
} from 'lucide-react';
import { getAccountAvatar, resolveOwnerUsername } from '../utils/userStorage.ts';
import { Anime } from '../types.ts';
import { ArtworkManager } from './ArtworkManager.tsx';

interface OwnerDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  onOpenCreateAccount?: () => void;
  onOpenLoginAccount?: () => void;
  onOpenProfilePhoto?: () => void;
  initialTab?: string;
}

type AdminTab =
  | 'overview'
  | 'bugs'
  | 'catalogue'
  | 'artwork'
  | 'users'
  | 'settings'
  | 'audit';

export const OwnerDashboardModal: React.FC<OwnerDashboardModalProps> = ({
  isOpen,
  onClose,
  onLogout,
  onOpenCreateAccount,
  onOpenLoginAccount,
  onOpenProfilePhoto,
  initialTab
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);
  const [statsData, setStatsData] = useState<any>(null);
  const [diagData, setDiagData] = useState<any>(null);

  // Email Config Diagnostics (original feature)
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; step?: string } | null>(null);
  const [testRecipient, setTestRecipient] = useState('');

  // Bug Reports Tab State
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [selectedBug, setSelectedBug] = useState<any>(null);
  const [bugStatusFilter, setBugStatusFilter] = useState<string>('all');
  const [updatingBug, setUpdatingBug] = useState(false);
  const [bugNoteInput, setBugNoteInput] = useState('');
  const [bugStatusInput, setBugStatusInput] = useState('');

  // Catalogue Tab State
  const [catalogueList, setCatalogueList] = useState<Anime[]>([]);
  const [catSearchQuery, setCatSearchQuery] = useState('');
  const [catStatusFilter, setCatStatusFilter] = useState('all');
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [isDeletingAnime, setIsDeletingAnime] = useState(false);
  const [savingAnime, setSavingAnime] = useState(false);
  const [catSuccessMsg, setCatSuccessMsg] = useState('');
  const [catErrorMsg, setCatErrorMsg] = useState('');

  // Catalogue Editing Form State
  const [editTitle, setEditTitle] = useState('');
  const [editAltTitle, setEditAltTitle] = useState('');
  const [editType, setEditType] = useState('TV');
  const [editStatus, setEditStatus] = useState('Ongoing');
  const [editReleaseYear, setEditReleaseYear] = useState<number>(2024);
  const [editSynopsis, setEditSynopsis] = useState('');
  const [editGenres, setEditGenres] = useState<string[]>([]);
  const [editEpisodes, setEditEpisodes] = useState<number>(0);
  const [editProviderId, setEditProviderId] = useState('');
  const [editDubLanguage, setEditDubLanguage] = useState('');

  // Artwork Tab State
  const [artFilter, setArtFilter] = useState<'all' | 'verified' | 'unverified' | 'missing'>('all');
  const [selectedArtAnime, setSelectedArtAnime] = useState<Anime | null>(null);
  const [artUrlInput, setArtUrlInput] = useState('');
  const [artStatusInput, setArtStatusInput] = useState<'verified' | 'unverified'>('unverified');
  const [savingArtwork, setSavingArtwork] = useState(false);

  // Users Tab State
  const [usersList, setUsersList] = useState<any[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  // Audit Logs Tab State
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditSearchQuery, setAuditSearchQuery] = useState('');

  // Load overview metrics, diagnostics, etc.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';

      if (initialTab) {
        setActiveTab(initialTab as AdminTab);
      } else {
        setActiveTab('overview');
      }
      fetchAdminStats();
      fetchEmailStatus();
      fetchDiagData();
      fetchBugReports();
      fetchCatalogue();
      fetchUsers();
      fetchAuditLogs();
      setTestResult(null);
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [isOpen, initialTab]);

  const fetchAdminStats = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/owner/admin-stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStatsData(data);
      }
    } catch (err) {
      console.error('Failed to fetch admin stats', err);
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

  const fetchDiagData = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/owner/settings-diagnostics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDiagData(data);
      }
    } catch (err) {
      console.error('Failed to fetch diagnostics', err);
    }
  };

  const fetchBugReports = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/bug-reports/owner/list', {
        headers: { 'X-Owner-Session': token, 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setBugReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to fetch bug reports', err);
    }
  };

  const fetchCatalogue = async () => {
    try {
      const res = await fetch('/api/anime?limit=all');
      if (res.ok) {
        const data = await res.json();
        setCatalogueList(data.anime || []);
      }
    } catch (err) {
      console.error('Failed to fetch catalogue list', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/owner/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch('/api/owner/audit-logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs', err);
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

  // Bug Report Actions
  const handleSelectBug = (bug: any) => {
    setSelectedBug(bug);
    setBugStatusInput(bug.status);
    setBugNoteInput(bug.internalNotes || '');
  };

  const handleUpdateBug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBug) return;
    setUpdatingBug(true);
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch(`/api/bug-reports/owner/report/${selectedBug.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Session': token,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: bugStatusInput,
          internalNote: bugNoteInput
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedBug(data.report);
        fetchBugReports();
        fetchAdminStats(); // refresh audit logs & stats
      }
    } catch (err) {
      console.error('Failed to update bug report', err);
    } finally {
      setUpdatingBug(false);
    }
  };

  // User Actions
  const handleToggleUserAccess = async (userId: string) => {
    setTogglingUserId(userId);
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch(`/api/owner/users/${userId}/toggle-access`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUsers();
        fetchAdminStats();
      }
    } catch (err) {
      console.error('Failed to toggle user access', err);
    } finally {
      setTogglingUserId(null);
    }
  };

  // Catalogue Actions
  const handleSelectAnimeEdit = (anime: Anime) => {
    setSelectedAnime(anime);
    setEditTitle(anime.title);
    setEditAltTitle(anime.alternateTitle || '');
    setEditType(anime.type);
    setEditStatus(anime.status);
    setEditReleaseYear(anime.releaseYear || 2024);
    setEditSynopsis(anime.synopsis || '');
    setEditGenres(anime.genres || []);
    setEditEpisodes(anime.totalEpisodes || 0);
    setEditProviderId(anime.providers?.raretoonIndia?.providerAnimeId || '');
    setEditDubLanguage(anime.providers?.raretoonIndia?.dubLanguage || '');
    setCatSuccessMsg('');
    setCatErrorMsg('');
  };

  const handleSaveAnime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnime) return;
    setSavingAnime(true);
    setCatSuccessMsg('');
    setCatErrorMsg('');
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch(`/api/owner/catalogue/${selectedAnime.id}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: editTitle,
          alternateTitle: editAltTitle,
          type: editType,
          status: editStatus,
          releaseYear: editReleaseYear,
          synopsis: editSynopsis,
          genres: editGenres,
          totalEpisodes: editEpisodes,
          providerAnimeId: editProviderId,
          dubLanguage: editDubLanguage
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCatSuccessMsg(data.message || 'Anime updated successfully.');
        setSelectedAnime(data.anime);
        fetchCatalogue();
        fetchAdminStats();
      } else {
        setCatErrorMsg(data.error || 'Failed to save catalogue record.');
      }
    } catch (err: any) {
      setCatErrorMsg(err.message || 'Failed to connect to backend server.');
    } finally {
      setSavingAnime(false);
    }
  };

  const handleDeleteAnime = async () => {
    if (!selectedAnime) return;
    if (!window.confirm(`Are you absolutely sure you want to permanently delete "${selectedAnime.title}"? This cannot be undone.`)) {
      return;
    }
    setIsDeletingAnime(true);
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch(`/api/owner/catalogue/${selectedAnime.id}/delete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert('Anime title has been permanently deleted.');
        setSelectedAnime(null);
        fetchCatalogue();
        fetchAdminStats();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete anime.');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete.');
    } finally {
      setIsDeletingAnime(false);
    }
  };

  // Artwork Actions
  const handleSelectArtEdit = (anime: Anime) => {
    setSelectedArtAnime(anime);
    setArtUrlInput(anime.artwork?.verifiedArtworkUrl || '');
    setArtStatusInput(anime.artwork?.verificationStatus === 'verified' ? 'verified' : 'unverified');
  };

  const handleSaveArtwork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedArtAnime) return;
    setSavingArtwork(true);
    try {
      const token = localStorage.getItem('anivault_owner_session_token') || '';
      const res = await fetch(`/api/owner/artwork/${selectedArtAnime.id}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          verifiedArtworkUrl: artUrlInput,
          verificationStatus: artStatusInput
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedArtAnime(data.anime);
        fetchCatalogue();
        fetchAdminStats();
        alert('Poster artwork configuration updated.');
      } else {
        alert(data.error || 'Failed to save artwork.');
      }
    } catch (err: any) {
      alert(err.message || 'Error updating artwork.');
    } finally {
      setSavingArtwork(false);
    }
  };

  // Genre toggling for editing form
  const toggleGenreSelection = (genre: string) => {
    if (editGenres.includes(genre)) {
      setEditGenres(editGenres.filter(g => g !== genre));
    } else {
      setEditGenres([...editGenres, genre]);
    }
  };

  const ALL_GENRES_OPTIONS = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Sci-Fi', 
    'Supernatural', 'Thriller', 'Slice of Life', 'Sports', 'Mecha', 'Mystery'
  ];

  // Filtering Computations
  const filteredBugs = useMemo(() => {
    return bugReports.filter(bug => {
      if (bugStatusFilter === 'all') return true;
      return bug.status.toLowerCase() === bugStatusFilter.toLowerCase();
    });
  }, [bugReports, bugStatusFilter]);

  const filteredCatalogue = useMemo(() => {
    return catalogueList.filter(anime => {
      const matchSearch =
        anime.title.toLowerCase().includes(catSearchQuery.toLowerCase()) ||
        (anime.alternateTitle || '').toLowerCase().includes(catSearchQuery.toLowerCase()) ||
        (anime.providers?.raretoonIndia?.providerAnimeId || '').toLowerCase().includes(catSearchQuery.toLowerCase());

      const matchStatus = catStatusFilter === 'all' || anime.status.toLowerCase() === catStatusFilter.toLowerCase();

      return matchSearch && matchStatus;
    });
  }, [catalogueList, catSearchQuery, catStatusFilter]);

  const filteredArtCatalogue = useMemo(() => {
    return catalogueList.filter(anime => {
      const matchSearch =
        anime.title.toLowerCase().includes(catSearchQuery.toLowerCase()) ||
        (anime.alternateTitle || '').toLowerCase().includes(catSearchQuery.toLowerCase());

      const verifiedUrl = anime.artwork?.verifiedArtworkUrl;
      const originalUrl = anime.artwork?.originalArtworkUrl;
      const isVerified = anime.artwork?.verificationStatus === 'verified';

      let matchArt = true;
      if (artFilter === 'verified') {
        matchArt = Boolean(verifiedUrl && isVerified);
      } else if (artFilter === 'unverified') {
        matchArt = Boolean(originalUrl && !isVerified);
      } else if (artFilter === 'missing') {
        matchArt = !verifiedUrl && !originalUrl;
      }

      return matchSearch && matchArt;
    });
  }, [catalogueList, catSearchQuery, artFilter]);

  const filteredUsers = useMemo(() => {
    return usersList.filter(u => {
      return (
        u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        u.id.toLowerCase().includes(userSearchQuery.toLowerCase())
      );
    });
  }, [usersList, userSearchQuery]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      return (
        log.action.toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
        (log.operator || '').toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
        (log.recordId || '').toLowerCase().includes(auditSearchQuery.toLowerCase()) ||
        (log.details || '').toLowerCase().includes(auditSearchQuery.toLowerCase())
      );
    });
  }, [auditLogs, auditSearchQuery]);

  if (!isOpen) return null;

  const ownerInfo = {
    username: resolveOwnerUsername(statsData?.owner?.username),
    email: statsData?.owner?.email || 'makerapp688@gmail.com',
    role: 'owner'
  };

  const ownerAvatar = getAccountAvatar('usr_owner');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-4 bg-black/90 backdrop-blur-sm animate-fade-in overscroll-contain overflow-hidden"
      id="owner-dashboard-modal"
    >
      <div className="relative w-full max-w-6xl bg-slate-950 border-2 border-amber-500/50 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[96dvh] sm:h-[90vh] max-w-full text-slate-100 touch-pan-y">
        {/* Header (BLACK & GOLD) */}
        <div className="flex items-center justify-between border-b border-amber-500/30 p-3.5 sm:p-5 shrink-0 bg-black gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/10 shrink-0">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-xl font-black tracking-tight text-white flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span className="truncate">OWNER COMMAND CENTER</span>
                <span className="text-[9px] sm:text-[10px] uppercase font-mono tracking-widest px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-amber-300 shrink-0">
                  v2.5 ADMIN
                </span>
              </h2>
              <p className="text-[11px] sm:text-xs text-amber-300/80 truncate">Anivex Core System, Catalogue &amp; Security Controller</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-900 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Horizontal Navigation Tabs (Custom scrollable for mobile responsiveness) */}
        <div className="bg-slate-950 border-b border-slate-900 overflow-x-auto scrollbar-none flex shrink-0">
          <div className="flex gap-1 p-2 min-w-max">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('bugs')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 relative ${
                activeTab === 'bugs'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span>Bug Reports</span>
              {statsData?.newBugReportsCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('catalogue')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'catalogue'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>Catalogue</span>
            </button>

            <button
              onClick={() => setActiveTab('artwork')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'artwork'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Artwork Manager</span>
            </button>

            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'users'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>User Management</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'audit'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Audit Logs</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'settings'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>System Diagnostics</span>
            </button>
          </div>
        </div>

        {/* Tab Content Panel (Scrollable body area) */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 sm:p-6 space-y-5 sm:space-y-6 bg-slate-950/40">
          {loading && activeTab === 'overview' && (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
              <p className="text-xs text-slate-400">Loading system admin data...</p>
            </div>
          )}

          {/* 1. OVERVIEW TAB */}
          {activeTab === 'overview' && statsData && (
            <div className="space-y-6 animate-fade-in">
              {/* Quick stats board */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-1">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Catalogue Size</div>
                  <div className="text-2xl font-black text-white">{statsData.catalogueCount}</div>
                  <p className="text-[10px] text-amber-400">Verified Anime Titles</p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-1">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Active Users</div>
                  <div className="text-2xl font-black text-white">{statsData.userCount}</div>
                  <p className="text-[10px] text-emerald-400">Registered Accounts</p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-1">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Bug Reports</div>
                  <div className="text-2xl font-black text-rose-400 flex items-center gap-2">
                    <span>{statsData.bugReportsCount}</span>
                    {statsData.newBugReportsCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-500 text-white animate-pulse">
                        {statsData.newBugReportsCount} NEW
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">Submitted by userbase</p>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-1">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">System Health</div>
                  <div className="text-2xl font-black text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-ping"></span>
                    <span>ONLINE</span>
                  </div>
                  <p className="text-[10px] text-emerald-300">Diagnostics healthy</p>
                </div>
              </div>

              {/* Artwork Heath Sub-Board */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <ImageIcon className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Catalogue Artwork Registry Health</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-slate-400">Verified Posters:</span>
                    <span className="text-sm font-bold text-emerald-400">{statsData.artworkStats?.verified || 0}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-slate-400">Unverified/Fallback Posters:</span>
                    <span className="text-sm font-bold text-amber-400">{statsData.artworkStats?.unverified || 0}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-slate-400">Missing Artwork:</span>
                    <span className="text-sm font-bold text-rose-400">{statsData.artworkStats?.missing || 0}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Unverified/Fallback artwork uses scraped provider imagery that might be incorrect. To enforce total integrity, use the <strong className="text-amber-400">Artwork Management</strong> tab to manually replace any random/broken posters with correct high-quality links and mark them as verified.
                </p>
              </div>

              {/* Owner Profile Identity card & Switcher */}
              <div className="bg-black border-2 border-amber-500/40 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {ownerAvatar ? (
                        <div className="w-14 h-14 rounded-full overflow-hidden border border-slate-800 shrink-0">
                          <img src={ownerAvatar} alt="Owner" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-amber-500 flex items-center justify-center text-slate-950 text-xl font-black border border-amber-400 shrink-0">
                          <Shield className="w-7 h-7" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-white text-base">{ownerInfo.username}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold text-amber-400 border border-amber-400/50 bg-amber-500/10">
                          &#123;owner&#125;
                        </span>
                      </div>
                      <div className="text-xs text-amber-300 font-semibold">Active Administration Session</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">{ownerInfo.email}</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {onOpenProfilePhoto && (
                      <button
                        onClick={onOpenProfilePhoto}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Photo</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onClose();
                        onLogout();
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Logout Owner</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Email service transmitter matrix (Original feature preserved and enhanced) */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Email Service Status (Owner Diagnostics)
                    </span>
                  </div>
                  <button
                    onClick={fetchEmailStatus}
                    className="text-[11px] text-slate-400 hover:text-amber-400 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3 h-3 animate-pulse" />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <span className="text-slate-400">Email:</span>
                    <span className={`px-2 py-0.5 rounded font-mono font-bold ${emailStatus?.configured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {emailStatus?.configured ? 'Configured' : 'Missing'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <span className="text-slate-400">Host:</span>
                    <span className={`px-2 py-0.5 rounded font-mono font-bold ${emailStatus?.hostConfigured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {emailStatus?.hostConfigured ? 'OK' : 'Missing'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <span className="text-slate-400">User:</span>
                    <span className={`px-2 py-0.5 rounded font-mono font-bold ${emailStatus?.userConfigured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {emailStatus?.userConfigured ? 'OK' : 'Missing'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                    <span className="text-slate-400">Pass:</span>
                    <span className={`px-2 py-0.5 rounded font-mono font-bold ${emailStatus?.passConfigured ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {emailStatus?.passConfigured ? 'OK' : 'Missing'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 space-y-3">
                  <div className="text-xs font-semibold text-slate-300">Send Test Email from Anivex Server</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={testRecipient}
                      onChange={e => setTestRecipient(e.target.value)}
                      placeholder={`Recipient email (defaults to ${ownerInfo.email})`}
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                    <button
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
                    <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${testResult.success ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300' : 'bg-rose-950/80 border border-rose-800 text-rose-300'}`}>
                      {testResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">{testResult.success ? 'SMTP Connection Success' : 'SMTP Connection Error'}</p>
                        <p className="text-[11px] opacity-90">{testResult.message}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* User Account Access Switching / Creation Row */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-rose-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      User Account Controller
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">Max 3 accounts</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Log in or register standard user accounts to test favorites/watchlist persistence. Standard accounts remain strictly isolated from system administration privileges.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenCreateAccount) onOpenCreateAccount();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Create User</span>
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenLoginAccount) onOpenLoginAccount();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5 text-rose-400" />
                    <span>Switch Login</span>
                  </button>
                </div>
              </div>

              {/* Recent Audit Action Feed */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Recent Administrative Activities (Audit Feed)
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className="text-xs text-amber-400 hover:underline"
                  >
                    View All Logs →
                  </button>
                </div>
                <div className="space-y-2 max-h-[250px] overflow-y-auto">
                  {statsData.recentActivity && statsData.recentActivity.length > 0 ? (
                    statsData.recentActivity.map((log: any) => (
                      <div key={log.id} className="p-3 bg-slate-950 border border-slate-900 rounded-xl text-xs flex justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="font-bold text-slate-200">{log.action}</p>
                          <p className="text-[10px] text-slate-400">{log.operator} — {log.details}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${log.result === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                            {log.result.toUpperCase()}
                          </span>
                          <p className="text-[9px] text-slate-500 mt-1">{new Date(log.timestamp).toLocaleTimeString()}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No recent activity found. Execute actions to populate logs.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. BUG REPORTS TAB */}
          {activeTab === 'bugs' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Bugs List (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh]">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4 shrink-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-200">User Bug Submissions</div>
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={bugStatusFilter}
                      onChange={e => setBugStatusFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-2 py-1 outline-none"
                    >
                      <option value="all">All Status</option>
                      <option value="new">New</option>
                      <option value="investigating">Investigating</option>
                      <option value="fixed">Fixed</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5">
                  {filteredBugs.length > 0 ? (
                    filteredBugs.map(bug => (
                      <div
                        key={bug.id}
                        onClick={() => handleSelectBug(bug)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer text-xs ${
                          selectedBug?.id === bug.id
                            ? 'bg-amber-500/10 border-amber-500/60 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="font-bold text-slate-200 truncate">{bug.whatHappened}</div>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                              bug.status === 'New'
                                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                : bug.status === 'Investigating'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : bug.status === 'Fixed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {bug.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 mt-2">
                          <span>{bug.id} • {bug.diagnostics?.relevantFeature}</span>
                          <span>{new Date(bug.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                      <AlertCircle className="w-8 h-8 opacity-40 mb-2" />
                      <p>No matching bug reports found.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Bug Details Controller (5 cols) */}
              <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh] overflow-y-auto">
                {selectedBug ? (
                  <form onSubmit={handleUpdateBug} className="space-y-4">
                    <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
                      <div className="font-black text-white text-xs">{selectedBug.id}</div>
                      <span className="text-[10px] text-slate-400">{new Date(selectedBug.createdAt).toLocaleString()}</span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">What happened</div>
                        <p className="text-xs text-white bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 mt-1 whitespace-pre-wrap">{selectedBug.whatHappened}</p>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">What they tried to do</div>
                        <p className="text-xs text-white bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 mt-1 whitespace-pre-wrap">{selectedBug.whatWereYouTryingToDo}</p>
                      </div>

                      {selectedBug.additionalDetails && (
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Additional details</div>
                          <p className="text-xs text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 mt-1 whitespace-pre-wrap">{selectedBug.additionalDetails}</p>
                        </div>
                      )}

                      {/* Display image attachments directly for inspection */}
                      {selectedBug.attachment && (
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5 text-amber-400" />
                            <span>Attachment Preview</span>
                          </div>
                          {selectedBug.attachment.fileType?.startsWith('image/') ? (
                            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 max-h-[150px]">
                              <img
                                src={`/api/bug-reports/owner/attachment/${selectedBug.id}`}
                                alt="Attachment"
                                className="w-full h-full object-contain cursor-zoom-in"
                                onClick={() => window.open(`/api/bug-reports/owner/attachment/${selectedBug.id}`, '_blank')}
                              />
                            </div>
                          ) : (
                            <a
                              href={`/api/bug-reports/owner/attachment/${selectedBug.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs hover:border-amber-500 text-amber-400 transition-all cursor-pointer"
                            >
                              <span className="truncate">{selectedBug.attachment.fileName}</span>
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="border-t border-slate-800 pt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-900">
                          <div>
                            <span className="font-semibold block text-slate-400">Reporter:</span>
                            <span className="text-slate-200">{selectedBug.reporterProfile?.username || 'Guest'}</span>
                          </div>
                          <div>
                            <span className="font-semibold block text-slate-400">Route Location:</span>
                            <span className="text-slate-200">{selectedBug.diagnostics?.currentRoute}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="font-semibold block text-slate-400">Browser / User Agent:</span>
                            <span className="text-slate-200 truncate block">{selectedBug.diagnostics?.devicePlatform}</span>
                          </div>
                        </div>
                      </div>

                      {/* Administrative Note Controls */}
                      <div className="border-t border-slate-800 pt-3 space-y-3">
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Bug Status</label>
                            <select
                              value={bugStatusInput}
                              onChange={e => setBugStatusInput(e.target.value)}
                              className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white outline-none focus:border-amber-500"
                            >
                              <option value="New">New</option>
                              <option value="Investigating">Investigating</option>
                              <option value="Fixed">Fixed</option>
                              <option value="Closed">Closed</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Administrative Internal Notes</label>
                          <textarea
                            value={bugNoteInput}
                            onChange={e => setBugNoteInput(e.target.value)}
                            placeholder="Add developer diagnostics, status or tracking details..."
                            className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white outline-none focus:border-amber-500 h-16 resize-none"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={updatingBug}
                          className="w-full py-2 bg-amber-500 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 hover:bg-amber-400"
                        >
                          {updatingBug ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Save Administrative Notes</span>
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center py-10">
                    <Info className="w-8 h-8 opacity-40 mb-2" />
                    <p className="text-xs">Select a bug report from the left panel to inspect details, view attachments, and add developer notes.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. CATALOGUE MANAGEMENT TAB */}
          {activeTab === 'catalogue' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Left Panel: Search & List (5 cols) */}
              <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh]">
                <div className="space-y-3 shrink-0 mb-4">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={catSearchQuery}
                      onChange={e => setCatSearchQuery(e.target.value)}
                      placeholder="Search anime catalogue..."
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={catStatusFilter}
                      onChange={e => setCatStatusFilter(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl text-xs p-1.5 text-slate-300 outline-none"
                    >
                      <option value="all">All Status</option>
                      <option value="Completed">Completed</option>
                      <option value="Ongoing">Ongoing</option>
                    </select>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {filteredCatalogue.length > 0 ? (
                    filteredCatalogue.map(anime => (
                      <div
                        key={anime.id}
                        onClick={() => handleSelectAnimeEdit(anime)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer text-xs flex justify-between items-center ${
                          selectedAnime?.id === anime.id
                            ? 'bg-amber-500/10 border-amber-500/60'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="truncate pr-2">
                          <p className="font-bold text-slate-200 truncate">{anime.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{anime.type} • {anime.releaseYear || 'No Year'}</p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${anime.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                            {anime.status}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-20 text-center text-slate-500 text-xs">No matching titles found.</div>
                  )}
                </div>
              </div>

              {/* Right Panel: Edit Editor (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh] overflow-y-auto">
                {selectedAnime ? (
                  <form onSubmit={handleSaveAnime} className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div>
                        <span className="text-[10px] font-bold font-mono text-amber-400 uppercase">Anime Editor</span>
                        <h4 className="text-sm font-black text-white mt-0.5">{selectedAnime.title}</h4>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeleteAnime}
                        disabled={isDeletingAnime}
                        className="px-3 py-1.5 bg-rose-950 text-rose-300 hover:bg-rose-900 border border-rose-800 rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Title</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Anime Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Alternate Title</label>
                        <input
                          type="text"
                          value={editAltTitle}
                          onChange={e => setEditAltTitle(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Type</label>
                        <select
                          value={editType}
                          onChange={e => setEditType(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        >
                          <option value="TV">TV</option>
                          <option value="Movie">Movie</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Status</label>
                        <select
                          value={editStatus}
                          onChange={e => setEditStatus(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        >
                          <option value="Completed">Completed</option>
                          <option value="Ongoing">Ongoing</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Release Year</label>
                        <input
                          type="number"
                          value={editReleaseYear}
                          onChange={e => setEditReleaseYear(parseInt(e.target.value) || 2024)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Episodes Count</label>
                        <input
                          type="number"
                          value={editEpisodes}
                          onChange={e => setEditEpisodes(parseInt(e.target.value) || 0)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Provider Anime ID (RareToon)</label>
                        <input
                          type="text"
                          value={editProviderId}
                          onChange={e => setEditProviderId(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Dub / Language Information</label>
                        <input
                          type="text"
                          value={editDubLanguage}
                          onChange={e => setEditDubLanguage(e.target.value)}
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Synopsis / Story Description</label>
                      <textarea
                        value={editSynopsis}
                        onChange={e => setEditSynopsis(e.target.value)}
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 h-24 resize-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Anime Genres Selection</label>
                      <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-950 border border-slate-800 rounded-xl max-h-[100px] overflow-y-auto">
                        {ALL_GENRES_OPTIONS.map(genre => {
                          const isSelected = editGenres.includes(genre);
                          return (
                            <button
                              type="button"
                              key={genre}
                              onClick={() => toggleGenreSelection(genre)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all border ${
                                isSelected
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              {genre}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {catSuccessMsg && <p className="text-xs text-emerald-400 font-bold">{catSuccessMsg}</p>}
                    {catErrorMsg && <p className="text-xs text-rose-400 font-bold">{catErrorMsg}</p>}

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={savingAnime}
                        className="w-full py-2 bg-amber-500 text-slate-950 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 hover:bg-amber-400 shadow-lg"
                      >
                        {savingAnime ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Save Catalogue Corrections</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-center py-10">
                    <Database className="w-8 h-8 opacity-40 mb-2" />
                    <p className="text-xs">Select an anime from the list to modify its title, status, metadata, seasons, episode details, or provider IDs.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. ARTWORK MANAGER (AUTOMATED INTEGRITY ENGINE) */}
          {activeTab === 'artwork' && (
            <ArtworkManager />
          )}

          {/* 5. USER MANAGEMENT TAB */}
          {activeTab === 'users' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh] animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-3 mb-4 shrink-0">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-200">Registered Accounts &amp; Access Controls</div>
                  <p className="text-[10px] text-slate-400 mt-0.5">Toggle account disabled/enabled statuses</p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={e => setUserSearchQuery(e.target.value)}
                    placeholder="Search user profile..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {filteredUsers.length > 0 ? (
                  filteredUsers.map(user => {
                    const isUserOwner = user.role === 'owner' || user.id === 'usr_owner';
                    return (
                      <div key={user.id} className="p-3.5 bg-slate-950 border border-slate-800 hover:border-slate-700/80 rounded-xl text-xs flex justify-between items-center gap-4 transition-all">
                        <div className="space-y-1 truncate pr-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-200">{isUserOwner ? resolveOwnerUsername(user.username) : (user.username || 'No Username')}</span>
                            <span className={`px-2 py-0.2 rounded text-[9px] font-mono font-bold ${
                              isUserOwner
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-400/30'
                                : user.id === 'guest_user'
                                ? 'bg-amber-500/10 text-amber-300'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                              {user.role}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono truncate">{user.email || 'Local Session Explorer'}</p>
                          <p className="text-[9px] text-slate-500">Created: {new Date(user.createdAt || Date.now()).toLocaleDateString()} • Last Active: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}</p>
                        </div>

                        <div className="shrink-0">
                          {isUserOwner ? (
                            <span className="px-2 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[10px] font-bold rounded">
                              Permanent Owner Access
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleUserAccess(user.id)}
                              disabled={togglingUserId === user.id}
                              className={`px-3 py-1.5 font-bold text-[10px] rounded-lg border cursor-pointer transition-all ${
                                user.disabled
                                  ? 'bg-rose-950/40 text-rose-400 border-rose-800 hover:bg-rose-900/40'
                                  : 'bg-emerald-950/40 text-emerald-400 border-emerald-800 hover:bg-emerald-900/40'
                              }`}
                            >
                              {togglingUserId === user.id ? (
                                <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                              ) : user.disabled ? (
                                'DISABLED / BLOCKED'
                              ) : (
                                'ALLOWED / ACTIVE'
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-20 text-center text-slate-500 text-xs">No matching users found.</div>
                )}
              </div>
            </div>
          )}

          {/* 6. AUDIT LOGS TAB */}
          {activeTab === 'audit' && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-[55vh] animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-3 mb-4 shrink-0">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-200">Administrative Audit Trails (Logs)</div>
                  <p className="text-[10px] text-slate-400 mt-0.5">Comprehensive chronological trail of modifications &amp; administrative logons</p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={auditSearchQuery}
                    onChange={e => setAuditSearchQuery(e.target.value)}
                    placeholder="Search logs details..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {filteredAuditLogs.length > 0 ? (
                  filteredAuditLogs.map(log => (
                    <div key={log.id} className="p-3 bg-slate-950 border border-slate-900 rounded-xl text-xs flex justify-between gap-4">
                      <div className="space-y-1 truncate pr-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-200">{log.action}</span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${log.result === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                            {log.result.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono truncate">{log.operator}</p>
                        <p className="text-[10px] text-slate-500 italic mt-0.5">{log.details}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[9px] text-slate-500 font-mono block">{log.id}</span>
                        <span className="text-[9px] text-slate-400 mt-1 block">{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-20 text-center text-slate-500 text-xs">No audit logs matched search description.</div>
                )}
              </div>
            </div>
          )}

          {/* 7. SYSTEM DIAGNOSTICS TAB */}
          {activeTab === 'settings' && diagData && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Activity className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">Anivex Backend Node Environment</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">Node Environment:</span>
                    <span className="text-white font-bold">{diagData.env?.NODE_ENV}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">Port Number:</span>
                    <span className="text-white font-bold">{diagData.env?.PORT}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">Session Secret Key:</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold ${diagData.env?.hasSessionSecret ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {diagData.env?.hasSessionSecret ? 'Active' : 'Missing'}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">SMTP Host Connection:</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold ${diagData.env?.hasSmtpHost ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {diagData.env?.hasSmtpHost ? 'Active' : 'Missing'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Lock className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">API Authentication Security Policies</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">Rate Limiting System:</span>
                    <span className="text-white font-bold">{diagData.security?.rateLimitStatus}</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                    <span className="text-slate-400">Cookie Security Attributes:</span>
                    <span className="text-white font-bold">SameSite={diagData.security?.cookieSameSite}; HttpOnly</span>
                  </div>
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between col-span-2">
                    <div className="w-full">
                      <span className="text-slate-400 block mb-1.5">Strictly Protected Endpoints:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {diagData.security?.protectedEndpoints?.map((ep: string) => (
                          <span key={ep} className="bg-slate-900 border border-slate-800 text-[10px] text-slate-300 px-2 py-0.5 rounded">
                            {ep}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
