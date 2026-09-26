import fs from 'fs';
import path from 'path';
import {
  verifyAnimeEntry,
  loadVerificationRecords,
  saveVerificationRecords,
  loadFakeAnimeIssues,
  inspectArtworkImage,
  isPlaceholderArtworkUrl,
  cleanAnimeTitle,
  applyArtworkUpdate,
  markCatalogueAnimeVerified
} from './artwork-verifier.ts';
import { logAdminAction } from './audit-logger.ts';
import { globalWorkerJobEngine, TaskPriority, createDeterministicTaskId } from './worker-job-engine.ts';
import { WorkerWaitReason } from './source-gateway.ts';
import { globalDataStore } from './data-store.ts';

export interface WorkerStatusInfo {
  workerId: number;
  currentAnimeId?: string | null;
  currentAnimeTitle?: string | null;
  status: 'idle' | 'busy' | 'backing_off';
}

export interface GlobalCatalogueStats {
  total: number;
  verified: number;
  autoFixed: number;
  needsReview: number;
  unableToVerify: number;
  possibleFake: number;
  missing: number;
  unverified: number;
  pending: number;
  completed: number;
  failed: number;
  historyCount: number;
}

export interface InspectReport {
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

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const INSPECT_REPORT_PATH = path.join(DATA_DIR, 'artwork-inspect-report.json');
const CATALOGUE_PATH = path.join(DATA_DIR, 'anivault-catalogue.json');

// --- Single Authoritative Global Stats Calculator ---
export function computeGlobalCatalogueStats(): GlobalCatalogueStats {
  const catalogue = globalDataStore.getAllCatalogueAnime();
  const records = globalDataStore.getAllVerificationRecords();
  const fakeIssues = globalDataStore.getAllFakeIssues();
  const historyCount = globalDataStore.getAllHistory().length;

  let verified = 0;
  let autoFixed = 0;
  let needsReview = 0;
  let unableToVerify = 0;
  let possibleFake = fakeIssues.filter(f => f.status === 'active' || (f as any).verdict !== 'verified_real').length;
  let missing = 0;

  for (const item of catalogue) {
    const rec = records[item.id];
    const url = item.artwork?.verifiedArtworkUrl || item.artwork?.originalArtworkUrl;
    const isMissing = isPlaceholderArtworkUrl(url);

    if (isMissing) {
      missing++;
      if (rec?.status === 'needs_review') needsReview++;
      else if (rec?.status === 'unable_to_verify') unableToVerify++;
    } else {
      if (rec) {
        if (rec.status === 'verified') {
          verified++;
        } else if (rec.status === 'auto_fixed') {
          verified++;
          autoFixed++;
        } else if (rec.status === 'needs_review') {
          needsReview++;
        } else if (rec.status === 'unable_to_verify') {
          unableToVerify++;
        } else if (rec.status === 'possible_fake') {
          possibleFake++;
        }
      } else if (item.artwork?.verificationStatus === 'verified') {
        verified++;
      }
    }
  }

  const unverified = Math.max(0, catalogue.length - verified);
  const snapshot = globalWorkerJobEngine.getSnapshot();
  const pending = snapshot.status === 'running' || snapshot.status === 'paused'
    ? (snapshot.queuedCount + snapshot.claimedCount)
    : unverified;
  const completed = snapshot.completedCount;
  const failed = snapshot.failedCount;

  return {
    total: catalogue.length,
    verified,
    autoFixed,
    needsReview,
    unableToVerify,
    possibleFake,
    missing,
    unverified,
    pending,
    completed,
    failed,
    historyCount
  };
}

class ArtworkScannerEngine {
  private catalogueMap = new Map<string, any>();

  constructor() {
    this.reloadCatalogueMap();
  }

  private reloadCatalogueMap() {
    this.catalogueMap.clear();
    for (const a of globalDataStore.getAllCatalogueAnime()) {
      this.catalogueMap.set(a.id, a);
    }
  }

  public getJobState(): any {
    const snapshot = globalWorkerJobEngine.getSnapshot();
    const globalStats = computeGlobalCatalogueStats();

    return {
      jobId: snapshot.jobId,
      status: snapshot.status,
      mode: snapshot.mode,
      batchLimit: snapshot.batchLimit,
      totalTasks: snapshot.totalTasks,
      completedTasksCount: snapshot.completedCount,
      failedTasksCount: snapshot.failedCount,
      processedCount: snapshot.completedCount + snapshot.failedCount,
      remainingTasksCount: snapshot.queuedCount + snapshot.claimedCount,
      queuedCount: snapshot.queuedCount,
      claimedCount: snapshot.claimedCount,
      progressPercent: snapshot.progressPercent,
      lastLog: snapshot.lastLog,
      workerCount: snapshot.workerCount,
      poolConfig: snapshot.poolConfig,
      etaFormatted: snapshot.etaFormatted,
      avgTaskDurationMs: snapshot.avgTaskDurationMs,
      tasksPerMinute: snapshot.tasksPerMinute,
      workerUtilization: snapshot.workerUtilization,
      databasePerformance: snapshot.databasePerformance,
      systemHealth: snapshot.systemHealth,
      sourceGatewayMetrics: snapshot.sourceGatewayMetrics,
      activeWorkers: snapshot.activeWorkers,
      liveAnimeRegistry: snapshot.liveAnimeRegistry,
      activeAnimeLocks: snapshot.activeAnimeLocks,
      activityEvents: snapshot.activityEvents,
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
      stateVersion: Date.now(),
      globalStats,
      sourceHealth: snapshot.sourceHealth,
      // Legacy compatibility
      totalCount: snapshot.totalTasks,
      stats: {
        scanned: snapshot.completedCount + snapshot.failedCount,
        verified: globalStats.verified,
        autoFixed: globalStats.autoFixed,
        needsReview: globalStats.needsReview,
        unableToVerify: globalStats.unableToVerify,
        possibleFake: globalStats.possibleFake,
        missing: globalStats.missing,
        completed: snapshot.completedCount,
        failed: snapshot.failedCount,
        retrying: snapshot.workerUtilization?.retrying || 0,
        pending: globalStats.pending
      }
    };
  }

  // --- START VERIFICATION (Verify All, Verify Unverified, or Fix Missing) ---
  public startScan(
    operator = 'Owner',
    mode: 'all' | 'unverified' | 'fix_missing' = 'all',
    limit?: number
  ): { success: boolean; alreadyRunning?: boolean; message: string; job?: any; state?: any } {
    if (!fs.existsSync(CATALOGUE_PATH)) {
      return { success: false, message: 'Catalogue not found.' };
    }

    // Active Job Reconnection: Do NOT create a duplicate job if one is already running
    const currentSnapshot = globalWorkerJobEngine.getSnapshot();
    if (currentSnapshot.status === 'running') {
      const activeState = this.getJobState();
      return {
        success: true,
        alreadyRunning: true,
        message: `Connected to active verification job (${currentSnapshot.jobId}).`,
        job: activeState,
        state: activeState
      };
    }

    this.reloadCatalogueMap();
    const catalogue: any[] = Array.from(this.catalogueMap.values());
    const records = loadVerificationRecords();

    // Determine target candidates from authoritative persisted state
    let candidates: any[] = [];
    if (mode === 'unverified') {
      candidates = catalogue.filter(a => {
        const rec = records[a.id];
        const url = a.artwork?.verifiedArtworkUrl || a.artwork?.originalArtworkUrl;
        const isMissing = isPlaceholderArtworkUrl(url);
        if (isMissing) return true;
        const isVerified = rec?.status === 'verified' || rec?.status === 'auto_fixed' || (!rec && a.artwork?.verificationStatus === 'verified');
        return !isVerified;
      });
    } else if (mode === 'fix_missing') {
      candidates = catalogue.filter(a => {
        const rec = records[a.id];
        const url = a.artwork?.verifiedArtworkUrl || a.artwork?.originalArtworkUrl;
        const isMissing = isPlaceholderArtworkUrl(url) ||
          (rec && isPlaceholderArtworkUrl(rec.currentArtworkUrl)) ||
          Boolean(rec?.issue && (rec.issue.toLowerCase().includes('missing') || rec.issue.toLowerCase().includes('placeholder') || rec.issue.toLowerCase().includes('unreachable')));
        return isMissing;
      });
    } else {
      candidates = [...catalogue];
    }

    if (typeof limit === 'number' && limit > 0) {
      candidates = candidates.slice(0, limit);
    }

    const tasks = candidates.map(a => {
      const type = mode === 'fix_missing' ? 'fix_missing' : 'artwork_verification';
      const taskId = createDeterministicTaskId(type, a.id);
      return {
        taskId,
        animeId: a.id,
        title: a.title,
        payload: a,
        priority: 'MEDIUM' as TaskPriority,
        type
      };
    });

    globalWorkerJobEngine.submitTasks(tasks, mode, limit);

    logAdminAction(
      `Start Verification Job (${mode.toUpperCase()})`,
      operator,
      'success',
      undefined,
      `Job launched: ${mode}, batch=${tasks.length}, limit=${limit || 'All'}.`
    );

    // Launch worker pool in background
    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Fatal error in worker pool:', err.message);
    });

    const jobState = this.getJobState();
    return {
      success: true,
      message: `Artwork verification job started (${mode}, batch=${tasks.length}).`,
      job: jobState,
      state: jobState
    };
  }

  private async processTaskByWorker(task: any, workerId: number, operator: string) {
    const animeId = task.animeId || task.payload?.id || task.taskId;
    const anime = globalDataStore.getCatalogueAnime(animeId) || task.payload || this.catalogueMap.get(animeId);
    if (!anime) throw new Error(`Anime record ${animeId} not found`);

    const operation = globalWorkerJobEngine.mapTaskTypeToOperation(task.type);
    const seasonLabel = task.seasonId
      ? `Season ${task.seasonId}`
      : (anime.season ? `Season ${anime.season}` : (Array.isArray(anime.seasons) && anime.seasons.length > 0 ? `${anime.seasons.length} Seasons` : 'Main / All Seasons'));

    const onWorkerStep = (step: string, source?: string, status?: 'working' | 'waiting' | 'retrying', waitReason?: WorkerWaitReason) => {
      globalWorkerJobEngine.updateWorkerProgress(workerId, {
        status: status || 'working',
        waitReason: status === 'waiting' || status === 'retrying' ? (waitReason || null) : null,
        currentAnimeId: anime.id,
        currentAnimeTitle: anime.title,
        seasonName: seasonLabel,
        operation,
        currentStep: step,
        currentSource: source || 'AniList'
      });
    };

    globalWorkerJobEngine.updateWorkerProgress(workerId, {
      status: 'working',
      waitReason: null,
      currentAnimeId: anime.id,
      currentAnimeTitle: anime.title,
      seasonName: seasonLabel,
      operation,
      currentStep: 'Querying external metadata sources...',
      currentSource: 'AniList / TVmaze / TheTVDB'
    });

    globalWorkerJobEngine.recordActivityEvent({
      workerId,
      taskId: task.taskId,
      animeId: anime.id,
      animeTitle: anime.title,
      operation,
      eventType: 'verification_started',
      source: 'Local Catalogue',
      step: 'Verification pipeline initialized',
      details: `Worker #${workerId} initiated ${operation} for "${anime.title}"`
    });

    let finalRes: any;

    if (task.type === 'artwork_reverify' || task.type === 'artwork_search_again' || task.type === 'RETRY_VERIFICATION' || task.type === 'SEARCH_ARTWORK') {
      onWorkerStep('Running multi-pass search & candidate match...', 'AniList / TVmaze / AniDB', 'working');

      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        taskId: task.taskId,
        animeId: anime.id,
        animeTitle: anime.title,
        operation,
        eventType: 'source_searched',
        source: 'AniList & TVmaze',
        step: 'Multi-pass search executed',
        details: `Querying active sources (AniList, TVmaze, AniDB) for "${anime.title}"`
      });

      finalRes = await verifyAnimeEntry(anime, { autoFixEnabled: true, operator, forceFreshSearch: true, workerId, onWorkerStep });

      onWorkerStep('Saving verification record & recalculating state...', finalRes.source || 'AniList', 'working');

      if (finalRes.replacedArtworkUrl) {
        globalWorkerJobEngine.recordActivityEvent({
          workerId,
          taskId: task.taskId,
          animeId: anime.id,
          animeTitle: anime.title,
          operation,
          eventType: 'artwork_saved',
          source: finalRes.source || 'AniList',
          step: 'Verified artwork saved',
          details: `Replaced artwork for "${anime.title}" with verified ${finalRes.source || 'AniList'} poster`,
          result: { url: finalRes.replacedArtworkUrl }
        });
      }
    } else if (task.type === 'artwork_fix' || task.type === 'fix_missing' || task.type === 'FIX_ARTWORK' || task.type === 'FIX_MISSING') {
      onWorkerStep('Evaluating candidate artwork usability...', 'Verification Records', 'working');

      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        taskId: task.taskId,
        animeId: anime.id,
        animeTitle: anime.title,
        operation,
        eventType: 'artwork_checked',
        source: 'Verification Records',
        step: 'Inspecting existing poster candidates',
        details: `Checking stored artwork candidates for "${anime.title}"`
      });

      const records = loadVerificationRecords();
      const rec = records[anime.id];
      const bestCandidate = rec?.candidates?.find((c: any) => c.confidence >= 0.45 && c.imageUrl && !isPlaceholderArtworkUrl(c.imageUrl));

      if (bestCandidate?.imageUrl) {
        onWorkerStep(`Validating candidate image from ${bestCandidate.source || 'AniList'}...`, bestCandidate.source || 'AniList', 'working');
        const inspection = await inspectArtworkImage(bestCandidate.imageUrl, true);
        if (inspection.usable && !inspection.isBlankOrPlaceholder) {
          onWorkerStep('Saving & verifying replacement artwork...', bestCandidate.source || 'AniList', 'working');

          const currentUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl || null;
          const applied = applyArtworkUpdate(anime.id, bestCandidate.imageUrl, 'verified', currentUrl, bestCandidate.source);
          const reloaded = globalDataStore.getCatalogueAnime(anime.id);
          const savedUrl = reloaded?.artwork?.verifiedArtworkUrl;

          if (applied && savedUrl === bestCandidate.imageUrl && !isPlaceholderArtworkUrl(savedUrl)) {
            const reloadInspection = await inspectArtworkImage(savedUrl);
            if (reloadInspection.usable && !reloadInspection.isBlankOrPlaceholder) {
              globalWorkerJobEngine.recordActivityEvent({
                workerId,
                taskId: task.taskId,
                animeId: anime.id,
                animeTitle: anime.title,
                operation,
                eventType: 'replacement_found',
                source: bestCandidate.source || 'AniList',
                step: 'Valid high-confidence candidate matched & verified',
                details: `Matched candidate (${Math.round(bestCandidate.confidence * 100)}% confidence) from ${bestCandidate.source || 'AniList'}`
              });

              records[anime.id] = {
                ...records[anime.id],
                animeId: anime.id,
                animeTitle: anime.title,
                status: 'auto_fixed',
                confidence: bestCandidate.confidence,
                currentArtworkUrl: bestCandidate.imageUrl,
                replacedArtworkUrl: bestCandidate.imageUrl,
                source: bestCandidate.source,
                issue: null,
                lastVerifiedAt: new Date().toISOString()
              };
              globalDataStore.saveVerificationRecord(anime.id, records[anime.id]);

              globalWorkerJobEngine.recordActivityEvent({
                workerId,
                taskId: task.taskId,
                animeId: anime.id,
                animeTitle: anime.title,
                operation,
                eventType: 'artwork_saved',
                source: bestCandidate.source || 'AniList',
                step: 'Artwork update saved & verified in database',
                details: `Saved and verified new poster for "${anime.title}"`,
                result: { url: bestCandidate.imageUrl }
              });

              finalRes = { status: 'auto_fixed', currentArtworkUrl: bestCandidate.imageUrl };
            }
          }
        }
      }

      if (!finalRes) {
        onWorkerStep('Searching replacement poster from trusted sources...', 'AniList / TVmaze', 'working');

        globalWorkerJobEngine.recordActivityEvent({
          workerId,
          taskId: task.taskId,
          animeId: anime.id,
          animeTitle: anime.title,
          operation,
          eventType: 'source_searched',
          source: 'AniList & TVmaze',
          step: 'Searching fresh replacement poster',
          details: `Fresh source search for missing poster on "${anime.title}"`
        });

        finalRes = await verifyAnimeEntry(anime, { autoFixEnabled: true, operator, forceFreshSearch: true, workerId, onWorkerStep });
      }
    } else {
      onWorkerStep('Checking artwork relevance & dimensions...', 'AniList', 'working');

      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        taskId: task.taskId,
        animeId: anime.id,
        animeTitle: anime.title,
        operation,
        eventType: 'artwork_checked',
        source: 'AniList',
        step: 'Checking poster dimensions & usability',
        details: `Standard artwork check for "${anime.title}"`
      });

      finalRes = await verifyAnimeEntry(anime, { autoFixEnabled: true, operator, workerId, onWorkerStep });
    }

    // In-memory globalDataStore is already updated immediately (and debounced to disk in background; flushed synchronously on job completion/pause/stop)
    return finalRes;
  }

  // Enqueue High Priority Re-verification Tasks (for Needs Review Workspace)
  public enqueueReverification(animeIds: string[], operator = 'Owner') {
    this.reloadCatalogueMap();
    const tasks = animeIds.map(id => {
      const anime = this.catalogueMap.get(id);
      return {
        taskId: createDeterministicTaskId('RETRY_VERIFICATION', id),
        animeId: id,
        title: anime?.title || id,
        payload: anime || { id, title: id },
        type: 'artwork_reverify'
      };
    });

    globalWorkerJobEngine.enqueueHighPriorityTasks(tasks);

    // Ensure worker pool is running
    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Error processing reverification queue:', err.message);
    });

    return this.getJobState();
  }

  public enqueueSearchAgain(animeIds: string[], operator = 'Owner') {
    this.reloadCatalogueMap();
    const tasks = animeIds.map(id => {
      const anime = this.catalogueMap.get(id);
      return {
        taskId: createDeterministicTaskId('SEARCH_ARTWORK', id),
        animeId: id,
        title: anime?.title || id,
        payload: anime || { id, title: id },
        type: 'artwork_search_again'
      };
    });

    globalWorkerJobEngine.enqueueHighPriorityTasks(tasks);

    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Error processing search_again queue:', err.message);
    });

    return this.getJobState();
  }

  public enqueueFixArtwork(animeIds: string[], operator = 'Owner') {
    this.reloadCatalogueMap();
    const tasks = animeIds.map(id => {
      const anime = this.catalogueMap.get(id);
      return {
        taskId: createDeterministicTaskId('FIX_ARTWORK', id),
        animeId: id,
        title: anime?.title || id,
        payload: anime || { id, title: id },
        type: 'artwork_fix'
      };
    });

    globalWorkerJobEngine.enqueueHighPriorityTasks(tasks);

    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Error processing fix_artwork queue:', err.message);
    });

    return this.getJobState();
  }

  public enqueueRetryAllNeedsReview(operator = 'Owner') {
    this.reloadCatalogueMap();
    const records = loadVerificationRecords();
    const targetIds: string[] = [];

    for (const anime of this.catalogueMap.values()) {
      const rec = records[anime.id];
      const url = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl;
      const isUnresolved = rec?.status === 'needs_review' || rec?.status === 'unable_to_verify' || anime.artwork?.verificationStatus === 'needs_review' || isPlaceholderArtworkUrl(url);
      if (isUnresolved) {
        targetIds.push(anime.id);
      }
    }

    if (targetIds.length === 0) {
      return { success: false, message: 'No unresolved or retryable artwork records found.', count: 0 };
    }

    const scanState = this.enqueueReverification(targetIds, operator);
    return {
      success: true,
      message: `Enqueued ${targetIds.length} unresolved items for worker re-verification.`,
      count: targetIds.length,
      scanState
    };
  }

  public enqueueSearchAllNeedsReview(operator = 'Owner') {
    this.reloadCatalogueMap();
    const records = loadVerificationRecords();
    const targetIds: string[] = [];

    for (const anime of this.catalogueMap.values()) {
      const rec = records[anime.id];
      const url = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl;
      const isUnresolved = rec?.status === 'needs_review' || rec?.status === 'unable_to_verify' || anime.artwork?.verificationStatus === 'needs_review' || isPlaceholderArtworkUrl(url);
      if (isUnresolved) {
        targetIds.push(anime.id);
      }
    }

    if (targetIds.length === 0) {
      return { success: false, message: 'No unresolved artwork records found for source search.', count: 0 };
    }

    const scanState = this.enqueueSearchAgain(targetIds, operator);
    return {
      success: true,
      message: `Enqueued ${targetIds.length} unresolved items for fresh multi-source search.`,
      count: targetIds.length,
      scanState
    };
  }

  public pauseScan(operator = 'Owner') {
    globalWorkerJobEngine.pauseJob();
    const state = this.getJobState();
    return { success: true, message: 'Job paused.', state, job: state };
  }

  public resumeScan(operator = 'Owner') {
    this.reloadCatalogueMap();
    globalWorkerJobEngine.resumeJob();
    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Error resuming pool:', err.message);
    });

    const state = this.getJobState();
    return { success: true, message: 'Job resumed successfully.', state, job: state };
  }

  public stopScan(operator = 'Owner') {
    globalWorkerJobEngine.stopJob();
    const state = this.getJobState();
    return { success: true, message: 'Job stopped. Completed progress retained.', state, job: state };
  }

  public resetScan(operator = 'Owner') {
    globalWorkerJobEngine.stopJob();
    logAdminAction('Reset Artwork Verification Scan', operator, 'success');
    const state = this.getJobState();
    return { success: true, message: 'Artwork verification job state reset.', state, job: state };
  }

  // --- INSPECT ALL: Complete Non-Destructive Catalogue Inspection ---
  public async inspectAll(): Promise<InspectReport> {
    if (!fs.existsSync(CATALOGUE_PATH)) {
      throw new Error('Catalogue file not found.');
    }

    const catalogue: any[] = globalDataStore.getAllCatalogueAnime();
    const records = loadVerificationRecords();
    const fakeIssues = loadFakeAnimeIssues();

    let validCount = 0;
    let missingCount = 0;
    let incorrectCount = 0;
    let requiresReplacementCount = 0;
    let needsReviewCount = 0;
    let possibleFakeCount = 0;

    const reportItems: InspectReport['items'] = [];

    for (const anime of catalogue) {
      const artUrl = anime.artwork?.verifiedArtworkUrl || anime.artwork?.originalArtworkUrl;
      const rec = records[anime.id];
      const isFake = fakeIssues.some(f => f.catalogueId === anime.id && f.status === 'active');

      const isMissing = isPlaceholderArtworkUrl(artUrl);
      const hasIssue = rec?.status === 'needs_review' || rec?.status === 'unable_to_verify';

      if (isFake) {
        possibleFakeCount++;
      }
      if (isMissing) {
        missingCount++;
        requiresReplacementCount++;
      } else if (rec?.status === 'auto_fixed') {
        requiresReplacementCount++;
      } else if (hasIssue) {
        incorrectCount++;
        needsReviewCount++;
      } else {
        validCount++;
      }

      reportItems.push({
        id: anime.id,
        title: anime.title,
        artworkUrl: artUrl || null,
        status: rec?.status || (isMissing ? 'missing' : 'unverified'),
        hasArtwork: !isMissing,
        issue: rec?.issue || (isMissing ? 'Artwork missing or empty' : undefined)
      });
    }

    const report: InspectReport = {
      inspectedAt: new Date().toISOString(),
      totalCatalogue: catalogue.length,
      validArtworkCount: validCount,
      missingArtworkCount: missingCount,
      incorrectArtworkCount: incorrectCount,
      requiresReplacementCount: requiresReplacementCount,
      pendingCount: catalogue.length - validCount,
      retryingCount: 0,
      needsReviewCount: needsReviewCount,
      possibleFakeCount: possibleFakeCount,
      items: reportItems
    };

    try {
      fs.writeFileSync(INSPECT_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
    } catch {}

    return report;
  }
}

export const artworkScanner = new ArtworkScannerEngine();
