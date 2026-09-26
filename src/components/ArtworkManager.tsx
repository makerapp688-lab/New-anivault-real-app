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
  jobId?: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  totalCount: number;
  totalTasks?: number;
  processedCount: number;
  completedTasksCount?: number;
  failedTasksCount?: number;
  remainingTasksCount?: number;
  queuedCount?: number;
  claimedCount?: number;
  progressPercent?: number;
  currentIndex: number;
  currentAnimeId: string | null;
  currentAnimeTitle: string | null;
  startedAt: string | null;
  updatedAt: string;
  stateVersion?: number;
  finishedAt?: string | null;
  mode?: 'all' | 'unverified' | 'fix_missing' | 'inspect';
  workerCount?: number;
  globalStats?: {
    total: number;
    verified: number;
    autoFixed: number;
    needsReview: number;
    unableToVerify: number;
    possibleFake: number;
    missing: number;
    unverified: number;
    pending?: number;
    completed?: number;
    failed?: number;
    historyCount: number;
  };
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
  tasksPerMinute?: number;
  workerUtilization?: {
    active: number;
    idle: number;
    waiting: number;
    retrying: number;
    utilizationPercent: number;
  };
  databasePerformance?: {
    totalReads: number;
    totalWrites: number;
    latencyMs: number;
  };
  estimatedRemainingSeconds?: number | null;
  activeWorkers?: WorkerInfo[];
  liveAnimeRegistry?: Record<string, any>;
  activeAnimeLocks?: Array<{
    animeId: string;
    workerId: number;
    taskId: string;
    acquiredAt: number;
    leaseExpiresAt: number;
  }>;
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
  status: 'operational' | 'testing' | 'rate_limited' | 'temporarily_unavailable' | 'timeout' | 'configuration_error' | 'degraded' | 'offline' | 'disabled' | 'untested';
  lastChecked?: string;
  lastSuccessfulChecked?: string;
  lastLatencyMs?: number;
  lastError?: string | null;
  lastMessage?: string | null;
  description: string;
}

export const ArtworkManager: React.FC<ArtworkManagerProps> = () => {
  // Main Sub-tabs: 'registry' | 'needs_review' | 'workers' | 'fake_issues' | 'history' | 'sources' | 'watch_order'
  const [subTab, setSubTab] = useState<'registry' | 'needs_review' | 'workers' | 'fake_issues' | 'history' | 'sources' | 'watch_order'>('registry');

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

  // Separate Watch Order Sources System State
  const [watchOrderSources, setWatchOrderSources] = useState<any[]>([]);
  const [watchOrderRecords, setWatchOrderRecords] = useState<any[]>([]);
  const [testingWatchOrderSourceId, setTestingWatchOrderSourceId] = useState<string | null>(null);
  const [watchOrderSourceTestResult, setWatchOrderSourceTestResult] = useState<Record<string, any>>({});
  const [watchOrderQuery, setWatchOrderQuery] = useState<string>('');
  const [resolvingWatchOrder, setResolvingWatchOrder] = useState<boolean>(false);
  const [validatingFranchiseKey, setValidatingFranchiseKey] = useState<string | null>(null);
  const [watchOrderFilter, setWatchOrderFilter] = useState<'all' | 'high_confidence' | 'needs_review' | 'validated'>('all');
  const [watchOrderBannerMessage, setWatchOrderBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
  const [workerStatusFilter, setWorkerStatusFilter] = useState<string>('all');
  const [workerPage, setWorkerPage] = useState<number>(1);

  const handleUpdatePoolConfig = async (newCount: number) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/pool-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentWorkers: newCount }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        if (data.scanState) updateScanStateSafely(data.scanState);
        await fetchDashboard();
      } else {
        alert(data.error || 'Failed to update worker pool count.');
      }
    } catch (err: any) {
      alert(`Error updating pool config: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

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
  const lastStateVersionRef = useRef<number>(0);

  // Safe Monotonic ScanState Updater (Prevents stale responses and backward progress jumps)
  const updateScanStateSafely = (newState: ScanState | null) => {
    if (!newState) return;
    setScanState(prev => {
      if (!prev) {
        if (newState.stateVersion) lastStateVersionRef.current = newState.stateVersion;
        return newState;
      }
      // If same job run, discard out-of-order stale responses and enforce monotonic progress
      const sameJob = (prev.jobId && newState.jobId && prev.jobId === newState.jobId) ||
        (prev.startedAt && newState.startedAt && prev.startedAt === newState.startedAt);
      if (sameJob) {
        if (
          newState.stateVersion &&
          lastStateVersionRef.current > 0 &&
          newState.stateVersion < lastStateVersionRef.current
        ) {
          return prev;
        }
        if (newState.stateVersion) {
          lastStateVersionRef.current = newState.stateVersion;
        }
        const safeProcessed = Math.max(prev.processedCount || 0, newState.processedCount || 0);
        const safeCompleted = Math.max(prev.completedTasksCount || 0, newState.completedTasksCount || 0);
        return {
          ...newState,
          processedCount: safeProcessed,
          completedTasksCount: safeCompleted
        };
      }
      if (newState.stateVersion) {
        lastStateVersionRef.current = newState.stateVersion;
      }
      return newState;
    });
    if (newState.globalStats) {
      setDashboardData((prev: any) => prev ? { ...prev, stats: newState.globalStats } : { stats: newState.globalStats });
    }
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
      const originalBodyOverflow = document.body.style.overflow;
      const originalHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        const ownerModal = document.getElementById('owner-dashboard-modal');
        if (ownerModal) {
          document.body.style.overflow = 'hidden';
          document.documentElement.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = originalBodyOverflow;
          document.documentElement.style.overflow = originalHtmlOverflow;
        }
      };
    }
  }, [isModalOpen]);

  // Fetch dashboard summary
  const fetchDashboard = async (autoReconnectView = false) => {
    try {
      const res = await fetch('/api/owner/artwork-manager/dashboard', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data);
        updateScanStateSafely(data.scanState);
        if (data.sources && Array.isArray(data.sources)) {
          setSourcesList(data.sources);
        }
        if (data.watchOrderSources && Array.isArray(data.watchOrderSources)) {
          setWatchOrderSources(data.watchOrderSources);
        }
        if (data.watchOrderRecords && Array.isArray(data.watchOrderRecords)) {
          setWatchOrderRecords(data.watchOrderRecords);
        }
        // Active Job Reconnection: if a verification job is already running when Artwork Manager opens, switch to live progress
        if (autoReconnectView && data.scanState?.status === 'running') {
          setSubTab('workers');
        }
      }
    } catch (err) {
      console.warn('Could not load artwork manager dashboard:', err);
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
      console.warn('Could not load anime registry:', err);
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
      console.warn('Could not load fake issues:', err);
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
      console.warn('Could not load history:', err);
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
      console.warn('Could not load sources:', err);
    }
  };

  // Fetch Watch Order Sources & Records (Separate from Artwork Verification)
  const fetchWatchOrderData = async () => {
    try {
      const res = await fetch('/api/owner/artwork-manager/watch-order/sources', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.sources)) setWatchOrderSources(data.sources);
        if (Array.isArray(data.records)) setWatchOrderRecords(data.records);
      }
    } catch (err) {
      console.warn('Could not load watch order sources:', err);
    }
  };

  const handleTestWatchOrderSource = async (sourceId: string) => {
    setTestingWatchOrderSourceId(sourceId);
    try {
      const res = await fetch(`/api/owner/artwork-manager/watch-order/sources/${sourceId}/test`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      setWatchOrderSourceTestResult(prev => ({ ...prev, [sourceId]: data }));
      if (Array.isArray(data.sources)) {
        setWatchOrderSources(data.sources);
      } else {
        await fetchWatchOrderData();
      }
    } catch (err: any) {
      setWatchOrderSourceTestResult(prev => ({
        ...prev,
        [sourceId]: { success: false, message: err.message }
      }));
    } finally {
      setTestingWatchOrderSourceId(null);
    }
  };

  const handleResolveWatchOrder = async (queryOrQueries: string | string[]) => {
    setResolvingWatchOrder(true);
    setWatchOrderBannerMessage(null);
    try {
      const payload = Array.isArray(queryOrQueries)
        ? { queries: queryOrQueries }
        : { query: queryOrQueries };
      const res = await fetch('/api/owner/artwork-manager/watch-order/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.records)) setWatchOrderRecords(data.records);
        if (Array.isArray(data.sources)) setWatchOrderSources(data.sources);
        setWatchOrderBannerMessage({
          type: 'success',
          text: Array.isArray(queryOrQueries)
            ? `Retrieved & compared live watch orders for ${queryOrQueries.join(', ')} across Watchordr and The Anime Order.`
            : `Retrieved & compared live watch order for "${data.record?.canonicalTitle || queryOrQueries}" (${data.record?.confidenceLabel}).`
        });
      } else {
        setWatchOrderBannerMessage({
          type: 'error',
          text: data.error || 'Failed to resolve watch order.'
        });
      }
    } catch (err: any) {
      setWatchOrderBannerMessage({
        type: 'error',
        text: `Error checking watch order: ${err.message}`
      });
    } finally {
      setResolvingWatchOrder(false);
    }
  };

  const handleValidateWatchOrder = async (
    franchiseKey: string,
    sourceChoice: 'consensus' | 'watchordr' | 'theanimeorder'
  ) => {
    setValidatingFranchiseKey(franchiseKey);
    setWatchOrderBannerMessage(null);
    try {
      const res = await fetch('/api/owner/artwork-manager/watch-order/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseKey, sourceChoice }),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (Array.isArray(data.records)) setWatchOrderRecords(data.records);
        setWatchOrderBannerMessage({
          type: 'success',
          text: data.message || 'Watch order validated and linked to catalogue records.'
        });
      } else {
        setWatchOrderBannerMessage({
          type: 'error',
          text: data.error || 'Failed to validate watch order.'
        });
      }
    } catch (err: any) {
      setWatchOrderBannerMessage({
        type: 'error',
        text: `Error validating watch order: ${err.message}`
      });
    } finally {
      setValidatingFranchiseKey(null);
    }
  };

  // Initial load & real-time SSE stream connection
  useEffect(() => {
    fetchDashboard(true);
    fetchAnimeList(1, 'all', '');
    fetchFakeIssues();
    fetchHistory();
    fetchSources();
    fetchWatchOrderData();

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/owner/artwork-manager/stream', { withCredentials: true });
      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const liveState = parsed.state || parsed.job;
          if (liveState) {
            updateScanStateSafely(liveState);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (es) es.close();
    };
  }, []);

  // Poll scan state when scan is active or when viewing Workers Monitor
  useEffect(() => {
    const shouldPoll = scanState?.status === 'running' || subTab === 'workers' || processingItemIds.length > 0;
    if (shouldPoll) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/owner/artwork-manager/status', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            const liveState = data.state || data.job;
            if (liveState) {
              const wasRunning = scanState?.status === 'running';
              updateScanStateSafely(liveState);
              if (wasRunning && liveState.status !== 'running') {
                fetchDashboard();
                fetchAnimeList(page, statusFilter, searchQuery);
                fetchFakeIssues();
                fetchHistory();
              }
            }
          }
        } catch {}
      }, 750);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [scanState?.status, scanState?.jobId, subTab, processingItemIds.length]);

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
        const nextState = data.state || data.job;
        if (nextState) {
          updateScanStateSafely(nextState);
        }
        setBatchModalConfig(null);
        setShowInspectModal(false);
        // Immediately open the live verification / progress monitoring screen
        setSubTab('workers');
        fetchDashboard();
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
        if (data.scanState) updateScanStateSafely(data.scanState);
        await fetchDashboard();
        await fetchAnimeList(page, statusFilter, searchQuery);
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
        if (data.scanState) updateScanStateSafely(data.scanState);
        fetchDashboard();
        fetchAnimeList(page, statusFilter, searchQuery);
      } else {
        alert(data.error || 'Failed to choose replacement.');
      }
    } catch (err: any) {
      alert(`Error choosing replacement: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryAllNeedsReview = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/needs-review/retry-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        if (data.scanState) updateScanStateSafely(data.scanState);
        await fetchDashboard();
        await fetchAnimeList(page, statusFilter, searchQuery);
      } else {
        alert(data.message || 'No unresolved items found to retry.');
      }
    } catch (err: any) {
      alert(`Error retrying all items: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSearchAllNeedsReview = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/owner/artwork-manager/needs-review/search-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        if (data.scanState) updateScanStateSafely(data.scanState);
        await fetchDashboard();
        await fetchAnimeList(page, statusFilter, searchQuery);
      } else {
        alert(data.message || 'No unresolved items found for source search.');
      }
    } catch (err: any) {
      alert(`Error searching all items: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRealBackendRefresh = async () => {
    setLoadingDashboard(true);
    try {
      await fetchDashboard();
      await fetchAnimeList(page, statusFilter, searchQuery);
      await fetchSources();
      await fetchFakeIssues();
      await fetchHistory();
    } catch (err: any) {
      console.error('Refresh error:', err.message);
    } finally {
      setLoadingDashboard(false);
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
        if (data.state || data.job) updateScanStateSafely(data.state || data.job);
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
        if (data.state || data.job) updateScanStateSafely(data.state || data.job);
        setSubTab('workers');
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
      const res = await fetch('/api/owner/artwork-manager/stop', {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.state || data.job) updateScanStateSafely(data.state || data.job);
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
        if (data.state || data.job) updateScanStateSafely(data.state || data.job);
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
    unverified: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    historyCount: 0
  };

  const progressPercent = scanState?.totalCount
    ? Math.min(100, Math.round((scanState.processedCount / scanState.totalCount) * 100))
    : 0;

  return (
    <div className="space-y-5 sm:space-y-6 animate-fade-in text-slate-100 max-w-full overflow-x-hidden">
      {/* 1. TOP HEADER & PRIMARY ACTION BAR */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-amber-500/40 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-5">
          <div className="space-y-1.5 max-w-2xl min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
                <ImageIcon className="w-5 h-5" />
              </div>
              <h3 className="text-sm sm:text-lg font-black text-white tracking-wide uppercase">
                ARTWORK MANAGER
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Automated Catalogue Integrity
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed break-words">
              Automated dual-source verification engine cross-checking AniList and Jikan/MyAnimeList data at scale. Auto-fixes low-res or missing artwork, detects possible fake anime, and secures high-resolution poster assets.
            </p>
          </div>

          {/* Primary Action Buttons */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
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
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${scanState.status === 'running' ? 'bg-amber-400 animate-ping' : 'bg-amber-600'}`} />
                <span className="font-bold text-white uppercase tracking-wider">
                  {scanState.status === 'running' ? 'Processing Workers...' : 'Verification Paused'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-amber-300 border border-slate-700">
                  {scanState.workerCount || 5} Workers Active
                </span>
                <span className="text-slate-400 break-words sm:truncate max-w-full sm:max-w-sm">
                  {scanState.currentAnimeTitle ? `[Active: ${scanState.currentAnimeTitle}]` : scanState.lastLog}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono font-bold text-xs">
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

      {/* 2. STATS OVERVIEW CARDS WITH REAL BACKEND REFRESH */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-400 uppercase tracking-wider font-mono">
            Authoritative Persisted Catalogue Statistics
          </span>
        </div>
        <button
          type="button"
          onClick={handleRealBackendRefresh}
          disabled={loadingDashboard}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
          title="Perform real backend recalculation & refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${loadingDashboard ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2.5">
        {/* Total Anime */}
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total</span>
          <div className="text-lg font-black text-white font-mono">{stats.total}</div>
          <div className="text-[9px] text-slate-500">Catalogue Titles</div>
        </div>

        {/* Verified */}
        <div className="p-3 bg-slate-950/80 border border-emerald-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Verified</span>
          <div className="text-lg font-black text-emerald-400 font-mono">{stats.verified}</div>
          <div className="text-[9px] text-slate-400">Validated Artwork</div>
        </div>

        {/* Auto Fixed */}
        <div className="p-3 bg-slate-950/80 border border-cyan-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block">Auto-Fixed</span>
          <div className="text-lg font-black text-cyan-400 font-mono">{stats.autoFixed}</div>
          <div className="text-[9px] text-slate-400">Posters Repaired</div>
        </div>

        {/* Needs Review */}
        <div className="p-3 bg-slate-950/80 border border-amber-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Needs Review</span>
          <div className="text-lg font-black text-amber-400 font-mono">{stats.needsReview}</div>
          <div className="text-[9px] text-slate-400">Uncertain Match</div>
        </div>

        {/* Unable to Verify */}
        <div className="p-3 bg-slate-950/80 border border-blue-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">Unable to Verify</span>
          <div className="text-lg font-black text-blue-400 font-mono">{stats.unableToVerify}</div>
          <div className="text-[9px] text-slate-400">No Source Match</div>
        </div>

        {/* Possible Fake */}
        <div className="p-3 bg-slate-950/80 border border-rose-500/40 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">Possible Fake</span>
          <div className="text-lg font-black text-rose-400 font-mono">{stats.possibleFake}</div>
          <div className="text-[9px] text-slate-400">Zero DB Match</div>
        </div>

        {/* Missing Artwork */}
        <div className="p-3 bg-slate-950/80 border border-orange-500/40 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider block">Missing Artwork</span>
          <div className="text-lg font-black text-orange-400 font-mono">{stats.missing}</div>
          <div className="text-[9px] text-slate-400">Needs Poster</div>
        </div>

        {/* Pending */}
        <div className="p-3 bg-slate-950/80 border border-purple-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">Pending</span>
          <div className="text-lg font-black text-purple-400 font-mono">
            {scanState?.status === 'running' || scanState?.status === 'paused'
              ? (scanState.remainingTasksCount ?? stats.pending ?? 0)
              : (stats.pending ?? Math.max(0, stats.total - stats.verified))}
          </div>
          <div className="text-[9px] text-slate-400">Awaiting Scan</div>
        </div>

        {/* Completed */}
        <div className="p-3 bg-slate-950/80 border border-emerald-500/20 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider block">Completed</span>
          <div className="text-lg font-black text-emerald-300 font-mono">
            {scanState?.completedTasksCount ?? stats.completed ?? 0}
          </div>
          <div className="text-[9px] text-slate-400">Tasks Finished</div>
        </div>

        {/* Failed */}
        <div className="p-3 bg-slate-950/80 border border-rose-500/30 rounded-xl space-y-1">
          <span className="text-[10px] font-bold text-rose-300 uppercase tracking-wider block">Failed</span>
          <div className="text-lg font-black text-rose-300 font-mono">
            {scanState?.failedTasksCount ?? stats.failed ?? 0}
          </div>
          <div className="text-[9px] text-slate-400">Failed Tasks</div>
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
          <span>Workers Monitor ({scanState?.poolConfig?.currentWorkers || scanState?.workerCount || 50})</span>
          {(scanState?.status === 'running' || scanState?.activeWorkers?.some(w => w.status === 'working' || w.status === 'claiming' || w.status === 'waiting' || w.status === 'retrying' || w.status === 'busy')) && (
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
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer sm:ml-auto ${
            subTab === 'sources'
              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Artwork Sources</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSubTab('watch_order');
            fetchWatchOrderData();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            subTab === 'watch_order'
              ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
              : 'bg-slate-950 text-cyan-300 hover:text-white border border-cyan-500/40'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Watch Order Sources</span>
          {watchOrderRecords.length > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-black ${
              subTab === 'watch_order' ? 'bg-slate-950 text-cyan-300' : 'bg-cyan-500/20 text-cyan-300'
            }`}>
              {watchOrderRecords.length}
            </span>
          )}
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
                onClick={handleRetryAllNeedsReview}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
                <span>Retry All Unresolved</span>
              </button>

              <button
                type="button"
                onClick={handleSearchAllNeedsReview}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search All Sources</span>
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('reverify', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-verify Selected ({selectedReviewIds.length})</span>
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('fix-artwork', selectedReviewIds)}
                disabled={!selectedReviewIds.length || actionLoading}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                <span>Fix Selected</span>
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
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-2 rounded-xl border border-slate-800">
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
                onClick={() => {
                  setReviewSubFilter(chip.id);
                  if (chip.id === 'missing_artwork') {
                    handleStatusFilterChange('missing');
                  } else if (chip.id === 'unable_to_verify') {
                    handleStatusFilterChange('unable_to_verify');
                  } else if (chip.id === 'possible_fake') {
                    handleStatusFilterChange('possible_fake');
                  } else {
                    handleStatusFilterChange('needs_review');
                  }
                }}
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
          {(() => {
            const filteredReviewList = animeList.filter(anime => {
              const iss = (anime.issue || '').toLowerCase();
              if (reviewSubFilter === 'temporary_source_failure') {
                return iss.includes('temporary') || iss.includes('rate-limit') || iss.includes('timeout');
              }
              if (reviewSubFilter === 'low_quality') {
                return iss.includes('low') || iss.includes('small') || iss.includes('resolution');
              }
              if (reviewSubFilter === 'sources_disagree') {
                return iss.includes('disagree') || iss.includes('conflict');
              }
              if (reviewSubFilter === 'incorrect_artwork') {
                return iss.includes('incorrect') || iss.includes('mismatch') || iss.includes('reverted');
              }
              return true;
            });

            return filteredReviewList.length > 0 ? (
              <div className="space-y-3">
                {filteredReviewList.map(anime => {
                  const isSelected = selectedReviewIds.includes(anime.id);
                  return (
                    <div
                      key={anime.id}
                      className={`bg-slate-950/90 border rounded-2xl p-3.5 sm:p-4 transition-all space-y-3 ${
                        isSelected ? 'border-amber-500 shadow-lg shadow-amber-500/10' : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        {/* Left: Checkbox + Poster + Info */}
                        <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
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
                            className="mt-1.5 w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500 bg-slate-900 cursor-pointer shrink-0"
                          />

                          {/* Uncropped Artwork */}
                          <div className="w-14 sm:w-16 h-20 sm:h-24 rounded-lg bg-slate-950 border border-slate-800 shrink-0 overflow-hidden relative flex items-center justify-center">
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
                              <h4 className="font-bold text-xs sm:text-sm text-white break-words">{anime.title}</h4>
                              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                {anime.verificationStatus.replace('_', ' ')}
                              </span>
                            </div>

                            <p className="text-[11px] sm:text-xs text-slate-400 font-mono break-words">
                              ID: {anime.id} • Source: {anime.source}
                            </p>

                            {/* Reason Description Box */}
                            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200/90 space-y-1">
                              <div className="font-black text-[10px] uppercase text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>Reason for Review:</span>
                              </div>
                              <p className="text-[11px] font-sans break-words">{anime.issue || 'Requires review before catalog verification.'}</p>
                            </div>

                            {/* Sources Checked Badges */}
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-1">
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
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap md:flex-col gap-1.5 w-full md:w-auto shrink-0 justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-900">
                          {(() => {
                            const isItemProcessing = processingItemIds.includes(anime.id) || (scanState?.status === 'running' && scanState?.activeWorkers?.some(w => w.currentAnimeId === anime.id));
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleBulkAction('reverify', [anime.id])}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                  <RefreshCw className={`w-3 h-3 shrink-0 ${isItemProcessing ? 'animate-spin' : ''}`} />
                                  <span>{isItemProcessing ? 'Processing...' : 'Re-verify'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleBulkAction('search-again', [anime.id])}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                  <Search className={`w-3 h-3 shrink-0 ${isItemProcessing ? 'animate-spin' : ''}`} />
                                  <span>{isItemProcessing ? 'Searching...' : 'Search Again'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleBulkAction('fix-artwork', [anime.id])}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                  <Sparkles className="w-3 h-3 fill-slate-950 shrink-0" />
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
                                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-black flex items-center justify-center gap-1 cursor-pointer shadow-sm disabled:opacity-50"
                                  >
                                    <ImageIcon className="w-3 h-3 shrink-0" />
                                    <span>Choose Candidate</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleBulkAction('approve-current', [anime.id])}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                  <span>Approve Current</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleBulkAction('mark-unable', [anime.id])}
                                  disabled={actionLoading || isItemProcessing}
                                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-bold flex items-center justify-center cursor-pointer disabled:opacity-50"
                                >
                                  Mark Unable
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setInspectedAnime(anime)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold flex items-center justify-center gap-1 border border-slate-800 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3 text-amber-400 shrink-0" />
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
            );
          })()}
        </div>
      )}

      {/* --- TAB: WORKERS MONITOR (5 Workers Concurrency) --- */}
      {subTab === 'workers' && (
        <div className="space-y-5">
          {/* Header Banner */}
          <div className="p-4 bg-gradient-to-r from-amber-950/60 via-slate-950 to-slate-950 border border-amber-500/40 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Activity className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="font-black text-sm text-white uppercase tracking-wider">
                  {scanState?.poolConfig?.currentWorkers || 50}-Worker Execution Pool Monitor
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Strict Parallel Execution Pool ({scanState?.poolConfig?.currentWorkers || 50} Workers)
                </span>
              </div>
              <p className="text-xs text-slate-300 break-words">
                Authoritative real-time telemetry directly from backend worker job engine. Displays task ownership, current step, source, heartbeats, and execution times across all {scanState?.poolConfig?.currentWorkers || 50} active workers.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchDashboard()}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                <span>Refresh Telemetry</span>
              </button>
            </div>
          </div>

          {/* Real Global Summary Totals Bar & Live Verification Progress */}
          {(() => {
            const currentWorkersCount = scanState?.poolConfig?.currentWorkers || scanState?.workerCount || 50;
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
            const waitingCount = workersList.filter(w => w.status === 'waiting').length;
            const idleCount = workersList.filter(w => w.status === 'idle').length;
            const retryingCount = workersList.filter(w => w.status === 'retrying' || w.status === 'backing_off').length;
            const errorCount = workersList.filter(w => w.status === 'error' || w.health === 'stale').length;

            const jobTotal = scanState?.totalTasks ?? scanState?.totalCount ?? 0;
            const completedTasks = scanState?.completedTasksCount ?? scanState?.processedCount ?? 0;
            const failedTasks = scanState?.failedTasksCount ?? scanState?.stats?.failed ?? 0;
            const processedTotal = scanState?.processedCount ?? (completedTasks + failedTasks);
            const remainingTasks = scanState?.remainingTasksCount ?? Math.max(0, jobTotal - processedTotal);
            const livePct = jobTotal > 0 ? Math.min(100, Math.round((processedTotal / jobTotal) * 100)) : 0;

            const activeTaskWorkers = workersList.filter(
              w => (w.status === 'working' || w.status === 'claiming' || w.status === 'waiting' || w.status === 'retrying' || w.status === 'busy') && w.currentAnimeTitle
            );

            return (
              <div className="space-y-4">
                {/* AUTHORITATIVE LIVE VERIFICATION PROGRESS PANEL */}
                <div className="p-4 sm:p-5 bg-slate-950/95 border border-amber-500/40 rounded-2xl space-y-4 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          scanState?.status === 'running'
                            ? 'bg-emerald-400 animate-ping'
                            : scanState?.status === 'paused'
                            ? 'bg-amber-400'
                            : scanState?.status === 'completed'
                            ? 'bg-cyan-400'
                            : 'bg-slate-500'
                        }`} />
                        <h4 className="font-black text-sm sm:text-base text-white uppercase tracking-wider">
                          Artwork Verification — Live Progress
                        </h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          {(scanState?.mode || 'unverified').replace(/_/g, ' ')}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-900 text-slate-300 border border-slate-700">
                          Status: {(scanState?.status || 'idle').toUpperCase()}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        Job: <span className="text-amber-300 font-bold">{scanState?.jobId || 'job_ready'}</span>
                        {scanState?.startedAt && (
                          <span className="ml-3 text-slate-500">
                            Started: {new Date(scanState.startedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {scanState?.status === 'running' && (
                        <>
                          <button
                            type="button"
                            onClick={handlePauseScan}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs cursor-pointer disabled:opacity-50"
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            onClick={handleStopScan}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            Stop
                          </button>
                        </>
                      )}
                      {scanState?.status === 'paused' && (
                        <>
                          <button
                            type="button"
                            onClick={handleResumeScan}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs cursor-pointer disabled:opacity-50"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={handleStopScan}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            Stop
                          </button>
                        </>
                      )}
                      {scanState?.status !== 'running' && scanState?.status !== 'paused' && (
                        <button
                          type="button"
                          onClick={() => handleStartScan('unverified')}
                          disabled={actionLoading}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                          <span>Verify Unverified Now</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Counter XX / TOTAL & Bar */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold uppercase text-slate-400">Progress:</span>
                        <span className="text-xl sm:text-2xl font-black font-mono text-white">
                          {processedTotal} <span className="text-slate-500">/</span> {jobTotal}
                        </span>
                        <span className="text-xs font-mono text-amber-400 font-bold">({livePct}%)</span>
                      </div>
                      <span className="text-xs font-mono text-cyan-400">
                        ETA: {scanState?.etaFormatted || (scanState?.status === 'running' ? 'Calculating...' : 'Idle')}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 via-emerald-400 to-cyan-400 transition-all duration-300"
                        style={{ width: `${livePct}%` }}
                      />
                    </div>
                  </div>

                  {/* Authoritative Job & Catalogue Counters */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
                    <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Job</span>
                      <span className="text-base font-black text-white font-mono">{jobTotal}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-emerald-500/30 rounded-xl">
                      <span className="text-[10px] text-emerald-400 uppercase font-bold block">Completed</span>
                      <span className="text-base font-black text-emerald-400 font-mono">{completedTasks}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-cyan-500/30 rounded-xl">
                      <span className="text-[10px] text-cyan-400 uppercase font-bold block">Remaining</span>
                      <span className="text-base font-black text-cyan-400 font-mono">{remainingTasks}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-emerald-500/20 rounded-xl">
                      <span className="text-[10px] text-emerald-300 uppercase font-bold block">Verified</span>
                      <span className="text-base font-black text-emerald-300 font-mono">{stats.verified}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-blue-500/30 rounded-xl">
                      <span className="text-[10px] text-blue-400 uppercase font-bold block">Auto-Fixed</span>
                      <span className="text-base font-black text-blue-400 font-mono">{stats.autoFixed}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-amber-500/30 rounded-xl">
                      <span className="text-[10px] text-amber-400 uppercase font-bold block">Needs Review</span>
                      <span className="text-base font-black text-amber-400 font-mono">{stats.needsReview}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-orange-500/30 rounded-xl">
                      <span className="text-[10px] text-orange-400 uppercase font-bold block">Unable to Verify</span>
                      <span className="text-base font-black text-orange-400 font-mono">{stats.unableToVerify}</span>
                    </div>
                    <div className="p-2.5 bg-slate-900/90 border border-rose-500/30 rounded-xl">
                      <span className="text-[10px] text-rose-400 uppercase font-bold block">Failed</span>
                      <span className="text-base font-black text-rose-400 font-mono">{failedTasks}</span>
                    </div>
                  </div>

                  {/* Current Live Worker Activity Stream */}
                  <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                      <span className="font-bold text-amber-300 uppercase tracking-wider font-mono">
                        Current Worker Activity ({activeTaskWorkers.length} Active)
                      </span>
                      <span className="text-slate-400 font-mono break-words">
                        Working: {workingCount} • Waiting: {waitingCount} • Retrying: {retryingCount} • Idle: {idleCount} • Error: {errorCount}
                      </span>
                    </div>
                    {activeTaskWorkers.length > 0 ? (
                      <div className="space-y-1 max-h-36 overflow-y-auto font-mono text-xs">
                        {activeTaskWorkers.slice(0, 10).map(w => (
                          <div key={w.workerId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 py-1.5 px-2 rounded bg-slate-950/80 border border-slate-800/80">
                            <div className="break-words pr-2 min-w-0">
                              <span className="text-emerald-400 font-bold">Worker {w.workerId}</span>
                              <span className="text-slate-500 mx-1.5">→</span>
                              <span className="text-white font-bold">{w.currentAnimeTitle}</span>
                              <span className="text-slate-500 mx-1.5">→</span>
                              <span className="text-amber-300">{w.operation || 'Artwork verification'}</span>
                              {w.currentStep && (
                                <span className="text-slate-400 ml-1.5 text-[10px]">({w.currentStep})</span>
                              )}
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300 shrink-0 self-start sm:self-center">
                              {w.status.toUpperCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 font-mono py-1 break-words">
                        {scanState?.lastLog || 'All workers idle. Start Verify Unverified or Verify All to process tasks.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Infrastructure Telemetry & Capacity Controls */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3.5 bg-slate-950/90 border border-slate-800 rounded-xl text-xs">
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">50-Worker Capable Architecture</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white font-bold text-sm">
                        {scanState?.poolConfig?.currentWorkers || 50} Active
                      </span>
                      <span className="text-slate-500 text-[10px] font-mono">(Max Capable: 50)</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Worker Pool Concurrency Selector</span>
                    <div className="flex items-center gap-1 font-mono text-xs">
                      {[1, 5, 10, 20, 30, 50].map(cnt => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => handleUpdatePoolConfig(cnt)}
                          className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            (scanState?.poolConfig?.currentWorkers || 50) === cnt
                              ? 'bg-amber-500 text-slate-950 shadow'
                              : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                          }`}
                        >
                          {cnt}W
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Real Calculated ETA</span>
                    <span className="font-mono text-cyan-400 font-bold text-sm block">
                      {scanState?.etaFormatted || 'Calculating...'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Server Heap Protection</span>
                    <span className="font-mono text-emerald-400 font-bold text-sm block">
                      {scanState?.systemHealth?.heapUsedMb || 0} MB <span className="text-slate-500 text-[10px]">({scanState?.systemHealth?.status || 'healthy'})</span>
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

                  <div className="p-3 bg-slate-950/80 border border-cyan-500/30 rounded-xl">
                    <div className="text-[10px] font-bold text-cyan-400 uppercase">Waiting</div>
                    <div className="text-lg font-black text-cyan-400 font-mono">{waitingCount}</div>
                    <div className="text-[9px] text-slate-500">Rate limiter slot</div>
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

                {/* Worker Status Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase font-mono mr-1">Filter Workers:</span>
                    {['all', 'working', 'claiming', 'waiting', 'retrying', 'idle', 'paused', 'error', 'stopped'].map(st => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setWorkerStatusFilter(st);
                          setWorkerPage(1);
                        }}
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase cursor-pointer transition-colors ${
                          workerStatusFilter === st
                            ? 'bg-amber-500 text-slate-950 shadow'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <span className="text-[10px] font-mono text-slate-400">
                    Showing {workersList.length} total active worker threads
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Dynamic Worker Pool Individual Cards Grid with Virtualized/Paginated Slice */}
          {(() => {
            const currentWorkersCount = scanState?.poolConfig?.currentWorkers || 50;
            const workerIds = Array.from({ length: currentWorkersCount }, (_, i) => i + 1);

            const allWorkerObjects = workerIds.map(id => {
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

            const filteredWorkers = allWorkerObjects.filter(w => {
              const effectiveStatus = (w.currentTaskId && w.status === 'idle') ? 'working' : w.status;
              if (workerStatusFilter === 'all') return true;
              if (workerStatusFilter === 'working') return effectiveStatus === 'working' || effectiveStatus === 'busy';
              if (workerStatusFilter === 'claiming') return effectiveStatus === 'claiming';
              if (workerStatusFilter === 'waiting') return effectiveStatus === 'waiting';
              if (workerStatusFilter === 'idle') return effectiveStatus === 'idle' && !w.currentTaskId;
              if (workerStatusFilter === 'retrying') return effectiveStatus === 'retrying' || effectiveStatus === 'backing_off';
              if (workerStatusFilter === 'paused') return effectiveStatus === 'paused';
              if (workerStatusFilter === 'error') return effectiveStatus === 'error' || w.health === 'stale';
              if (workerStatusFilter === 'stopped') return effectiveStatus === 'stopped';
              return true;
            });

            const pageSize = 12;
            const totalWorkerPages = Math.ceil(filteredWorkers.length / pageSize) || 1;
            const currentWorkerPage = Math.min(workerPage, totalWorkerPages);
            const pagedWorkers = filteredWorkers.slice((currentWorkerPage - 1) * pageSize, currentWorkerPage * pageSize);

            const activeLocks = scanState?.activeAnimeLocks || [];

            return (
              <div className="space-y-4">
                {/* 50-Worker Fleet Throughput & Smart Performance Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-900/80 border border-slate-800 rounded-xl text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Real Throughput</span>
                    <p className="text-base font-black text-emerald-400 font-mono flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span>{scanState?.tasksPerMinute || 0}</span>
                      <span className="text-[10px] font-normal text-slate-400">tasks/min</span>
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Fleet Utilization</span>
                    <p className="text-base font-black text-cyan-400 font-mono flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      <span>{scanState?.workerUtilization?.utilizationPercent || 0}%</span>
                      <span className="text-[10px] font-normal text-slate-400">({scanState?.workerUtilization?.active || 0}/50 active)</span>
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Storage Engine</span>
                    <p className="text-base font-black text-purple-400 font-mono flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-purple-400" />
                      <span>{scanState?.databasePerformance?.latencyMs || '< 1'}ms</span>
                      <span className="text-[10px] font-normal text-slate-400">(In-Memory Store)</span>
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Singleflight Cache</span>
                    <p className="text-base font-black text-amber-400 font-mono flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-amber-400" />
                      <span>{scanState?.sourceGatewayMetrics?.anilist?.cacheHits || 0} Hits</span>
                      <span className="text-[10px] font-normal text-slate-400">({scanState?.sourceGatewayMetrics?.anilist?.deduplicatedRequests || 0} deduped)</span>
                    </p>
                  </div>
                </div>

                {/* Authoritative Live Anime Claims & Locks Registry Banner */}
                {activeLocks.length > 0 && (
                  <div className="p-3 bg-slate-950/90 border border-emerald-500/40 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                        <span className="font-bold text-emerald-300 uppercase tracking-wider font-mono">
                          Authoritative Live Anime Claims ({activeLocks.length} Active Leases)
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Zero Duplication Enforced • Atomic Leases Active
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {activeLocks.map(lock => {
                        const reg = scanState?.liveAnimeRegistry?.[lock.animeId];
                        return (
                          <div
                            key={lock.animeId}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 border border-emerald-500/30 text-[11px] font-mono text-slate-300"
                          >
                            <span className="px-1 py-0.5 rounded bg-emerald-950 text-emerald-400 font-black text-[9px]">
                              W#{lock.workerId}
                            </span>
                            <span className="font-bold text-white truncate max-w-[140px]">
                              {reg?.animeTitle || lock.animeId}
                            </span>
                            <span className="text-slate-500 text-[9px]">
                              ({formatTimeAgo(lock.acquiredAt)})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pagedWorkers.map(worker => {
                    const id = worker.workerId;
                    const hasActiveTask = Boolean(worker.currentTaskId);
                    const rawStatus = hasActiveTask && worker.status === 'idle' ? 'working' : worker.status;
                    const normalizedStatus =
                      rawStatus === 'busy'
                        ? 'WORKING'
                        : rawStatus === 'backing_off'
                        ? 'RETRYING'
                        : rawStatus.toUpperCase();
                    const isWorking = normalizedStatus === 'WORKING' || normalizedStatus === 'CLAIMING';
                    const isWaiting = normalizedStatus === 'WAITING';
                    const isRetrying = normalizedStatus === 'RETRYING';
                    const isError = normalizedStatus === 'ERROR' || worker.health === 'stale';
                    const isPaused = normalizedStatus === 'PAUSED' || normalizedStatus === 'STOPPED';
                    const healthStatus = (worker.health || (isError ? 'error' : 'healthy')).toUpperCase();

                    return (
                      <div
                        key={id}
                        onClick={() => setSelectedWorkerId(id)}
                        className={`p-4 rounded-xl border transition-all space-y-3 relative overflow-hidden cursor-pointer group hover:scale-[1.01] ${
                          isWorking
                            ? 'bg-slate-950/90 border-emerald-500/50 hover:border-emerald-400 shadow-lg shadow-emerald-950/20'
                            : isWaiting
                            ? 'bg-slate-950/90 border-cyan-500/50 hover:border-cyan-400'
                            : isRetrying
                            ? 'bg-slate-950/90 border-amber-500/50 hover:border-amber-400'
                            : isError
                            ? 'bg-slate-950/90 border-rose-500/50 hover:border-rose-400'
                            : isPaused
                            ? 'bg-slate-950/90 border-purple-500/40 hover:border-purple-300'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {/* Worker Card Top Header: Worker ID & Status */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg text-xs font-black font-mono border ${
                              isWorking
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : isWaiting
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}>
                              Worker #{id}
                            </div>
                            <span className="text-xs font-black text-white uppercase tracking-wider">
                              ID: W-{id}
                            </span>
                          </div>

                          {/* Real Backend Status Badge: IDLE, CLAIMING, WORKING, RETRYING, WAITING, PAUSED, ERROR, STOPPED */}
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 border ${
                              isWorking
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                                : isWaiting
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
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
                              isWorking ? 'bg-emerald-400 animate-ping' : isWaiting ? 'bg-cyan-400 animate-ping' : isRetrying ? 'bg-amber-400' : isError ? 'bg-rose-400' : 'bg-slate-500'
                            }`} />
                            <span>{normalizedStatus}</span>
                          </span>
                        </div>

                        {/* Worker Card Body: All 11 Required Real Telemetry Fields */}
                        <div className="space-y-2 text-xs">
                          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              <span>Anime</span>
                              <span className="font-mono text-amber-300">
                                Season: {worker.seasonName || (hasActiveTask ? 'Main / All Seasons' : '—')}
                              </span>
                            </div>
                            <div className="font-bold text-white text-xs break-words">
                              {worker.currentAnimeTitle || (hasActiveTask ? 'Processing Anime Task' : 'No Active Anime')}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono break-all">
                              Anime ID: {worker.currentAnimeId || '—'}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] font-mono">
                            <div className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 min-w-0">
                              <span className="text-[9px] text-slate-500 uppercase block font-sans">Current Task</span>
                              <span className="text-slate-200 break-all block">{worker.currentTaskId || 'None'}</span>
                            </div>

                            <div className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 min-w-0">
                              <span className="text-[9px] text-slate-500 uppercase block font-sans">Operation</span>
                              <span className="text-amber-300 font-bold block break-words">{worker.operation || (hasActiveTask ? 'Verify Artwork' : 'Idle')}</span>
                            </div>

                            <div className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 min-w-0">
                              <span className="text-[9px] text-slate-500 uppercase block font-sans">Source</span>
                              <span className="text-cyan-300 block break-words">{worker.currentSource || (hasActiveTask ? 'AniList' : '—')}</span>
                            </div>

                            <div className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 min-w-0">
                              <span className="text-[9px] text-slate-500 uppercase block font-sans">Retry Count &amp; Health</span>
                              <span className="text-slate-200 block break-words">
                                Retries: <strong className="text-amber-300">{worker.retryCount ?? 0}</strong> •{' '}
                                <strong className={healthStatus === 'HEALTHY' ? 'text-emerald-400' : 'text-rose-400'}>{healthStatus}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 space-y-0.5">
                            <span className="text-[9px] text-slate-500 uppercase block font-sans">Current Step</span>
                            <span className="text-slate-200 text-[11px] block break-words">
                              {worker.currentStep || (hasActiveTask ? 'Executing verification pipeline...' : 'Idle — awaiting queued task')}
                            </span>
                          </div>

                          {worker.lastError && (
                            <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800 text-[10px] text-rose-300">
                              <strong>Error:</strong> {worker.lastError}
                            </div>
                          )}
                        </div>

                        {/* Card Footer Metrics */}
                        <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                          <span>Heartbeat: {formatTimeAgo(worker.lastHeartbeat)}</span>
                          <span className="text-amber-400 font-sans font-bold group-hover:underline">Inspect Worker →</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Worker Pagination Bar */}
                {totalWorkerPages > 1 && (
                  <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs">
                    <span className="text-slate-400 font-mono">
                      Showing worker threads {(currentWorkerPage - 1) * pageSize + 1} to {Math.min(currentWorkerPage * pageSize, filteredWorkers.length)} of {filteredWorkers.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={currentWorkerPage <= 1}
                        onClick={() => setWorkerPage(p => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer flex items-center gap-1 font-bold"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Prev</span>
                      </button>
                      <span className="px-2 font-mono text-amber-400 font-bold">
                        {currentWorkerPage} / {totalWorkerPages}
                      </span>
                      <button
                        type="button"
                        disabled={currentWorkerPage >= totalWorkerPages}
                        onClick={() => setWorkerPage(p => Math.min(totalWorkerPages, p + 1))}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-30 cursor-pointer flex items-center gap-1 font-bold"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

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
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overscroll-contain">
          <div className="p-4 sm:p-6 bg-slate-950 border border-slate-800 rounded-2xl max-w-2xl w-full space-y-4 sm:space-y-5 shadow-2xl max-h-[90dvh] overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y">
            {(() => {
              const worker = scanState?.activeWorkers?.find(w => w.workerId === selectedWorkerId) || {
                workerId: selectedWorkerId,
                status: 'idle' as const,
                tasksCompleted: 0,
                tasksFailed: 0,
                lastHeartbeat: Date.now(),
                health: 'healthy' as const
              };

              const isWorking = worker.status === 'working' || worker.status === 'claiming' || worker.status === 'waiting' || worker.status === 'busy';
              const isRetrying = worker.status === 'retrying' || worker.status === 'backing_off';
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
                          Status: {(worker.currentTaskId && worker.status === 'idle') ? 'WORKING' : worker.status.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-slate-400">
                        Heartbeat: {formatTimeAgo(worker.lastHeartbeat)}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs pt-2 border-t border-slate-800">
                      <div className="font-bold text-amber-300 text-sm break-words">{worker.currentAnimeTitle || 'No Active Anime'}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                        <div><span className="text-slate-500">Worker ID:</span> #{worker.workerId}</div>
                        <div className="break-all"><span className="text-slate-500">Current Task:</span> {worker.currentTaskId || 'None'}</div>
                        <div className="break-all"><span className="text-slate-500">Anime ID:</span> {worker.currentAnimeId || '—'}</div>
                        <div className="break-words"><span className="text-slate-500">Season:</span> {worker.seasonName || 'Main / All Seasons'}</div>
                        <div className="break-words"><span className="text-slate-500">Operation:</span> {worker.operation || 'Idle'}</div>
                        <div className="break-words"><span className="text-slate-500">Source:</span> {worker.currentSource || '—'}</div>
                        <div><span className="text-slate-500">Retry Count:</span> {worker.retryCount ?? 0}</div>
                        <div><span className="text-slate-500">Health:</span> {(worker.health || 'healthy').toUpperCase()}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-950 text-slate-300 text-xs break-words">
                        <strong>Current Step:</strong> {worker.currentStep || 'Awaiting task from shared coordinator queue'}
                      </div>
                    </div>
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
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase">
                <Shield className="w-4 h-4" />
                <span>Owner Artwork Source Configuration</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Configure endpoints, rate limits, and connectivity for trusted anime artwork providers. Watch Order determination is managed in the separate Watch Order Sources tab.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubTab('watch_order');
                fetchWatchOrderData();
              }}
              className="px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-black flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Open Watch Order Sources →</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sourcesList.map(source => {
              const isTestingThis = testingSourceId === source.id;
              const displayStatus = isTestingThis ? 'testing' : (source.status || 'untested');
              const statusLabel = displayStatus.replace(/_/g, ' ');
              const persistedMessage = sourceTestResult[source.id]?.message || source.lastMessage || null;
              const persistedError = sourceTestResult[source.id]?.success === false
                ? sourceTestResult[source.id]?.message
                : source.lastError || null;

              return (
                <div
                  key={source.id}
                  className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 relative overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2">
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
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 border ${
                        displayStatus === 'operational'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : displayStatus === 'testing'
                          ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30 animate-pulse'
                          : displayStatus === 'rate_limited' || displayStatus === 'timeout' || displayStatus === 'degraded'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : displayStatus === 'temporarily_unavailable'
                          ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                          : displayStatus === 'disabled'
                          ? 'bg-slate-900 text-slate-500 border-slate-800'
                          : displayStatus === 'untested'
                          ? 'bg-slate-800/80 text-slate-300 border-slate-700'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs bg-slate-900/80 p-3 rounded-lg border border-slate-800/80 font-mono text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Endpoint:</span>
                      <span className="text-slate-300 truncate max-w-[220px]">{source.endpoint}</span>
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
                    <div className="flex justify-between">
                      <span className="text-slate-500">Last Tested:</span>
                      <span className="text-slate-300">
                        {source.lastChecked
                          ? `${new Date(source.lastChecked).toLocaleString()}${source.lastLatencyMs ? ` (${source.lastLatencyMs}ms)` : ''}`
                          : 'Never tested'}
                      </span>
                    </div>
                    {source.lastSuccessfulChecked && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Last Successful:</span>
                        <span className="text-emerald-400">
                          {new Date(source.lastSuccessfulChecked).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {(persistedMessage || persistedError) && (
                    <div
                      className={`p-2.5 rounded text-[11px] border ${
                        displayStatus === 'operational' && !persistedError
                          ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                          : displayStatus === 'disabled'
                          ? 'bg-slate-900 border-slate-800 text-slate-400'
                          : 'bg-rose-950/40 border-rose-800 text-rose-300'
                      }`}
                    >
                      {persistedError || persistedMessage}
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-900 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleTestSource(source.id)}
                      disabled={isTestingThis || !source.enabled || source.status === 'disabled'}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isTestingThis ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>{isTestingThis ? 'Testing...' : 'Test Connection'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- TAB 6: WATCH ORDER SOURCES SYSTEM (Separate from Artwork Verification) --- */}
      {subTab === 'watch_order' && (
        <div className="space-y-6">
          {/* Top Architecture & Safety Banner */}
          <div className="p-4 sm:p-5 bg-gradient-to-r from-cyan-950/60 via-slate-950 to-slate-950 border border-cyan-500/40 rounded-2xl space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-cyan-300 text-xs sm:text-sm font-black uppercase tracking-wider">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Watch Order Sources — Dual-Source Franchise Verification</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/20 text-cyan-200 border border-cyan-500/30">
                  Isolated from Artwork Pipeline
                </span>
              </div>
              <button
                type="button"
                onClick={fetchWatchOrderData}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Refresh Watch Orders</span>
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Determines canonical franchise watch orders by querying and cross-comparing{' '}
              <strong className="text-white">Watchordr (https://watchordr.com/)</strong> and{' '}
              <strong className="text-white">The Anime Order (https://theanimeorder.com/)</strong>. Automatically detects TV seasons, canon theatrical movies, OVAs, specials, recap/compilation films, and alternate versions. Catalogue records are <strong className="text-amber-300">never modified automatically</strong> until explicitly validated by the Owner.
            </p>
          </div>

          {/* 1. WATCH ORDER SOURCES CONNECTIVITY CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {watchOrderSources.map(source => {
              const isTestingThis = testingWatchOrderSourceId === source.id;
              const displayStatus = isTestingThis ? 'testing' : (source.status || 'untested');
              const statusLabel = displayStatus.replace(/_/g, ' ');
              const persistedMessage =
                watchOrderSourceTestResult[source.id]?.message || source.lastMessage || null;
              const persistedError =
                watchOrderSourceTestResult[source.id]?.success === false
                  ? watchOrderSourceTestResult[source.id]?.message
                  : source.lastError || null;

              return (
                <div
                  key={source.id}
                  className="p-4 sm:p-5 bg-slate-950/90 border border-slate-800 hover:border-cyan-500/40 rounded-2xl space-y-3.5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-black text-sm text-white">{source.name}</h4>
                        <a
                          href={source.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 hover:underline flex items-center gap-1"
                        >
                          <span>{source.websiteUrl}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{source.description}</p>
                    </div>

                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase shrink-0 border ${
                        displayStatus === 'operational'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : displayStatus === 'testing'
                          ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 animate-pulse'
                          : displayStatus === 'untested'
                          ? 'bg-slate-800 text-slate-300 border-slate-700'
                          : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  <div className="space-y-1.5 bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 font-mono text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Website URL:</span>
                      <span className="text-cyan-300 truncate">{source.websiteUrl}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">robots.txt &amp; Access Rules:</span>
                      <span className="text-emerald-400">
                        {source.robotsAllowed !== false ? 'Verified & Respected' : 'Restricted'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Polite Rate Limit:</span>
                      <span className="text-slate-300">
                        {source.rateLimitPerSecond}/sec • {source.rateLimitPerMinute}/min (Timeout {source.timeoutMs}ms)
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Indexed Franchises:</span>
                      <span className="text-amber-300 font-bold">
                        {source.indexedFranchiseCount ? `${source.indexedFranchiseCount} Guides` : 'Click Test Connection'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Last Checked:</span>
                      <span className="text-slate-300">
                        {source.lastChecked
                          ? `${new Date(source.lastChecked).toLocaleString()}${
                              source.lastLatencyMs ? ` (${source.lastLatencyMs}ms)` : ''
                            }`
                          : 'Never tested'}
                      </span>
                    </div>
                  </div>

                  {(persistedMessage || persistedError) && (
                    <div
                      className={`p-2.5 rounded-lg text-[11px] border ${
                        displayStatus === 'operational' && !persistedError
                          ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                      }`}
                    >
                      {persistedError || persistedMessage}
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-900 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-mono">
                      Source Priority #{source.priority}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTestWatchOrderSource(source.id)}
                      disabled={isTestingThis}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-cyan-500/15"
                    >
                      {isTestingThis ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>{isTestingThis ? 'Testing Live Source...' : 'Test Connection'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 2. FRANCHISE LOOKUP & BENCHMARK TEST BAR */}
          <div className="p-4 sm:p-5 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h4 className="font-black text-xs sm:text-sm text-white uppercase tracking-wider flex items-center gap-2">
                  <Search className="w-4 h-4 text-cyan-400" />
                  <span>Compare Franchise Watch Order Across Both Sources</span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Matches exact franchise by title, alternate/romaji titles, release year, seasons, and AniList IDs. Never invents a watch order.
                </p>
              </div>

              {/* Quick Benchmark Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase text-slate-400 mr-1">Quick Test:</span>
                {['Demon Slayer', 'Jujutsu Kaisen', 'Naruto', 'Attack on Titan'].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    disabled={resolvingWatchOrder}
                    onClick={() => {
                      setWatchOrderQuery(preset);
                      handleResolveWatchOrder(preset);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-[11px] font-bold text-slate-200 hover:text-cyan-300 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={resolvingWatchOrder}
                  onClick={() =>
                    handleResolveWatchOrder(['Demon Slayer', 'Jujutsu Kaisen', 'Naruto', 'Attack on Titan'])
                  }
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-black text-amber-300 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Compare All 4</span>
                </button>
              </div>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                if (watchOrderQuery.trim()) {
                  handleResolveWatchOrder(watchOrderQuery.trim());
                }
              }}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={watchOrderQuery}
                  onChange={e => setWatchOrderQuery(e.target.value)}
                  placeholder="Enter franchise title (e.g. Demon Slayer, Jujutsu Kaisen, Naruto, Attack on Titan, Steins;Gate)..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={resolvingWatchOrder || !watchOrderQuery.trim()}
                className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0 shadow-lg shadow-cyan-500/20"
              >
                {resolvingWatchOrder ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Layers className="w-3.5 h-3.5" />
                )}
                <span>{resolvingWatchOrder ? 'Fetching Live Sources...' : 'Check & Compare Sources'}</span>
              </button>
            </form>

            {watchOrderBannerMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 ${
                  watchOrderBannerMessage.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-700/70 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-700/70 text-rose-300'
                }`}
              >
                <span>{watchOrderBannerMessage.text}</span>
                <button
                  type="button"
                  onClick={() => setWatchOrderBannerMessage(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* 3. STORED WATCH ORDER COMPARISON RESULTS */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="font-black text-xs sm:text-sm text-white uppercase tracking-wider">
                  Stored Franchise Watch-Order Records ({watchOrderRecords.length})
                </h4>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                {[
                  { id: 'all', label: 'All Franchises', count: watchOrderRecords.length },
                  {
                    id: 'high_confidence',
                    label: 'High Confidence',
                    count: watchOrderRecords.filter(r => r.status === 'high_confidence').length
                  },
                  {
                    id: 'needs_review',
                    label: 'Needs Review',
                    count: watchOrderRecords.filter(r => r.status === 'needs_review').length
                  },
                  {
                    id: 'validated',
                    label: 'Validated',
                    count: watchOrderRecords.filter(r => r.status === 'validated').length
                  }
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setWatchOrderFilter(f.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black whitespace-nowrap cursor-pointer transition-colors flex items-center gap-1.5 ${
                      watchOrderFilter === f.id
                        ? 'bg-cyan-500 text-slate-950'
                        : 'text-slate-400 hover:text-white bg-slate-900/60'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                        watchOrderFilter === f.id ? 'bg-slate-950 text-cyan-300' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {f.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const filteredRecords = watchOrderRecords.filter(r => {
                if (watchOrderFilter === 'all') return true;
                return r.status === watchOrderFilter;
              });

              if (filteredRecords.length === 0) {
                return (
                  <div className="py-16 text-center bg-slate-950/60 border border-slate-800 rounded-2xl space-y-2">
                    <Layers className="w-8 h-8 text-cyan-400 opacity-40 mx-auto" />
                    <p className="text-xs text-slate-400">No franchise watch-order records match the selected filter.</p>
                    <p className="text-[11px] text-slate-500">
                      Use the Quick Test buttons above (Demon Slayer, Jujutsu Kaisen, Naruto, Attack on Titan) to compare live sources.
                    </p>
                  </div>
                );
              }

              const renderCategoryBadge = (entry: any) => {
                if (entry.category === 'recap_movie' || entry.isRecapOrCompilation) {
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40">
                      Recap / Compilation Movie
                    </span>
                  );
                }
                if (entry.category === 'alternate_version' || entry.isAlternateVersion) {
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Alternate Version ({entry.rawFormat})
                    </span>
                  );
                }
                if (entry.category === 'ova') {
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-purple-500/20 text-purple-300 border border-purple-500/40">
                      OVA
                    </span>
                  );
                }
                if (entry.category === 'special') {
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                      Special
                    </span>
                  );
                }
                if (entry.category === 'movie') {
                  return (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                      Movie
                    </span>
                  );
                }
                return (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Season ({entry.rawFormat})
                  </span>
                );
              };

              return (
                <div className="space-y-5">
                  {filteredRecords.map(rec => {
                    const isValidating = validatingFranchiseKey === rec.franchiseKey;
                    const isHighConfidence = rec.status === 'high_confidence' || rec.sourcesAgree;
                    const isValidated = rec.status === 'validated';

                    return (
                      <div
                        key={rec.id}
                        className="bg-slate-950/95 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl"
                      >
                        {/* Franchise Card Header */}
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base sm:text-lg font-black text-white">{rec.canonicalTitle}</h3>

                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border flex items-center gap-1 ${
                                  isValidated
                                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                    : isHighConfidence
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                }`}
                              >
                                {isValidated ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : isHighConfidence ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <AlertTriangle className="w-3 h-3" />
                                )}
                                <span>
                                  {rec.confidenceLabel} ({rec.confidenceScore}%)
                                </span>
                              </span>

                              {rec.appliedToCatalogue ? (
                                <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                                  Validated &amp; Linked to Catalogue ({rec.matchedCatalogueItems?.length || 0} items)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-400 border border-slate-800">
                                  Catalogue Unmodified (Awaiting Owner Validation)
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-400 font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span>
                                Alternate Titles: {rec.alternateTitles?.slice(0, 4).join(' • ') || rec.canonicalTitle}
                              </span>
                              <span>•</span>
                              <span>Last Checked: {new Date(rec.lastCheckedAt).toLocaleString()}</span>
                            </div>
                          </div>

                          {/* Owner Validation & Re-check Controls */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={resolvingWatchOrder}
                              onClick={() => handleResolveWatchOrder(rec.queryTitle || rec.canonicalTitle)}
                              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${resolvingWatchOrder ? 'animate-spin' : ''}`} />
                              <span>Re-Check</span>
                            </button>

                            {rec.watchordr?.found && (
                              <button
                                type="button"
                                disabled={isValidating}
                                onClick={() => handleValidateWatchOrder(rec.franchiseKey, 'watchordr')}
                                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-500/15"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>
                                  {rec.sourcesAgree ? 'Validate Agreed Order' : 'Validate Watchordr Order'}
                                </span>
                              </button>
                            )}

                            {rec.theAnimeOrder?.found && (
                              <button
                                type="button"
                                disabled={isValidating}
                                onClick={() => handleValidateWatchOrder(rec.franchiseKey, 'theanimeorder')}
                                className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-cyan-500/15"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Validate The Anime Order</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Entry Classification Breakdown & Matched Catalogue Items */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-emerald-400 uppercase block">Seasons</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.seasons ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-cyan-400 uppercase block">Canon Movies</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.movies ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-purple-400 uppercase block">OVAs</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.ovas ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-indigo-400 uppercase block">Specials</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.specials ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-rose-400 uppercase block">Recap Movies</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.recapMovies ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-amber-400 uppercase block">Alternate Ver.</span>
                            <span className="text-sm font-black text-white font-mono">
                              {rec.entryBreakdown?.alternateVersions ?? 0}
                            </span>
                          </div>
                          <div className="p-2 bg-slate-900/80 border border-slate-800 rounded-xl">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block">Catalogue Matches</span>
                            <span className="text-sm font-black text-amber-300 font-mono">
                              {rec.matchedCatalogueItems?.length ?? 0}
                            </span>
                          </div>
                        </div>

                        {/* Agreement & Discrepancy Analysis Box */}
                        <div
                          className={`p-3.5 rounded-xl border space-y-1.5 text-xs ${
                            rec.sourcesAgree
                              ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                              : 'bg-amber-950/25 border-amber-500/30 text-amber-200'
                          }`}
                        >
                          <div className="font-black uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                            {rec.sourcesAgree ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Dual-Source Agreement Confirmed (High Confidence)</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                                <span>Source Discrepancy Detected — Needs Owner Review</span>
                              </>
                            )}
                          </div>
                          <p className="text-slate-200 leading-relaxed">{rec.agreementSummary}</p>
                          {rec.discrepancies && rec.discrepancies.length > 0 && (
                            <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5 pt-1">
                              {rec.discrepancies.map((d: string, idx: number) => (
                                <li key={idx}>{d}</li>
                              ))}
                            </ul>
                          )}
                        </div>

                        {/* Side-by-Side Source Results Comparison */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* Column 1: Watchordr */}
                          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
                            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-xs text-white uppercase">
                                    1. Watchordr
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                                    {rec.watchordr?.found ? `${rec.watchordr.entries.length} Entries` : 'Not Indexed'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                  Matched Title: <strong className="text-slate-200">{rec.watchordr?.matchedTitle || '—'}</strong>
                                </div>
                              </div>
                              {rec.watchordr?.sourceUrl && (
                                <a
                                  href={rec.watchordr.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10px] font-mono text-cyan-300 hover:underline flex items-center gap-1 shrink-0"
                                >
                                  <span>Source URL</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>

                            {rec.watchordr?.found ? (
                              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                                {rec.watchordr.entries.map((entry: any) => (
                                  <div
                                    key={entry.step}
                                    className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90 flex items-start gap-2.5 text-xs"
                                  >
                                    <span className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-mono font-black text-[11px] flex items-center justify-center shrink-0">
                                      {entry.step}
                                    </span>

                                    {entry.posterUrl && (
                                      <img
                                        src={entry.posterUrl}
                                        alt={entry.title}
                                        className="w-9 h-13 object-cover rounded border border-slate-800 shrink-0"
                                      />
                                    )}

                                    <div className="flex-1 min-w-0 space-y-1">
                                      <div className="font-bold text-white leading-snug break-words">
                                        {entry.title}
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {renderCategoryBadge(entry)}
                                        {entry.releaseDateText && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                                            {entry.releaseDateText}
                                          </span>
                                        )}
                                        {entry.episodes && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                                            {entry.episodes} ep{entry.episodes > 1 ? 's' : ''}
                                          </span>
                                        )}
                                        {entry.anilistId && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-cyan-300 border border-slate-800">
                                            AL #{entry.anilistId}
                                          </span>
                                        )}
                                        {entry.isSkippable && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                            Skippable
                                          </span>
                                        )}
                                      </div>

                                      {entry.warning && (
                                        <p className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/50 px-2 py-1 rounded">
                                          {entry.warning}
                                        </p>
                                      )}
                                      {entry.matchedCatalogueTitle && (
                                        <div className="text-[10px] font-mono text-emerald-400">
                                          ✓ Matched in Anivex Catalogue: {entry.matchedCatalogueTitle}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-10 text-center text-xs text-slate-400 space-y-1">
                                <AlertCircle className="w-6 h-6 text-amber-400/70 mx-auto" />
                                <p>{rec.watchordr?.error || 'Franchise not indexed on Watchordr.'}</p>
                              </div>
                            )}
                          </div>

                          {/* Column 2: The Anime Order */}
                          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
                            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-xs text-white uppercase">
                                    2. The Anime Order
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                                    {rec.theAnimeOrder?.found
                                      ? `${rec.theAnimeOrder.entries.length} Entries`
                                      : 'Not Indexed'}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                  Matched Title:{' '}
                                  <strong className="text-slate-200">{rec.theAnimeOrder?.matchedTitle || '—'}</strong>
                                </div>
                              </div>
                              {rec.theAnimeOrder?.sourceUrl && (
                                <a
                                  href={rec.theAnimeOrder.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-[10px] font-mono text-cyan-300 hover:underline flex items-center gap-1 shrink-0"
                                >
                                  <span>Source URL</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>

                            {rec.theAnimeOrder?.found ? (
                              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                                {rec.theAnimeOrder.entries.map((entry: any) => (
                                  <div
                                    key={entry.step}
                                    className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90 flex items-start gap-2.5 text-xs"
                                  >
                                    <span className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-black text-[11px] flex items-center justify-center shrink-0">
                                      {entry.step}
                                    </span>

                                    {entry.posterUrl && (
                                      <img
                                        src={entry.posterUrl}
                                        alt={entry.title}
                                        className="w-9 h-13 object-cover rounded border border-slate-800 shrink-0"
                                      />
                                    )}

                                    <div className="flex-1 min-w-0 space-y-1">
                                      <div className="font-bold text-white leading-snug break-words">
                                        {entry.title}
                                      </div>
                                      {entry.alternateTitle && entry.alternateTitle !== entry.title && (
                                        <div className="text-[10px] text-slate-400 font-mono truncate">
                                          {entry.alternateTitle}
                                        </div>
                                      )}

                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {renderCategoryBadge(entry)}
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                                          {entry.releaseYear || 'TBA'}
                                        </span>
                                        {entry.episodes && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                                            {entry.episodes} ep{entry.episodes > 1 ? 's' : ''}
                                          </span>
                                        )}
                                        {entry.anilistId && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-cyan-300 border border-slate-800">
                                            AL #{entry.anilistId}
                                          </span>
                                        )}
                                        {entry.isUnreleased && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-800 text-slate-400 border border-slate-700">
                                            Unreleased
                                          </span>
                                        )}
                                      </div>

                                      {entry.note && (
                                        <p className="text-[10px] text-slate-400 italic">{entry.note}</p>
                                      )}
                                      {entry.matchedCatalogueTitle && (
                                        <div className="text-[10px] font-mono text-emerald-400">
                                          ✓ Matched in Anivex Catalogue: {entry.matchedCatalogueTitle}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-10 text-center text-xs text-slate-400 space-y-1">
                                <AlertCircle className="w-6 h-6 text-amber-400/70 mx-auto" />
                                <p>{rec.theAnimeOrder?.error || 'Franchise not indexed on The Anime Order.'}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 5. DETAILED INSPECTION DRAWER / MODAL */}
      {inspectedAnime && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overscroll-contain">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90dvh] overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y p-4 sm:p-6 space-y-5 shadow-2xl animate-fade-in relative">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200 overscroll-contain">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90dvh] flex flex-col shadow-2xl overflow-hidden touch-pan-y">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in overscroll-contain overflow-hidden">
          <div className="relative w-full max-w-md bg-slate-950 border-2 border-amber-500/50 rounded-2xl shadow-2xl p-4 sm:p-5 space-y-5 text-slate-100 max-h-[90dvh] overflow-y-auto overscroll-contain touch-pan-y">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in overscroll-contain">
          <div className="relative w-full max-w-2xl bg-slate-950 border-2 border-purple-500/50 rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4 text-slate-100 max-h-[90dvh] flex flex-col overflow-hidden touch-pan-y">
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
