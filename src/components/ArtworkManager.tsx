import React, { useState, useEffect, useRef } from 'react';
import {
  Image as ImageIcon,
  Shield,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  AlertCircle,
  ExternalLink,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Sliders,
  Check,
  X,
  Clock,
  Layers,
  Sparkles,
  Database,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Info,
  History,
  Activity,
  Zap,
  Globe
} from 'lucide-react';

interface ArtworkManagerProps {
  onClose?: () => void;
}

interface WorkerCompletedTask {
  taskId: string;
  animeId?: string | null;
  animeTitle: string;
  operation: string;
  completedAt: string;
  status: 'completed' | 'failed';
  details?: string | null;
}

interface WorkerInfo {
  workerId: number;
  status: 'idle' | 'claiming' | 'working' | 'retrying' | 'waiting' | 'paused' | 'error' | 'stopped' | 'busy' | 'backing_off';
  currentTaskId?: string | null;
  currentAnimeId?: string | null;
  currentAnimeTitle?: string | null;
  seasonName?: string | null;
  operation?: string | null;
  currentSource?: string | null;
  currentStep?: string | null;
  taskStartedAt?: number | null;
  lastHeartbeat: number;
  retryCount?: number;
  tasksCompleted?: number;
  tasksFailed?: number;
  health?: 'healthy' | 'stale' | 'error';
  lastError?: string | null;
  recentCompletedTasks?: WorkerCompletedTask[];
}

interface WorkerActivityEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  workerId: number;
  taskId?: string | null;
  animeId?: string | null;
  animeTitle?: string | null;
  operation?: string | null;
  eventType: string;
  source?: string | null;
  step?: string | null;
  details?: string | null;
  result?: any;
}

function formatTimeAgo(timestampMs?: number | null): string {
  if (!timestampMs) return 'N/A';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin}m ${diffSec % 60}s ago`;
}

function formatElapsed(timestampMs?: number | null): string {
  if (!timestampMs) return '0s';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin}m ${diffSec % 60}s`;
}

interface ScanState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  totalCount: number;
  processedCount: number;
  currentIndex: number;
  currentAnimeId: string | null;
  currentAnimeTitle: string | null;
  startedAt: string | null;
  updatedAt: string;
  finishedAt?: string | null;
  mode?: 'all' | 'unverified' | 'inspect';
  workerCount?: number;
  poolConfig?: {
    minWorkers: number;
    maxWorkers: number;
    currentWorkers: number;
    concurrencyLimit: number;
  };
  etaFormatted?: string;
  systemHealth?: {
    heapUsedMb: number;
    heapTotalMb: number;
    status: 'healthy' | 'high_load' | 'critical';
  };
  sourceGatewayMetrics?: Record<string, any>;
  estimatedRemainingSeconds?: number | null;
  activeWorkers?: WorkerInfo[];
  activityEvents?: WorkerActivityEvent[];
  stats: {
    scanned: number;
    verified: number;
    autoFixed: number;
    needsReview: number;
    unableToVerify: number;
    possibleFake: number;
    missing?: number;
    failed: number;
    retrying?: number;
    pending?: number;
  };
  lastLog: string;
}

interface InspectReport {
  inspectedAt: string;
  totalCatalogue: number;
  validArtworkCount: number;
  missingArtworkCount: number;
  incorrectArtworkCount: number;
  requiresReplacementCount: number;
  pendingCount: number;
  retryingCount: number;
  needsReviewCount: number;
  possibleFakeCount: number;
  items: Array<{
    id: string;
    title: string;
    artworkUrl: string | null;
    status: string;
    hasArtwork: boolean;
    issue?: string;
  }>;
}

interface AnimeItem {
  id: string;
  title: string;
  alternateTitle: string | null;
  releaseYear: number | null;
  type: string;
  currentArtworkUrl: string | null;
  source: string;
  verificationStatus: string;
  confidence: number;
  dimensions: string;
  lastVerifiedAt: string | null;
  issue: string | null;
  candidates: any[];
  evidence: string[];
  aniListMatch: any;
  jikanMatch: any;
  providerUrl: string | null;
}

interface FakeAnimeIssue {
  id: string;
  catalogueId: string;
  animeTitle: string;
  source: string;
  sourceUrl?: string;
  titlesChecked: string[];
  aniListResult: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  jikanResult: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  verificationResults: string;
  reason: string;
  timestamp: string;
  evidence: string[];
  status: 'active' | 'dismissed' | 'manual_verified';
}

interface HistoryItem {
  id: string;
  animeId: string;
  animeTitle: string;
  previousArtworkUrl: string;
  newArtworkUrl: string;
  replacedAt: string;
  replacedBy: string;
  source: string;
  reason: string;
}

interface SourceConfig {
  id: string;
  name: string;
  type: 'graphql' | 'rest';
  endpoint: string;
  enabled: boolean;
  rateLimitPerMinute: number;
  rateLimitPerSecond?: number;
  timeoutMs: number;
  priority: number;
  status: 'operational' | 'degraded' | 'offline' | 'untested';
  lastChecked?: string;
  lastLatencyMs?: number;
  lastError?: string | null;
  description: string;
}

export const ArtworkManager: React.FC<ArtworkManagerProps> = () => {
  // Main Sub-tabs: 'registry' | 'needs_review' | 'workers' | 'fake_issues' | 'history' | 'sources'
  const [subTab, setSubTab] = useState<'registry' | 'needs_review' | 'workers' | 'fake_issues' | 'history' | 'sources'>('registry');

  // Dashboard & Scan status
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Catalogue List Tab
  const [animeList, setAnimeList] = useState<AnimeItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Issues & History Data
  const [fakeIssues, setFakeIssues] = useState<FakeAnimeIssue[]>([]);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [sourcesList, setSourcesList] = useState<SourceConfig[]>([]);

  // Inspect All Report Modal / State
  const [inspectReport, setInspectReport] = useState<InspectReport | null>(null);
  const [inspectingAll, setInspectingAll] = useState(false);
  const [showInspectModal, setShowInspectModal] = useState(false);

  // Batch Selection Modal State for "Verify All", "Verify Unverified", and "Fix Missing"
  const [batchModalConfig, setBatchModalConfig] = useState<{
    open: boolean;
    mode: 'all' | 'unverified' | 'fix_missing';
    totalAvailable: number;
  } | null>(null);
  const [selectedBatchOption, setSelectedBatchOption] = useState<number | 'all'>(300);
  const [customBatchInput, setCustomBatchInput] = useState<string>('300');

  // Worker Detail Modal & Activity Event Filters
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [eventSearch, setEventSearch] = useState<string>('');

  // Needs Review Workspace State
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [processingItemIds, setProcessingItemIds] = useState<string[]>([]);
  const [reviewSubFilter, setReviewSubFilter] = useState<string>('all');
  const [chosenReplacementModal, setChosenReplacementModal] = useState<{
    open: boolean;
    animeId: string;
    animeTitle: string;
    candidates: any[];
  } | null>(null);

  // Selected item for detailed inspection drawer
  const [inspectedAnime, setInspectedAnime] = useState<AnimeItem | null>(null);
  const [singleVerifying, setSingleVerifying] = useState(false);
  const [testingSourceId, setTestingSourceId] = useState<string | null>(null);
  const [sourceTestResult, setSourceTestResult] = useState<Record<string, any>>({});

  const pollingRef = useRef<any>(null);

  // Safe Monotonic ScanState Updater (Prevents progress numbers from jumping backward)
  const updateScanStateSafely = (newState: ScanState | null) => {
    if (!newState) return;
    setScanState(prev => {
      if (!prev) return newState;
      // If same job run, enforce monotonic non-decreasing processed count
      if (prev.status === 'running' && newState.status === 'running' && prev.startedAt === newState.startedAt) {
        const safeProcessed = Math.max(prev.processedCount || 0, newState.processedCount || 0);
        return {
          ...newState,
          processedCount: safeProcessed
        };
      }
      return newState;
    });
  };

  // Lock background body scroll when any overlay/modal is open
  const isModalOpen = Boolean(
    selectedWorkerId !== null ||
    showInspectModal ||
    batchModalConfig !== null ||
    chosenReplacementModal !== null ||
    inspectedAnime !== null
  );

  useEffect(() => {
    if (isModalOpen) {
      const originalOverflow = document.body.style.overflow;
      const originalTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.touchAction = originalTouchAction;
      };
    }
  }, [isModalOpen]);

  // Fetch dashboard summary
  const fetchDashboard = async () => {
    try {
      const res = await fetch('/api/owner/artwork-manager/dashboard', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
        updateScanStateSafely(data.scanState);
      }
    } catch (err) {
      console.error('Failed to load artwork manager dashboard:', err);
    } finally {
      setLoadingDashboard(false);
    }
  };

  // Fetch anime list for registry
  const fetchAnimeList = async (pageNum = page, currentStatus = statusFilter, query = searchQuery) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', '30');
      if (currentStatus !== 'all') params.set('status', currentStatus);
      if (query.trim()) params.set('search', query.trim());

      const res = await fetch(`/api/owner/artwork-manager/anime?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAnimeList(data.anime || []);
        setTotalPages(data.totalPages || 1);
        setTotalCount(data.total || 0);
        setPage(data.page || 1);
      }
    } catch (err) {
      console.error('Failed to load anime registry:', err);
    } finally {
      setListLoading(false);
    }
  };

  // Fetch fake issues
  const fetchFakeIssues = async () => {
    try {
      const res = await fetch('/api/owner/artwork-manager/fake-issues', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setFakeIssues(data.issues || []);
      }
    } catch (err) {
      console.error('Failed to load fake issues:', err);
    }
  };

  // Fetch history
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/owner/artwork-manager/history', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data.history || []);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  // Fetch sources
  const fetchSources = async () => {
    try {
      const res = await fetch('/api/owner/artwork-manager/sources', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSourcesList(data.sources || []);
      }
    } catch (err) {
      console.error('Failed to load sources:', err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchDashboard();
    fetchAnimeList(1, 'all', '');
    fetchFakeIssues();
    fetchHistory();
    fetchSources();
  }, []);

  // Poll scan state when scan is active
  useEffect(() => {
    if (scanState?.status === 'running') {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/owner/artwork-manager/status', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            updateScanStateSafely(data.state);
            if (data.state.status !== 'running') {
              clearInterval(pollingRef.current);
              fetchDashboard();
              fetchAnimeList();
              fetchFakeIssues();
            }
          }
        } catch {}
      }, 1500);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [scanState?.status]);

  // Handle Search & Filter changes
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchAnimeList(1, statusFilter, searchQuery);
  };

  const handleStatusFilterChange = (newStatus: string) => {
    setStatusFilter(newStatus);
    setPage(1);
    fetchAnimeList(1, newStatus, searchQuery);
  };

  // Inspect All Operation (Non-destructive catalogue inspection)
  const handleInspectAll = async () => {
    setInspectingAll(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/inspect-all', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.report) {
        setInspectReport(data.report);
        setShowInspectModal(true);
        fetchDashboard();
      } else {
        alert(data.error || 'Failed to inspect catalogue.');
      }
    } catch (err: any) {
      alert(`Error inspecting catalogue: ${err.message}`);
    } finally {
      setInspectingAll(false);
    }
  };

  // Scan Actions: mode can be 'all' | 'unverified' | 'fix_missing'
  const handleStartScan = async (
    mode: 'all' | 'unverified' | 'fix_missing' = 'all',
    limit?: number
  ) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, limit }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        if (data.state) {
          setScanState(data.state);
        }
        fetchDashboard();
        setBatchModalConfig(null);
      } else {
        alert(data.message || 'Failed to start verification.');
      }
    } catch (err: any) {
      alert(`Error starting verification: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const openUnverifiedBatchModal = () => {
    const unverifiedTotal = Math.max(0, stats.total - stats.verified);
    setBatchModalConfig({
      open: true,
      mode: 'unverified',
      totalAvailable: unverifiedTotal
    });
    setSelectedBatchOption(unverifiedTotal > 300 ? 300 : 'all');
    setCustomBatchInput(String(unverifiedTotal > 300 ? 300 : unverifiedTotal));
  };

  const openFixMissingBatchModal = () => {
    const missingTotal = stats.missing || 0;
    setBatchModalConfig({
      open: true,
      mode: 'fix_missing',
      totalAvailable: missingTotal
    });
    setSelectedBatchOption(missingTotal > 300 ? 300 : 'all');
    setCustomBatchInput(String(missingTotal > 300 ? 300 : missingTotal));
  };

  const openVerifyAllBatchModal = () => {
    const totalCount = stats.total || 0;
    setBatchModalConfig({
      open: true,
      mode: 'all',
      totalAvailable: totalCount
    });
    setSelectedBatchOption(totalCount > 300 ? 300 : 'all');
    setCustomBatchInput(String(totalCount > 300 ? 300 : totalCount));
  };

  // Needs Review Workspace Handlers
  const handleBulkAction = async (endpoint: string, animeIds: string[]) => {
    if (!animeIds.length) return;
    setActionLoading(true);
    setProcessingItemIds(prev => Array.from(new Set([...prev, ...animeIds])));
    try {
      const res = await fetch(`/api/owner/artwork-manager/needs-review/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeIds }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setSelectedReviewIds(prev => prev.filter(id => !animeIds.includes(id)));
        if (data.scanState) setScanState(data.scanState);
        await fetchDashboard();
        await fetchAnimeList();
      } else {
        alert(data.error || 'Operation failed.');
      }
    } catch (err: any) {
      alert(`Error executing workspace action: ${err.message}`);
    } finally {
      setActionLoading(false);
      setProcessingItemIds(prev => prev.filter(id => !animeIds.includes(id)));
    }
  };

  const handleChooseReplacementCandidate = async (animeId: string, selectedCandidateUrl: string, source: string) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/needs-review/choose-replacement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeId, selectedCandidateUrl, source }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setChosenReplacementModal(null);
        if (data.scanState) setScanState(data.scanState);
        fetchDashboard();
        fetchAnimeList();
      } else {
        alert(data.error || 'Failed to choose replacement.');
      }
    } catch (err: any) {
      alert(`Error choosing replacement: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePauseScan = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/pause', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchDashboard();
      }
    } catch (err: any) {
      alert(`Error pausing scan: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeScan = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/resume', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchDashboard();
      } else {
        alert(data.message || 'Failed to resume.');
      }
    } catch (err: any) {
      alert(`Error resuming scan: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopScan = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/owner/artwork-manager/stop', {
        method: 'POST',
        credentials: 'include'
      });
      fetchDashboard();
    } catch (err: any) {
      alert(`Error stopping scan: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetScan = async () => {
    if (!window.confirm('Reset artwork verification progress back to 0?')) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/reset', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchDashboard();
      }
    } catch (err: any) {
      alert(`Error resetting scan: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Single Item Actions
  const handleVerifySingle = async (animeId: string) => {
    setSingleVerifying(true);
    try {
      const res = await fetch(`/api/owner/artwork-manager/verify-single/${animeId}`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        // Refresh item in inspector
        fetchAnimeList();
        fetchDashboard();
        if (inspectedAnime && inspectedAnime.id === animeId) {
          setInspectedAnime({
            ...inspectedAnime,
            verificationStatus: data.result.status,
            confidence: Math.round(data.result.confidence * 100),
            currentArtworkUrl: data.result.currentArtworkUrl,
            issue: data.result.issue,
            candidates: data.result.candidates || [],
            evidence: data.result.evidence || [],
            aniListMatch: data.result.aniListMatch,
            jikanMatch: data.result.jikanMatch
          });
        }
      } else {
        alert(data.error || 'Failed to verify single anime.');
      }
    } catch (err: any) {
      alert(`Error verifying: ${err.message}`);
    } finally {
      setSingleVerifying(false);
    }
  };

  const handleApplyCandidate = async (animeId: string, candidateUrl: string, source: string) => {
    try {
      const res = await fetch(`/api/owner/artwork-manager/anime/${animeId}/apply-candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateUrl, source }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchAnimeList();
        fetchDashboard();
        fetchHistory();
        if (inspectedAnime && inspectedAnime.id === animeId) {
          setInspectedAnime({
            ...inspectedAnime,
            currentArtworkUrl: candidateUrl,
            verificationStatus: 'verified',
            issue: null
          });
        }
        alert('Candidate artwork applied and marked verified.');
      } else {
        alert(data.error || 'Failed to apply candidate.');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleRevertArtwork = async (animeId: string) => {
    if (!window.confirm('Revert artwork to previous backup?')) return;
    try {
      const res = await fetch(`/api/owner/artwork-manager/anime/${animeId}/revert`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchAnimeList();
        fetchDashboard();
        fetchHistory();
        if (inspectedAnime && inspectedAnime.id === animeId) {
          setInspectedAnime({
            ...inspectedAnime,
            currentArtworkUrl: data.previousUrl,
            verificationStatus: 'needs_review',
            issue: 'Manually reverted to backup.'
          });
        }
        alert('Artwork reverted successfully.');
      } else {
        alert(data.message || data.error || 'Failed to revert.');
      }
    } catch (err: any) {
      alert(`Error reverting: ${err.message}`);
    }
  };

  const handleResolveFakeIssue = async (issueId: string, action: 'manual_verified' | 'dismiss') => {
    try {
      const res = await fetch(`/api/owner/artwork-manager/fake-issues/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        fetchFakeIssues();
        fetchDashboard();
        fetchAnimeList();
      }
    } catch (err: any) {
      alert(`Error resolving fake issue: ${err.message}`);
    }
  };

  const handleTestSource = async (sourceId: string) => {
    setTestingSourceId(sourceId);
    try {
      const res = await fetch(`/api/owner/artwork-manager/sources/${sourceId}/test`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      setSourceTestResult(prev => ({ ...prev, [sourceId]: data }));
      fetchSources();
    } catch (err: any) {
      setSourceTestResult(prev => ({ ...prev, [sourceId]: { success: false, message: err.message } }));
    } finally {
      setTestingSourceId(null);
    }
  };

  const stats = dashboardData?.stats || {
    total: 0,
    verified: 0,
    autoFixed: 0,
    needsReview: 0,
    unableToVerify: 0,
    possibleFake: 0,
    missing: 0,
    historyCount: 0
  };

  const progressPercent = scanState?.totalCount
    ? Math.min(100, Math.round((scanState.processedCount / scanState.totalCount) * 100))
    : 0;

  return (
    <div className="space-y-6 animate-fade-in text-slate-100">
      {/* 1. TOP HEADER & PRIMARY ACTION BAR */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-amber-500/40 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
                <ImageIcon className="w-5 h-5" />
              </div>
              <h3 className="text-base sm:text-lg font-black text-white tracking-wide uppercase">
                ARTWORK MANAGER
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Automated Catalogue Integrity
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Automated dual-source verification engine cross-checking AniList and Jikan/MyAnimeList data at scale. Auto-fixes low-res or missing artwork, detects possible fake anime, and secures high-resolution poster assets.
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {scanState?.status === 'running' ? (
              <>
                <button
                  type="button"
                  onClick={handlePauseScan}
                  disabled={actionLoading}
                  className="px-4 py-2.5 rounded-xl font-black text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50"
                >
                  <Pause className="w-4 h-4 fill-slate-950" />
                  <span>Pause</span>
                </button>
                <button
                  type="button"
                  onClick={handleStopScan}
                  disabled={actionLoading}
                  className="px-3.5 py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-rose-400 border border-rose-500/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  <span>Stop</span>
                </button>
              </>
            ) : scanState?.status === 'paused' ? (
              <>
                <button
                  type="button"
                  onClick={handleResumeScan}
                  disabled={actionLoading}
                  className="px-4 py-2.5 rounded-xl font-black text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Resume</span>
                </button>
                <button
                  type="button"
                  onClick={handleStopScan}
                  disabled={actionLoading}
                  className="px-3.5 py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-rose-400 border border-rose-500/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  <span>Stop</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetScan}
                  disabled={actionLoading}
                  className="px-3 py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </>
            ) : (
              <>
                {/* 1. Inspect All button */}
                <button
                  type="button"
                  id="btn-inspect-all"
                  onClick={handleInspectAll}
                  disabled={inspectingAll || actionLoading}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-cyan-500/40 flex items-center gap-2 cursor-pointer shadow-lg shadow-cyan-950/20 disabled:opacity-50"
                >
                  {inspectingAll ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  <span>Inspect All</span>
                </button>

                {/* 2. Verify All button (Batch Modal) */}
                <button
                  type="button"
                  id="btn-verify-all"
                  onClick={openVerifyAllBatchModal}
                  disabled={actionLoading}
                  className="px-3.5 py-2 rounded-xl font-black text-xs bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-amber-500/25 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-slate-950" />
                  <span>Verify All</span>
                </button>

                {/* 3. Verify Unverified button (Batch Modal) */}
                <button
                  type="button"
                  id="btn-verify-unverified"
                  onClick={openUnverifiedBatchModal}
                  disabled={actionLoading}
                  className="px-3.5 py-2 rounded-xl font-black text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-emerald-500/25 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                  <span>Verify Unverified</span>
                </button>

                {/* 4. Fix Missing Artwork button (Batch Modal) */}
                <button
                  type="button"
                  id="btn-fix-missing"
                  onClick={openFixMissingBatchModal}
                  disabled={actionLoading}
                  className="px-3.5 py-2 rounded-xl font-black text-xs bg-rose-500 hover:bg-rose-400 text-white flex items-center gap-1.5 shadow-lg shadow-rose-500/25 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Fix Missing</span>
                  {stats.missing > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-slate-950 text-rose-300 font-mono">
                      {stats.missing}
                    </span>
                  )}
                </button>

                {scanState?.processedCount && scanState.processedCount > 0 ? (
                  <button
                    type="button"
                    onClick={handleResetScan}
                    disabled={actionLoading}
                    title="Reset verification state"
                    className="p-2.5 rounded-xl font-bold text-xs bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Live Scan Status Bar with Worker Concurrency & Accurate ETA */}
        {(scanState?.status === 'running' || scanState?.status === 'paused') && (
          <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${scanState.status === 'running' ? 'bg-amber-400 animate-ping' : 'bg-amber-600'}`} />
                <span className="font-bold text-white uppercase tracking-wider">
                  {scanState.status === 'running' ? 'Processing Workers...' : 'Verification Paused'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-amber-300 border border-slate-700">
                  {scanState.workerCount || 5} Workers Active
                </span>
                <span className="text-slate-400 truncate max-w-sm">
                  {scanState.currentAnimeTitle ? `[Active: ${scanState.currentAnimeTitle}]` : scanState.lastLog}
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono font-bold text-xs">
                {scanState.estimatedRemainingSeconds !== null && scanState.estimatedRemainingSeconds !== undefined && scanState.status === 'running' && (
                  <span className="text-emerald-400 font-normal">
                    ETA: ~{Math.ceil(scanState.estimatedRemainingSeconds / 60)}m ({scanState.estimatedRemainingSeconds}s)
                  </span>
                )}
                <span className="text-amber-400">
                  {scanState.processedCount} / {scanState.totalCount} ({progressPercent}%)
                </span>
              </div>
            </div>

            <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800 relative">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Anime */}
        <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Catalogue</span>
          <div className="text-xl font-black text-white">{stats.total}</div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1">
            <Layers className="w-3 h-3 text-slate-400" />
            <span>Total Titles</span>
          </div>
        </div>

        {/* Verified */}
        <div className="p-3.5 bg-slate-950/80 border border-emerald-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Verified</span>
          <div className="text-xl font-black text-emerald-400">{stats.verified}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>High Quality</span>
          </div>
        </div>

        {/* Auto Fixed */}
        <div className="p-3.5 bg-slate-950/80 border border-cyan-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Auto-Fixed</span>
          <div className="text-xl font-black text-cyan-400">{stats.autoFixed}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>Posters Replaced</span>
          </div>
        </div>

        {/* Needs Review */}
        <div className="p-3.5 bg-slate-950/80 border border-amber-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Needs Review</span>
          <div className="text-xl font-black text-amber-400">{stats.needsReview}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span>Uncertain / Conflict</span>
          </div>
        </div>

        {/* Unable to Verify */}
        <div className="p-3.5 bg-slate-950/80 border border-blue-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Unable to Verify</span>
          <div className="text-xl font-black text-blue-400">{stats.unableToVerify}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-blue-400" />
            <span>API Fallback/Retry</span>
          </div>
        </div>

        {/* Possible Fake */}
        <div className="p-3.5 bg-slate-950/80 border border-rose-500/40 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Possible Fake</span>
          <div className="text-xl font-black text-rose-400">{stats.possibleFake}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-rose-400" />
            <span>Zero DB Match</span>
          </div>
        </div>
      </div>

      {/* 3. SUB-NAVIGATION TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setSubTab('registry')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'registry'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Catalogue Registry</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSubTab('needs_review');
            handleStatusFilterChange('needs_review');
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer relative ${
            subTab === 'needs_review'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Needs Review Queue</span>
          {stats.needsReview > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-500 text-slate-950">
              {stats.needsReview}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('workers')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer relative ${
            subTab === 'workers'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-amber-400" />
          <span>Workers Monitor (5)</span>
          {scanState?.activeWorkers?.some(w => w.status === 'working' || w.status === 'claiming' || w.status === 'busy') && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setSubTab('fake_issues');
            fetchFakeIssues();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer relative ${
            subTab === 'fake_issues'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Possible Fake Anime</span>
          {stats.possibleFake > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-rose-600 text-white">
              {stats.possibleFake}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setSubTab('history');
            fetchHistory();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'history'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>History &amp; Backups</span>
          {stats.historyCount > 0 && (
            <span className="text-[10px] text-slate-400 font-mono">({stats.historyCount})</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setSubTab('sources');
            fetchSources();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ml-auto ${
            subTab === 'sources'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Artwork Sources</span>
        </button>
      </div>

      {/* 4. SUB-TAB VIEW CONTENT */}

      {/* --- TAB 1: REGISTRY VIEW --- */}
      {subTab === 'registry' && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <form onSubmit={handleSearchSubmit} className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search anime title or alternate title..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500 transition-colors"
              />
            </form>

            <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 overflow-x-auto">
              {[
                { id: 'all', label: 'All', count: stats.total },
                { id: 'missing', label: 'Missing Artwork', count: stats.missing },
                { id: 'unverified', label: 'Unverified', count: Math.max(0, stats.total - stats.verified) },
                { id: 'verified', label: 'Verified', count: stats.verified },
                { id: 'auto_fixed', label: 'Auto-Fixed', count: stats.autoFixed },
                { id: 'needs_review', label: 'Needs Review', count: stats.needsReview },
                { id: 'unable_to_verify', label: 'Unable to Verify', count: stats.unableToVerify },
                { id: 'possible_fake', label: 'Possible Fake', count: stats.possibleFake }
              ].map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleStatusFilterChange(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black capitalize whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1.5 ${
                    statusFilter === f.id
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white bg-slate-900/60'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                    statusFilter === f.id ? 'bg-slate-950 text-amber-300' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Anime Items Grid */}
          {listLoading ? (
            <div className="py-24 text-center text-slate-500 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
              <p className="text-xs">Loading catalogue artwork...</p>
            </div>
          ) : animeList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {animeList.map(anime => (
                <div
                  key={anime.id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex gap-3 transition-all group relative overflow-hidden"
                >
                  {/* Poster Thumbnail */}
                  <div className="w-16 h-24 rounded-lg bg-slate-950 border border-slate-800 shrink-0 overflow-hidden relative flex items-center justify-center">
                    {anime.currentArtworkUrl ? (
                      <>
                        <img
                          src={anime.currentArtworkUrl}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full object-cover opacity-25 blur-sm scale-110 pointer-events-none select-none"
                        />
                        <img
                          src={anime.currentArtworkUrl}
                          alt={anime.title}
                          className="relative z-10 max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-sm"
                          onError={e => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </>
                    ) : (
                      <div className="text-slate-600 flex flex-col items-center">
                        <ImageIcon className="w-5 h-5 opacity-40" />
                        <span className="text-[8px] text-center mt-1">No Poster</span>
                      </div>
                    )}

                    <span className="absolute bottom-0 left-0 right-0 bg-slate-950/90 text-[8px] text-slate-300 text-center py-0.5 font-mono truncate">
                      {anime.dimensions}
                    </span>
                  </div>

                  {/* Info Column */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1.5">
                        <h4 className="font-bold text-xs text-white truncate" title={anime.title}>
                          {anime.title}
                        </h4>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 border ${
                            anime.verificationStatus === 'verified'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : anime.verificationStatus === 'auto_fixed'
                              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                              : anime.verificationStatus === 'needs_review'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : anime.verificationStatus === 'possible_fake'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/40'
                              : anime.verificationStatus === 'unable_to_verify'
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {anime.verificationStatus.replace('_', ' ')}
                        </span>
                      </div>

                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {anime.alternateTitle || `Source: ${anime.source}`}
                      </p>

                      {anime.issue && (
                        <p className="text-[10px] text-amber-300/80 truncate mt-1 bg-amber-950/30 border border-amber-900/40 px-1.5 py-0.5 rounded">
                          {anime.issue}
                        </p>
                      )}
                    </div>

                    {/* Bottom Actions Row */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-900 mt-2">
                      <span className="text-[9px] text-slate-500 font-mono">
                        {anime.lastVerifiedAt
                          ? new Date(anime.lastVerifiedAt).toLocaleDateString()
                          : 'Not Scanned'}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setInspectedAnime(anime)}
                          className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-[10px] font-bold flex items-center gap-1 border border-slate-700/60 cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-amber-400" />
                          <span>Inspect</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-slate-500 space-y-1">
              <ImageIcon className="w-8 h-8 opacity-30 mx-auto" />
              <p className="text-xs">No matching anime titles found.</p>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400 font-mono">
                Showing {animeList.length} of {totalCount} titles
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => {
                    const p = page - 1;
                    setPage(p);
                    fetchAnimeList(p, statusFilter, searchQuery);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>
                <span className="px-2 font-mono text-amber-400 font-bold">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => {
                    const p = page + 1;
                    setPage(p);
                    fetchAnimeList(p, statusFilter, searchQuery);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 2: NEEDS REVIEW INTERACTIVE WORKSPACE --- */}
      {subTab === 'needs_review' && (
        <div className="space-y-5">
          {/* Header Workspace Banner */}
          <div className="p-4 bg-gradient-to-r from-amber-950/60 via-slate-950 to-slate-950 border border-amber-500/40 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-sm text-white uppercase tracking-wider">
                  Needs Review Control Center ({stats.needsReview})
                </h3>
              </div>
              <p className="text-xs text-slate-300">
                Interactive workspace for resolving unverified or conflicting artwork. Resolving items instantly updates the database and removes resolved items from Needs Review.
              </p>
            </div>

            {/* Bulk Actions Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleBulkAction('reverify', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-verify Selected ({selectedReviewIds.length})</span>
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('search-again', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search Again</span>
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('fix-artwork', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                <span>Fix Artwork</span>
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('approve-current', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Approve Selected</span>
              </button>
            </div>
          </div>

          {/* Sub-Filters Chips */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-2 rounded-xl border border-slate-800 overflow-x-auto">
            {[
              { id: 'all', label: 'All Review Items' },
              { id: 'missing_artwork', label: 'Missing Artwork' },
              { id: 'incorrect_artwork', label: 'Incorrect Artwork' },
              { id: 'low_quality', label: 'Low Quality' },
              { id: 'sources_disagree', label: 'Sources Disagree' },
              { id: 'unable_to_verify', label: 'Unable to Verify' },
              { id: 'temporary_source_failure', label: 'Temporary Failure' },
              { id: 'possible_fake', label: 'Possible Fake' }
            ].map(chip => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setReviewSubFilter(chip.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase cursor-pointer transition-colors ${
                  reviewSubFilter === chip.id
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'bg-slate-900/80 text-slate-400 hover:text-white'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Review Cards Grid */}
          {animeList.length > 0 ? (
            <div className="space-y-3">
              {animeList.map(anime => {
                const isSelected = selectedReviewIds.includes(anime.id);
                return (
                  <div
                    key={anime.id}
                    className={`bg-slate-950/90 border rounded-2xl p-4 transition-all space-y-3 ${
                      isSelected ? 'border-amber-500 shadow-lg shadow-amber-500/10' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      {/* Left: Checkbox + Poster + Info */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedReviewIds(prev => [...prev, anime.id]);
                            } else {
                              setSelectedReviewIds(prev => prev.filter(id => id !== anime.id));
                            }
                          }}
                          className="mt-1.5 w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500 bg-slate-900 cursor-pointer"
                        />

                        {/* Uncropped Artwork */}
                        <div className="w-16 h-24 rounded-lg bg-slate-950 border border-slate-800 shrink-0 overflow-hidden relative flex items-center justify-center">
                          {anime.currentArtworkUrl ? (
                            <>
                              <img
                                src={anime.currentArtworkUrl}
                                alt=""
                                aria-hidden="true"
                                className="absolute inset-0 w-full h-full object-cover opacity-25 blur-sm scale-110 pointer-events-none select-none"
                              />
                              <img
                                src={anime.currentArtworkUrl}
                                alt={anime.title}
                                className="relative z-10 max-w-full max-h-full object-contain drop-shadow-sm"
                              />
                            </>
                          ) : (
                            <div className="text-slate-600 flex flex-col items-center">
                              <ImageIcon className="w-5 h-5 opacity-40" />
                              <span className="text-[8px] text-center mt-1">No Poster</span>
                            </div>
                          )}
                        </div>

                        {/* Text Metadata */}
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-white break-words">{anime.title}</h4>
                            <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {anime.verificationStatus.replace('_', ' ')}
                            </span>
                          </div>

                          <p className="text-xs text-slate-400 font-mono">
                            ID: {anime.id} • Source: {anime.source}
                          </p>

                          {/* Reason Description Box */}
                          <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200/90 space-y-1">
                            <div className="font-black text-[10px] uppercase text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Reason for Review:</span>
                            </div>
                            <p className="text-[11px] font-sans">{anime.issue || 'Requires review before catalog verification.'}</p>
                          </div>

                          {/* Sources Checked Badges */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            {anime.aniListMatch && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-300 font-mono">
                                AniList Match: <strong className="text-emerald-400">{Math.round(anime.aniListMatch.score * 100)}%</strong>
                              </span>
                            )}
                            {anime.jikanMatch && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-300 font-mono">
                                Jikan Match: <strong className="text-emerald-400">{Math.round(anime.jikanMatch.score * 100)}%</strong>
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                              Last Checked: {anime.lastVerifiedAt ? new Date(anime.lastVerifiedAt).toLocaleString() : 'Recent'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Individual Workspace Actions */}
                      <div className="flex flex-wrap md:flex-col gap-1.5 shrink-0 justify-end">
                        {(() => {
                          const isItemProcessing = processingItemIds.includes(anime.id) || (scanState?.status === 'running' && scanState?.activeWorkers?.some(w => w.currentAnimeId === anime.id));
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => handleBulkAction('reverify', [anime.id])}
                                disabled={actionLoading || isItemProcessing}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3 h-3 ${isItemProcessing ? 'animate-spin' : ''}`} />
                                <span>{isItemProcessing ? 'Processing...' : 'Re-verify'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleBulkAction('search-again', [anime.id])}
                                disabled={actionLoading || isItemProcessing}
                                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black flex items-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                              >
                                <Search className={`w-3 h-3 ${isItemProcessing ? 'animate-spin' : ''}`} />
                                <span>{isItemProcessing ? 'Searching...' : 'Search Again'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleBulkAction('fix-artwork', [anime.id])}
                                disabled={actionLoading || isItemProcessing}
                                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                              >
                                <Sparkles className="w-3 h-3 fill-slate-950" />
                                <span>{isItemProcessing ? 'Fixing...' : 'Fix Artwork'}</span>
                              </button>

                              {anime.candidates && anime.candidates.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setChosenReplacementModal({
                                    open: true,
                                    animeId: anime.id,
                                    animeTitle: anime.title,
                                    candidates: anime.candidates
                                  })}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-black flex items-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                  <ImageIcon className="w-3 h-3" />
                                  <span>Choose Candidate</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleBulkAction('approve-current', [anime.id])}
                                disabled={actionLoading || isItemProcessing}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Approve Current</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleBulkAction('mark-unable', [anime.id])}
                                disabled={actionLoading || isItemProcessing}
                                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-bold cursor-pointer disabled:opacity-50"
                              >
                                Mark Unable
                              </button>

                              <button
                                type="button"
                                onClick={() => setInspectedAnime(anime)}
                                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold flex items-center gap-1 border border-slate-800 cursor-pointer"
                              >
                                <Eye className="w-3 h-3 text-amber-400" />
                                <span>Inspect Details</span>
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-20 text-center text-slate-500 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 opacity-60 mx-auto" />
              <h4 className="font-bold text-sm text-slate-300">Needs Review Queue Clear</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No unresolved anime items require manual attention. Run artwork verification to check for new catalogue updates.
              </p>
            </div>
          )}
        </div>
      )}

      {/* --- TAB: WORKERS MONITOR (5 Workers Concurrency) --- */}
      {subTab === 'workers' && (
        <div className="space-y-5">
          {/* Header Banner */}
          <div className="p-4 bg-gradient-to-r from-amber-950/60 via-slate-950 to-slate-950 border border-amber-500/40 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-sm text-white uppercase tracking-wider">
                  {scanState?.poolConfig?.currentWorkers || 10}-Worker Execution Pool Monitor
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Strict Parallel Execution Pool ({scanState?.poolConfig?.currentWorkers || 10} Workers)
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Authoritative real-time telemetry directly from backend worker job engine. Displays task ownership, current step, source, heartbeats, and execution times across all {scanState?.poolConfig?.currentWorkers || 10} active workers.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchDashboard}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                <span>Refresh Telemetry</span>
              </button>
            </div>
          </div>

          {/* Real Global Summary Totals Bar */}
          {(() => {
            const currentWorkersCount = scanState?.poolConfig?.currentWorkers || 5;
            const workerIds = Array.from({ length: currentWorkersCount }, (_, i) => i + 1);

            const workersList = workerIds.map(id => {
              const real = scanState?.activeWorkers?.find(w => w.workerId === id);
              return real || {
                workerId: id,
                status: 'idle' as const,
                tasksCompleted: 0,
                tasksFailed: 0,
                lastHeartbeat: Date.now(),
                health: 'healthy' as const
              };
            });

            const workingCount = workersList.filter(w => w.status === 'working' || w.status === 'claiming' || w.status === 'busy').length;
            const idleCount = workersList.filter(w => w.status === 'idle').length;
            const retryingCount = workersList.filter(w => w.status === 'retrying').length;
            const errorCount = workersList.filter(w => w.status === 'error').length;
            const pendingTasks = scanState?.stats?.pending || 0;
            const completedTasks = scanState?.processedCount || 0;
            const failedTasks = scanState?.stats?.failed || 0;

            return (
              <div className="space-y-3">
                {/* Infrastructure Telemetry Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Configured Worker Pool</span>
                    <span className="font-mono text-white font-bold">
                      {scanState?.poolConfig?.currentWorkers || 5} Active <span className="text-slate-500 text-[10px]">(Min: {scanState?.poolConfig?.minWorkers || 1}, Max: {scanState?.poolConfig?.maxWorkers || 10})</span>
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Real Calculated ETA</span>
                    <span className="font-mono text-cyan-400 font-bold">
                      {scanState?.etaFormatted || 'Calculating...'}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Server Resource Protection</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {scanState?.systemHealth?.heapUsedMb || 0} MB <span className="text-slate-500 text-[10px]">({scanState?.systemHealth?.status || 'healthy'})</span>
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Central Gateway Semaphores</span>
                    <span className="font-mono text-amber-300 font-bold">
                      Active Rate Limiters & Breakers
                    </span>
                  </div>
                </div>

                {/* Worker Metrics Totals Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                  <div className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-emerald-400 uppercase">Working</div>
                    <div className="text-lg font-black text-emerald-400 font-mono">{workingCount}</div>
                    <div className="text-[9px] text-slate-500">Active workers</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Idle</div>
                    <div className="text-lg font-black text-slate-300 font-mono">{idleCount}</div>
                    <div className="text-[9px] text-slate-500">Awaiting tasks</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-amber-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-amber-400 uppercase">Retrying</div>
                    <div className="text-lg font-black text-amber-400 font-mono">{retryingCount}</div>
                    <div className="text-[9px] text-slate-500">Source backoff</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-rose-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-rose-400 uppercase">Errors</div>
                    <div className="text-lg font-black text-rose-400 font-mono">{errorCount}</div>
                    <div className="text-[9px] text-slate-500">Worker errors</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-cyan-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-cyan-400 uppercase">Pending Tasks</div>
                    <div className="text-lg font-black text-cyan-400 font-mono">{pendingTasks}</div>
                    <div className="text-[9px] text-slate-500">In queue</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-blue-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-blue-400 uppercase">Completed</div>
                    <div className="text-lg font-black text-blue-400 font-mono">{completedTasks}</div>
                    <div className="text-[9px] text-slate-500">Processed</div>
                  </div>

                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Failed Tasks</div>
                    <div className="text-lg font-black text-slate-400 font-mono">{failedTasks}</div>
                    <div className="text-[9px] text-slate-500">Failed total</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Dynamic Worker Pool Individual Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: scanState?.poolConfig?.currentWorkers || 5 }, (_, i) => i + 1).map(id => {
              const worker = scanState?.activeWorkers?.find(w => w.workerId === id) || {
                workerId: id,
                status: 'idle' as const,
                tasksCompleted: 0,
                tasksFailed: 0,
                lastHeartbeat: Date.now(),
                health: 'healthy' as const
              };

              const isWorking = worker.status === 'working' || worker.status === 'claiming' || worker.status === 'busy';
              const isRetrying = worker.status === 'retrying';
              const isError = worker.status === 'error';
              const isPaused = worker.status === 'paused';

              return (
                <div
                  key={id}
                  onClick={() => setSelectedWorkerId(id)}
                  className={`p-4 rounded-xl border transition-all space-y-3 relative overflow-hidden cursor-pointer group hover:scale-[1.01] ${
                    isWorking
                      ? 'bg-slate-950/90 border-emerald-500/50 hover:border-emerald-400 shadow-lg shadow-emerald-950/20'
                      : isRetrying
                      ? 'bg-slate-950/90 border-amber-500/50 hover:border-amber-400'
                      : isError
                      ? 'bg-slate-950/90 border-rose-500/50 hover:border-rose-400'
                      : isPaused
                      ? 'bg-slate-950/90 border-purple-500/40 hover:border-purple-300'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Worker Card Top Header */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg text-xs font-black font-mono border ${
                        isWorking
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        Worker #{id}
                      </div>
                      <span className="text-xs font-black text-white uppercase tracking-wider">
                        Worker {id}
                      </span>
                    </div>

                    {/* Status Badge */}
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 border ${
                        isWorking
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                          : isRetrying
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : isError
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          : isPaused
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : 'bg-slate-800/80 text-slate-400 border-slate-700'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        isWorking ? 'bg-emerald-400 animate-ping' : isRetrying ? 'bg-amber-400' : isError ? 'bg-rose-400' : 'bg-slate-500'
                      }`} />
                      <span>{isWorking ? 'WORKING' : worker.status.toUpperCase()}</span>
                    </span>
                  </div>

                  {/* Worker Card Body Details */}
                  {isWorking || isRetrying || isError ? (
                    <div className="space-y-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current Anime</div>
                        <div className="font-bold text-white text-sm break-words">
                          {worker.currentAnimeTitle || 'Anime Task In Progress'}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-mono">
                          {worker.currentAnimeId && <span>ID: {worker.currentAnimeId}</span>}
                          {worker.seasonName && <span className="text-amber-300">• {worker.seasonName}</span>}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-[9px] text-slate-500 uppercase block font-sans">Task ID</span>
                          <span className="text-slate-200 truncate block">{worker.currentTaskId || `task-${id}`}</span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-[9px] text-slate-500 uppercase block font-sans">Operation</span>
                          <span className="text-amber-300 font-bold block">{worker.operation || 'Verify Artwork'}</span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-[9px] text-slate-500 uppercase block font-sans">Current Source</span>
                          <span className="text-cyan-300 block truncate">{worker.currentSource || 'AniList / Jikan'}</span>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-[9px] text-slate-500 uppercase block font-sans">Started / Spent</span>
                          <span className="text-emerald-400 block">{formatElapsed(worker.taskStartedAt)}</span>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-0.5">
                        <span className="text-[9px] text-slate-500 uppercase block font-sans">Current Processing Step</span>
                        <span className="text-slate-200 text-[11px] block">{worker.currentStep || 'Executing task verification pipeline...'}</span>
                      </div>

                      {worker.lastError && (
                        <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800 text-[10px] text-rose-300">
                          <strong>Error:</strong> {worker.lastError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-500 space-y-1 bg-slate-900/30 rounded-lg border border-slate-800/40">
                      <Clock className="w-5 h-5 opacity-40 mx-auto text-slate-400" />
                      <p className="text-xs font-bold text-slate-400">IDLE</p>
                      <p className="text-[10px] text-slate-500">No task currently claimed</p>
                    </div>
                  )}

                  {/* Card Footer Metrics & Action CTA */}
                  <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>Heartbeat: {formatTimeAgo(worker.lastHeartbeat)}</span>
                    <span className="text-amber-400 font-sans font-bold group-hover:underline">View Worker Details & History →</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Activity History Panel (Persisted Events) */}
          <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-black text-sm text-white uppercase tracking-wider flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400" />
                  <span>Live Activity History Log</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
                    {scanState?.activityEvents?.length || 0} Persisted Events
                  </span>
                </h4>
                <p className="text-xs text-slate-400">
                  Authoritative record of claims, searches, artwork checks, replacements, completions, failures, and recoveries.
                </p>
              </div>

              {/* Event Search & Filter Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter by anime title..."
                  value={eventSearch}
                  onChange={e => setEventSearch(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />

                <select
                  value={eventFilter}
                  onChange={e => setEventFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="all">All Event Types</option>
                  <option value="task_claimed">Task Claimed</option>
                  <option value="verification_started">Verification Started</option>
                  <option value="source_searched">Source Searched</option>
                  <option value="artwork_checked">Artwork Checked</option>
                  <option value="replacement_found">Replacement Found</option>
                  <option value="artwork_saved">Artwork Saved</option>
                  <option value="task_completed">Task Completed</option>
                  <option value="task_failed">Task Failed</option>
                  <option value="stale_task_recovered">Stale Recovered</option>
                </select>
              </div>
            </div>

            {/* Event List */}
            {(() => {
              const allEvents = scanState?.activityEvents || [];
              const filtered = allEvents.filter(evt => {
                if (eventFilter !== 'all' && evt.eventType !== eventFilter) return false;
                if (eventSearch.trim()) {
                  const q = eventSearch.toLowerCase();
                  const matchTitle = evt.animeTitle?.toLowerCase().includes(q);
                  const matchOp = evt.operation?.toLowerCase().includes(q);
                  const matchWorker = `worker ${evt.workerId}`.includes(q);
                  if (!matchTitle && !matchOp && !matchWorker) return false;
                }
                return true;
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-8 text-center text-slate-500 text-xs font-medium">
                    No activity events match the selected filters.
                  </div>
                );
              }

              return (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {filtered.map(evt => (
                    <div
                      key={evt.id}
                      className="p-3 bg-slate-900/80 border border-slate-800/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="flex items-start md:items-center gap-2.5">
                        <span className="px-2 py-1 rounded-md text-[10px] font-mono font-black bg-slate-800 text-slate-300 border border-slate-700">
                          W#{evt.workerId}
                        </span>

                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase font-mono border ${
                          evt.eventType === 'task_completed' || evt.eventType === 'artwork_saved'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : evt.eventType === 'task_failed'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : evt.eventType === 'replacement_found'
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : evt.eventType === 'stale_task_recovered'
                            ? 'bg-amber-500/30 text-amber-200 border-amber-400/50'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {evt.eventType.replace(/_/g, ' ')}
                        </span>

                        <div className="space-y-0.5">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{evt.animeTitle || 'System Worker Event'}</span>
                            {evt.operation && (
                              <span className="text-[10px] font-normal text-amber-300 font-mono">
                                ({evt.operation})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {evt.details || evt.step || 'Processing step executed'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono shrink-0">
                        {evt.source && <span className="text-cyan-300">{evt.source}</span>}
                        <span>{formatTimeAgo(evt.timestampMs)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* --- WORKER DETAIL MODAL / DRAWER --- */}
      {selectedWorkerId !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl max-w-2xl w-full space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            {(() => {
              const worker = scanState?.activeWorkers?.find(w => w.workerId === selectedWorkerId) || {
                workerId: selectedWorkerId,
                status: 'idle' as const,
                tasksCompleted: 0,
                tasksFailed: 0,
                lastHeartbeat: Date.now(),
                health: 'healthy' as const
              };

              const isWorking = worker.status === 'working' || worker.status === 'claiming' || worker.status === 'busy';
              const isRetrying = worker.status === 'retrying';
              const isError = worker.status === 'error';

              const workerEvents = (scanState?.activityEvents || []).filter(e => e.workerId === selectedWorkerId);

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 font-mono font-black text-sm border border-amber-500/30">
                        Worker #{worker.workerId}
                      </div>
                      <div>
                        <h3 className="font-black text-base text-white">
                          Worker {worker.workerId} Deep Diagnostic View
                        </h3>
                        <p className="text-xs text-slate-400">
                          Authoritative worker task lease, telemetry, and activity history.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedWorkerId(null)}
                      className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Worker Status Banner */}
                  <div className={`p-4 rounded-xl border space-y-2 ${
                    isWorking
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : isRetrying
                      ? 'bg-amber-950/30 border-amber-500/40'
                      : isError
                      ? 'bg-rose-950/30 border-rose-500/40'
                      : 'bg-slate-900 border-slate-800'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          isWorking ? 'bg-emerald-400 animate-ping' : isRetrying ? 'bg-amber-400' : isError ? 'bg-rose-400' : 'bg-slate-500'
                        }`} />
                        <span className="font-black text-sm text-white uppercase tracking-wider">
                          Status: {isWorking ? 'WORKING' : worker.status.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">
                        Heartbeat: {formatTimeAgo(worker.lastHeartbeat)}
                      </span>
                    </div>

                    {isWorking ? (
                      <div className="space-y-1.5 text-xs pt-2 border-t border-slate-800">
                        <div className="font-bold text-amber-300 text-sm">{worker.currentAnimeTitle}</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                          <div><span className="text-slate-500">Task ID:</span> {worker.currentTaskId}</div>
                          <div><span className="text-slate-500">Operation:</span> {worker.operation}</div>
                          <div><span className="text-slate-500">Source:</span> {worker.currentSource}</div>
                          <div><span className="text-slate-500">Spent:</span> {formatElapsed(worker.taskStartedAt)}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-950 text-slate-300 text-xs">
                          <strong>Step:</strong> {worker.currentStep}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        Worker is currently idle awaiting tasks from the priority queue.
                      </p>
                    )}
                  </div>

                  {/* Worker Metrics Summary */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Completed</div>
                      <div className="text-lg font-black text-emerald-400 font-mono">{worker.tasksCompleted || 0}</div>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Failed</div>
                      <div className="text-lg font-black text-rose-400 font-mono">{worker.tasksFailed || 0}</div>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Health</div>
                      <div className="text-lg font-black text-cyan-400 font-mono uppercase">{worker.health || 'Healthy'}</div>
                    </div>
                  </div>

                  {/* Worker Recent Completed Tasks */}
                  {worker.recentCompletedTasks && worker.recentCompletedTasks.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">
                        Worker #{worker.workerId} Recent Completed Tasks
                      </h4>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {worker.recentCompletedTasks.map((t, idx) => (
                          <div key={idx} className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-xs flex items-center justify-between">
                            <div>
                              <div className="font-bold text-white">{t.animeTitle}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{t.operation} • {t.details}</div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                            }`}>
                              {t.status.toUpperCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Worker Specific Activity Events Timeline */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-xs text-slate-300 uppercase tracking-wider">
                      Worker #{worker.workerId} Activity Event History ({workerEvents.length})
                    </h4>
                    {workerEvents.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {workerEvents.map(evt => (
                          <div key={evt.id} className="p-2.5 bg-slate-900/70 border border-slate-800 rounded-lg text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-amber-300 font-mono text-[10px] uppercase">
                                {evt.eventType.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">{formatTimeAgo(evt.timestampMs)}</span>
                            </div>
                            <div className="text-slate-200">{evt.animeTitle || 'Worker Event'}</div>
                            <div className="text-[11px] text-slate-400">{evt.details || evt.step}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-4 text-center text-slate-500 text-xs">
                        No activity events recorded yet for Worker #{worker.workerId}.
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* --- TAB 3: POSSIBLE FAKE ANIME ISSUES --- */}
      {subTab === 'fake_issues' && (
        <div className="space-y-4">
          <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl space-y-1">
            <div className="flex items-center gap-2 text-rose-300 text-xs font-black uppercase">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Possible Fake Anime Detection Registry</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Anime entries flagged after thorough multi-pass searches across AniList and Jikan/MyAnimeList returned zero matches. These records are preserved safely for the future Fake Anime Manager without deleting the catalogue items.
            </p>
          </div>

          {fakeIssues.length > 0 ? (
            <div className="space-y-3">
              {fakeIssues.map(issue => (
                <div
                  key={issue.id}
                  className="p-4 bg-slate-950/90 border border-slate-800 hover:border-slate-700 rounded-xl space-y-3 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{issue.animeTitle}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                            issue.status === 'active'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {issue.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Catalogue ID: {issue.catalogueId} • Source: {issue.source}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {issue.status === 'active' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleResolveFakeIssue(issue.id, 'manual_verified')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700 text-emerald-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Confirm Real / Verified</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResolveFakeIssue(issue.id, 'dismiss')}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                    <div>
                      <span className="font-bold text-slate-400 uppercase text-[9px]">Titles Exhaustively Checked:</span>
                      <p className="text-slate-200 mt-0.5 font-mono text-[10px]">
                        {issue.titlesChecked?.join(' • ') || issue.animeTitle}
                      </p>
                    </div>

                    <div>
                      <span className="font-bold text-slate-400 uppercase text-[9px]">Source Canonical URL:</span>
                      <p className="text-slate-300 mt-0.5 truncate text-[10px]">
                        {issue.sourceUrl ? (
                          <a
                            href={issue.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-400 hover:underline flex items-center gap-1"
                          >
                            <span>{issue.sourceUrl}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ) : (
                          'No source URL provided'
                        )}
                      </p>
                    </div>
                  </div>

                  {issue.evidence && issue.evidence.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Verification Findings:</span>
                      <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                        {issue.evidence.map((ev, i) => (
                          <li key={i}>{ev}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-slate-500 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 opacity-60 mx-auto" />
              <p className="text-xs">No active Possible Fake Anime Issues detected.</p>
              <p className="text-[11px] text-slate-600">Run Start Artwork Verification to scan the catalogue.</p>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 4: ARTWORK HISTORY & BACKUPS --- */}
      {subTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Audit log of all automatic fixes and replacements. Any changed artwork can be reverted to its previous backup immediately.
            </p>
            <button
              type="button"
              onClick={fetchHistory}
              className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>

          {historyList.length > 0 ? (
            <div className="space-y-3">
              {historyList.map(entry => (
                <div
                  key={entry.id}
                  className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-white">{entry.animeTitle}</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                        {entry.source}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">{entry.reason}</p>
                    <p className="text-[9px] text-slate-500 font-mono">
                      {new Date(entry.replacedAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Previous Thumbnail */}
                    <div className="w-10 h-14 rounded bg-slate-900 border border-slate-800 overflow-hidden relative" title="Previous Artwork">
                      <img src={entry.previousArtworkUrl} alt="Previous" className="w-full h-full object-cover" />
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                    {/* New Thumbnail */}
                    <div className="w-10 h-14 rounded bg-slate-900 border border-slate-800 overflow-hidden relative" title="New Artwork">
                      <img src={entry.newArtworkUrl} alt="New" className="w-full h-full object-cover" />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevertArtwork(entry.animeId)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer ml-2"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Revert</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-slate-500 space-y-1">
              <History className="w-8 h-8 opacity-30 mx-auto" />
              <p className="text-xs">No artwork replacement history recorded yet.</p>
            </div>
          )}
        </div>
      )}

      {/* --- TAB 5: SOURCE CONFIGURATION (Owner Only) --- */}
      {subTab === 'sources' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase">
              <Shield className="w-4 h-4" />
              <span>Owner Artwork Source Configuration</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Configure endpoints, rate limits, and connectivity for trusted anime artwork providers. Additional providers can be added in the backend without changing the core verifier.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sourcesList.map(source => (
              <div
                key={source.id}
                className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white">{source.name}</h4>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-slate-800 text-slate-300">
                        {source.type}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">{source.description}</p>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                      source.status === 'operational'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : source.status === 'degraded'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {source.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs bg-slate-900/80 p-3 rounded-lg border border-slate-800/80 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Endpoint:</span>
                    <span className="text-slate-300 truncate max-w-[200px]">{source.endpoint}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Rate Limit:</span>
                    <span className="text-slate-300">
                      {source.rateLimitPerSecond ? `${source.rateLimitPerSecond}/sec` : `${source.rateLimitPerMinute}/min`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Timeout:</span>
                    <span className="text-slate-300">{source.timeoutMs}ms</span>
                  </div>
                </div>

                {sourceTestResult[source.id] && (
                  <div
                    className={`p-2.5 rounded text-[11px] border ${
                      sourceTestResult[source.id].success
                        ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-800 text-rose-300'
                    }`}
                  >
                    {sourceTestResult[source.id].message}
                  </div>
                )}

                <div className="pt-2 border-t border-slate-900 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleTestSource(source.id)}
                    disabled={testingSourceId === source.id}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {testingSourceId === source.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    <span>Test Connection</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. DETAILED INSPECTION DRAWER / MODAL */}
      {inspectedAnime && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-2xl animate-fade-in relative">
            <button
              type="button"
              onClick={() => setInspectedAnime(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1 pr-10">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider font-mono">
                Artwork Deep Inspection
              </span>
              <h3 className="text-lg font-black text-white">{inspectedAnime.title}</h3>
              {inspectedAnime.alternateTitle && (
                <p className="text-xs text-slate-400">{inspectedAnime.alternateTitle}</p>
              )}
            </div>

            {/* Side-by-Side Artwork Visualizer */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Current Artwork Card */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center space-y-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Current Catalogue Artwork</span>
                <div className="w-36 aspect-[3/4] bg-slate-950 border border-slate-800 rounded-lg overflow-hidden relative shadow">
                  {inspectedAnime.currentArtworkUrl ? (
                    <img
                      src={inspectedAnime.currentArtworkUrl}
                      alt={inspectedAnime.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600">
                      <ImageIcon className="w-8 h-8 opacity-40 mb-1" />
                      <span className="text-[9px]">Missing Poster</span>
                    </div>
                  )}
                </div>
                <div className="text-center space-y-1">
                  <span className="text-[10px] font-mono text-slate-400 block truncate max-w-xs">
                    {inspectedAnime.currentArtworkUrl || 'No image assigned'}
                  </span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                      inspectedAnime.verificationStatus === 'verified'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {inspectedAnime.verificationStatus}
                  </span>
                </div>
              </div>

              {/* Verified Source Candidate Match */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-amber-400 uppercase">
                    Trusted Source Match Evidence
                  </span>

                  {inspectedAnime.aniListMatch && (
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-300">AniList Match:</span>
                        <span className="text-emerald-400">{Math.round(inspectedAnime.aniListMatch.score * 100)}%</span>
                      </div>
                      <p className="text-slate-400 truncate">{inspectedAnime.aniListMatch.title}</p>
                    </div>
                  )}

                  {inspectedAnime.jikanMatch && (
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-300">Jikan (MAL) Match:</span>
                        <span className="text-emerald-400">{Math.round(inspectedAnime.jikanMatch.score * 100)}%</span>
                      </div>
                      <p className="text-slate-400 truncate">{inspectedAnime.jikanMatch.title}</p>
                    </div>
                  )}

                  {inspectedAnime.candidates && inspectedAnime.candidates.length > 0 ? (
                    <div className="space-y-1.5 pt-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Available Candidates:</span>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {inspectedAnime.candidates.slice(0, 3).map((cand, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleApplyCandidate(inspectedAnime.id, cand.imageUrl, cand.source)}
                            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-lg cursor-pointer shrink-0 text-center space-y-1 transition-colors"
                          >
                            <img src={cand.imageUrl} alt="Candidate" className="w-14 h-20 object-cover rounded" />
                            <span className="text-[8px] font-mono text-amber-300 uppercase block">
                              Apply {cand.source}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No candidates available.</p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleVerifySingle(inspectedAnime.id)}
                    disabled={singleVerifying}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {singleVerifying ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Re-verify Now</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInspectedAnime(null)}
                    className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 5. INSPECT ALL MODAL REPORT */}
      {showInspectModal && inspectReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-wider">
                    Catalogue Artwork Inspection Report
                  </h3>
                  <p className="text-xs text-slate-400">
                    Inspected {inspectReport.totalCatalogue} titles on {new Date(inspectReport.inspectedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowInspectModal(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Metrics Grid */}
            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Inspected</span>
                  <div className="text-lg font-black text-white">{inspectReport.totalCatalogue}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-emerald-500/40 rounded-xl">
                  <span className="text-[10px] font-bold text-emerald-400 uppercase">Valid</span>
                  <div className="text-lg font-black text-emerald-400">{inspectReport.validArtworkCount}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-rose-500/40 rounded-xl">
                  <span className="text-[10px] font-bold text-rose-400 uppercase">Missing</span>
                  <div className="text-lg font-black text-rose-400">{inspectReport.missingArtworkCount}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-amber-500/40 rounded-xl">
                  <span className="text-[10px] font-bold text-amber-400 uppercase">Incorrect</span>
                  <div className="text-lg font-black text-amber-400">{inspectReport.incorrectArtworkCount}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-cyan-500/40 rounded-xl">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase">Auto-Repair</span>
                  <div className="text-lg font-black text-cyan-400">{inspectReport.requiresReplacementCount}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-purple-500/40 rounded-xl">
                  <span className="text-[10px] font-bold text-purple-400 uppercase">Needs Review</span>
                  <div className="text-lg font-black text-purple-400">{inspectReport.needsReviewCount}</div>
                </div>
                <div className="p-3 bg-slate-950 border border-rose-600/50 rounded-xl">
                  <span className="text-[10px] font-bold text-rose-500 uppercase">Possible Fake</span>
                  <div className="text-lg font-black text-rose-400">{inspectReport.possibleFakeCount}</div>
                </div>
              </div>

              {/* Action Banner to Proceed with Auto-Repair */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-black text-amber-400 uppercase tracking-wide">
                    Ready to Auto-Verify Catalogue
                  </span>
                  <p className="text-xs text-slate-300">
                    Inspection completed without making changes. Run Verify All to automatically repair flagged entries.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowInspectModal(false);
                      handleStartScan('unverified');
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-500/20"
                  >
                    <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Verify Unverified</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInspectModal(false);
                      handleStartScan('all');
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
                  >
                    <Play className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Verify All</span>
                  </button>
                </div>
              </div>

              {/* Affected Records Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white uppercase tracking-wider">
                    Catalogue Inspection Breakdown ({inspectReport.items.length} titles)
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Showing all inspected records
                  </span>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-black border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">Anime Title</th>
                        <th className="py-2.5 px-3">Artwork Status</th>
                        <th className="py-2.5 px-3">Integrity State</th>
                        <th className="py-2.5 px-3">Issue Detected</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {inspectReport.items.map(item => (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-sans font-bold text-white max-w-xs truncate">
                            {item.title}
                          </td>
                          <td className="py-2 px-3">
                            {item.hasArtwork ? (
                              <span className="text-emerald-400 text-[11px]">Valid URL</span>
                            ) : (
                              <span className="text-rose-400 text-[11px]">Missing</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                item.status === 'verified'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : item.status === 'auto_fixed'
                                  ? 'bg-cyan-500/20 text-cyan-300'
                                  : item.status === 'needs_review'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-400 text-[11px]">
                            {item.issue || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowInspectModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BATCH SELECTION MODAL */}
      {batchModalConfig?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in overscroll-contain overflow-hidden touch-none">
          <div className="relative w-full max-w-md bg-slate-950 border-2 border-amber-500/50 rounded-2xl shadow-2xl p-5 space-y-5 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl border ${
                  batchModalConfig.mode === 'unverified'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : batchModalConfig.mode === 'fix_missing'
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                }`}>
                  {batchModalConfig.mode === 'unverified' ? <Sparkles className="w-5 h-5" /> : batchModalConfig.mode === 'fix_missing' ? <ImageIcon className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-black text-sm text-white uppercase tracking-wide">
                    {batchModalConfig.mode === 'unverified' ? 'Verify Unverified Batch' : batchModalConfig.mode === 'fix_missing' ? 'Fix Missing Artwork Batch' : 'Verify All Batch'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Total Available: <strong className="text-amber-300">{batchModalConfig.totalAvailable}</strong> titles
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBatchModalConfig(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-black text-slate-300 uppercase tracking-wider">
                Select Batch Size
              </label>

              <div className="grid grid-cols-3 gap-2">
                {[50, 100, 300].map(size => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setSelectedBatchOption(size);
                      setCustomBatchInput(String(size));
                    }}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      selectedBatchOption === size
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md'
                        : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {size}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setSelectedBatchOption('all');
                    setCustomBatchInput(String(batchModalConfig.totalAvailable));
                  }}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer col-span-2 ${
                    selectedBatchOption === 'all'
                      ? 'bg-amber-500 text-slate-950 border-amber-400 font-black shadow-md'
                      : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  All ({batchModalConfig.totalAvailable})
                </button>
              </div>

              <div className="pt-2">
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Or enter custom amount:
                </label>
                <input
                  type="number"
                  min="1"
                  max={batchModalConfig.totalAvailable}
                  value={customBatchInput}
                  onChange={(e) => {
                    setCustomBatchInput(e.target.value);
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      setSelectedBatchOption(val);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  placeholder="e.g. 150"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchModalConfig(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const limit = selectedBatchOption === 'all'
                    ? undefined
                    : (parseInt(customBatchInput, 10) || (typeof selectedBatchOption === 'number' ? selectedBatchOption : undefined));
                  handleStartScan(batchModalConfig.mode, limit);
                }}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-slate-950" />
                <span>Start Verification Batch</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHOOSE REPLACEMENT CANDIDATE MODAL */}
      {chosenReplacementModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-2xl bg-slate-950 border-2 border-purple-500/50 rounded-2xl shadow-2xl p-5 space-y-4 text-slate-100 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="font-black text-sm text-white uppercase tracking-wide">
                    Choose Replacement Poster
                  </h3>
                  <p className="text-xs text-slate-400">
                    Select a verified poster candidate for <strong className="text-white">{chosenReplacementModal.animeTitle}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChosenReplacementModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-900 border border-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto p-1 flex-1">
              {chosenReplacementModal.candidates.map((cand, idx) => (
                <div
                  key={idx}
                  className="bg-slate-900 border border-slate-800 hover:border-purple-500 rounded-xl p-3 flex flex-col justify-between space-y-2 transition-all group cursor-pointer"
                  onClick={() => handleChooseReplacementCandidate(chosenReplacementModal.animeId, cand.imageUrl, cand.source)}
                >
                  <div className="w-full aspect-[3/4] bg-slate-950 rounded-lg overflow-hidden relative flex items-center justify-center border border-slate-800">
                    <img
                      src={cand.imageUrl}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover opacity-25 blur-sm scale-110 pointer-events-none"
                    />
                    <img
                      src={cand.imageUrl}
                      alt={cand.title}
                      className="relative z-10 max-w-full max-h-full object-contain group-hover:scale-105 transition-transform"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-mono uppercase text-purple-400 font-bold">{cand.source}</span>
                      <span className="font-mono text-emerald-400 font-black">{Math.round(cand.confidence * 100)}%</span>
                    </div>
                    <p className="text-[10px] text-slate-300 truncate">{cand.title}</p>
                    <button
                      type="button"
                      className="w-full py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-sm"
                    >
                      Apply Poster
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setChosenReplacementModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold border border-slate-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
