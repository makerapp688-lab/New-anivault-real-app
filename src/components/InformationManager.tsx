import React, { useState, useEffect, useCallback } from 'react';
import {
  Info,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Search,
  RefreshCw,
  Check,
  X,
  History,
  Database,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Trash2,
  Sparkles,
  Copy,
  Layers,
  Film,
  Globe,
  FileText,
  ShieldCheck,
  Loader2
} from 'lucide-react';

function getOwnerToken(): string {
  try {
    return localStorage.getItem('anivault_owner_session_token') || '';
  } catch {
    return '';
  }
}

function getOwnerHeaders(): Record<string, string> {
  const token = getOwnerToken();
  return token
    ? {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Owner-Session': token
      }
    : { 'Content-Type': 'application/json' };
}

type InfoFilterTab =
  | 'all'
  | 'needs_review'
  | 'conflict'
  | 'duplicates'
  | 'suspected_fake'
  | 'episode_mismatch'
  | 'missing_info'
  | 'verified'
  | 'auto_fixed'
  | 'workers'
  | 'history';

const ALL_ANIME_TYPES = ['TV', 'Movie', 'OVA', 'ONA', 'Special'] as const;
const ALL_ANIME_STATUSES = ['Completed', 'Ongoing', 'Upcoming'] as const;
const COMMON_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Sci-Fi',
  'Supernatural',
  'Thriller',
  'Slice of Life',
  'Sports',
  'Mecha',
  'Mystery',
  'Romance',
  'Family',
  'Kids'
];

export const InformationManager: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<InfoFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [animeList, setAnimeList] = useState<any[]>([]);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [scanState, setScanState] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    total: 0,
    verified: 0,
    correct: 0,
    autoFixed: 0,
    needsReview: 0,
    conflicts: 0,
    duplicates: 0,
    suspectedFake: 0,
    missingInfo: 0,
    episodeMismatch: 0,
    unverified: 0,
    historyCount: 0
  });
  const [loading, setLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Selected Anime Drawer / Editor State
  const [selectedAnime, setSelectedAnime] = useState<any | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editAltTitle, setEditAltTitle] = useState('');
  const [editJapaneseTitle, setEditJapaneseTitle] = useState('');
  const [editType, setEditType] = useState<string>('TV');
  const [editStatus, setEditStatus] = useState<string>('Completed');
  const [editReleaseYear, setEditReleaseYear] = useState<number>(2024);
  const [editReleaseDate, setEditReleaseDate] = useState<string>('');
  const [editTotalSeasons, setEditTotalSeasons] = useState<number>(1);
  const [editTotalEpisodes, setEditTotalEpisodes] = useState<number>(1);
  const [editSeasons, setEditSeasons] = useState<any[]>([]);
  const [editGenres, setEditGenres] = useState<string[]>([]);
  const [editLanguagesInput, setEditLanguagesInput] = useState<string>('');
  const [editSynopsis, setEditSynopsis] = useState<string>('');
  const [editStoryDetails, setEditStoryDetails] = useState<string>('');
  const [editRelatedAnimeInput, setEditRelatedAnimeInput] = useState<string>('');
  const [editFranchiseInput, setEditFranchiseInput] = useState<string>('');
  const [editProviderAnimeId, setEditProviderAnimeId] = useState<string>('');
  const [editCanonicalUrl, setEditCanonicalUrl] = useState<string>('');
  const [confirmDeleteDupId, setConfirmDeleteDupId] = useState<string | null>(null);
  const [confirmDeleteFakeId, setConfirmDeleteFakeId] = useState<string | null>(null);

  const fetchStatusAndList = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const statusRes = await fetch('/api/owner/info-manager/status', {
          headers: getOwnerHeaders()
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.state) setScanState(statusData.state);
          if (statusData.stats) setStats(statusData.stats);
        }

        if (activeFilter === 'history') {
          const histRes = await fetch('/api/owner/info-manager/history', {
            headers: getOwnerHeaders()
          });
          if (histRes.ok) {
            const histData = await histRes.json();
            setHistoryList(histData.history || []);
            setTotalItems(histData.total || 0);
          }
        } else {
          const params = new URLSearchParams({
            filter: activeFilter,
            search: searchQuery,
            page: String(page),
            limit: '24'
          });
          const listRes = await fetch(`/api/owner/info-manager/anime?${params.toString()}`, {
            headers: getOwnerHeaders()
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            setAnimeList(listData.anime || []);
            setTotalItems(listData.total || 0);
            setTotalPages(listData.totalPages || 1);
            if (listData.stats) setStats(listData.stats);
          }
        }
      } catch (err) {
        console.error('[InformationManager] Failed to load data:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeFilter, searchQuery, page]
  );

  useEffect(() => {
    fetchStatusAndList();
  }, [fetchStatusAndList]);

  // Poll while scan is running
  useEffect(() => {
    if (scanState?.status !== 'running') return;
    const interval = setInterval(() => {
      fetchStatusAndList(true);
    }, 1500);
    return () => clearInterval(interval);
  }, [scanState?.status, fetchStatusAndList]);

  const populateEditor = (anime: any) => {
    setSelectedAnime(anime);
    setConfirmDeleteDupId(null);
    setConfirmDeleteFakeId(null);
    setEditTitle(anime.title || '');
    setEditAltTitle(anime.alternateTitle || '');
    setEditJapaneseTitle(anime.japaneseTitle || '');
    setEditType(ALL_ANIME_TYPES.includes(anime.type) ? anime.type : 'TV');
    setEditStatus(ALL_ANIME_STATUSES.includes(anime.status) ? anime.status : 'Completed');
    setEditReleaseYear(anime.releaseYear || 2024);
    setEditReleaseDate(anime.releaseDate || '');
    const seasonsArr = Array.isArray(anime.seasons) ? anime.seasons : [];
    setEditTotalSeasons(anime.totalSeasons ?? anime.seasonsCount ?? (seasonsArr.length || 1));
    setEditTotalEpisodes(anime.totalEpisodes || 0);
    setEditSeasons(
      seasonsArr.map((s: any, idx: number) => ({
        seasonNumber: s.seasonNumber ?? idx + 1,
        title: s.title || `Season ${s.seasonNumber ?? idx + 1}`,
        canonicalUrl: s.canonicalUrl || '',
        episodeCount: typeof s.episodeCount === 'number' ? s.episodeCount : (Array.isArray(s.episodes) ? s.episodes.length : 0),
        episodes: Array.isArray(s.episodes) ? s.episodes : []
      }))
    );
    setEditGenres(Array.isArray(anime.genres) ? [...anime.genres] : []);
    const langs =
      Array.isArray(anime.languages) && anime.languages.length > 0
        ? anime.languages.join(', ')
        : anime.providers?.raretoonIndia?.dubLanguage || 'Hindi, Japanese';
    setEditLanguagesInput(langs);
    setEditSynopsis(anime.synopsis || '');
    setEditStoryDetails(anime.storyDetails || '');
    setEditRelatedAnimeInput(Array.isArray(anime.relatedAnime) ? anime.relatedAnime.join(', ') : '');
    setEditFranchiseInput(Array.isArray(anime.franchiseRelationships) ? anime.franchiseRelationships.join(', ') : '');
    setEditProviderAnimeId(anime.providers?.raretoonIndia?.providerAnimeId || '');
    setEditCanonicalUrl(anime.providers?.raretoonIndia?.canonicalUrl || anime.canonicalProviderUrl || '');
  };

  const handleInspectAll = async () => {
    setActionBusyId('inspect_all');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/owner/info-manager/inspect-all', {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Full catalogue information audit completed.' });
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to inspect catalogue.' });
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message || 'Network error during audit.' });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleStartScan = async (mode: 'all' | 'unverified' | 'fix_missing') => {
    setActionBusyId(`start_${mode}`);
    setBannerMessage(null);
    try {
      const res = await fetch('/api/owner/info-manager/start', {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({ mode })
      });
      const data = await res.json();
      if (res.ok) {
        setScanState(data.state);
        if (data.stats) setStats(data.stats);
        setBannerMessage({
          type: 'info',
          text:
            mode === 'fix_missing'
              ? 'Started background scan to verify and auto-fix missing anime information.'
              : `Started background information verification (${mode}).`
        });
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to start scan.' });
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message || 'Network error.' });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleScanControl = async (action: 'pause' | 'resume' | 'stop' | 'reset') => {
    setActionBusyId(action);
    try {
      const res = await fetch(`/api/owner/info-manager/${action}`, {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        if (data.state) setScanState(data.state);
        if (data.stats) setStats(data.stats);
        await fetchStatusAndList(true);
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleVerifySingle = async (animeId: string, autoFix = false) => {
    setActionBusyId(`verify_${animeId}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/verify-single/${animeId}`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({ autoFix })
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({
          type: 'success',
          text: autoFix
            ? `Verified & auto-fixed metadata for "${data.anime?.title || animeId}".`
            : `Verified "${data.anime?.title || animeId}" against trusted metadata sources.`
        });
        await fetchStatusAndList(true);
        if (selectedAnime && selectedAnime.id === animeId && data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Verification failed.' });
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message || 'Verification failed.' });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleApproveInfo = async (animeId: string) => {
    setActionBusyId(`approve_${animeId}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/anime/${animeId}/approve`, {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Anime information marked as Verified.' });
        await fetchStatusAndList(true);
        if (selectedAnime && selectedAnime.id === animeId && data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to approve.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleApplyCandidate = async (animeId: string, candidate: any) => {
    setActionBusyId(`cand_${animeId}`);
    setBannerMessage(null);
    try {
      const updates: Record<string, any> = {};
      if (candidate.title) updates.title = candidate.title;
      if (candidate.alternateTitle) updates.alternateTitle = candidate.alternateTitle;
      if (candidate.japaneseTitle) updates.japaneseTitle = candidate.japaneseTitle;
      if (candidate.type) updates.type = candidate.type;
      if (candidate.status) updates.status = candidate.status;
      if (candidate.releaseYear) updates.releaseYear = candidate.releaseYear;
      if (candidate.releaseDate) updates.releaseDate = candidate.releaseDate;
      if (candidate.totalEpisodes) updates.totalEpisodes = candidate.totalEpisodes;
      if (Array.isArray(candidate.genres) && candidate.genres.length > 0) updates.genres = candidate.genres;
      if (candidate.synopsis && candidate.synopsis.length >= 20) updates.synopsis = candidate.synopsis;
      if (Array.isArray(candidate.relatedAnime) && candidate.relatedAnime.length > 0) updates.relatedAnime = candidate.relatedAnime;
      if (Array.isArray(candidate.franchiseRelationships) && candidate.franchiseRelationships.length > 0) {
        updates.franchiseRelationships = candidate.franchiseRelationships;
      }

      const res = await fetch(`/api/owner/info-manager/anime/${animeId}/update`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({
          updates,
          source: candidate.source || 'Trusted Metadata Candidate',
          reason: `Applied verified metadata candidate from ${candidate.source}`
        })
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({
          type: 'success',
          text: `Applied ${candidate.source} metadata to "${data.anime?.title}".`
        });
        await fetchStatusAndList(true);
        if (data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to apply candidate.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSaveManualEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnime) return;
    setSavingEdit(true);
    setBannerMessage(null);
    try {
      const parsedLanguages = editLanguagesInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const parsedRelated = editRelatedAnimeInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const parsedFranchise = editFranchiseInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const updates = {
        title: editTitle.trim(),
        alternateTitle: editAltTitle.trim() || null,
        japaneseTitle: editJapaneseTitle.trim() || null,
        type: editType,
        status: editStatus,
        releaseYear: Number(editReleaseYear) || 2024,
        releaseDate: editReleaseDate.trim() || null,
        totalSeasons: Number(editTotalSeasons) || 1,
        totalEpisodes: Number(editTotalEpisodes) || 0,
        seasons: editSeasons,
        genres: editGenres,
        languages: parsedLanguages,
        dubLanguage: parsedLanguages.join(', '),
        synopsis: editSynopsis.trim(),
        storyDetails: editStoryDetails.trim() || null,
        relatedAnime: parsedRelated,
        franchiseRelationships: parsedFranchise,
        providerAnimeId: editProviderAnimeId.trim(),
        canonicalUrl: editCanonicalUrl.trim()
      };

      const res = await fetch(`/api/owner/info-manager/anime/${selectedAnime.id}/update`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({
          updates,
          source: 'Owner Information Editor',
          reason: 'Manual verification and correction via Information Manager'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Saved anime information updates.' });
        await fetchStatusAndList(true);
        if (data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to save changes.' });
      }
    } catch (err: any) {
      setBannerMessage({ type: 'error', text: err.message || 'Error saving changes.' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteDuplicate = async (animeId: string) => {
    setActionBusyId(`del_${animeId}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/anime/${animeId}/delete-duplicate`, {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Duplicate entry removed.' });
        setSelectedAnime(null);
        setConfirmDeleteDupId(null);
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to delete duplicate.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleResolveFake = async (animeId: string, action: 'dismiss' | 'confirm_delete') => {
    setActionBusyId(`fake_${animeId}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/anime/${animeId}/resolve-fake`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Suspected fake status resolved.' });
        setConfirmDeleteFakeId(null);
        if (data.deleted) {
          setSelectedAnime(null);
        } else if (data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to resolve suspected fake.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRevertHistory = async (historyId: string) => {
    setActionBusyId(`rev_${historyId}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/history/${historyId}/revert`, {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Change reverted successfully.' });
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to revert history entry.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRetryAllReview = async () => {
    setActionBusyId('retry_all_review');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/owner/info-manager/retry-all-review', {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        if (data.state) setScanState(data.state);
        if (data.stats) setStats(data.stats);
        setBannerMessage({ type: 'info', text: data.message || 'Queued Needs Review items onto shared worker pool.' });
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to retry review items.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleFixAllHighConfidence = async () => {
    setActionBusyId('fix_all_high_confidence');
    setBannerMessage(null);
    try {
      const res = await fetch('/api/owner/info-manager/fix-all-high-confidence', {
        method: 'POST',
        headers: getOwnerHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        if (data.state) setScanState(data.state);
        if (data.stats) setStats(data.stats);
        setBannerMessage({
          type: 'success',
          text: data.message || 'Resolved high-confidence items while preserving human-review items.'
        });
        await fetchStatusAndList(true);
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to execute Fix All.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleResolveReviewItem = async (
    animeId: string,
    action: 'approve_suggestions' | 'mark_verified' | 'reject_suggestions' | 'skip_ignore'
  ) => {
    setActionBusyId(`res_rev_${animeId}_${action}`);
    setBannerMessage(null);
    try {
      const res = await fetch(`/api/owner/info-manager/anime/${animeId}/resolve-review`, {
        method: 'POST',
        headers: getOwnerHeaders(),
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (res.ok) {
        setBannerMessage({ type: 'success', text: data.message || 'Review item resolved.' });
        await fetchStatusAndList(true);
        if (selectedAnime && selectedAnime.id === animeId && data.anime) {
          populateEditor({ ...data.anime, infoRecord: data.record });
        }
      } else {
        setBannerMessage({ type: 'error', text: data.error || 'Failed to resolve review item.' });
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const toggleEditGenre = (genre: string) => {
    if (editGenres.includes(genre)) {
      setEditGenres(editGenres.filter(g => g !== genre));
    } else {
      setEditGenres([...editGenres, genre]);
    }
  };

  const renderStatusBadge = (item: any) => {
    const rec = item.infoRecord;
    const hasDup = (item.duplicateIds?.length || 0) > 0 || rec?.status === 'duplicate';
    if (rec?.status === 'suspected_fake' || rec?.checkedFields?.suspectedFake === 'mismatch') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-500/20 text-red-300 border border-red-500/40">
          {rec?.suspectedFakeStrongEvidence ? 'SUSPECTED FAKE' : 'SUSPECTED FAKE / NEEDS REVIEW'}
        </span>
      );
    }
    if (hasDup) {
      const dupClass = rec?.duplicateClassification;
      const dupLabel =
        dupClass === 'confirmed_duplicate'
          ? 'CONFIRMED DUPLICATE'
          : dupClass === 'likely_duplicate'
            ? 'LIKELY DUPLICATE'
            : 'POSSIBLE DUPLICATE';
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-500/15 text-rose-400 border border-rose-500/30">
          {dupLabel}
        </span>
      );
    }
    if (rec?.status === 'conflict' || rec?.checkedFields?.conflictingInformation === 'mismatch') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-orange-500/20 text-orange-300 border border-orange-500/40">
          CONFLICT
        </span>
      );
    }
    if (rec?.status === 'verified') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          VERIFIED
        </span>
      );
    }
    if (rec?.status === 'correct') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-teal-500/15 text-teal-300 border border-teal-500/30">
          CORRECT
        </span>
      );
    }
    if (rec?.status === 'auto_fixed') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
          AUTO-FIXED
        </span>
      );
    }
    if (rec?.status === 'needs_review') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-500/15 text-amber-300 border border-amber-500/30">
          NEEDS REVIEW ({rec.discrepancies?.length || 0})
        </span>
      );
    }
    if (rec?.status === 'missing_info') {
      return (
        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-purple-500/15 text-purple-300 border border-purple-500/30">
          MISSING INFORMATION
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
        UNVERIFIED
      </span>
    );
  };

  return (
    <div className="space-y-5 animate-fade-in" id="owner-information-manager">
      {/* Header & Purpose Banner */}
      <div className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
                <Info className="w-5 h-5" />
              </div>
              <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wide">
                Information Manager
              </h3>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                SHARED 50-WORKER 19-POINT METADATA ENGINE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Verifies and corrects Anime Title, Japanese/Alternate Titles, Duplicate Entries, Seasons Count, Total &amp; Season-Specific Episode Counts, Completed vs Ongoing Status, Release Date/Year, Type (TV/Movie/OVA/ONA/Special), Genres, Languages, Synopsis, Story/Details, Related Anime, Franchise Relationships, Conflicting Info, Rare Toon ↔ Zenime Mapping, and Suspected Fake/Non-Existent Anime using the shared 50-worker pool.
            </p>
          </div>

          {/* Primary Batch Action Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              id="btn-info-inspect-all"
              onClick={handleInspectAll}
              disabled={actionBusyId === 'inspect_all' || scanState?.status === 'running'}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {actionBusyId === 'inspect_all' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Inspect All Info</span>
            </button>

            <button
              type="button"
              id="btn-info-verify-all"
              onClick={() => handleStartScan('all')}
              disabled={scanState?.status === 'running'}
              className="px-3.5 py-2 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Verify All</span>
            </button>

            <button
              type="button"
              id="btn-info-fix-missing"
              onClick={() => handleStartScan('fix_missing')}
              disabled={scanState?.status === 'running'}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Fix Missing Info</span>
            </button>

            <button
              type="button"
              id="btn-info-retry-all-review"
              onClick={handleRetryAllReview}
              disabled={actionBusyId === 'retry_all_review' || scanState?.status === 'running'}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${actionBusyId === 'retry_all_review' ? 'animate-spin' : ''}`} />
              <span>Retry All</span>
            </button>

            <button
              type="button"
              id="btn-info-fix-all-high-confidence"
              onClick={handleFixAllHighConfidence}
              disabled={actionBusyId === 'fix_all_high_confidence' || scanState?.status === 'running'}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Automatically resolve only items meeting high-confidence criteria; leaves human-review items untouched"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Fix All (High-Confidence)</span>
            </button>

            {scanState?.status === 'running' && (
              <button
                type="button"
                onClick={() => handleScanControl('pause')}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-950 text-amber-300 border border-amber-600/50 flex items-center gap-1 cursor-pointer"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
            )}

            {scanState?.status === 'paused' && (
              <button
                type="button"
                onClick={() => handleScanControl('resume')}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-600/50 flex items-center gap-1 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </button>
            )}

            {(scanState?.status === 'running' || scanState?.status === 'paused') && (
              <button
                type="button"
                onClick={() => handleScanControl('stop')}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-950 text-rose-300 border border-rose-700/60 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchStatusAndList(false)}
              className="p-2 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 cursor-pointer"
              title="Refresh Results"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => handleScanControl('reset')}
              className="p-2 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 cursor-pointer"
              title="Reset scan progress"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live Scan Progress Bar */}
        {scanState && (scanState.status === 'running' || scanState.status === 'paused' || scanState.processedCount > 0) && (
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    scanState.status === 'running'
                      ? 'bg-emerald-400 animate-ping'
                      : scanState.status === 'paused'
                        ? 'bg-amber-400'
                        : 'bg-sky-400'
                  }`}
                />
                <span className="font-bold text-slate-200 uppercase">{scanState.status}</span>
                <span className="text-slate-400 truncate max-w-md">{scanState.lastLog}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                {scanState.workerSnapshot && (
                  <span className="text-sky-400">
                    Queue: {scanState.workerSnapshot.queuedCount || 0} · Active: {scanState.workerSnapshot.claimedCount || 0} · Throughput: {scanState.workerSnapshot.tasksPerMinute ?? scanState.workerSnapshot.throughputPerMin ?? 0}/min
                  </span>
                )}
                <span className="font-bold text-amber-400">
                  {scanState.processedCount} / {scanState.totalCount} ({scanState.progressPercent || 0}%)
                </span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400 transition-all duration-300"
                style={{ width: `${scanState.progressPercent || 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Global Metrics Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] font-bold uppercase text-slate-400">Total Anime</div>
            <div className="text-base font-black text-white mt-0.5">{stats.total}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30">
            <div className="text-[10px] font-bold uppercase text-emerald-400">Verified / Correct</div>
            <div className="text-base font-black text-emerald-300 mt-0.5">{stats.verified}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-cyan-500/30">
            <div className="text-[10px] font-bold uppercase text-cyan-400">Auto-Fixed</div>
            <div className="text-base font-black text-cyan-300 mt-0.5">{stats.autoFixed}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-500/30">
            <div className="text-[10px] font-bold uppercase text-amber-400">Needs Review</div>
            <div className="text-base font-black text-amber-300 mt-0.5">{stats.needsReview}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-orange-500/30">
            <div className="text-[10px] font-bold uppercase text-orange-400">Conflicts</div>
            <div className="text-base font-black text-orange-300 mt-0.5">{stats.conflicts || 0}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-rose-500/30">
            <div className="text-[10px] font-bold uppercase text-rose-400">Suspected Dup</div>
            <div className="text-base font-black text-rose-300 mt-0.5">{stats.duplicates}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-red-500/30">
            <div className="text-[10px] font-bold uppercase text-red-400">Suspected Fake</div>
            <div className="text-base font-black text-red-300 mt-0.5">{stats.suspectedFake || 0}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-yellow-500/30">
            <div className="text-[10px] font-bold uppercase text-yellow-400">Season/Ep Issues</div>
            <div className="text-base font-black text-yellow-300 mt-0.5">{stats.episodeMismatch}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-purple-500/30">
            <div className="text-[10px] font-bold uppercase text-purple-400">Missing Info</div>
            <div className="text-base font-black text-purple-300 mt-0.5">{stats.missingInfo}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[10px] font-bold uppercase text-slate-400">Change History</div>
            <div className="text-base font-black text-slate-200 mt-0.5">{stats.historyCount}</div>
          </div>
        </div>
      </div>

      {bannerMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
              : bannerMessage.type === 'error'
                ? 'bg-rose-950/70 border-rose-500/40 text-rose-200'
                : 'bg-sky-950/70 border-sky-500/40 text-sky-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : bannerMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-3 rounded-2xl">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: `All (${stats.total})` },
            { id: 'needs_review', label: `Needs Review (${stats.needsReview})` },
            { id: 'conflict', label: `Conflict (${stats.conflicts || 0})` },
            { id: 'duplicates', label: `Suspected Duplicate (${stats.duplicates})` },
            { id: 'suspected_fake', label: `Suspected Fake (${stats.suspectedFake || 0})` },
            { id: 'episode_mismatch', label: `Season/Episode Issues (${stats.episodeMismatch})` },
            { id: 'missing_info', label: `Missing Information (${stats.missingInfo})` },
            { id: 'verified', label: `Verified / Correct (${stats.verified})` },
            { id: 'auto_fixed', label: `Auto-Fixed (${stats.autoFixed})` },
            { id: 'workers', label: `Worker Monitor (${typeof scanState?.sharedWorkerSnapshot?.workerCount === 'number' ? scanState.sharedWorkerSnapshot.workerCount : Array.isArray(scanState?.sharedWorkerSnapshot?.workers) ? scanState.sharedWorkerSnapshot.workers.length : 50})` },
            { id: 'history', label: `Change History (${stats.historyCount})` }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveFilter(tab.id as InfoFilterTab);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeFilter === tab.id
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeFilter !== 'history' && activeFilter !== 'workers' && (
          <div className="relative w-full md:w-72 shrink-0">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search title, JP title, genre, year..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
      </div>

      {/* Main Content Area: Worker Monitor OR History OR Split Catalogue + Inspector/Editor */}
      {activeFilter === 'workers' ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h4 className="text-xs font-black uppercase tracking-wider text-white">
                Shared Worker Infrastructure Telemetry (Information + Artwork Verification)
              </h4>
              <p className="text-[11px] text-slate-400">
                Real-time monitoring of the shared 50-worker pool (80-worker architecture capacity) executing both ARTWORK_VERIFICATION and INFORMATION_VERIFICATION jobs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fetchStatusAndList(false)}
              className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Telemetry</span>
            </button>
          </div>

          {/* Queue & Throughput Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] font-bold uppercase text-slate-400">Active / Capacity</div>
              <div className="text-sm font-black text-white mt-0.5">
                {typeof scanState?.sharedWorkerSnapshot?.workerCount === 'number'
                  ? scanState.sharedWorkerSnapshot.workerCount
                  : Array.isArray(scanState?.sharedWorkerSnapshot?.workers)
                    ? scanState.sharedWorkerSnapshot.workers.length
                    : 'Not available'}{' '}
                /{' '}
                {typeof scanState?.sharedWorkerSnapshot?.architectureCapacity === 'number'
                  ? scanState.sharedWorkerSnapshot.architectureCapacity
                  : scanState?.sharedWorkerSnapshot?.poolConfig?.maxWorkers ?? 'Not available'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-sky-500/30">
              <div className="text-[10px] font-bold uppercase text-sky-400">Info Queue Waiting</div>
              <div className="text-sm font-black text-sky-300 mt-0.5">
                {scanState?.workerSnapshot?.queuedCount ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30">
              <div className="text-[10px] font-bold uppercase text-amber-400">Info Processing</div>
              <div className="text-sm font-black text-amber-300 mt-0.5">
                {scanState?.workerSnapshot?.claimedCount ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/30">
              <div className="text-[10px] font-bold uppercase text-emerald-400">Info Completed</div>
              <div className="text-sm font-black text-emerald-300 mt-0.5">
                {scanState?.workerSnapshot?.completedCount ?? stats.verified}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-rose-500/30">
              <div className="text-[10px] font-bold uppercase text-rose-400">Info Failed / Retry</div>
              <div className="text-sm font-black text-rose-300 mt-0.5">
                {scanState?.workerSnapshot?.failedCount ?? 0} / {scanState?.workerSnapshot?.retryingCount ?? 0}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/30">
              <div className="text-[10px] font-bold uppercase text-amber-400">Requiring Review</div>
              <div className="text-sm font-black text-amber-300 mt-0.5">{stats.needsReview}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] font-bold uppercase text-slate-400">Avg Process Time</div>
              <div className="text-sm font-black text-slate-200 mt-0.5">
                {scanState?.sharedWorkerSnapshot?.avgTaskDurationMs
                  ? `${scanState.sharedWorkerSnapshot.avgTaskDurationMs} ms`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/30">
              <div className="text-[10px] font-bold uppercase text-cyan-400">Throughput</div>
              <div className="text-sm font-black text-cyan-300 mt-0.5">
                {scanState?.sharedWorkerSnapshot?.tasksPerMinute ?? scanState?.sharedWorkerSnapshot?.throughputPerMin ?? 0} jobs/min
              </div>
            </div>
          </div>

          {/* 50-Worker Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[52vh] overflow-y-auto pr-1">
            {(scanState?.sharedWorkerSnapshot?.workers || []).map((w: any) => {
              const isWorking = w.status === 'working' || w.status === 'busy' || w.status === 'claiming';
              const sysLabel =
                w.jobSystem === 'INFORMATION_VERIFICATION'
                  ? 'INFO VERIFICATION'
                  : w.jobSystem === 'ARTWORK_VERIFICATION'
                    ? 'ARTWORK VERIFICATION'
                    : 'SHARED POOL';
              return (
                <div
                  key={w.workerId}
                  className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                    isWorking
                      ? 'bg-sky-950/30 border-sky-500/50'
                      : w.status === 'error'
                        ? 'bg-rose-950/30 border-rose-500/50'
                        : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-black text-white">
                      Worker #{String(w.workerId).padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-sky-300">{sysLabel}</span>
                      <span className="text-slate-600">·</span>
                      <span
                        className={`text-[10px] font-black uppercase ${
                          isWorking ? 'text-emerald-400' : w.status === 'error' ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {w.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-300 truncate">
                    {w.currentAnimeTitle
                      ? `${w.currentAnimeTitle} (${w.operation || w.currentStep || 'Verifying'})`
                      : 'Idle — Ready for next Artwork or Information job'}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>
                      Done: {w.tasksCompleted || 0} · Fail: {w.tasksFailed || 0} · Retry: {w.retryCount || 0}
                    </span>
                    <span>
                      HB: {w.lastHeartbeat ? `${Math.max(0, Math.round((Date.now() - w.lastHeartbeat) / 1000))}s ago` : 'ok'}
                    </span>
                  </div>
                  {w.lastError && (
                    <div className="text-[10px] text-rose-400 truncate font-mono">Error: {w.lastError}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : activeFilter === 'history' ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                Information Change History ({historyList.length})
              </h4>
            </div>
          </div>

          {historyList.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">
              No metadata changes recorded yet. Updates and auto-fixes will appear here with full before/after snapshots.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
              {historyList.map((entry: any) => (
                <div
                  key={entry.id}
                  className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">{entry.animeTitle}</span>
                      <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[10px] font-mono">
                        {entry.source}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(entry.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300">{entry.reason}</p>
                    {Array.isArray(entry.changedFields) && entry.changedFields.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {entry.changedFields.map((f: string) => (
                          <span
                            key={f}
                            className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-amber-300"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevertHistory(entry.id)}
                    disabled={actionBusyId === `rev_${entry.id}`}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Revert Change</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Anime Information List */}
          <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col h-[64vh]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3 shrink-0">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Catalogue Entries ({totalItems})
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono text-[11px] text-slate-400">
                  Page {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="p-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                  <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
                  <span className="text-xs">Loading anime information records...</span>
                </div>
              ) : animeList.length === 0 ? (
                <div className="py-20 text-center text-xs text-slate-500">
                  No anime records match the current filter. Click &ldquo;Inspect All Info&rdquo; to audit the entire catalogue.
                </div>
              ) : (
                animeList.map(item => {
                  const isSelected = selectedAnime?.id === item.id;
                  const rec = item.infoRecord;
                  const discrepanciesCount = rec?.discrepancies?.length || 0;
                  return (
                    <div
                      key={item.id}
                      onClick={() => populateEditor(item)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer text-xs space-y-2 ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/70 shadow-md'
                          : 'bg-slate-950 border-slate-800/90 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{item.title}</div>
                          {(item.japaneseTitle || item.alternateTitle) && (
                            <div className="text-[10px] text-slate-400 truncate">
                              {item.japaneseTitle || item.alternateTitle}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {renderStatusBadge(item)}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-semibold">
                          {item.type || 'TV'}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
                          {item.status || 'Unknown'}
                        </span>
                        <span>Year: {item.releaseYear || 'N/A'}</span>
                        <span>•</span>
                        <span>Seasons: {item.computedSeasonsCount || 0}</span>
                        <span>•</span>
                        <span>Episodes: {item.totalEpisodes || 0}</span>
                        <span>•</span>
                        <span>Genres: {Array.isArray(item.genres) ? item.genres.length : 0}</span>
                      </div>

                      {discrepanciesCount > 0 && (
                        <div className="text-[10px] text-amber-300/90 bg-amber-950/30 border border-amber-500/20 rounded-lg px-2 py-1 truncate">
                          {rec.discrepancies.map((d: any) => d.label).join(' • ')}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: 19-Point Inspector, Source Comparison & Manual Editor */}
          <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col h-[64vh] overflow-y-auto">
            {selectedAnime ? (
              <div className="space-y-4">
                {/* Top Action Bar for Selected Anime */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono font-bold text-sky-400 uppercase block">
                      Information Inspector &amp; Editor ({selectedAnime.id})
                    </span>
                    <h4 className="text-sm font-black text-white truncate">{selectedAnime.title}</h4>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleVerifySingle(selectedAnime.id, false)}
                      disabled={actionBusyId === `verify_${selectedAnime.id}`}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-sky-300 border border-sky-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {actionBusyId === `verify_${selectedAnime.id}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>Retry</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVerifySingle(selectedAnime.id, true)}
                      disabled={actionBusyId === `verify_${selectedAnime.id}`}
                      className="px-2.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Fix</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleResolveReviewItem(selectedAnime.id, 'approve_suggestions')}
                      disabled={actionBusyId === `res_rev_${selectedAnime.id}_approve_suggestions`}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleResolveReviewItem(selectedAnime.id, 'reject_suggestions')}
                      disabled={actionBusyId === `res_rev_${selectedAnime.id}_reject_suggestions`}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveInfo(selectedAnime.id)}
                      disabled={actionBusyId === `approve_${selectedAnime.id}`}
                      className="px-2.5 py-1.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleResolveReviewItem(selectedAnime.id, 'skip_ignore')}
                      disabled={actionBusyId === `res_rev_${selectedAnime.id}_skip_ignore`}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <span>Skip / Ignore</span>
                    </button>
                  </div>
                </div>

                {/* Detected Discrepancies / Issues Box */}
                {selectedAnime.infoRecord?.discrepancies?.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2">
                    <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span>Detected Information Discrepancies ({selectedAnime.infoRecord.discrepancies.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {selectedAnime.infoRecord.discrepancies.map((d: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="space-y-0.5">
                            <span className="font-bold text-amber-300">{d.label}: </span>
                            <span className="text-slate-300">{d.message}</span>
                            {d.currentValue !== undefined && d.suggestedValue !== undefined && (
                              <div className="text-[10px] text-slate-400 pt-0.5">
                                Current:{' '}
                                <span className="font-mono text-rose-300">
                                  {Array.isArray(d.currentValue) ? d.currentValue.join(', ') : String(d.currentValue)}
                                </span>{' '}
                                → Verified:{' '}
                                <span className="font-mono text-emerald-300">
                                  {Array.isArray(d.suggestedValue) ? d.suggestedValue.join(', ') : String(d.suggestedValue)}
                                </span>
                              </div>
                            )}
                          </div>
                          {d.suggestedValue !== undefined && d.field !== 'duplicate' && d.field !== 'suspectedFake' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (d.field === 'title') setEditTitle(String(d.suggestedValue));
                                if (d.field === 'alternateTitles') setEditAltTitle(String(d.suggestedValue));
                                if (d.field === 'seasonsCount') setEditTotalSeasons(Number(d.suggestedValue) || 1);
                                if (d.field === 'totalEpisodes') setEditTotalEpisodes(Number(d.suggestedValue) || 1);
                                if (d.field === 'status') setEditStatus(String(d.suggestedValue));
                                if (d.field === 'releaseYear') setEditReleaseYear(Number(d.suggestedValue) || 2024);
                                if (d.field === 'type') setEditType(String(d.suggestedValue));
                                if (d.field === 'genres' && Array.isArray(d.suggestedValue)) setEditGenres(d.suggestedValue);
                                if (d.field === 'languages' && Array.isArray(d.suggestedValue)) setEditLanguagesInput(d.suggestedValue.join(', '));
                                if (d.field === 'synopsis') setEditSynopsis(String(d.suggestedValue));
                                if (d.field === 'storyDetails') setEditStoryDetails(String(d.suggestedValue));
                                if (d.field === 'relatedAnime' && Array.isArray(d.suggestedValue)) setEditRelatedAnimeInput(d.suggestedValue.join(', '));
                                if (d.field === 'franchiseRelationships') setEditFranchiseInput(String(d.suggestedValue));
                                if (d.field === 'raretoonMapping') setEditProviderAnimeId(String(d.suggestedValue));
                              }}
                              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold shrink-0 cursor-pointer"
                            >
                              Fill Suggestion
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suspected Fake / Non-Existent Anime Review Panel */}
                {(selectedAnime.infoRecord?.status === 'suspected_fake' ||
                  selectedAnime.infoRecord?.checkedFields?.suspectedFake === 'issue') && (
                  <div className="p-3.5 rounded-xl bg-red-950/35 border border-red-500/40 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase text-red-300 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-red-400" />
                        <span>Suspected Fake / Needs Review</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleResolveFake(selectedAnime.id, 'dismiss')}
                          disabled={actionBusyId === `fake_${selectedAnime.id}`}
                          className="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-200 border border-emerald-600/60 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>Confirm Valid Anime (Keep)</span>
                        </button>
                        {confirmDeleteFakeId !== selectedAnime.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFakeId(selectedAnime.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-950 hover:bg-red-900 text-red-200 border border-red-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete Fake Entry</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleResolveFake(selectedAnime.id, 'confirm_delete')}
                              className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[10px] font-black cursor-pointer"
                            >
                              Confirm Permanent Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFakeId(null)}
                              className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      {selectedAnime.infoRecord?.suspectedFakeReason ||
                        'External trusted sources did not return a confident match or the title looks like a placeholder. Zenime never auto-deletes suspected entries — please review before deciding.'}
                    </p>
                  </div>
                )}

                {/* Duplicate Entry Resolution Panel */}
                {((selectedAnime.duplicateIds?.length || 0) > 0 ||
                  (selectedAnime.infoRecord?.duplicateOfIds?.length || 0) > 0) && (
                  <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-black uppercase text-rose-300 flex items-center gap-1.5">
                        <Copy className="w-4 h-4 text-rose-400" />
                        <span>Suspected Duplicate Catalogue Entry Detected</span>
                      </div>
                      {confirmDeleteDupId !== selectedAnime.id ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteDupId(selectedAnime.id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete This Duplicate</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteDuplicate(selectedAnime.id)}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black cursor-pointer"
                          >
                            Confirm Permanent Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteDupId(null)}
                            className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[10px] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300">
                      Matching catalogue entry:{' '}
                      <span className="font-mono text-rose-300">
                        {(selectedAnime.infoRecord?.duplicateTitles || selectedAnime.duplicateIds || []).join(', ')}
                      </span>
                    </p>
                  </div>
                )}

                {/* Trusted External Source Candidates */}
                {selectedAnime.infoRecord?.candidates?.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                      Trusted Source Metadata Matches
                    </div>
                    <div className="space-y-2">
                      {selectedAnime.infoRecord.candidates.map((cand: any, i: number) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white truncate">{cand.title}</span>
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[10px] font-mono">
                                {cand.source} ({Math.round((cand.confidence || 0.9) * 100)}%)
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {cand.type || 'TV'} • {cand.status || 'Completed'} • Year: {cand.releaseYear || 'N/A'} • Episodes:{' '}
                              {cand.totalEpisodes || 'N/A'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleApplyCandidate(selectedAnime.id, cand)}
                            disabled={actionBusyId === `cand_${selectedAnime.id}`}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] shrink-0 cursor-pointer"
                          >
                            Apply Source Info
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full 19-Point Manual Information Editor Form */}
                <form onSubmit={handleSaveManualEdit} className="space-y-3.5 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">1. Anime Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        required
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">2A. Alternate Title</label>
                      <input
                        type="text"
                        value={editAltTitle}
                        onChange={e => setEditAltTitle(e.target.value)}
                        placeholder="English / Romaji alternate title"
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">2B. Japanese Title</label>
                      <input
                        type="text"
                        value={editJapaneseTitle}
                        onChange={e => setEditJapaneseTitle(e.target.value)}
                        placeholder="Native Japanese / Romaji title"
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        9. Anime Type (TV / Movie / OVA / ONA / Special)
                      </label>
                      <select
                        value={editType}
                        onChange={e => setEditType(e.target.value)}
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      >
                        {ALL_ANIME_TYPES.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        7. Completed vs Ongoing Status
                      </label>
                      <select
                        value={editStatus}
                        onChange={e => setEditStatus(e.target.value)}
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      >
                        {ALL_ANIME_STATUSES.map(st => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">8. Release Year &amp; Date</label>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="number"
                          value={editReleaseYear}
                          onChange={e => setEditReleaseYear(parseInt(e.target.value, 10) || 2024)}
                          className="w-24 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                        />
                        <input
                          type="text"
                          value={editReleaseDate}
                          onChange={e => setEditReleaseDate(e.target.value)}
                          placeholder="YYYY-MM-DD (optional)"
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">4. Number of Seasons</label>
                      <input
                        type="number"
                        min={0}
                        value={editTotalSeasons}
                        onChange={e => setEditTotalSeasons(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">5. Total Episode Count</label>
                      <input
                        type="number"
                        min={0}
                        value={editTotalEpisodes}
                        onChange={e => setEditTotalEpisodes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* 6. Season-Specific Episode Counts */}
                  {editSeasons.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          6. Season-Specific Episode Counts ({editSeasons.length} Seasons)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const sum = editSeasons.reduce((acc, s) => acc + (Number(s.episodeCount) || 0), 0);
                            if (sum > 0) setEditTotalEpisodes(sum);
                            setEditTotalSeasons(editSeasons.length);
                          }}
                          className="text-[10px] text-amber-400 hover:underline cursor-pointer"
                        >
                          Sync Total Episodes from Seasons Sum
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                        {editSeasons.map((s, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                          >
                            <span className="font-semibold text-slate-300 truncate">
                              S{s.seasonNumber}: {s.title}
                            </span>
                            <input
                              type="number"
                              min={0}
                              value={s.episodeCount}
                              onChange={e => {
                                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                const next = [...editSeasons];
                                next[idx] = { ...next[idx], episodeCount: val };
                                setEditSeasons(next);
                              }}
                              className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white text-right"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 11. Languages */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">
                      11. Languages (Comma-separated)
                    </label>
                    <input
                      type="text"
                      value={editLanguagesInput}
                      onChange={e => setEditLanguagesInput(e.target.value)}
                      placeholder="Hindi, Tamil, Telugu, English, Japanese"
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                    />
                  </div>

                  {/* 10. Genres */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      10. Genres ({editGenres.length} selected)
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                      {COMMON_GENRES.map(genre => {
                        const active = editGenres.includes(genre);
                        return (
                          <button
                            key={genre}
                            type="button"
                            onClick={() => toggleEditGenre(genre)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all cursor-pointer ${
                              active
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

                  {/* 12. Synopsis / Description */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">
                      12. Synopsis / Description
                    </label>
                    <textarea
                      value={editSynopsis}
                      onChange={e => setEditSynopsis(e.target.value)}
                      rows={3}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2.5 text-white focus:border-amber-500 outline-none resize-none"
                    />
                  </div>

                  {/* 13. Story / Details */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">
                      13. Story / Details (Extended Background &amp; Lore)
                    </label>
                    <textarea
                      value={editStoryDetails}
                      onChange={e => setEditStoryDetails(e.target.value)}
                      rows={2}
                      placeholder="Additional story summary, production notes, or adaptation details..."
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none resize-none"
                    />
                  </div>

                  {/* 14, 15, 18. Related Anime, Franchise Relationships, and Rare Toon ↔ Zenime Mapping */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        14. Related Anime (Comma-separated titles)
                      </label>
                      <input
                        type="text"
                        value={editRelatedAnimeInput}
                        onChange={e => setEditRelatedAnimeInput(e.target.value)}
                        placeholder="Sequels, prequels, spin-offs, movies..."
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        15. Franchise Relationships
                      </label>
                      <input
                        type="text"
                        value={editFranchiseInput}
                        onChange={e => setEditFranchiseInput(e.target.value)}
                        placeholder="Franchise group or watch-order relation"
                        className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">
                          18A. Rare Toon ↔ Zenime Provider ID / Slug
                        </label>
                        <input
                          type="text"
                          value={editProviderAnimeId}
                          onChange={e => setEditProviderAnimeId(e.target.value)}
                          placeholder="e.g. naruto-shippuden-hindi-dubbed"
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase">
                          18B. Rare Toon ↔ Zenime Canonical URL
                        </label>
                        <input
                          type="text"
                          value={editCanonicalUrl}
                          onChange={e => setEditCanonicalUrl(e.target.value)}
                          placeholder="https://raretoonsindia.com/..."
                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg text-xs p-2 text-white focus:border-amber-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-lg"
                  >
                    {savingEdit ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>Save &amp; Verify Anime Information</span>
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 p-6 space-y-2">
                <Info className="w-9 h-9 opacity-40 text-sky-400" />
                <p className="text-xs font-bold text-slate-300">Select an Anime Entry to Inspect or Correct</p>
                <p className="text-[11px] max-w-sm">
                  Click any anime on the left to review all 19 metadata checks, compare against trusted external sources, resolve duplicates or suspected fakes, or edit season and episode counts.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
