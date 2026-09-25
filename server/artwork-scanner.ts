import fs from 'fs';
import path from 'path';
import {
  verifyAnimeEntry,
  loadVerificationRecords,
  saveVerificationRecords,
  loadFakeAnimeIssues,
  inspectArtworkImage,
  cleanAnimeTitle,
  applyArtworkUpdate,
  markCatalogueAnimeVerified
} from './artwork-verifier.ts';
import { logAdminAction } from './audit-logger.ts';
import { globalWorkerJobEngine, TaskPriority } from './worker-job-engine.ts';

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
  let catalogue: any[] = [];
  try {
    if (fs.existsSync(CATALOGUE_PATH)) {
      catalogue = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
    }
  } catch {}

  const records = loadVerificationRecords();
  const fakeIssues = loadFakeAnimeIssues();
  let historyCount = 0;
  try {
    const historyPath = path.join(DATA_DIR, 'artwork-history.json');
    if (fs.existsSync(historyPath)) {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      historyCount = Array.isArray(history) ? history.length : 0;
    }
  } catch {}

  let verified = 0;
  let autoFixed = 0;
  let needsReview = 0;
  let unableToVerify = 0;
  let possibleFake = fakeIssues.filter(f => f.status === 'active').length;
  let missing = 0;

  for (const item of catalogue) {
    const rec = records[item.id];
    const url = item.artwork?.verifiedArtworkUrl || item.artwork?.originalArtworkUrl;
    const cleanUrl = typeof url === 'string' ? url.trim().toLowerCase() : '';
    const isMissing = !cleanUrl || cleanUrl.includes('placeholder') || cleanUrl.includes('default-poster') || cleanUrl.includes('default_poster') || cleanUrl.includes('no-image') || cleanUrl === 'null' || cleanUrl === 'undefined';

    if (isMissing) {
      missing++;
      if (rec?.status === 'needs_review') needsReview++;
      else if (rec?.status === 'unable_to_verify') unableToVerify++;
    } else {
      if (rec) {
        if (rec.status === 'verified') verified++;
        else if (rec.status === 'auto_fixed') autoFixed++;
        else if (rec.status === 'needs_review') needsReview++;
        else if (rec.status === 'unable_to_verify') unableToVerify++;
        else if (rec.status === 'possible_fake') possibleFake++;
      } else if (item.artwork?.verificationStatus === 'verified') {
        verified++;
      }
    }
  }

  const unverified = Math.max(0, catalogue.length - verified);

  return {
    total: catalogue.length,
    verified,
    autoFixed,
    needsReview,
    unableToVerify,
    possibleFake,
    missing,
    unverified,
    historyCount
  };
}

class ArtworkScannerEngine {
  private catalogueMap = new Map<string, any>();

  constructor() {
    this.reloadCatalogueMap();
  }

  private reloadCatalogueMap() {
    try {
      if (fs.existsSync(CATALOGUE_PATH)) {
        const cat: any[] = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
        this.catalogueMap.clear();
        for (const a of cat) {
          this.catalogueMap.set(a.id, a);
        }
      }
    } catch {}
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
      progressPercent: snapshot.progressPercent,
      lastLog: snapshot.lastLog,
      workerCount: snapshot.workerCount,
      poolConfig: snapshot.poolConfig,
      etaFormatted: snapshot.etaFormatted,
      avgTaskDurationMs: snapshot.avgTaskDurationMs,
      systemHealth: snapshot.systemHealth,
      sourceGatewayMetrics: snapshot.sourceGatewayMetrics,
      activeWorkers: snapshot.activeWorkers,
      activityEvents: snapshot.activityEvents,
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
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
        failed: snapshot.failedCount,
        retrying: 0,
        pending: snapshot.queuedCount
      }
    };
  }

  // --- START VERIFICATION (Verify All, Verify Unverified, or Fix Missing) ---
  public startScan(
    operator = 'Owner',
    mode: 'all' | 'unverified' | 'fix_missing' = 'all',
    limit?: number
  ): { success: boolean; message: string; job?: any } {
    if (!fs.existsSync(CATALOGUE_PATH)) {
      return { success: false, message: 'Catalogue not found.' };
    }

    this.reloadCatalogueMap();
    const catalogue: any[] = Array.from(this.catalogueMap.values());
    const records = loadVerificationRecords();

    // Determine target candidates
    let candidates: any[] = [];
    if (mode === 'unverified') {
      candidates = catalogue.filter(a => {
        const rec = records[a.id];
        const isVerified = rec?.status === 'verified' || a.artwork?.verificationStatus === 'verified';
        return !isVerified;
      });
    } else if (mode === 'fix_missing') {
      candidates = catalogue.filter(a => {
        const url = a.artwork?.verifiedArtworkUrl || a.artwork?.originalArtworkUrl;
        return !url || url.includes('placeholder') || url.includes('default-poster');
      });
    } else {
      candidates = [...catalogue];
    }

    if (typeof limit === 'number' && limit > 0) {
      candidates = candidates.slice(0, limit);
    }

    const tasks = candidates.map(a => ({
      taskId: a.id,
      title: a.title,
      payload: a,
      priority: 'MEDIUM' as TaskPriority,
      type: 'artwork_verification'
    }));

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

    return {
      success: true,
      message: `Artwork verification job started (${mode}, batch=${tasks.length}).`,
      job: this.getJobState()
    };
  }

  private async processTaskByWorker(task: any, workerId: number, operator: string) {
    this.reloadCatalogueMap();
    const anime = task.payload || this.catalogueMap.get(task.taskId);
    if (!anime) throw new Error(`Anime record ${task.taskId} not found`);

    const operation = globalWorkerJobEngine.mapTaskTypeToOperation(task.type);

    globalWorkerJobEngine.updateWorkerProgress(workerId, {
      status: 'working',
      currentAnimeId: anime.id,
      currentAnimeTitle: anime.title,
      seasonName: anime.season ? `Season ${anime.season}` : null,
      currentStep: 'Querying external metadata sources...',
      currentSource: 'AniList / Jikan'
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

    if (task.type === 'artwork_reverify' || task.type === 'artwork_search_again') {
      globalWorkerJobEngine.updateWorkerProgress(workerId, {
        currentStep: 'Running multi-pass search & candidate match...',
        currentSource: 'AniList / Jikan'
      });

      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        taskId: task.taskId,
        animeId: anime.id,
        animeTitle: anime.title,
        operation,
        eventType: 'source_searched',
        source: 'AniList & Jikan',
        step: 'Multi-pass search executed',
        details: `Querying AniList and Jikan for "${anime.title}"`
      });

      const res = await verifyAnimeEntry(anime, { autoFixEnabled: true, operator, forceFreshSearch: true });

      globalWorkerJobEngine.updateWorkerProgress(workerId, { currentStep: 'Saving verification record...' });

      if (res.replacedArtworkUrl) {
        globalWorkerJobEngine.recordActivityEvent({
          workerId,
          taskId: task.taskId,
          animeId: anime.id,
          animeTitle: anime.title,
          operation,
          eventType: 'artwork_saved',
          source: res.source || 'AniList',
          step: 'Verified artwork saved',
          details: `Replaced artwork for "${anime.title}" with verified ${res.source || 'AniList'} poster`,
          result: { url: res.replacedArtworkUrl }
        });
      }

      return res;
    } else if (task.type === 'artwork_fix') {
      globalWorkerJobEngine.updateWorkerProgress(workerId, {
        currentStep: 'Evaluating candidate artwork usability...',
        currentSource: 'Verification Records'
      });

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
      const bestCandidate = rec?.candidates?.find((c: any) => c.confidence >= 0.50 && c.imageUrl);

      if (bestCandidate?.imageUrl) {
        const inspection = await inspectArtworkImage(bestCandidate.imageUrl);
        if (inspection.usable && !inspection.isBlankOrPlaceholder) {
          globalWorkerJobEngine.updateWorkerProgress(workerId, {
            currentStep: 'Saving verified replacement artwork...',
            currentSource: bestCandidate.source || 'AniList'
          });

          globalWorkerJobEngine.recordActivityEvent({
            workerId,
            taskId: task.taskId,
            animeId: anime.id,
            animeTitle: anime.title,
            operation,
            eventType: 'replacement_found',
            source: bestCandidate.source || 'AniList',
            step: 'Valid high-confidence candidate matched',
            details: `Matched candidate (${Math.round(bestCandidate.confidence * 100)}% confidence) from ${bestCandidate.source || 'AniList'}`
          });

          applyArtworkUpdate(anime.id, bestCandidate.imageUrl, 'verified', null, bestCandidate.source);
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
          saveVerificationRecords(records);

          globalWorkerJobEngine.recordActivityEvent({
            workerId,
            taskId: task.taskId,
            animeId: anime.id,
            animeTitle: anime.title,
            operation,
            eventType: 'artwork_saved',
            source: bestCandidate.source || 'AniList',
            step: 'Artwork update saved to database',
            details: `Saved new poster for "${anime.title}"`,
            result: { url: bestCandidate.imageUrl }
          });

          return { status: 'auto_fixed', currentArtworkUrl: bestCandidate.imageUrl };
        }
      }

      globalWorkerJobEngine.updateWorkerProgress(workerId, {
        currentStep: 'Searching replacement poster from sources...',
        currentSource: 'AniList / Jikan'
      });

      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        taskId: task.taskId,
        animeId: anime.id,
        animeTitle: anime.title,
        operation,
        eventType: 'source_searched',
        source: 'AniList & Jikan',
        step: 'Searching fresh replacement poster',
        details: `Fresh source search for missing poster on "${anime.title}"`
      });

      return await verifyAnimeEntry(anime, { autoFixEnabled: true, operator, forceFreshSearch: true });
    } else {
      globalWorkerJobEngine.updateWorkerProgress(workerId, {
        currentStep: 'Checking artwork relevance & dimensions...',
        currentSource: 'AniList'
      });

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

      return await verifyAnimeEntry(anime, { autoFixEnabled: true, operator });
    }
  }

  // Enqueue High Priority Re-verification Tasks (for Needs Review Workspace)
  public enqueueReverification(animeIds: string[], operator = 'Owner') {
    this.reloadCatalogueMap();
    const tasks = animeIds.map(id => {
      const anime = this.catalogueMap.get(id);
      return {
        taskId: id,
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
        taskId: id,
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
        taskId: id,
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

  public pauseScan(operator = 'Owner') {
    globalWorkerJobEngine.pauseJob();
    return { success: true, message: 'Job paused.' };
  }

  public resumeScan(operator = 'Owner') {
    this.reloadCatalogueMap();
    globalWorkerJobEngine.runJobPool(async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId, operator);
    }).catch(err => {
      console.error('[ArtworkScanner] Error resuming pool:', err.message);
    });

    return { success: true, message: 'Job resumed successfully.' };
  }

  public stopScan(operator = 'Owner') {
    globalWorkerJobEngine.stopJob();
    return { success: true, message: 'Job stopped. Completed progress retained.' };
  }

  public resetScan(operator = 'Owner') {
    globalWorkerJobEngine.stopJob();
    logAdminAction('Reset Artwork Verification Scan', operator, 'success');
    return { success: true, message: 'Artwork verification job state reset.' };
  }

  // --- INSPECT ALL: Complete Non-Destructive Catalogue Inspection ---
  public async inspectAll(): Promise<InspectReport> {
    if (!fs.existsSync(CATALOGUE_PATH)) {
      throw new Error('Catalogue file not found.');
    }

    const catalogue: any[] = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
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

      const isMissing = !artUrl || artUrl.includes('placeholder') || artUrl.includes('default-poster');
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
