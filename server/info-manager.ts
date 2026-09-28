import fs from 'fs';
import path from 'path';
import { globalDataStore } from './data-store.ts';
import { globalSourceGateway } from './source-gateway.ts';
import { calculateStringSimilarity, cleanAnimeTitle } from './artwork-verifier.ts';
import { logAdminAction } from './audit-logger.ts';
import {
  globalWorkerJobEngine,
  createDeterministicTaskId,
  JobTask,
  JobStateSnapshot,
  TaskPriority
} from './worker-job-engine.ts';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const INFO_RECORDS_PATH = path.join(DATA_DIR, 'info-verification-records.json');
const INFO_HISTORY_PATH = path.join(DATA_DIR, 'info-history.json');
const ARTWORK_RECORDS_PATH = path.join(DATA_DIR, 'artwork-verification-records.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export type DuplicateClassification =
  | 'confirmed_duplicate'
  | 'likely_duplicate'
  | 'possible_duplicate'
  | 'not_duplicate';

export type InfoVerificationStatus =
  | 'verified'
  | 'correct'
  | 'auto_fixed'
  | 'needs_review'
  | 'conflict'
  | 'duplicate'
  | 'suspected_fake'
  | 'confirmed_fake'
  | 'missing_info'
  | 'unverified';

export type InfoCheckField =
  | 'title'
  | 'alternateTitles'
  | 'duplicate'
  | 'seasonsCount'
  | 'totalEpisodes'
  | 'seasonEpisodes'
  | 'status'
  | 'releaseYear'
  | 'type'
  | 'genres'
  | 'languages'
  | 'synopsis'
  | 'storyDetails'
  | 'relatedAnime'
  | 'franchiseRelationships'
  | 'raretoonMapping'
  | 'conflictingInformation'
  | 'suspectedFake';

export interface InfoReviewQueueReason {
  field: InfoCheckField;
  currentValue: any;
  proposedValue: any;
  evidence: string;
  sources: string[];
  confidence: number;
  reasonForReview: string;
}

export interface InfoFieldDiscrepancy {
  field: InfoCheckField;
  label: string;
  severity: 'high' | 'medium' | 'low';
  currentValue: any;
  suggestedValue: any;
  proposedValue?: any;
  evidence?: string;
  sources?: string[];
  confidence?: number;
  reasonForReview?: string;
  source: string;
  message: string;
}

export interface InfoMetadataCandidate {
  source: string;
  sourceId?: string | number;
  malId?: number;
  confidence: number;
  title: string;
  alternateTitle?: string | null;
  japaneseTitle?: string | null;
  type?: 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special';
  status?: 'Completed' | 'Ongoing' | 'Upcoming';
  releaseYear?: number;
  releaseDate?: string | null;
  totalEpisodes?: number;
  totalSeasons?: number;
  genres?: string[];
  synopsis?: string;
  relatedAnime?: string[];
  franchiseRelationships?: string[];
}

export interface InfoVerificationRecord {
  animeId: string;
  animeTitle: string;
  status: InfoVerificationStatus;
  statusLabel: string;
  confidence: number;
  source?: string;
  sourcesChecked?: string[];
  lastVerifiedAt: string;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  retryPending?: boolean;
  decisionReason?: string;
  externalIds?: {
    aniListId?: number | null;
    malId?: number | null;
    tvmazeId?: number | null;
  };
  discrepancies: InfoFieldDiscrepancy[];
  reviewQueueReasons?: InfoReviewQueueReason[];
  duplicateOfIds?: string[];
  duplicateTitles?: string[];
  duplicateEvidence?: string[];
  duplicateClassification?: DuplicateClassification;
  suspectedFakeReason?: string | null;
  suspectedFakeStrongEvidence?: boolean;
  candidates: InfoMetadataCandidate[];
  checkedFields: Record<InfoCheckField, 'ok' | 'mismatch' | 'missing'>;
  summaryMessage: string;
}

export interface InfoHistoryEntry {
  id: string;
  animeId: string;
  animeTitle: string;
  updatedAt: string;
  updatedBy: string;
  source: string;
  reason: string;
  changedFields: string[];
  previousSnapshot: {
    title: string;
    alternateTitle: string | null;
    japaneseTitle?: string | null;
    type: string;
    status: string;
    releaseYear: number;
    releaseDate?: string | null;
    totalSeasons?: number;
    totalEpisodes?: number;
    seasons?: any[];
    genres: string[];
    languages?: string[];
    dubLanguage?: string;
    synopsis: string;
    storyDetails?: string | null;
    relatedAnime?: string[];
    franchiseRelationships?: string[];
    providerAnimeId?: string;
    canonicalUrl?: string;
  };
  newSnapshot: {
    title: string;
    alternateTitle: string | null;
    japaneseTitle?: string | null;
    type: string;
    status: string;
    releaseYear: number;
    releaseDate?: string | null;
    totalSeasons?: number;
    totalEpisodes?: number;
    seasons?: any[];
    genres: string[];
    languages?: string[];
    dubLanguage?: string;
    synopsis: string;
    storyDetails?: string | null;
    relatedAnime?: string[];
    franchiseRelationships?: string[];
    providerAnimeId?: string;
    canonicalUrl?: string;
  };
}

export interface InfoManagerStats {
  total: number;
  totalSeasons: number;
  totalAuthoritativeEpisodes: number;
  totalImportedEpisodes: number;
  verified: number;
  correct: number;
  autoFixed: number;
  needsReview: number;
  conflicts: number;
  duplicates: number;
  suspectedFake: number;
  confirmedFake: number;
  missingInfo: number;
  episodeMismatch: number;
  unverified: number;
  historyCount: number;
}

export interface InfoScanJobState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  mode: 'all' | 'unverified' | 'fix_missing' | 'inspect';
  totalCount: number;
  processedCount: number;
  progressPercent: number;
  currentAnimeId: string | null;
  currentAnimeTitle: string | null;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  lastLog: string;
  globalStats: InfoManagerStats;
  workerSnapshot?: JobStateSnapshot;
  sharedWorkerSnapshot?: JobStateSnapshot;
}

function stripHtmlTags(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapAniListFormat(format?: string | null): 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' {
  switch ((format || '').toUpperCase()) {
    case 'MOVIE':
      return 'Movie';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'SPECIAL':
      return 'Special';
    case 'TV':
    case 'TV_SHORT':
    default:
      return 'TV';
  }
}

function mapAniListStatus(status?: string | null): 'Completed' | 'Ongoing' | 'Upcoming' {
  switch ((status || '').toUpperCase()) {
    case 'RELEASING':
      return 'Ongoing';
    case 'NOT_YET_RELEASED':
      return 'Upcoming';
    case 'FINISHED':
    case 'CANCELLED':
    default:
      return 'Completed';
  }
}

function mapJikanFormat(format?: string | null): 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' {
  switch ((format || '').toUpperCase()) {
    case 'MOVIE':
      return 'Movie';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'SPECIAL':
    case 'TV SPECIAL':
      return 'Special';
    case 'TV':
    default:
      return 'TV';
  }
}

function mapJikanStatus(status?: string | null): 'Completed' | 'Ongoing' | 'Upcoming' {
  const s = (status || '').toLowerCase();
  if (s.includes('currently airing') || s === 'ongoing') return 'Ongoing';
  if (s.includes('not yet aired') || s === 'upcoming') return 'Upcoming';
  return 'Completed';
}

function extractLanguagesFromAnime(anime: any): string[] {
  const langs = new Set<string>();
  if (Array.isArray(anime.languages)) {
    for (const l of anime.languages) {
      if (typeof l === 'string' && l.trim()) langs.add(l.trim());
    }
  }
  const dubLang = anime.providers?.raretoonIndia?.dubLanguage;
  if (typeof dubLang === 'string' && dubLang.trim()) {
    for (const part of dubLang.split(/[,/&|+-]+/)) {
      const trimmed = part.trim();
      if (trimmed) langs.add(trimmed);
    }
  }
  const titleText = `${anime.title || ''} ${anime.alternateTitle || ''}`;
  for (const lang of ['Hindi', 'Tamil', 'Telugu', 'English', 'Japanese', 'Malayalam', 'Kannada', 'Bengali']) {
    if (new RegExp(`\\b${lang}\\b`, 'i').test(titleText)) {
      langs.add(lang);
    }
  }
  return Array.from(langs);
}

/**
 * Normalize title for duplicate comparison while preserving season numbers, movie/OVA tags, and sequel numbers
 * so separate seasons or movies of a franchise are never falsely flagged as duplicates.
 */
function normalizeDuplicateIdentityTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .toLowerCase()
    .replace(/\b(?:watch|online|free|hd|1080p|720p|480p|all\s+episodes?|episodes?\s+\d+(?:\s*-\s*\d+)?)\b/gi, ' ')
    .replace(/\b(?:in\s+)?(?:hindi|tamil|telugu|malayalam|kannada|bengali|english|japanese)\s*(?:dub(?:bed)?|sub(?:bed)?)?\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class InformationManagerEngine {
  private recordsMap = new Map<string, InfoVerificationRecord>();
  private historyList: InfoHistoryEntry[] = [];
  private artworkAniListMatches = new Map<string, any>();
  private scanState: Omit<InfoScanJobState, 'globalStats'> = {
    status: 'idle',
    mode: 'all',
    totalCount: 0,
    processedCount: 0,
    progressPercent: 0,
    currentAnimeId: null,
    currentAnimeTitle: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    lastLog: 'Shared 50-Worker Information Manager coordinator ready.'
  };
  private stopRequested = false;
  private pauseRequested = false;
  private isLoopActive = false;
  private saveRecordsTimer: NodeJS.Timeout | null = null;
  private isTestEnv = false;
  private lastFetchDiagnostics = new Map<
    string,
    {
      hadTransientFailure: boolean;
      sourcesAttempted: string[];
      sourcesSucceeded: string[];
      errors: string[];
    }
  >();

  /**
   * Sanitize persisted candidates by removing non-anime TVMaze fallback noise and backfilling cached AniList identity
   */
  private sanitizePersistedCandidates(anime: any, existingCandidates: InfoMetadataCandidate[] = []): InfoMetadataCandidate[] {
    const trusted = existingCandidates.filter(c => c && c.source !== 'TVMaze');
    if (trusted.length === 0 && anime?.id) {
      const artMatch = this.artworkAniListMatches.get(anime.id);
      if (artMatch && artMatch.id) {
        const cleanedInfo = cleanAnimeTitle(anime.title || '');
        const searchQuery = cleanedInfo.cleaned || anime.title || '';
        const eng = artMatch.title?.english || '';
        const rom = artMatch.title?.romaji || '';
        const mappedType = mapAniListFormat(artMatch.format);
        const confidence = this.scoreCandidateConfidence(anime, searchQuery, {
          sourceId: artMatch.id,
          titles: [eng, rom].filter(Boolean),
          type: mappedType,
          releaseYear: artMatch.seasonYear || undefined
        });
        trusted.push({
          source: 'AniList',
          sourceId: artMatch.id,
          confidence,
          title: eng || rom || anime.title,
          alternateTitle: rom && rom !== eng ? rom : null,
          japaneseTitle: rom || null,
          type: mappedType,
          releaseYear: artMatch.seasonYear || anime.releaseYear || undefined
        });
      }
    }
    return trusted;
  }

  constructor() {
    const argv1 = process.argv[1] || '';
    this.isTestEnv = Boolean(argv1.includes('/test/') || argv1.endsWith('.test.ts'));
    this.loadFromDisk();
    this.repairFalsePositivesOnStartup();
    globalWorkerJobEngine.registerSystemProcessor('INFORMATION_VERIFICATION', async (task, workerId) => {
      return await this.processTaskByWorker(task, workerId);
    });
  }

  /**
   * Repair any prior false-positive season episodeCount=1 overwrites and synchronize info records
   * against the authoritative Phase 1/2 catalogue on startup.
   */
  private repairFalsePositivesOnStartup() {
    try {
      let restoredHistoryCount = 0;
      const keepHistory: InfoHistoryEntry[] = [];
      for (const h of this.historyList) {
        const isOldFalseEpisodeFix =
          h.reason?.startsWith('Auto-repaired missing/inconsistent metadata') &&
          h.changedFields?.includes('seasons') &&
          (h.previousSnapshot?.totalEpisodes || 0) > (h.newSnapshot?.totalEpisodes || 0);

        if (isOldFalseEpisodeFix && h.previousSnapshot) {
          globalDataStore.updateCatalogueAnime(h.animeId, (item) => {
            if (Array.isArray(h.previousSnapshot.seasons) && h.previousSnapshot.seasons.length > 0) {
              item.seasons = h.previousSnapshot.seasons;
            }
            if (typeof h.previousSnapshot.totalEpisodes === 'number' && h.previousSnapshot.totalEpisodes > 0) {
              item.totalEpisodes = h.previousSnapshot.totalEpisodes;
            }
          });
          restoredHistoryCount++;
        } else {
          keepHistory.push(h);
        }
      }
      if (restoredHistoryCount > 0) {
        this.historyList = keepHistory;
        this.saveHistoryToDisk();
        globalDataStore.flushCatalogueSync();
      }

      // Synchronize all records against the authoritative catalogue so stale pre-Phase-1 discrepancies are purged
      const catalogue = globalDataStore.getAllCatalogueAnime();
      const catalogueById = new Map<string, any>();
      for (const a of catalogue) {
        if (a && a.id) catalogueById.set(a.id, a);
      }
      const duplicateMap = this.buildDuplicateIndex(catalogue);

      for (const [animeId] of Array.from(this.recordsMap.entries())) {
        if (!catalogueById.has(animeId)) {
          this.recordsMap.delete(animeId);
        }
      }

      for (const anime of catalogue) {
        const existing = this.recordsMap.get(anime.id);
        const dupIds = duplicateMap.get(anime.id) || [];
        const sanitizedCandidates = this.sanitizePersistedCandidates(anime, existing?.candidates || []);
        const evaluated = this.evaluateAnimeMetadata(
          anime,
          dupIds,
          catalogueById,
          sanitizedCandidates,
          existing?.status === 'auto_fixed' ? 'auto_fixed' : undefined
        );
        if (existing?.attemptCount) evaluated.attemptCount = existing.attemptCount;
        if (existing?.lastAttemptAt) evaluated.lastAttemptAt = existing.lastAttemptAt;
        this.recordsMap.set(anime.id, evaluated);
      }
      this.saveRecordsToDisk(true);
    } catch (err: any) {
      console.warn('[InfoManager] Startup repair warning:', err.message);
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(ARTWORK_RECORDS_PATH)) {
        const artParsed = JSON.parse(fs.readFileSync(ARTWORK_RECORDS_PATH, 'utf-8'));
        this.artworkAniListMatches.clear();
        for (const [k, v] of Object.entries(artParsed)) {
          const rec = v as any;
          if (rec?.aniListMatch) {
            this.artworkAniListMatches.set(k, rec.aniListMatch);
          }
        }
      }
    } catch {}

    try {
      if (fs.existsSync(INFO_RECORDS_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(INFO_RECORDS_PATH, 'utf-8'));
        this.recordsMap.clear();
        for (const [k, v] of Object.entries(parsed)) {
          this.recordsMap.set(k, v as InfoVerificationRecord);
        }
      }
    } catch (err: any) {
      console.warn('[InfoManager] Failed to load info records:', err.message);
    }

    try {
      if (fs.existsSync(INFO_HISTORY_PATH)) {
        this.historyList = JSON.parse(fs.readFileSync(INFO_HISTORY_PATH, 'utf-8'));
      }
    } catch (err: any) {
      console.warn('[InfoManager] Failed to load info history:', err.message);
    }
  }

  private saveRecordsToDisk(immediate = false) {
    if (this.isTestEnv) return;
    if (!immediate) {
      if (this.saveRecordsTimer) return;
      this.saveRecordsTimer = setTimeout(() => {
        this.saveRecordsTimer = null;
        this.saveRecordsToDisk(true);
      }, 450);
      return;
    }
    if (this.saveRecordsTimer) {
      clearTimeout(this.saveRecordsTimer);
      this.saveRecordsTimer = null;
    }
    try {
      const obj: Record<string, InfoVerificationRecord> = {};
      for (const [k, v] of this.recordsMap.entries()) {
        obj[k] = v;
      }
      const tmpPath = `${INFO_RECORDS_PATH}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf-8');
      fs.renameSync(tmpPath, INFO_RECORDS_PATH);
    } catch (err: any) {
      console.warn('[InfoManager] Failed to save info records:', err.message);
    }
  }

  private saveHistoryToDisk() {
    if (this.isTestEnv) return;
    try {
      fs.writeFileSync(INFO_HISTORY_PATH, JSON.stringify(this.historyList, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[InfoManager] Failed to save info history:', err.message);
    }
  }

  public getRecord(animeId: string): InfoVerificationRecord | null {
    return this.recordsMap.get(animeId) || null;
  }

  public getAllRecords(): Record<string, InfoVerificationRecord> {
    const out: Record<string, InfoVerificationRecord> = {};
    for (const [k, v] of this.recordsMap.entries()) {
      out[k] = v;
    }
    return out;
  }

  public getHistory(): InfoHistoryEntry[] {
    return [...this.historyList];
  }

  /**
   * Smart Multi-Signal Duplicate Classification between two catalogue entries
   */
  public classifyDuplicatePair(a: any, b: any): {
    classification: DuplicateClassification;
    confidence: number;
    evidence: string;
  } {
    if (!a || !b || a.id === b.id) {
      return { classification: 'not_duplicate', confidence: 0, evidence: '' };
    }

    const typeA = (a.type || 'TV').toUpperCase();
    const typeB = (b.type || 'TV').toUpperCase();
    // Never treat a Movie and a TV Series as duplicates of each other
    if (typeA !== typeB) {
      return { classification: 'not_duplicate', confidence: 0.15, evidence: `Different format (${a.type} vs ${b.type})` };
    }

    // Check if one has explicit season/movie number that differs from the other (e.g., Season 1 vs Season 2, Movie 1 vs Movie 2)
    const seasonMatchA = (a.title || '').match(/\b(?:season|part|movie|film)\s*(\d+)\b/i);
    const seasonMatchB = (b.title || '').match(/\b(?:season|part|movie|film)\s*(\d+)\b/i);
    if (seasonMatchA && seasonMatchB && seasonMatchA[1] !== seasonMatchB[1]) {
      return { classification: 'not_duplicate', confidence: 0.1, evidence: 'Different numbered installment/season' };
    }

    const urlA = (a.providers?.raretoonIndia?.canonicalUrl || a.canonicalProviderUrl || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/^raretoonindia\.in/, 'rareanimes.mov')
      .replace(/\/+$/, '');
    const urlB = (b.providers?.raretoonIndia?.canonicalUrl || b.canonicalProviderUrl || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/^raretoonindia\.in/, 'rareanimes.mov')
      .replace(/\/+$/, '');
    const isValidSpecificUrl = (u: string) =>
      Boolean(u && u !== 'rareanimes.mov' && u !== 'rareanimes.mov/home' && !u.endsWith('/home'));

    const provA = (a.providers?.raretoonIndia?.providerAnimeId || '').trim().toLowerCase();
    const provB = (b.providers?.raretoonIndia?.providerAnimeId || '').trim().toLowerCase();
    const isValidSpecificProv = (p: string) => Boolean(p && !p.startsWith('mal_'));

    const sameUrl = isValidSpecificUrl(urlA) && isValidSpecificUrl(urlB) && urlA === urlB;
    const sameProv = isValidSpecificProv(provA) && isValidSpecificProv(provB) && provA === provB;
    const sameExternalId = Boolean(
      (a.malId && b.malId && Number(a.malId) === Number(b.malId)) ||
      (a.aniListId && b.aniListId && Number(a.aniListId) === Number(b.aniListId))
    );

    const normA = normalizeDuplicateIdentityTitle(a.title || '');
    const normB = normalizeDuplicateIdentityTitle(b.title || '');
    const cleanA = cleanAnimeTitle(a.title || '').cleaned.toLowerCase().trim();
    const cleanB = cleanAnimeTitle(b.title || '').cleaned.toLowerCase().trim();
    const sameYear = Boolean(a.releaseYear && b.releaseYear && Math.abs(Number(a.releaseYear) - Number(b.releaseYear)) <= 1);
    const yearConflict = Boolean(a.releaseYear && b.releaseYear && Math.abs(Number(a.releaseYear) - Number(b.releaseYear)) >= 3);

    if (yearConflict && !sameUrl && !sameProv && !sameExternalId) {
      return { classification: 'not_duplicate', confidence: 0.2, evidence: `Distinct release years (${a.releaseYear} vs ${b.releaseYear})` };
    }

    if (sameUrl || sameProv) {
      return {
        classification: 'confirmed_duplicate',
        confidence: 0.98,
        evidence: `Confirmed duplicate: Matches "${b.title}" [${b.id}] with identical RareToon provider mapping (${sameUrl ? urlA : provA}) and format (${a.type}).`
      };
    }

    if (sameExternalId && !seasonMatchA && !seasonMatchB && sameYear) {
      return {
        classification: 'confirmed_duplicate',
        confidence: 0.96,
        evidence: `Confirmed duplicate: Matches "${b.title}" [${b.id}] with identical external MAL/AniList ID, year (${a.releaseYear}), and format (${a.type}).`
      };
    }

    if (normA && normA === normB && !seasonMatchA && !seasonMatchB) {
      if (sameYear) {
        return {
          classification: 'likely_duplicate',
          confidence: 0.88,
          evidence: `Likely duplicate: Matches "${b.title}" [${b.id}] — identical normalized title, same format (${a.type}), and release year (${a.releaseYear}).`
        };
      }
      return {
        classification: 'possible_duplicate',
        confidence: 0.76,
        evidence: `Possible duplicate: Similar title "${b.title}" [${b.id}] (${a.type}), but distinct RareToon URLs. Review before merging.`
      };
    }

    return { classification: 'not_duplicate', confidence: 0, evidence: '' };
  }

  /**
   * Build multi-signal duplicate index across the entire catalogue
   * Uses strong identity evidence:
   * 1. Same RareToon canonical URL
   * 2. Same RareToon provider ID / slug
   * 3. Same MAL / AniList ID
   * 4. Normalized identity title + year + type
   */
  public buildDuplicateIndex(catalogue: any[]): Map<string, string[]> {
    const byIdentityTitle = new Map<string, any[]>();
    const byProviderId = new Map<string, any[]>();
    const byCanonicalUrl = new Map<string, any[]>();
    const byExternalId = new Map<string, any[]>();

    const normalizeUrlForIndex = (u?: string | null) => {
      if (!u || typeof u !== 'string') return '';
      const clean = u
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\/(www\.)?/, '')
        .replace(/^raretoonindia\.in/, 'rareanimes.mov')
        .replace(/\/+$/, '');
      if (!clean || clean === 'rareanimes.mov' || clean === 'rareanimes.mov/home' || clean.endsWith('/home')) return '';
      return clean;
    };

    for (const anime of catalogue) {
      if (!anime || !anime.id) continue;
      for (const rawTitle of [anime.title, anime.alternateTitle]) {
        if (!rawTitle) continue;
        const norm = normalizeDuplicateIdentityTitle(rawTitle);
        if (norm.length >= 2) {
          const list = byIdentityTitle.get(norm) || [];
          list.push(anime);
          byIdentityTitle.set(norm, list);
        }
      }

      const provId = anime.providers?.raretoonIndia?.providerAnimeId;
      if (provId && typeof provId === 'string' && provId.trim() && !provId.trim().toLowerCase().startsWith('mal_')) {
        const key = provId.trim().toLowerCase();
        const list = byProviderId.get(key) || [];
        list.push(anime);
        byProviderId.set(key, list);
      }

      const canonUrl = normalizeUrlForIndex(anime.providers?.raretoonIndia?.canonicalUrl || anime.canonicalProviderUrl);
      if (canonUrl) {
        const list = byCanonicalUrl.get(canonUrl) || [];
        list.push(anime);
        byCanonicalUrl.set(canonUrl, list);
      }

      if (anime.malId) {
        const key = `mal:${anime.malId}`;
        const list = byExternalId.get(key) || [];
        list.push(anime);
        byExternalId.set(key, list);
      }
      if (anime.aniListId) {
        const key = `al:${anime.aniListId}`;
        const list = byExternalId.get(key) || [];
        list.push(anime);
        byExternalId.set(key, list);
      }
    }

    const duplicateMap = new Map<string, string[]>();
    for (const anime of catalogue) {
      if (!anime || !anime.id) continue;
      const candidatePeers = new Map<string, any>();

      for (const rawTitle of [anime.title, anime.alternateTitle]) {
        if (!rawTitle) continue;
        const norm = normalizeDuplicateIdentityTitle(rawTitle);
        for (const peer of byIdentityTitle.get(norm) || []) {
          if (peer.id !== anime.id) candidatePeers.set(peer.id, peer);
        }
      }

      const provId = anime.providers?.raretoonIndia?.providerAnimeId;
      if (provId && typeof provId === 'string' && provId.trim() && !provId.trim().toLowerCase().startsWith('mal_')) {
        for (const peer of byProviderId.get(provId.trim().toLowerCase()) || []) {
          if (peer.id !== anime.id) candidatePeers.set(peer.id, peer);
        }
      }

      const canonUrl = normalizeUrlForIndex(anime.providers?.raretoonIndia?.canonicalUrl || anime.canonicalProviderUrl);
      if (canonUrl) {
        for (const peer of byCanonicalUrl.get(canonUrl) || []) {
          if (peer.id !== anime.id) candidatePeers.set(peer.id, peer);
        }
      }

      if (anime.malId) {
        for (const peer of byExternalId.get(`mal:${anime.malId}`) || []) {
          if (peer.id !== anime.id) candidatePeers.set(peer.id, peer);
        }
      }
      if (anime.aniListId) {
        for (const peer of byExternalId.get(`al:${anime.aniListId}`) || []) {
          if (peer.id !== anime.id) candidatePeers.set(peer.id, peer);
        }
      }

      const validDupIds: string[] = [];
      for (const [peerId, peer] of candidatePeers.entries()) {
        const check = this.classifyDuplicatePair(anime, peer);
        if (check.classification !== 'not_duplicate') {
          validDupIds.push(peerId);
        }
      }
      if (validDupIds.length > 0) {
        duplicateMap.set(anime.id, validDupIds);
      }
    }

    return duplicateMap;
  }

  /**
   * Evaluate internal consistency and metadata completeness for a single anime
   * across all 19 information dimensions (optionally enriched with external candidates from AniList / TVMaze)
   */
  public evaluateAnimeMetadata(
    anime: any,
    duplicateIds: string[],
    catalogueById: Map<string, any>,
    candidates: InfoMetadataCandidate[] = [],
    preserveStatus?: InfoVerificationStatus
  ): InfoVerificationRecord {
    const discrepancies: InfoFieldDiscrepancy[] = [];
    const checkedFields: Record<InfoCheckField, 'ok' | 'mismatch' | 'missing'> = {
      title: 'ok',
      alternateTitles: 'ok',
      duplicate: 'ok',
      seasonsCount: 'ok',
      totalEpisodes: 'ok',
      seasonEpisodes: 'ok',
      status: 'ok',
      releaseYear: 'ok',
      type: 'ok',
      genres: 'ok',
      languages: 'ok',
      synopsis: 'ok',
      storyDetails: 'ok',
      relatedAnime: 'ok',
      franchiseRelationships: 'ok',
      raretoonMapping: 'ok',
      conflictingInformation: 'ok',
      suspectedFake: 'ok'
    };

    const topCandidate = candidates.length > 0 ? candidates[0] : null;
    const secondCandidate = candidates.length > 1 ? candidates[1] : null;
    const cleanedTitleInfo = cleanAnimeTitle(anime.title || '');

    // 1. Anime Title Check (Allow valid 1-letter alphanumeric titles such as "K")
    const trimmedTitle = (anime.title || '').trim();
    const isMissingOrInvalidShortTitle =
      !trimmedTitle || (trimmedTitle.length === 1 && !/^[a-z0-9]$/i.test(trimmedTitle));
    if (isMissingOrInvalidShortTitle) {
      checkedFields.title = 'missing';
      discrepancies.push({
        field: 'title',
        label: 'Anime Title',
        severity: 'high',
        currentValue: anime.title || '',
        suggestedValue: topCandidate?.title || 'Valid Title Required',
        source: topCandidate?.source || 'Catalogue Audit',
        message: 'Anime title is missing or invalid.'
      });
    } else if (
      /\b(?:download|watch\s+online|1080p|720p|480p|all\s+episodes\s+hindi)\b/i.test(anime.title) &&
      cleanedTitleInfo.cleaned !== anime.title
    ) {
      checkedFields.title = 'mismatch';
      discrepancies.push({
        field: 'title',
        label: 'Anime Title',
        severity: 'medium',
        currentValue: anime.title,
        suggestedValue: topCandidate?.title || cleanedTitleInfo.cleaned,
        source: topCandidate?.source || 'Title Cleaner',
        message: `Title contains scraping noise ("${anime.title}"). Suggested clean title: "${topCandidate?.title || cleanedTitleInfo.cleaned}".`
      });
    }

    // 2. Japanese Title / Alternate Titles Check (Optional metadata: never fail the anime if absent)
    checkedFields.alternateTitles = 'ok';

    // 3. Duplicate Anime Entries Check (Multi-signal: Confirmed / Likely / Possible / Not a duplicate)
    const duplicateTitles: string[] = [];
    const duplicateEvidence: string[] = [];
    let highestDuplicateClass: DuplicateClassification = 'not_duplicate';

    if (duplicateIds.length > 0) {
      for (const dId of duplicateIds) {
        const dupAnime = catalogueById.get(dId);
        if (dupAnime) {
          const check = this.classifyDuplicatePair(anime, dupAnime);
          if (check.classification === 'not_duplicate') continue;
          duplicateTitles.push(`${dupAnime.title} (${dId})`);
          duplicateEvidence.push(check.evidence);
          if (check.classification === 'confirmed_duplicate') {
            highestDuplicateClass = 'confirmed_duplicate';
          } else if (check.classification === 'likely_duplicate' && highestDuplicateClass !== 'confirmed_duplicate') {
            highestDuplicateClass = 'likely_duplicate';
          } else if (check.classification === 'possible_duplicate' && highestDuplicateClass === 'not_duplicate') {
            highestDuplicateClass = 'possible_duplicate';
          }
        }
      }
      if (duplicateTitles.length > 0) {
        checkedFields.duplicate = 'mismatch';
        const classLabel =
          highestDuplicateClass === 'confirmed_duplicate'
            ? 'Confirmed Duplicate'
            : highestDuplicateClass === 'likely_duplicate'
              ? 'Likely Duplicate'
              : 'Possible Duplicate';
        discrepancies.push({
          field: 'duplicate',
          label: `${classLabel} Entry`,
          severity: highestDuplicateClass === 'confirmed_duplicate' ? 'high' : 'medium',
          currentValue: `${anime.title} (${anime.id})`,
          suggestedValue: `Review matching entry: ${duplicateTitles.join(', ')}`,
          source: 'Multi-Signal Duplicate Detector',
          message: `${classLabel} detected matching: ${duplicateTitles.join(', ')}. Review evidence before deleting.`
        });
      }
    }

    // 4. Number of Seasons & Season Numbering Check
    const seasonsArr = Array.isArray(anime.seasons) ? anime.seasons : [];
    const actualSeasonsLen = seasonsArr.length;
    const declaredSeasons = anime.totalSeasons ?? anime.seasonsCount ?? actualSeasonsLen;
    const seenSeasonNumbers = new Set<number>();
    let hasInvalidSeasonNumbering = false;
    for (let sIdx = 0; sIdx < seasonsArr.length; sIdx++) {
      const sn = Number(seasonsArr[sIdx]?.seasonNumber);
      if (!sn || isNaN(sn) || sn < 1 || seenSeasonNumbers.has(sn)) {
        hasInvalidSeasonNumbering = true;
      } else {
        seenSeasonNumbers.add(sn);
      }
    }
    if (anime.type !== 'Movie' && actualSeasonsLen === 0 && (!declaredSeasons || declaredSeasons <= 0)) {
      checkedFields.seasonsCount = 'missing';
      discrepancies.push({
        field: 'seasonsCount',
        label: 'Seasons Count',
        severity: 'medium',
        currentValue: 0,
        suggestedValue: topCandidate?.totalSeasons || 1,
        source: topCandidate?.source || 'Catalogue Audit',
        message: 'Series has 0 seasons recorded.'
      });
    } else if (actualSeasonsLen > 0 && declaredSeasons && declaredSeasons !== actualSeasonsLen) {
      checkedFields.seasonsCount = 'mismatch';
      discrepancies.push({
        field: 'seasonsCount',
        label: 'Seasons Count',
        severity: 'medium',
        currentValue: declaredSeasons,
        suggestedValue: actualSeasonsLen,
        source: 'Season Structure Audit',
        message: `Declared totalSeasons (${declaredSeasons}) does not match seasons array count (${actualSeasonsLen}).`
      });
    } else if (hasInvalidSeasonNumbering) {
      checkedFields.seasonsCount = 'mismatch';
      discrepancies.push({
        field: 'seasonsCount',
        label: 'Season Numbering',
        severity: 'medium',
        currentValue: seasonsArr.map((s: any) => s?.seasonNumber).join(', '),
        suggestedValue: actualSeasonsLen,
        source: 'Season Structure Audit',
        message: 'Season numbering contains non-positive or duplicate season numbers.'
      });
    }

    // 5. Season-Specific Episode Counts Check
    // Strictly separate:
    // A. authoritative episode count (s.authoritativeEpisodeCount || s.episodeCount)
    // B. imported episode records (s.importedEpisodeCount ?? s.episodes.length)
    // C. whether the episode list is complete (isEpisodeListComplete)
    // Only flag discrepancy if authoritative count <= 0 and imported count <= 0, OR if imported count exceeds declared authoritative count.
    let sumSeasonEpisodes = 0;
    const brokenSeasons: string[] = [];
    for (const s of seasonsArr) {
      const epListLen = Array.isArray(s.episodes) ? s.episodes.length : 0;
      const sCount =
        typeof s.authoritativeEpisodeCount === 'number' && s.authoritativeEpisodeCount > 0
          ? s.authoritativeEpisodeCount
          : typeof s.episodeCount === 'number' && s.episodeCount > 0
          ? s.episodeCount
          : epListLen;
      sumSeasonEpisodes += sCount > 0 ? sCount : epListLen;
      if (sCount <= 0 && epListLen <= 0) {
        brokenSeasons.push(`Season ${s.seasonNumber || '?'}`);
      } else if (epListLen > sCount) {
        brokenSeasons.push(`Season ${s.seasonNumber} (declared ${sCount} < ${epListLen} imported episodes)`);
      }
    }
    if (brokenSeasons.length > 0) {
      checkedFields.seasonEpisodes = 'mismatch';
      discrepancies.push({
        field: 'seasonEpisodes',
        label: 'Season Episode Counts',
        severity: 'medium',
        currentValue: brokenSeasons.join('; '),
        suggestedValue: 'Synchronize season episode counts with episode list',
        source: 'Season Structure Audit',
        message: `Season-specific episode count discrepancy in: ${brokenSeasons.join(', ')}`
      });
    }

    // 6. Total Episode Count Check
    const currentTotalEp = typeof anime.totalEpisodes === 'number' ? anime.totalEpisodes : 0;
    if (currentTotalEp <= 0) {
      checkedFields.totalEpisodes = 'missing';
      const suggestedEp = sumSeasonEpisodes > 0 ? sumSeasonEpisodes : (topCandidate?.totalEpisodes || (anime.type === 'Movie' ? 1 : 12));
      discrepancies.push({
        field: 'totalEpisodes',
        label: 'Total Episode Count',
        severity: 'high',
        currentValue: currentTotalEp,
        suggestedValue: suggestedEp,
        source: topCandidate?.source || 'Episode Counter',
        message: `Total episode count is ${currentTotalEp}. Suggested: ${suggestedEp}.`
      });
    } else if (sumSeasonEpisodes > 0 && currentTotalEp !== sumSeasonEpisodes) {
      checkedFields.totalEpisodes = 'mismatch';
      discrepancies.push({
        field: 'totalEpisodes',
        label: 'Total Episode Count',
        severity: 'medium',
        currentValue: currentTotalEp,
        suggestedValue: sumSeasonEpisodes,
        source: 'Season Episode Sum',
        message: `Total episodes (${currentTotalEp}) does not match sum of season episodes (${sumSeasonEpisodes}).`
      });
    } else if (
      topCandidate?.totalEpisodes &&
      topCandidate.confidence >= 0.88 &&
      actualSeasonsLen <= 1 &&
      Math.abs(currentTotalEp - topCandidate.totalEpisodes) > 0 &&
      sumSeasonEpisodes === 0
    ) {
      checkedFields.totalEpisodes = 'mismatch';
      discrepancies.push({
        field: 'totalEpisodes',
        label: 'Total Episode Count',
        severity: 'medium',
        currentValue: currentTotalEp,
        suggestedValue: topCandidate.totalEpisodes,
        source: topCandidate.source,
        message: `${topCandidate.source} reports ${topCandidate.totalEpisodes} episodes vs catalogue ${currentTotalEp}.`
      });
    }

    // 7. Completed vs Ongoing Status Check
    // Never determine Completed/Ongoing from release year alone. Use reliable anime source evidence.
    const validStatuses = ['Completed', 'Ongoing', 'Upcoming'];
    const currentYear = new Date().getFullYear();
    const yr = Number(anime.releaseYear);
    const isAuthoritativeAnimeCandidate = Boolean(
      topCandidate && (topCandidate.source === 'AniList' || topCandidate.source === 'MyAnimeList')
    );
    const matchesSameEraAndScope = Boolean(
      actualSeasonsLen <= 1 &&
      currentTotalEp <= 100 &&
      (!topCandidate?.releaseYear || !yr || Math.abs(yr - topCandidate.releaseYear) <= 2)
    );
    if (!validStatuses.includes(anime.status)) {
      checkedFields.status = 'missing';
      discrepancies.push({
        field: 'status',
        label: 'Airing Status',
        severity: 'medium',
        currentValue: anime.status,
        suggestedValue: topCandidate?.status || null,
        source: topCandidate?.source || 'Status Audit',
        message: `Invalid status "${anime.status}". Expected Completed, Ongoing, or Upcoming.`
      });
    } else if (
      isAuthoritativeAnimeCandidate &&
      matchesSameEraAndScope &&
      topCandidate?.status &&
      topCandidate.confidence >= 0.88 &&
      anime.status !== topCandidate.status &&
      (!secondCandidate || secondCandidate.status === topCandidate.status)
    ) {
      checkedFields.status = 'mismatch';
      discrepancies.push({
        field: 'status',
        label: 'Airing Status',
        severity: 'medium',
        currentValue: anime.status,
        suggestedValue: topCandidate.status,
        source: topCandidate.source,
        message: `Status is "${anime.status}" in catalogue, while ${topCandidate.source} reports "${topCandidate.status}".`
      });
    }

    // 8. Release Date / Year Check
    const titleHasExplicitYear = Boolean(yr && new RegExp(`\\b${yr}\\b`).test(anime.title || ''));
    if (!yr || isNaN(yr) || yr < 1950 || yr > currentYear + 2) {
      checkedFields.releaseYear = 'missing';
      discrepancies.push({
        field: 'releaseYear',
        label: 'Release Year',
        severity: 'medium',
        currentValue: anime.releaseYear,
        suggestedValue: topCandidate?.releaseYear || null,
        source: topCandidate?.source || 'Release Date Audit',
        message: `Missing or invalid release year (${anime.releaseYear || 'none'}).`
      });
    } else if (
      isAuthoritativeAnimeCandidate &&
      !titleHasExplicitYear &&
      topCandidate?.releaseYear &&
      topCandidate.confidence >= 0.88 &&
      Math.abs(yr - topCandidate.releaseYear) >= 2 &&
      actualSeasonsLen <= 1
    ) {
      checkedFields.releaseYear = 'mismatch';
      discrepancies.push({
        field: 'releaseYear',
        label: 'Release Year',
        severity: 'low',
        currentValue: yr,
        suggestedValue: topCandidate.releaseYear,
        source: topCandidate.source,
        message: `Catalogue release year is ${yr}, while ${topCandidate.source} reports ${topCandidate.releaseYear}.`
      });
    }

    // 9. Anime Type Check (TV, Movie, OVA, ONA, Special)
    const allowedTypes = ['TV', 'Movie', 'OVA', 'ONA', 'Special'];
    const titleIndicatesMovie = /\b(?:movie|film)\b/i.test(anime.title || '') && !/\b(?:series|season)\b/i.test(anime.title || '');
    const titleIndicatesOva = /\b(?:ova|oad)\b/i.test(anime.title || '');
    const isCompatibleStreamingSeries = Boolean(
      topCandidate?.type &&
      ((anime.type === 'TV' && topCandidate.type === 'ONA') || (anime.type === 'ONA' && topCandidate.type === 'TV'))
    );
    if (!allowedTypes.includes(anime.type)) {
      checkedFields.type = 'missing';
      discrepancies.push({
        field: 'type',
        label: 'Anime Type',
        severity: 'medium',
        currentValue: anime.type,
        suggestedValue: topCandidate?.type || (titleIndicatesMovie ? 'Movie' : null),
        source: topCandidate?.source || 'Format Audit',
        message: `Type "${anime.type}" is not one of TV, Movie, OVA, ONA, Special.`
      });
    } else if (titleIndicatesMovie && anime.type === 'TV' && currentTotalEp <= 1) {
      checkedFields.type = 'mismatch';
      discrepancies.push({
        field: 'type',
        label: 'Anime Type',
        severity: 'medium',
        currentValue: anime.type,
        suggestedValue: 'Movie',
        source: topCandidate?.source || 'Format Audit',
        message: `Title indicates a Movie ("${anime.title}") with ${currentTotalEp} episode, but type is set to TV.`
      });
    } else if (titleIndicatesOva && anime.type !== 'OVA') {
      checkedFields.type = 'mismatch';
      discrepancies.push({
        field: 'type',
        label: 'Anime Type',
        severity: 'low',
        currentValue: anime.type,
        suggestedValue: 'OVA',
        source: 'Format Audit',
        message: `Title indicates OVA ("${anime.title}"), but type is set to ${anime.type}.`
      });
    } else if (
      isAuthoritativeAnimeCandidate &&
      !isCompatibleStreamingSeries &&
      topCandidate?.type &&
      topCandidate.confidence >= 0.9 &&
      anime.type !== topCandidate.type &&
      !titleIndicatesMovie
    ) {
      checkedFields.type = 'mismatch';
      discrepancies.push({
        field: 'type',
        label: 'Anime Type',
        severity: 'low',
        currentValue: anime.type,
        suggestedValue: topCandidate.type,
        source: topCandidate.source,
        message: `Catalogue type is ${anime.type}, while ${topCandidate.source} reports ${topCandidate.type}.`
      });
    }

    // 10. Genres Check (Never invent fallback genres)
    const genres = Array.isArray(anime.genres) ? anime.genres.filter(Boolean) : [];
    if (genres.length === 0) {
      checkedFields.genres = 'missing';
      discrepancies.push({
        field: 'genres',
        label: 'Genres',
        severity: 'medium',
        currentValue: [],
        suggestedValue: topCandidate?.genres && topCandidate.genres.length > 0 ? topCandidate.genres : null,
        source: topCandidate?.source || 'Genre Audit',
        message: 'Anime has no genres assigned.'
      });
    }

    // 11. Languages Check (Optional metadata: never fail the anime if absent)
    checkedFields.languages = 'ok';

    // 12. Synopsis / Description & 13. Story / Details Check (Never invent boilerplate synopsis)
    const syn = (anime.synopsis || '').trim();
    if (!syn || syn.length < 30 || /no synopsis available|description coming soon|placeholder/i.test(syn)) {
      checkedFields.synopsis = 'missing';
      checkedFields.storyDetails = 'missing';
      discrepancies.push({
        field: 'synopsis',
        label: 'Synopsis & Story Details',
        severity: 'medium',
        currentValue: syn || '(Empty)',
        suggestedValue: topCandidate?.synopsis && topCandidate.synopsis.length >= 30 ? topCandidate.synopsis : null,
        source: topCandidate?.source || 'Synopsis Audit',
        message: syn ? 'Synopsis / story details are too short or placeholder text.' : 'Synopsis and story details are missing.'
      });
    }

    // 14 & 15. Related Anime & Franchise Relationships Check (Optional metadata: never fail the anime if absent)
    checkedFields.relatedAnime = 'ok';
    checkedFields.franchiseRelationships = 'ok';

    // 16. Rare Toon <-> Zenime Mapping Check
    const rtProv = anime.providers?.raretoonIndia;
    const hasProviderId = Boolean(rtProv?.providerAnimeId && String(rtProv.providerAnimeId).trim());
    const hasCanonicalUrl = Boolean(
      (rtProv?.canonicalUrl && String(rtProv.canonicalUrl).startsWith('http')) ||
      (anime.canonicalProviderUrl && String(anime.canonicalProviderUrl).startsWith('http'))
    );
    if (!hasProviderId || !hasCanonicalUrl) {
      checkedFields.raretoonMapping = 'missing';
      discrepancies.push({
        field: 'raretoonMapping',
        label: 'Rare Toon ↔ Zenime Mapping',
        severity: 'medium',
        currentValue: `${rtProv?.providerAnimeId || 'No ID'} | ${rtProv?.canonicalUrl || 'No URL'}`,
        suggestedValue: `rt-${cleanedTitleInfo.cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        source: 'RareToon Mapping Audit',
        message: 'Rare Toon ↔ Zenime provider mapping (providerAnimeId or canonicalUrl) is incomplete.'
      });
    }

    // 17. Conflicting Information Across Sources Check
    let hasSourceConflict = false;
    if (topCandidate && secondCandidate && topCandidate.source !== secondCandidate.source && topCandidate.confidence >= 0.78 && secondCandidate.confidence >= 0.78) {
      const yearDiff =
        topCandidate.releaseYear && secondCandidate.releaseYear
          ? Math.abs(topCandidate.releaseYear - secondCandidate.releaseYear)
          : 0;
      const statusConflict =
        topCandidate.status && secondCandidate.status && topCandidate.status !== secondCandidate.status;
      if (yearDiff >= 2 || statusConflict) {
        hasSourceConflict = true;
        checkedFields.conflictingInformation = 'mismatch';
        discrepancies.push({
          field: 'conflictingInformation',
          label: 'Conflicting Source Information',
          severity: 'medium',
          currentValue: `${topCandidate.source}: ${topCandidate.status || '?'} (${topCandidate.releaseYear || '?'})`,
          suggestedValue: `${secondCandidate.source}: ${secondCandidate.status || '?'} (${secondCandidate.releaseYear || '?'})`,
          source: `${topCandidate.source} vs ${secondCandidate.source}`,
          message: `Cross-check conflict between ${topCandidate.source} and ${secondCandidate.source}. Owner review recommended.`
        });
      }
    }

    // 18. Suspected Fake / Non-Existent Anime Check
    // Never mark an anime as fake simply because one source cannot find it!
    // Use multiple trusted evidence sources AND the existing Rare Toon mapping.
    let suspectedFakeReason: string | null = null;
    let suspectedFakeStrongEvidence = false;
    const isGibberishTitle =
      isMissingOrInvalidShortTitle ||
      /^(?:test|fake|dummy|sample|untitled|asdf|null|undefined)\b/i.test(trimmedTitle);
    const noExternalMatchesAfterCheck =
      candidates.length === 0 && Boolean((anime as any)._externalSourcesQueried);
    const lowConfidenceMatchesOnly =
      candidates.length > 0 && topCandidate && topCandidate.confidence < 0.45;

    if (isGibberishTitle || (!hasCanonicalUrl && (noExternalMatchesAfterCheck || lowConfidenceMatchesOnly))) {
      checkedFields.suspectedFake = 'mismatch';
      suspectedFakeStrongEvidence = Boolean(isGibberishTitle && (noExternalMatchesAfterCheck || !hasCanonicalUrl));
      suspectedFakeReason = isGibberishTitle
        ? `Title "${anime.title}" matches placeholder/invalid pattern.`
        : noExternalMatchesAfterCheck
          ? 'No matching anime found across AniList, MyAnimeList/Jikan, or Rare Toon canonical URL. Marked Suspected Fake / Needs Review for Owner decision.'
          : `Low title similarity (${Math.round((topCandidate?.confidence || 0) * 100)}%) across trusted sources and missing Rare Toon canonical URL.`;

      discrepancies.push({
        field: 'suspectedFake',
        label: 'Suspected Fake / Non-Existent Anime',
        severity: 'high',
        currentValue: anime.title,
        suggestedValue: suspectedFakeStrongEvidence
          ? 'Strong evidence of invalid entry — Owner may review or delete'
          : 'Suspected Fake / Needs Review — Do not auto-delete; Owner decision required',
        source: 'Cross-Source Existence Verifier',
        message: suspectedFakeReason
      });
    }

    // Determine overall status, real multi-factor confidence, & clear human-readable statusLabel
    // Identity Priority: 1. MAL/Jikan ID -> 2. AniList ID -> 3. Rare Toon canonical URL/provider ID -> 4. title + year + type
    const artMatch = this.artworkAniListMatches.get(anime.id);
    const resolvedAniListId =
      Number(anime.aniListId || anime.anilistId || (topCandidate?.source === 'AniList' ? topCandidate.sourceId : 0) || artMatch?.id || 0) || null;
    const resolvedMalId =
      Number(
        anime.malId ||
        topCandidate?.malId ||
        (topCandidate?.source === 'MyAnimeList' ? topCandidate.sourceId : 0) ||
        (anime.id?.startsWith('mal_') ? anime.id.replace('mal_', '') : 0)
      ) || null;
    const resolvedTvmazeId =
      Number(topCandidate?.source === 'TVMaze' ? topCandidate.sourceId : (secondCandidate?.source === 'TVMaze' ? secondCandidate.sourceId : 0)) || null;

    const hasVerifiedExternalId = Boolean(resolvedMalId || resolvedAniListId);
    const hasVerifiedRareToonIdentity = Boolean(hasCanonicalUrl && hasProviderId && !isGibberishTitle);
    const hasWeakCandidateOnly = Boolean(candidates.length > 0 && topCandidate && topCandidate.confidence < 0.75);
    const hasStrongCandidateAgreement = Boolean(candidates.length > 0 && topCandidate && topCandidate.confidence >= 0.75);

    let status: InfoVerificationStatus = 'verified';
    let statusLabel = 'Verified';
    let decisionReason = 'Strong multi-field agreement across catalogue, Rare Toon mapping, and external identity evidence.';

    if (preserveStatus === 'confirmed_fake') {
      status = 'confirmed_fake';
      statusLabel = 'Confirmed Fake';
      decisionReason = suspectedFakeReason || 'Confirmed fake / non-existent anime record.';
    } else if (preserveStatus === 'needs_review') {
      status = 'needs_review';
      statusLabel = 'Needs Review';
      decisionReason = 'Explicitly marked Needs Review by Owner.';
    } else if (preserveStatus === 'auto_fixed' && discrepancies.length === 0) {
      status = 'auto_fixed';
      statusLabel = 'Verified (Auto-Fixed)';
      decisionReason = 'High-confidence metadata fields repaired and verified.';
    } else if (checkedFields.suspectedFake === 'mismatch') {
      status = 'suspected_fake';
      statusLabel = suspectedFakeStrongEvidence ? 'Suspected Fake' : 'Suspected Fake / Needs Review';
      decisionReason = suspectedFakeReason || 'Suspected fake / non-existent anime requires Owner review.';
    } else if (duplicateTitles.length > 0) {
      status = 'duplicate';
      statusLabel =
        highestDuplicateClass === 'confirmed_duplicate'
          ? 'Confirmed Duplicate'
          : highestDuplicateClass === 'likely_duplicate'
            ? 'Suspected Duplicate'
            : 'Possible Duplicate';
      decisionReason = duplicateEvidence.join(' | ') || `Duplicate identity evidence matches ${duplicateTitles.join(', ')}.`;
    } else if (hasSourceConflict) {
      status = 'conflict';
      statusLabel = 'Conflict';
      decisionReason = `Trusted sources (${topCandidate?.source} vs ${secondCandidate?.source}) disagree on release year or airing status.`;
    } else {
      const hasMissing = Object.values(checkedFields).some(v => v === 'missing');
      const hasMismatch = Object.values(checkedFields).some(v => v === 'mismatch');

      if (hasWeakCandidateOnly && !hasVerifiedExternalId) {
        discrepancies.push({
          field: 'title',
          label: 'Insufficient External Evidence',
          severity: 'low',
          currentValue: anime.title,
          suggestedValue: topCandidate!.title,
          source: topCandidate!.source,
          message: `Only a weak candidate match (${Math.round(topCandidate!.confidence * 100)}%) was returned by ${topCandidate!.source}. Needs Owner review before marking Verified.`
        });
      }

      if (hasMismatch || (hasWeakCandidateOnly && !hasVerifiedExternalId)) {
        status = 'needs_review';
        statusLabel = 'Needs Review';
        decisionReason = hasWeakCandidateOnly
          ? `Uncertain anime identity: weak candidate confidence (${Math.round((topCandidate?.confidence || 0) * 100)}%) on ${topCandidate?.source} requires Owner review.`
          : `Field discrepancy detected (${discrepancies.map(d => d.label).join(', ')}).`;
      } else if (hasMissing) {
        status = 'missing_info';
        statusLabel = 'Missing Information';
        decisionReason = `Missing required metadata field(s): ${discrepancies.map(d => d.label).join(', ')}.`;
      } else if (hasStrongCandidateAgreement || hasVerifiedExternalId) {
        status = 'verified';
        statusLabel = 'Verified';
        decisionReason = hasStrongCandidateAgreement
          ? `Verified against ${topCandidate!.source} (${Math.round(topCandidate!.confidence * 100)}% agreement) and Rare Toon mapping.`
          : `Verified with canonical external ID (${resolvedMalId ? `MAL #${resolvedMalId}` : `AniList #${resolvedAniListId}`}) and complete Rare Toon metadata.`;
      } else if (Boolean((anime as any)._externalSourcesQueried) && candidates.length === 0 && !hasVerifiedExternalId && !hasVerifiedRareToonIdentity) {
        discrepancies.push({
          field: 'title',
          label: 'Insufficient External Evidence',
          severity: 'low',
          currentValue: anime.title,
          suggestedValue: anime.title,
          source: 'External Metadata Verifier',
          message: 'Uncertain anime identity: no external candidate matches and no canonical Rare Toon identity linked.'
        });
        status = 'needs_review';
        statusLabel = 'Needs Review';
        decisionReason = 'Uncertain anime identity: external sources returned 0 candidates and no external or Rare Toon canonical ID is linked.';
      } else {
        status = 'correct';
        statusLabel = 'Correct';
        decisionReason = 'Existing catalogue metadata and Rare Toon canonical identity are internally consistent.';
      }
    }

    // Calculate real multi-factor evidence confidence (0.0 to 0.99)
    let realConfidence = 0.50;
    if (topCandidate) {
      realConfidence = topCandidate.confidence;
      if (secondCandidate && secondCandidate.source !== topCandidate.source) {
        if (!hasSourceConflict && secondCandidate.confidence >= 0.75) {
          realConfidence = Math.min(0.99, realConfidence + 0.04);
        } else if (hasSourceConflict) {
          realConfidence = Math.min(0.65, realConfidence - 0.18);
        }
      }
    } else if (artMatch && typeof artMatch.similarityScore === 'number') {
      realConfidence = Math.min(0.97, Math.max(0.75, Number(artMatch.similarityScore)));
    } else if (hasVerifiedExternalId && hasProviderId && hasCanonicalUrl) {
      realConfidence = 0.92;
    } else if (hasProviderId && hasCanonicalUrl) {
      realConfidence = 0.84;
    }

    // Penalize confidence for each unresolved discrepancy
    for (const d of discrepancies) {
      if (d.severity === 'high') realConfidence -= 0.22;
      else if (d.severity === 'medium') realConfidence -= 0.12;
      else realConfidence -= 0.06;
    }
    if (status === 'suspected_fake' || status === 'confirmed_fake') {
      realConfidence = Math.min(realConfidence, 0.25);
    } else if (status === 'conflict') {
      realConfidence = Math.min(realConfidence, 0.62);
    } else if (status === 'needs_review' && hasWeakCandidateOnly) {
      realConfidence = Math.min(realConfidence, topCandidate?.confidence || 0.55);
    }
    realConfidence = Number(Math.max(0.05, Math.min(0.99, realConfidence)).toFixed(2));

    const sourcesChecked = Array.from(
      new Set([
        'Zenime Catalogue Audit',
        'RareToon Mapping Verifier',
        ...(resolvedMalId ? ['MyAnimeList'] : []),
        ...(resolvedAniListId ? ['AniList'] : []),
        ...candidates.map(c => c.source)
      ])
    );

    // Populate structured Review Queue metadata on each discrepancy and build reviewQueueReasons
    const reviewQueueReasons: InfoReviewQueueReason[] = [];
    for (const d of discrepancies) {
      const itemSources = Array.from(new Set([d.source, ...sourcesChecked].filter(Boolean)));
      d.proposedValue = d.suggestedValue;
      d.evidence = d.message;
      d.sources = itemSources;
      d.confidence = realConfidence;
      d.reasonForReview = `${d.label}: ${d.message} (Confidence: ${Math.round(realConfidence * 100)}%)`;
      reviewQueueReasons.push({
        field: d.field,
        currentValue: d.currentValue,
        proposedValue: d.suggestedValue,
        evidence: d.message,
        sources: itemSources,
        confidence: realConfidence,
        reasonForReview: d.reasonForReview
      });
    }

    const summaryMessage =
      discrepancies.length === 0
        ? 'All anime metadata, episodes, franchise links, and RareToon mappings verified and consistent.'
        : `${discrepancies.length} issue(s) found: ${discrepancies.map(d => d.label).join(', ')}.`;

    return {
      animeId: anime.id,
      animeTitle: anime.title,
      status,
      statusLabel,
      confidence: realConfidence,
      source: topCandidate?.source || (resolvedMalId ? 'MyAnimeList + RareToon Verifier' : resolvedAniListId ? 'AniList + RareToon Verifier' : 'RareToon + Catalogue Verifier'),
      sourcesChecked,
      lastVerifiedAt: new Date().toISOString(),
      decisionReason,
      externalIds: {
        aniListId: resolvedAniListId,
        malId: resolvedMalId,
        tvmazeId: resolvedTvmazeId
      },
      discrepancies,
      reviewQueueReasons,
      duplicateOfIds: duplicateIds,
      duplicateTitles,
      duplicateEvidence,
      duplicateClassification: highestDuplicateClass,
      suspectedFakeReason,
      suspectedFakeStrongEvidence,
      candidates,
      checkedFields,
      summaryMessage
    };
  }

  /**
   * Compute real multi-factor candidate confidence from title similarity, external ID match,
   * release year agreement, format/type agreement, and episode/status alignment.
   */
  private scoreCandidateConfidence(
    anime: any,
    searchQuery: string,
    candidate: {
      sourceId?: string | number;
      malId?: number;
      titles: string[];
      type?: string;
      releaseYear?: number;
      totalEpisodes?: number;
      status?: string;
    }
  ): number {
    let bestSim = 0;
    const referenceTitles = [searchQuery, anime.title, anime.alternateTitle, anime.japaneseTitle]
      .filter((t): t is string => Boolean(t && typeof t === 'string' && t.trim()))
      .map(t => t.trim());

    for (const candTitle of candidate.titles) {
      if (!candTitle) continue;
      for (const refTitle of referenceTitles) {
        const sim = calculateStringSimilarity(refTitle, candTitle);
        if (sim > bestSim) bestSim = sim;
      }
    }

    let score = bestSim;

    // External ID exact agreement bonus (Identity Priority: 1. MAL/Jikan ID, 2. AniList ID)
    const hasExactMalId = Boolean(
      anime.malId &&
      ((candidate.malId && Number(anime.malId) === Number(candidate.malId)) ||
        (candidate.sourceId && Number(anime.malId) === Number(candidate.sourceId)))
    );
    const hasExactAniListId = Boolean(anime.aniListId && candidate.sourceId && Number(anime.aniListId) === Number(candidate.sourceId));
    if (hasExactMalId) {
      score = Math.max(score, 0.92) + 0.06;
    } else if (hasExactAniListId) {
      score = Math.max(score, 0.91) + 0.06;
    }

    // Release year agreement / disagreement (penalize wrong decade/original when title is a Remake)
    const titleIsExplicitRemakeOrYear = /\b(?:remake|19\d\d|20\d\d)\b/i.test(anime.title || '');
    if (anime.releaseYear && candidate.releaseYear) {
      const yrDiff = Math.abs(Number(anime.releaseYear) - Number(candidate.releaseYear));
      if (yrDiff === 0) score += 0.05;
      else if (yrDiff === 1) score += 0.02;
      else if (yrDiff >= 3 && titleIsExplicitRemakeOrYear && !hasExactMalId && !hasExactAniListId) score -= 0.30;
      else if (yrDiff >= 10 && (!Array.isArray(anime.seasons) || anime.seasons.length <= 1) && !hasExactMalId && !hasExactAniListId) score -= 0.22;
      else if (yrDiff >= 4 && (!Array.isArray(anime.seasons) || anime.seasons.length <= 1)) score -= 0.10;
    }

    // Format / Type agreement
    if (anime.type && candidate.type) {
      if (anime.type === candidate.type) {
        score += 0.03;
      } else if ((anime.type === 'Movie' && candidate.type === 'TV') || (anime.type === 'TV' && candidate.type === 'Movie')) {
        score -= 0.12;
      }
    }

    return Number(Math.max(0.05, Math.min(0.99, score)).toFixed(2));
  }

  /**
   * Query AniList and Jikan (MyAnimeList) + cached RareToon/AniList identity for anime metadata candidates.
   * Tracks temporary API/network/timeout/rate-limit failures so workers retry instead of marking Needs Review.
   */
  public async fetchExternalMetadataCandidates(anime: any): Promise<InfoMetadataCandidate[]> {
    const cleanedInfo = cleanAnimeTitle(anime.title || '');
    const hasRemakeYearInTitle = /\b(?:remake|20\d\d)\b/i.test(anime.title || '');
    const searchQuery = hasRemakeYearInTitle
      ? (anime.title || '').replace(/\b(?:hindi|tamil|telugu|dubbed|subbed|download|watch\s+online)\b/gi, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
      : (cleanedInfo.cleaned || anime.title || '');
    const candidates: InfoMetadataCandidate[] = [];
    const diag = {
      hadTransientFailure: false,
      sourcesAttempted: [] as string[],
      sourcesSucceeded: [] as string[],
      errors: [] as string[]
    };

    // 1. Query AniList GraphQL for rich metadata + external IDs + franchise relations
    diag.sourcesAttempted.push('AniList');
    try {
      const query = `
        query ($search: String) {
          Page (page: 1, perPage: 4) {
            media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
              id
              idMal
              title {
                romaji
                english
                native
              }
              synonyms
              format
              status
              seasonYear
              startDate {
                year
                month
                day
              }
              episodes
              genres
              description(asHtml: false)
              relations {
                edges {
                  relationType
                  node {
                    id
                    type
                    format
                    title {
                      english
                      romaji
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const gatewayRes = await globalSourceGateway.executeRequest<any>(
        'anilist',
        `info:${searchQuery.toLowerCase().trim()}`,
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 7500);
          try {
            const res = await fetch('https://graphql.anilist.co', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Zenime-Info-Manager/2.0'
              },
              body: JSON.stringify({ query, variables: { search: searchQuery } }),
              signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) {
              return { success: false, matches: [], statusCode: res.status, error: `AniList HTTP ${res.status}` };
            }
            const data = await res.json();
            return { success: true, matches: data?.data?.Page?.media || [], statusCode: 200 };
          } catch (err: any) {
            clearTimeout(timer);
            return { success: false, matches: [], error: err.message };
          }
        }
      );

      if (gatewayRes.success && Array.isArray(gatewayRes.matches)) {
        diag.sourcesSucceeded.push('AniList');
        for (const m of gatewayRes.matches) {
          const eng = m.title?.english || '';
          const rom = m.title?.romaji || '';
          const nat = m.title?.native || '';
          const mappedType = mapAniListFormat(m.format);
          const mappedStatus = mapAniListStatus(m.status);
          const releaseYear = m.seasonYear || m.startDate?.year || undefined;
          const totalEpisodes = typeof m.episodes === 'number' && m.episodes > 0 ? m.episodes : undefined;

          const confidence = this.scoreCandidateConfidence(anime, searchQuery, {
            sourceId: m.id,
            malId: m.idMal || undefined,
            titles: [eng, rom, nat, ...(Array.isArray(m.synonyms) ? m.synonyms : [])],
            type: mappedType,
            releaseYear,
            totalEpisodes,
            status: mappedStatus
          });

          const startDateStr =
            m.startDate?.year
              ? `${m.startDate.year}-${String(m.startDate.month || 1).padStart(2, '0')}-${String(m.startDate.day || 1).padStart(2, '0')}`
              : null;

          const relEdges = Array.isArray(m.relations?.edges) ? m.relations.edges : [];
          const relatedAnime: string[] = [];
          const franchiseRelationships: string[] = [];
          for (const edge of relEdges) {
            if (!edge?.node || edge.node.type !== 'ANIME') continue;
            const relTitle = edge.node.title?.english || edge.node.title?.romaji;
            if (!relTitle) continue;
            const relType = String(edge.relationType || 'RELATED').replace(/_/g, ' ');
            relatedAnime.push(relTitle);
            franchiseRelationships.push(`${relType}: ${relTitle} (${edge.node.format || 'TV'})`);
          }

          candidates.push({
            source: 'AniList',
            sourceId: m.id,
            malId: m.idMal || undefined,
            confidence,
            title: eng || rom || searchQuery,
            alternateTitle: rom && rom !== eng ? rom : (Array.isArray(m.synonyms) && m.synonyms[0]) || null,
            japaneseTitle: nat || rom || null,
            type: mappedType,
            status: mappedStatus,
            releaseYear,
            releaseDate: startDateStr,
            totalEpisodes,
            genres: Array.isArray(m.genres) ? m.genres : undefined,
            synopsis: stripHtmlTags(m.description),
            relatedAnime: relatedAnime.slice(0, 8),
            franchiseRelationships: franchiseRelationships.slice(0, 8)
          });
        }
      } else {
        diag.hadTransientFailure = true;
        diag.errors.push(gatewayRes.error || `AniList status ${gatewayRes.statusCode || 'unavailable'}`);
      }
    } catch (err: any) {
      diag.hadTransientFailure = true;
      diag.errors.push(`AniList error: ${err.message}`);
    }

    // 2. Cross-check with Jikan / MyAnimeList (preferring malId when available, or searchQuery)
    diag.sourcesAttempted.push('MyAnimeList');
    try {
      const knownMalId = Number(anime.malId || (candidates[0]?.malId ?? 0)) || null;
      const jikanCacheKey = knownMalId
        ? `info_jikan_id:${knownMalId}`
        : `info_jikan_q:${searchQuery.toLowerCase().trim()}`;

      const jikanRes = await globalSourceGateway.executeRequest<any>(
        'jikan',
        jikanCacheKey,
        async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 7000);
          try {
            const url = knownMalId
              ? `https://api.jikan.moe/v4/anime/${knownMalId}`
              : `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchQuery)}&limit=3`;
            const res = await fetch(url, {
              headers: { Accept: 'application/json', 'User-Agent': 'Zenime-Info-Manager/2.0' },
              signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) {
              return { success: false, matches: [], statusCode: res.status, error: `Jikan HTTP ${res.status}` };
            }
            const data = await res.json();
            const list = knownMalId ? (data?.data ? [data.data] : []) : (Array.isArray(data?.data) ? data.data : []);
            return { success: true, matches: list, statusCode: 200 };
          } catch (err: any) {
            clearTimeout(timer);
            return { success: false, matches: [], error: err.message };
          }
        }
      );

      if (jikanRes.success && Array.isArray(jikanRes.matches)) {
        diag.sourcesSucceeded.push('MyAnimeList');
        for (const m of jikanRes.matches) {
          if (!m || !m.mal_id) continue;
          const eng = m.title_english || '';
          const defTitle = m.title || '';
          const jap = m.title_japanese || '';
          const mappedType = mapJikanFormat(m.type);
          const mappedStatus = mapJikanStatus(m.status);
          const releaseYear =
            m.year ||
            (m.aired?.prop?.from?.year ? Number(m.aired.prop.from.year) : undefined) ||
            (m.aired?.from ? parseInt(String(m.aired.from).slice(0, 4), 10) : undefined);
          const totalEpisodes = typeof m.episodes === 'number' && m.episodes > 0 ? m.episodes : undefined;

          const confidence = this.scoreCandidateConfidence(anime, searchQuery, {
            sourceId: m.mal_id,
            malId: m.mal_id,
            titles: [eng, defTitle, jap, ...(Array.isArray(m.title_synonyms) ? m.title_synonyms : [])].filter(Boolean),
            type: mappedType,
            releaseYear,
            totalEpisodes,
            status: mappedStatus
          });
          if (confidence < 0.50) continue;

          const genres = Array.isArray(m.genres)
            ? m.genres.map((g: any) => g?.name).filter(Boolean)
            : undefined;

          candidates.push({
            source: 'MyAnimeList',
            sourceId: m.mal_id,
            malId: m.mal_id,
            confidence,
            title: eng || defTitle || searchQuery,
            alternateTitle: defTitle && defTitle !== eng ? defTitle : null,
            japaneseTitle: jap || defTitle || null,
            type: mappedType,
            status: mappedStatus,
            releaseYear,
            releaseDate: m.aired?.from ? String(m.aired.from).slice(0, 10) : null,
            totalEpisodes,
            genres: genres && genres.length > 0 ? genres : undefined,
            synopsis: stripHtmlTags(m.synopsis)
          });
        }
      } else {
        diag.hadTransientFailure = true;
        diag.errors.push(jikanRes.error || `Jikan status ${jikanRes.statusCode || 'unavailable'}`);
      }
    } catch (err: any) {
      diag.hadTransientFailure = true;
      diag.errors.push(`Jikan error: ${err.message}`);
    }

    // 3. Always include cached verified AniList match from artwork-verification-records if no AniList candidate was returned
    if (!candidates.some(c => c.source === 'AniList')) {
      const artMatch = this.artworkAniListMatches.get(anime.id);
      if (artMatch && artMatch.id) {
        const eng = artMatch.title?.english || '';
        const rom = artMatch.title?.romaji || '';
        const mappedType = mapAniListFormat(artMatch.format);
        const confidence = this.scoreCandidateConfidence(anime, searchQuery, {
          sourceId: artMatch.id,
          titles: [eng, rom].filter(Boolean),
          type: mappedType,
          releaseYear: artMatch.seasonYear || undefined
        });
        candidates.push({
          source: 'AniList',
          sourceId: artMatch.id,
          confidence,
          title: eng || rom || anime.title,
          alternateTitle: rom && rom !== eng ? rom : null,
          japaneseTitle: rom || null,
          type: mappedType,
          releaseYear: artMatch.seasonYear || anime.releaseYear || undefined
        });
      }
    }

    if (anime?.id) {
      this.lastFetchDiagnostics.set(anime.id, diag);
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }

  /**
   * Compute authoritative global statistics for Information Manager
   */
  public computeGlobalStats(): InfoManagerStats {
    const catalogue = globalDataStore.getAllCatalogueAnime();
    const duplicateMap = this.buildDuplicateIndex(catalogue);

    let totalSeasons = 0;
    let totalAuthoritativeEpisodes = 0;
    let totalImportedEpisodes = 0;
    let verified = 0;
    let correct = 0;
    let autoFixed = 0;
    let needsReview = 0;
    let conflicts = 0;
    let duplicates = 0;
    let suspectedFake = 0;
    let confirmedFake = 0;
    let missingInfo = 0;
    let episodeMismatch = 0;
    let unverified = 0;

    for (const h of this.historyList) {
      if (h.source === 'Owner Confirmed Fake Deletion' || h.reason?.includes('Confirmed Fake')) {
        confirmedFake++;
      }
    }

    for (const anime of catalogue) {
      const seasonsArr = Array.isArray(anime.seasons) ? anime.seasons : [];
      totalSeasons += seasonsArr.length || anime.totalSeasons || 1;
      totalAuthoritativeEpisodes += Number(anime.authoritativeTotalEpisodes ?? anime.totalEpisodes ?? 0);
      totalImportedEpisodes += Number(
        anime.importedEpisodesCount ??
          seasonsArr.reduce((acc: number, s: any) => acc + (Array.isArray(s.episodes) ? s.episodes.length : 0), 0)
      );

      const rec = this.recordsMap.get(anime.id);
      const hasDup = (duplicateMap.get(anime.id) || []).length > 0;
      if (hasDup) duplicates++;

      if (!rec) {
        unverified++;
        continue;
      }

      if (
        rec.checkedFields?.totalEpisodes !== 'ok' ||
        rec.checkedFields?.seasonEpisodes !== 'ok' ||
        rec.checkedFields?.seasonsCount !== 'ok'
      ) {
        episodeMismatch++;
      }

      if (rec.status === 'verified') {
        verified++;
        correct++;
      } else if (rec.status === 'correct') {
        verified++;
        correct++;
      } else if (rec.status === 'auto_fixed') {
        verified++;
        correct++;
        autoFixed++;
      } else if (rec.status === 'suspected_fake') {
        suspectedFake++;
        needsReview++;
      } else if (rec.status === 'confirmed_fake') {
        confirmedFake++;
        needsReview++;
      } else if (rec.status === 'conflict') {
        conflicts++;
        needsReview++;
      } else if (rec.status === 'duplicate') {
        needsReview++;
      } else if (rec.status === 'needs_review') {
        needsReview++;
      } else if (rec.status === 'missing_info') {
        missingInfo++;
      } else {
        unverified++;
      }
    }

    return {
      total: catalogue.length,
      totalSeasons,
      totalAuthoritativeEpisodes,
      totalImportedEpisodes,
      verified,
      correct,
      autoFixed,
      needsReview,
      conflicts,
      duplicates,
      suspectedFake,
      confirmedFake,
      missingInfo,
      episodeMismatch,
      unverified,
      historyCount: this.historyList.length
    };
  }

  public getJobState(): InfoScanJobState {
    const infoSnap = globalWorkerJobEngine.getSnapshot('INFORMATION_VERIFICATION');
    const sharedSnap = globalWorkerJobEngine.getSnapshot();
    const activeInfoWorker = sharedSnap.workers.find(
      w => w.jobSystem === 'INFORMATION_VERIFICATION' && (w.status === 'working' || w.status === 'busy' || w.status === 'claiming')
    );

    const hasActiveInfoTasks = infoSnap.queuedCount > 0 || infoSnap.claimedCount > 0 || infoSnap.retryingCount > 0;
    let derivedStatus = this.scanState.status;
    if (hasActiveInfoTasks) {
      derivedStatus = sharedSnap.status === 'paused' ? 'paused' : 'running';
    } else if (derivedStatus === 'running' && infoSnap.totalTasks > 0 && infoSnap.processedCount >= infoSnap.totalTasks) {
      derivedStatus = 'completed';
    }

    return {
      ...this.scanState,
      status: derivedStatus,
      totalCount: infoSnap.totalTasks > 0 ? infoSnap.totalTasks : this.scanState.totalCount,
      processedCount: infoSnap.totalTasks > 0 ? infoSnap.processedCount : this.scanState.processedCount,
      progressPercent: infoSnap.totalTasks > 0 ? infoSnap.progressPercent : this.scanState.progressPercent,
      currentAnimeId: activeInfoWorker?.currentAnimeId || this.scanState.currentAnimeId,
      currentAnimeTitle: activeInfoWorker?.currentAnimeTitle || this.scanState.currentAnimeTitle,
      lastLog: infoSnap.lastLog || this.scanState.lastLog,
      globalStats: this.computeGlobalStats(),
      workerSnapshot: infoSnap,
      sharedWorkerSnapshot: sharedSnap
    };
  }

  /**
   * Run instant full-catalogue audit across all 19 metadata categories
   */
  public inspectAllCatalogue(operatorEmail: string): {
    stats: InfoManagerStats;
    inspectedCount: number;
  } {
    const catalogue = globalDataStore.getAllCatalogueAnime();
    const catalogueById = new Map<string, any>();
    for (const a of catalogue) {
      if (a && a.id) catalogueById.set(a.id, a);
    }
    const duplicateMap = this.buildDuplicateIndex(catalogue);

    for (const anime of catalogue) {
      const existing = this.recordsMap.get(anime.id);
      const dupIds = duplicateMap.get(anime.id) || [];
      const sanitizedCandidates = this.sanitizePersistedCandidates(anime, existing?.candidates || []);
      const evaluated = this.evaluateAnimeMetadata(
        anime,
        dupIds,
        catalogueById,
        sanitizedCandidates,
        existing?.status === 'auto_fixed' ? 'auto_fixed' : undefined
      );
      this.recordsMap.set(anime.id, evaluated);
    }

    this.saveRecordsToDisk(true);
    this.scanState.updatedAt = new Date().toISOString();
    this.scanState.lastLog = `Inspected all ${catalogue.length} anime records across 19 metadata & mapping checks.`;

    logAdminAction(
      'Information Manager: Inspect All Catalogue',
      operatorEmail,
      'success',
      undefined,
      `Audited ${catalogue.length} anime entries for title, seasons, episodes, duplicates, status, type, year, genres, languages, synopsis, story, franchise relations, RareToon mapping, and fake checks.`
    );

    return {
      stats: this.computeGlobalStats(),
      inspectedCount: catalogue.length
    };
  }

  /**
   * Verify a single anime against trusted external metadata sources with confidence-based auto-resolution
   */
  public async verifySingleAnime(
    animeId: string,
    autoFixMissing: boolean,
    operatorEmail: string,
    workerId?: number
  ): Promise<InfoVerificationRecord | null> {
    const anime = globalDataStore.getCatalogueAnime(animeId);
    if (!anime) return null;

    if (workerId) {
      globalWorkerJobEngine.updateWorkerStep(workerId, 'AniList / TVMaze', 'Searching trusted metadata sources');
      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        jobSystem: 'INFORMATION_VERIFICATION',
        animeId,
        animeTitle: anime.title,
        operation: 'Information Verification',
        eventType: 'source_searched',
        source: 'AniList + TVMaze',
        step: 'Querying metadata & franchise relations',
        details: `Searching metadata candidates for "${anime.title}"`
      });
    }

    const catalogue = globalDataStore.getAllCatalogueAnime();
    const catalogueById = new Map<string, any>();
    for (const a of catalogue) {
      if (a && a.id) catalogueById.set(a.id, a);
    }
    const duplicateMap = this.buildDuplicateIndex(catalogue);
    const dupIds = duplicateMap.get(animeId) || [];

    const candidates = await this.fetchExternalMetadataCandidates(anime);
    const fetchDiag = this.lastFetchDiagnostics.get(animeId);
    const prevRec = this.recordsMap.get(animeId);

    // Rule 1: Temporary API/network/timeout/rate-limit failure -> RETRY -> NEVER immediately mark Needs Review!
    if (
      candidates.length === 0 &&
      fetchDiag?.hadTransientFailure &&
      fetchDiag.sourcesSucceeded.length === 0 &&
      !anime.aniListId &&
      !anime.malId
    ) {
      const transientErrorMsg =
        fetchDiag.errors.join('; ') || 'Temporary metadata API timeout/rate-limit — scheduled for retry.';
      const fallbackRecord = this.evaluateAnimeMetadata(
        anime,
        dupIds,
        catalogueById,
        prevRec?.candidates ? this.sanitizePersistedCandidates(anime, prevRec.candidates) : [],
        prevRec?.status === 'auto_fixed' ? 'auto_fixed' : undefined
      );
      fallbackRecord.attemptCount = (prevRec?.attemptCount || 0) + 1;
      fallbackRecord.lastAttemptAt = new Date().toISOString();
      fallbackRecord.lastError = transientErrorMsg;
      fallbackRecord.retryPending = true;
      fallbackRecord.decisionReason = `Temporary source failure (${transientErrorMsg}) — queued for automatic retry without marking Needs Review.`;
      this.recordsMap.set(animeId, fallbackRecord);
      this.saveRecordsToDisk();
      return fallbackRecord;
    }

    const top = candidates[0];
    const second = candidates[1];

    // Check if two high-confidence sources genuinely conflict on release year or status
    const hasHighConfidenceSourceConflict = Boolean(
      top &&
      second &&
      top.source !== second.source &&
      top.confidence >= 0.78 &&
      second.confidence >= 0.78 &&
      ((top.releaseYear && second.releaseYear && Math.abs(top.releaseYear - second.releaseYear) >= 2) ||
        (top.status && second.status && top.status !== second.status))
    );

    if (workerId) {
      globalWorkerJobEngine.updateWorkerStep(
        workerId,
        top?.source || 'Catalogue Audit',
        'Cross-checking 19 metadata & RareToon dimensions'
      );
      globalWorkerJobEngine.recordActivityEvent({
        workerId,
        jobSystem: 'INFORMATION_VERIFICATION',
        animeId,
        animeTitle: anime.title,
        operation: 'Information Verification',
        eventType: 'info_checked',
        source: top?.source || 'Catalogue Audit',
        step: 'Evaluating metadata evidence',
        details: top
          ? `Matched "${top.title}" on ${top.source} (${Math.round(top.confidence * 100)}% confidence)`
          : 'Evaluated internal catalogue & RareToon mapping'
      });
    }

    // Confidence-based Smart Auto-Resolution (Rule 7: Strong evidence of an incorrect field -> safely AUTO-FIX that field):
    let didAutoFix = false;
    const updates: Record<string, any> = {};
    const cleanedTitleInfo = cleanAnimeTitle(anime.title || '');

    // 0. Link verified external IDs (Identity Priority: 1. MAL/Jikan ID, 2. AniList ID)
    if (top && top.confidence >= 0.85) {
      if (!anime.malId && top.malId) {
        updates.malId = Number(top.malId);
      } else if (!anime.malId && top.source === 'MyAnimeList' && top.sourceId) {
        updates.malId = Number(top.sourceId);
      }
      if (!anime.aniListId && top.source === 'AniList' && top.sourceId) {
        updates.aniListId = Number(top.sourceId);
      }
    }

    // 1. Clean scraping noise from title when clean title is unambiguous
    if (
      /\b(?:download|watch\s+online|1080p|720p|480p|all\s+episodes\s+hindi)\b/i.test(anime.title || '') &&
      cleanedTitleInfo.cleaned &&
      cleanedTitleInfo.cleaned.length >= 1 &&
      cleanedTitleInfo.cleaned !== anime.title &&
      dupIds.length === 0
    ) {
      updates.title = top && top.confidence >= 0.88 ? top.title : cleanedTitleInfo.cleaned;
    }

    // 2. Fill missing Japanese / Alternate title only when a trusted source provides a distinct title
    const hasAlt = Boolean((anime.alternateTitle && anime.alternateTitle.trim()) || (anime.japaneseTitle && anime.japaneseTitle.trim()));
    if (!hasAlt && top && top.confidence >= 0.75 && (top.alternateTitle || top.japaneseTitle)) {
      const candidateAlt = String(top.alternateTitle || top.japaneseTitle).trim();
      if (candidateAlt && candidateAlt.toLowerCase() !== (anime.title || '').trim().toLowerCase()) {
        updates.alternateTitle = candidateAlt;
      }
      if (top.japaneseTitle && top.japaneseTitle.trim()) {
        updates.japaneseTitle = top.japaneseTitle.trim();
      }
    }

    // 3. Synchronize totalSeasons and non-destructive season episode counts
    // CRITICAL EPISODE RULE: Never reduce authoritative episodeCount to episodes.length when episodes[] is a partial list!
    const seasonsArr = Array.isArray(anime.seasons) ? anime.seasons : [];
    if (seasonsArr.length > 0 && anime.totalSeasons !== seasonsArr.length) {
      updates.totalSeasons = seasonsArr.length;
    }
    if (seasonsArr.length > 0) {
      let seasonsChanged = false;
      const fixedSeasons = seasonsArr.map((s: any) => {
        const epLen = Array.isArray(s.episodes) ? s.episodes.length : 0;
        const currentAuth =
          typeof s.authoritativeEpisodeCount === 'number' && s.authoritativeEpisodeCount > 0
            ? s.authoritativeEpisodeCount
            : typeof s.episodeCount === 'number' && s.episodeCount > 0
            ? s.episodeCount
            : Math.max(1, epLen);
        const nextAuth = Math.max(currentAuth, epLen);
        const isComplete = nextAuth > 0 && epLen >= nextAuth;
        const listStatus = epLen === 0 ? 'empty' : isComplete ? 'complete' : 'partial';
        if (
          s.episodeCount !== nextAuth ||
          s.authoritativeEpisodeCount !== nextAuth ||
          s.importedEpisodeCount !== epLen ||
          s.isEpisodeListComplete !== isComplete ||
          s.episodeListStatus !== listStatus
        ) {
          seasonsChanged = true;
          return {
            ...s,
            episodeCount: nextAuth,
            authoritativeEpisodeCount: nextAuth,
            importedEpisodeCount: epLen,
            isEpisodeListComplete: isComplete,
            episodeListStatus: listStatus
          };
        }
        return s;
      });
      if (seasonsChanged) {
        updates.seasons = fixedSeasons;
      }
    }

    // 4. Synchronize totalEpisodes from seasons sum or high-confidence candidate
    const effectiveSeasons = updates.seasons || seasonsArr;
    const seasonEpSum = effectiveSeasons.reduce((acc: number, s: any) => {
      const c = typeof s.episodeCount === 'number' && s.episodeCount > 0
        ? s.episodeCount
        : (Array.isArray(s.episodes) ? s.episodes.length : 0);
      return acc + c;
    }, 0);

    if ((!anime.totalEpisodes || anime.totalEpisodes <= 0) && (seasonEpSum > 0 || (top && top.confidence >= 0.78 && top.totalEpisodes))) {
      updates.totalEpisodes = seasonEpSum > 0 ? seasonEpSum : top!.totalEpisodes;
    } else if (seasonEpSum > 0 && anime.totalEpisodes !== seasonEpSum) {
      updates.totalEpisodes = seasonEpSum;
    } else if (
      seasonEpSum === 0 &&
      effectiveSeasons.length <= 1 &&
      top &&
      top.confidence >= 0.88 &&
      top.totalEpisodes &&
      anime.totalEpisodes !== top.totalEpisodes
    ) {
      updates.totalEpisodes = top.totalEpisodes;
    }

    // 5. High-confidence Airing Status resolution (STATUS RULE: never use year alone; auto-fix when reliable sources agree without conflict)
    const currentYear = new Date().getFullYear();
    const yr = Number(anime.releaseYear);
    const isTopReliableAnimeSource = Boolean(top && (top.source === 'AniList' || top.source === 'MyAnimeList'));
    const matchesSameEraAndScope = Boolean(
      effectiveSeasons.length <= 1 &&
      (anime.totalEpisodes || 0) <= 100 &&
      (!top?.releaseYear || !yr || Math.abs(yr - top.releaseYear) <= 2)
    );
    if (!hasHighConfidenceSourceConflict) {
      if (!['Completed', 'Ongoing', 'Upcoming'].includes(anime.status)) {
        updates.status = top?.status || 'Completed';
      } else if (
        isTopReliableAnimeSource &&
        matchesSameEraAndScope &&
        top &&
        top.confidence >= 0.88 &&
        top.status &&
        anime.status !== top.status &&
        (!second || second.status === top.status)
      ) {
        updates.status = top.status;
      }
    }

    // 6. High-confidence Release Year resolution (when no cross-source conflict and title doesn't specify its own remake year)
    const titleHasExplicitYear = Boolean(yr && new RegExp(`\\b${yr}\\b`).test(anime.title || ''));
    if (!hasHighConfidenceSourceConflict) {
      if ((!yr || isNaN(yr) || yr < 1950 || yr > currentYear + 2) && top?.releaseYear) {
        updates.releaseYear = top.releaseYear;
      } else if (
        isTopReliableAnimeSource &&
        !titleHasExplicitYear &&
        effectiveSeasons.length <= 1 &&
        top &&
        top.confidence >= 0.88 &&
        top.releaseYear &&
        Math.abs(yr - top.releaseYear) >= 2
      ) {
        updates.releaseYear = top.releaseYear;
      }
    }

    // 7. High-confidence Anime Type resolution
    const titleIndicatesMovie = /\b(?:movie|film)\b/i.test(anime.title || '') && !/\b(?:series|season)\b/i.test(anime.title || '');
    const titleIndicatesOva = /\b(?:ova|oad)\b/i.test(anime.title || '');
    const isCompatibleStreamingSeries = Boolean(
      top?.type && ((anime.type === 'TV' && top.type === 'ONA') || (anime.type === 'ONA' && top.type === 'TV'))
    );
    if (!['TV', 'Movie', 'OVA', 'ONA', 'Special'].includes(anime.type)) {
      updates.type = top?.type || (titleIndicatesMovie ? 'Movie' : 'TV');
    } else if (titleIndicatesMovie && anime.type === 'TV' && (anime.totalEpisodes || 0) <= 1) {
      updates.type = 'Movie';
    } else if (titleIndicatesOva && anime.type !== 'OVA') {
      updates.type = 'OVA';
    } else if (isTopReliableAnimeSource && !isCompatibleStreamingSeries && top && top.confidence >= 0.90 && top.type && anime.type !== top.type && !titleIndicatesMovie) {
      updates.type = top.type;
    }

    // 8. Missing Genres, Languages, Synopsis, Franchise Relationships
    if ((!Array.isArray(anime.genres) || anime.genres.length === 0) && top && top.confidence >= 0.75 && Array.isArray(top.genres) && top.genres.length > 0) {
      updates.genres = top.genres;
    }
    const detectedLangs = extractLanguagesFromAnime(anime);
    if ((!Array.isArray(anime.languages) || anime.languages.length === 0) && detectedLangs.length > 0) {
      updates.languages = detectedLangs;
    }
    const syn = (anime.synopsis || '').trim();
    if ((!syn || syn.length < 30 || /no synopsis available|description coming soon|placeholder/i.test(syn)) && top && top.confidence >= 0.75 && top.synopsis && top.synopsis.length >= 30) {
      updates.synopsis = top.synopsis;
    }
    if ((!Array.isArray(anime.relatedAnime) || anime.relatedAnime.length === 0) && top && top.confidence >= 0.78 && Array.isArray(top.relatedAnime) && top.relatedAnime.length > 0) {
      updates.relatedAnime = top.relatedAnime;
    }
    if (
      (!Array.isArray(anime.franchiseRelationships) || anime.franchiseRelationships.length === 0) &&
      top &&
      top.confidence >= 0.78 &&
      Array.isArray(top.franchiseRelationships) &&
      top.franchiseRelationships.length > 0
    ) {
      updates.franchiseRelationships = top.franchiseRelationships;
    }

    // 9. Missing RareToon providerAnimeId when canonicalUrl exists
    const rtProv = anime.providers?.raretoonIndia;
    if ((!rtProv?.providerAnimeId || !String(rtProv.providerAnimeId).trim()) && cleanedTitleInfo.cleaned) {
      updates.providerAnimeId = `rt-${cleanedTitleInfo.cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    }

    if (autoFixMissing && Object.keys(updates).length > 0 && dupIds.length === 0) {
      const sourceName = top ? `${top.source} (${Math.round(top.confidence * 100)}% match)` : 'Internal Consistency Verifier';
      this.applyMetadataUpdate(
        animeId,
        updates,
        operatorEmail,
        `High-confidence worker verification & auto-repair (${Object.keys(updates).join(', ')})`,
        sourceName,
        'auto_fixed'
      );
      didAutoFix = true;
      if (workerId) {
        globalWorkerJobEngine.recordActivityEvent({
          workerId,
          jobSystem: 'INFORMATION_VERIFICATION',
          animeId,
          animeTitle: anime.title,
          operation: 'Information Auto-Fix',
          eventType: 'info_saved',
          source: top?.source || 'Internal Verifier',
          step: 'Saved high-confidence metadata corrections',
          details: `Auto-resolved fields: ${Object.keys(updates).join(', ')}`
        });
      }
    }

    const updatedAnime = { ...(globalDataStore.getCatalogueAnime(animeId) || anime), _externalSourcesQueried: true };
    const record = this.evaluateAnimeMetadata(
      updatedAnime,
      dupIds,
      catalogueById,
      candidates,
      didAutoFix ? 'auto_fixed' : undefined
    );
    record.attemptCount = (prevRec?.attemptCount || 0) + 1;
    record.lastAttemptAt = new Date().toISOString();
    record.lastError = null;
    record.retryPending = false;

    this.recordsMap.set(animeId, record);
    this.saveRecordsToDisk();
    return record;
  }

  /**
   * Shared Worker Processor for INFORMATION_VERIFICATION tasks
   */
  public async processTaskByWorker(task: JobTask, workerId: number): Promise<any> {
    const animeId = task.animeId;
    const autoFix = Boolean(task.payload?.autoFix ?? true);
    const operatorEmail = task.payload?.operatorEmail || 'Owner';

    const record = await this.verifySingleAnime(animeId, autoFix, operatorEmail, workerId);
    if (!record) {
      return {
        status: 'unable_to_verify',
        summary: `Anime ${animeId} not found in catalogue.`
      };
    }

    // Rule 1: If verification encountered a temporary source failure, throw so the shared worker pool retries with backoff
    if (record.retryPending && record.lastError) {
      throw new Error(record.lastError);
    }

    this.scanState.currentAnimeId = record.animeId;
    this.scanState.currentAnimeTitle = record.animeTitle;
    this.scanState.updatedAt = new Date().toISOString();
    this.scanState.lastLog = `[Worker #${String(workerId).padStart(2, '0')}] Verified "${record.animeTitle}" → ${record.statusLabel}`;

    return {
      status: record.status,
      statusLabel: record.statusLabel,
      confidence: record.confidence,
      source: record.source,
      summary: record.summaryMessage
    };
  }

  /**
   * Apply verified or manual metadata updates to an anime and record full before/after history
   */
  public applyMetadataUpdate(
    animeId: string,
    updates: Record<string, any>,
    operatorEmail: string,
    reason: string,
    source = 'Owner Manual Edit',
    targetStatus: InfoVerificationStatus = 'verified'
  ): { success: boolean; anime?: any; record?: InfoVerificationRecord; error?: string } {
    const existing = globalDataStore.getCatalogueAnime(animeId);
    if (!existing) {
      return { success: false, error: `Anime '${animeId}' not found.` };
    }

    const previousSnapshot = {
      title: existing.title,
      alternateTitle: existing.alternateTitle || null,
      japaneseTitle: existing.japaneseTitle || null,
      type: existing.type,
      status: existing.status,
      releaseYear: existing.releaseYear,
      releaseDate: existing.releaseDate || null,
      totalSeasons: existing.totalSeasons ?? (Array.isArray(existing.seasons) ? existing.seasons.length : 1),
      totalEpisodes: existing.totalEpisodes || 0,
      seasons: existing.seasons ? JSON.parse(JSON.stringify(existing.seasons)) : [],
      genres: Array.isArray(existing.genres) ? [...existing.genres] : [],
      languages: Array.isArray(existing.languages) ? [...existing.languages] : [],
      dubLanguage: existing.providers?.raretoonIndia?.dubLanguage || '',
      synopsis: existing.synopsis || '',
      storyDetails: existing.storyDetails || null,
      relatedAnime: Array.isArray(existing.relatedAnime) ? [...existing.relatedAnime] : [],
      franchiseRelationships: Array.isArray(existing.franchiseRelationships) ? [...existing.franchiseRelationships] : [],
      providerAnimeId: existing.providers?.raretoonIndia?.providerAnimeId || '',
      canonicalUrl: existing.providers?.raretoonIndia?.canonicalUrl || ''
    };

    const changedFields: string[] = [];

    globalDataStore.updateCatalogueAnime(animeId, (item) => {
      if (updates.malId !== undefined) {
        const mId = Number(updates.malId);
        if (!isNaN(mId) && mId > 0 && mId !== Number(item.malId || 0)) {
          item.malId = mId;
          changedFields.push('malId');
        }
      }
      if (updates.aniListId !== undefined) {
        const aId = Number(updates.aniListId);
        if (!isNaN(aId) && aId > 0 && aId !== Number(item.aniListId || 0)) {
          item.aniListId = aId;
          changedFields.push('aniListId');
        }
      }
      if (typeof updates.title === 'string' && updates.title.trim() && updates.title.trim() !== item.title) {
        item.title = updates.title.trim();
        changedFields.push('title');
      }
      if (updates.alternateTitle !== undefined && updates.alternateTitle !== item.alternateTitle) {
        item.alternateTitle = updates.alternateTitle ? String(updates.alternateTitle).trim() : null;
        changedFields.push('alternateTitle');
      }
      if (updates.japaneseTitle !== undefined && updates.japaneseTitle !== item.japaneseTitle) {
        item.japaneseTitle = updates.japaneseTitle ? String(updates.japaneseTitle).trim() : null;
        changedFields.push('japaneseTitle');
      }
      if (
        typeof updates.type === 'string' &&
        ['TV', 'Movie', 'OVA', 'ONA', 'Special'].includes(updates.type) &&
        updates.type !== item.type
      ) {
        item.type = updates.type;
        changedFields.push('type');
      }
      if (
        typeof updates.status === 'string' &&
        ['Completed', 'Ongoing', 'Upcoming'].includes(updates.status) &&
        updates.status !== item.status
      ) {
        item.status = updates.status;
        changedFields.push('status');
      }
      if (updates.releaseYear !== undefined) {
        const yr = parseInt(String(updates.releaseYear), 10);
        if (!isNaN(yr) && yr >= 1950 && yr <= 2035 && yr !== item.releaseYear) {
          item.releaseYear = yr;
          changedFields.push('releaseYear');
        }
      }
      if (updates.releaseDate !== undefined && updates.releaseDate !== item.releaseDate) {
        item.releaseDate = updates.releaseDate ? String(updates.releaseDate).trim() : null;
        changedFields.push('releaseDate');
      }
      if (updates.totalSeasons !== undefined) {
        const ts = parseInt(String(updates.totalSeasons), 10);
        if (!isNaN(ts) && ts >= 0 && ts !== item.totalSeasons) {
          item.totalSeasons = ts;
          item.seasonsCount = ts;
          changedFields.push('totalSeasons');
        }
      }
      if (updates.totalEpisodes !== undefined) {
        const te = parseInt(String(updates.totalEpisodes), 10);
        if (!isNaN(te) && te >= 0 && te !== item.totalEpisodes) {
          item.totalEpisodes = te;
          item.authoritativeTotalEpisodes = te;
          changedFields.push('totalEpisodes');
        }
      }
      if (Array.isArray(updates.seasons)) {
        item.seasons = updates.seasons;
        item.totalSeasons = updates.seasons.length;
        item.seasonsCount = updates.seasons.length;
        changedFields.push('seasons');
      }
      if (Array.isArray(item.seasons)) {
        let sumAuth = 0;
        let sumImp = 0;
        let allComp = item.seasons.length > 0;
        for (const s of item.seasons) {
          const imp = Array.isArray(s.episodes) ? s.episodes.length : 0;
          const auth = Math.max(s.authoritativeEpisodeCount || s.episodeCount || 1, imp);
          const comp = auth > 0 && imp >= auth;
          s.episodeCount = auth;
          s.authoritativeEpisodeCount = auth;
          s.importedEpisodeCount = imp;
          s.isEpisodeListComplete = comp;
          s.episodeListStatus = imp === 0 ? 'empty' : comp ? 'complete' : 'partial';
          sumAuth += auth;
          sumImp += imp;
          if (!comp) allComp = false;
        }
        const finalAuth = Math.max(item.totalEpisodes || 0, sumAuth);
        item.totalEpisodes = finalAuth;
        item.authoritativeTotalEpisodes = finalAuth;
        item.importedEpisodesCount = sumImp;
        item.isEpisodeListComplete = allComp && finalAuth > 0 && sumImp >= finalAuth;
        item.episodeListStatus = sumImp === 0 ? 'empty' : item.isEpisodeListComplete ? 'complete' : 'partial';
      }
      if (Array.isArray(updates.genres)) {
        const cleanGenres = updates.genres.map((g: any) => String(g).trim()).filter(Boolean);
        if (JSON.stringify(cleanGenres) !== JSON.stringify(item.genres || [])) {
          item.genres = cleanGenres;
          changedFields.push('genres');
        }
      }
      if (Array.isArray(updates.languages)) {
        const cleanLangs = updates.languages.map((l: any) => String(l).trim()).filter(Boolean);
        if (JSON.stringify(cleanLangs) !== JSON.stringify(item.languages || [])) {
          item.languages = cleanLangs;
          changedFields.push('languages');
        }
      }
      if (typeof updates.dubLanguage === 'string') {
        item.providers = item.providers || {};
        item.providers.raretoonIndia = item.providers.raretoonIndia || {};
        if (updates.dubLanguage.trim() !== (item.providers.raretoonIndia.dubLanguage || '')) {
          item.providers.raretoonIndia.dubLanguage = updates.dubLanguage.trim();
          changedFields.push('dubLanguage');
        }
      }
      if (typeof updates.providerAnimeId === 'string') {
        item.providers = item.providers || {};
        item.providers.raretoonIndia = item.providers.raretoonIndia || {};
        if (updates.providerAnimeId.trim() !== (item.providers.raretoonIndia.providerAnimeId || '')) {
          item.providers.raretoonIndia.providerAnimeId = updates.providerAnimeId.trim();
          changedFields.push('providerAnimeId');
        }
      }
      if (typeof updates.canonicalUrl === 'string') {
        item.providers = item.providers || {};
        item.providers.raretoonIndia = item.providers.raretoonIndia || {};
        if (updates.canonicalUrl.trim() !== (item.providers.raretoonIndia.canonicalUrl || '')) {
          item.providers.raretoonIndia.canonicalUrl = updates.canonicalUrl.trim();
          item.canonicalProviderUrl = updates.canonicalUrl.trim();
          changedFields.push('canonicalUrl');
        }
      }
      if (typeof updates.synopsis === 'string' && updates.synopsis.trim() !== (item.synopsis || '').trim()) {
        item.synopsis = updates.synopsis.trim();
        changedFields.push('synopsis');
      }
      if (updates.storyDetails !== undefined && updates.storyDetails !== item.storyDetails) {
        item.storyDetails = updates.storyDetails ? String(updates.storyDetails).trim() : null;
        changedFields.push('storyDetails');
      }
      if (Array.isArray(updates.relatedAnime)) {
        const cleanRel = updates.relatedAnime.map((r: any) => String(r).trim()).filter(Boolean);
        if (JSON.stringify(cleanRel) !== JSON.stringify(item.relatedAnime || [])) {
          item.relatedAnime = cleanRel;
          changedFields.push('relatedAnime');
        }
      }
      if (Array.isArray(updates.franchiseRelationships)) {
        const cleanFran = updates.franchiseRelationships.map((r: any) => String(r).trim()).filter(Boolean);
        if (JSON.stringify(cleanFran) !== JSON.stringify(item.franchiseRelationships || [])) {
          item.franchiseRelationships = cleanFran;
          changedFields.push('franchiseRelationships');
        }
      }
    });

    globalDataStore.flushCatalogueSync();
    const updatedAnime = globalDataStore.getCatalogueAnime(animeId);

    const newSnapshot = {
      title: updatedAnime.title,
      alternateTitle: updatedAnime.alternateTitle || null,
      japaneseTitle: updatedAnime.japaneseTitle || null,
      type: updatedAnime.type,
      status: updatedAnime.status,
      releaseYear: updatedAnime.releaseYear,
      releaseDate: updatedAnime.releaseDate || null,
      totalSeasons: updatedAnime.totalSeasons ?? (Array.isArray(updatedAnime.seasons) ? updatedAnime.seasons.length : 1),
      totalEpisodes: updatedAnime.totalEpisodes || 0,
      seasons: updatedAnime.seasons ? JSON.parse(JSON.stringify(updatedAnime.seasons)) : [],
      genres: Array.isArray(updatedAnime.genres) ? [...updatedAnime.genres] : [],
      languages: Array.isArray(updatedAnime.languages) ? [...updatedAnime.languages] : [],
      dubLanguage: updatedAnime.providers?.raretoonIndia?.dubLanguage || '',
      synopsis: updatedAnime.synopsis || '',
      storyDetails: updatedAnime.storyDetails || null,
      relatedAnime: Array.isArray(updatedAnime.relatedAnime) ? [...updatedAnime.relatedAnime] : [],
      franchiseRelationships: Array.isArray(updatedAnime.franchiseRelationships) ? [...updatedAnime.franchiseRelationships] : [],
      providerAnimeId: updatedAnime.providers?.raretoonIndia?.providerAnimeId || '',
      canonicalUrl: updatedAnime.providers?.raretoonIndia?.canonicalUrl || ''
    };

    if (changedFields.length > 0) {
      const historyEntry: InfoHistoryEntry = {
        id: `INFO-HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        animeId,
        animeTitle: updatedAnime.title,
        updatedAt: new Date().toISOString(),
        updatedBy: operatorEmail,
        source,
        reason: reason || `Updated fields: ${changedFields.join(', ')}`,
        changedFields,
        previousSnapshot,
        newSnapshot
      };
      this.historyList.unshift(historyEntry);
      if (this.historyList.length > 500) {
        this.historyList.pop();
      }
      this.saveHistoryToDisk();
    }

    const catalogue = globalDataStore.getAllCatalogueAnime();
    const catalogueById = new Map<string, any>();
    for (const a of catalogue) {
      if (a && a.id) catalogueById.set(a.id, a);
    }
    const duplicateMap = this.buildDuplicateIndex(catalogue);
    const existingRec = this.recordsMap.get(animeId);

    const evaluated = this.evaluateAnimeMetadata(
      updatedAnime,
      duplicateMap.get(animeId) || [],
      catalogueById,
      existingRec?.candidates || [],
      targetStatus
    );

    if (targetStatus === 'verified') {
      evaluated.status = 'verified';
      evaluated.statusLabel = 'Verified';
      evaluated.discrepancies = [];
      evaluated.summaryMessage = `Verified and updated by ${operatorEmail} (${source}).`;
    } else if (targetStatus === 'auto_fixed') {
      evaluated.status = 'auto_fixed';
      evaluated.statusLabel = 'Verified (Auto-Fixed)';
    }

    this.recordsMap.set(animeId, evaluated);
    this.saveRecordsToDisk();

    logAdminAction(
      `Information Manager: Update "${updatedAnime.title}"`,
      operatorEmail,
      'success',
      animeId,
      `Source: ${source} | Fields: ${changedFields.join(', ') || 'verified'}`
    );

    return {
      success: true,
      anime: updatedAnime,
      record: evaluated
    };
  }

  /**
   * Revert a previous Information Manager change from history
   */
  public revertHistoryEntry(historyId: string, operatorEmail: string): {
    success: boolean;
    anime?: any;
    error?: string;
  } {
    const entry = this.historyList.find(h => h.id === historyId);
    if (!entry) {
      return { success: false, error: 'History entry not found.' };
    }

    const prev = entry.previousSnapshot;
    return this.applyMetadataUpdate(
      entry.animeId,
      {
        title: prev.title,
        alternateTitle: prev.alternateTitle,
        japaneseTitle: prev.japaneseTitle,
        type: prev.type,
        status: prev.status,
        releaseYear: prev.releaseYear,
        releaseDate: prev.releaseDate,
        totalSeasons: prev.totalSeasons,
        totalEpisodes: prev.totalEpisodes,
        seasons: prev.seasons,
        genres: prev.genres,
        languages: prev.languages,
        dubLanguage: prev.dubLanguage,
        synopsis: prev.synopsis,
        storyDetails: prev.storyDetails,
        relatedAnime: prev.relatedAnime,
        franchiseRelationships: prev.franchiseRelationships,
        providerAnimeId: prev.providerAnimeId,
        canonicalUrl: prev.canonicalUrl
      },
      operatorEmail,
      `Reverted change ${historyId}`,
      'History Revert',
      'verified'
    );
  }

  /**
   * Owner resolution for Suspected Fake / Non-Existent anime:
   * - 'dismiss' / 'mark_verified': Keeps the anime and marks it Verified Real
   * - 'confirm_fake': Marks the record as Confirmed Fake while preserving the record and evidence
   * - 'confirm_delete': Deletes when Owner explicitly confirms strong evidence of fake/non-existent anime
   */
  public resolveSuspectedFake(
    animeId: string,
    action: 'dismiss' | 'confirm_fake' | 'confirm_delete',
    operatorEmail: string
  ): {
    success: boolean;
    deleted?: boolean;
    anime?: any;
    record?: InfoVerificationRecord;
    message?: string;
    error?: string;
  } {
    const anime = globalDataStore.getCatalogueAnime(animeId);
    if (!anime) {
      return { success: false, error: 'Anime entry not found.' };
    }

    if (action === 'confirm_fake') {
      const existingRec = this.recordsMap.get(animeId);
      const catalogue = globalDataStore.getAllCatalogueAnime();
      const catalogueById = new Map<string, any>();
      for (const a of catalogue) {
        if (a && a.id) catalogueById.set(a.id, a);
      }
      const duplicateMap = this.buildDuplicateIndex(catalogue);
      const evaluated = this.evaluateAnimeMetadata(
        anime,
        duplicateMap.get(animeId) || [],
        catalogueById,
        existingRec?.candidates || [],
        'confirmed_fake'
      );
      evaluated.status = 'confirmed_fake';
      evaluated.statusLabel = 'Confirmed Fake';
      evaluated.suspectedFakeStrongEvidence = true;
      evaluated.suspectedFakeReason =
        existingRec?.suspectedFakeReason || 'Confirmed Fake Anime by Owner after multi-source verification.';
      this.recordsMap.set(animeId, evaluated);
      this.saveRecordsToDisk();
      logAdminAction(
        `Information Manager: Mark Confirmed Fake "${anime.title}"`,
        operatorEmail,
        'success',
        animeId,
        `Marked ${animeId} as Confirmed Fake Anime (${evaluated.suspectedFakeReason})`
      );
      return {
        success: true,
        deleted: false,
        anime,
        record: evaluated,
        message: `"${anime.title}" marked as Confirmed Fake Anime.`
      };
    }

    if (action === 'confirm_delete') {
      const title = anime.title;
      const existingRec = this.recordsMap.get(animeId);
      const fakeReason = existingRec?.suspectedFakeReason || 'Owner confirmed strong evidence of fake/non-existent anime';
      const historyEntry: InfoHistoryEntry = {
        id: `INFO-HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        animeId,
        animeTitle: title,
        updatedAt: new Date().toISOString(),
        updatedBy: operatorEmail,
        source: 'Owner Confirmed Fake Deletion',
        reason: `Confirmed Fake Anime removed by Owner (${fakeReason})`,
        changedFields: ['deleted_confirmed_fake'],
        previousSnapshot: {
          title: anime.title,
          alternateTitle: anime.alternateTitle || null,
          japaneseTitle: anime.japaneseTitle || null,
          type: anime.type,
          status: anime.status,
          releaseYear: anime.releaseYear,
          releaseDate: anime.releaseDate || null,
          totalSeasons: anime.totalSeasons ?? 1,
          totalEpisodes: anime.totalEpisodes || 0,
          seasons: anime.seasons ? JSON.parse(JSON.stringify(anime.seasons)) : [],
          genres: Array.isArray(anime.genres) ? [...anime.genres] : [],
          languages: Array.isArray(anime.languages) ? [...anime.languages] : [],
          dubLanguage: anime.providers?.raretoonIndia?.dubLanguage || '',
          synopsis: anime.synopsis || '',
          storyDetails: anime.storyDetails || null,
          relatedAnime: Array.isArray(anime.relatedAnime) ? [...anime.relatedAnime] : [],
          franchiseRelationships: Array.isArray(anime.franchiseRelationships) ? [...anime.franchiseRelationships] : [],
          providerAnimeId: anime.providers?.raretoonIndia?.providerAnimeId || '',
          canonicalUrl: anime.providers?.raretoonIndia?.canonicalUrl || ''
        },
        newSnapshot: {
          title: `[CONFIRMED FAKE REMOVED] ${title}`,
          alternateTitle: null,
          type: anime.type,
          status: 'Removed (Confirmed Fake)',
          releaseYear: anime.releaseYear || 0,
          genres: [],
          synopsis: fakeReason
        }
      };
      this.historyList.unshift(historyEntry);
      this.saveHistoryToDisk();

      const ok = globalDataStore.deleteCatalogueAnime(animeId);
      if (!ok) {
        return { success: false, error: 'Failed to delete confirmed fake anime entry.' };
      }
      this.recordsMap.delete(animeId);
      this.saveRecordsToDisk();
      logAdminAction(
        `Information Manager: Delete Confirmed Fake Anime "${title}"`,
        operatorEmail,
        'success',
        animeId,
        `Owner confirmed and deleted fake/non-existent entry ${animeId} (${fakeReason})`
      );
      return {
        success: true,
        deleted: true,
        message: `Confirmed fake entry "${title}" removed by Owner.`
      };
    }

    // Dismiss suspected fake flag & mark verified
    const res = this.applyMetadataUpdate(
      animeId,
      {},
      operatorEmail,
      'Owner reviewed Suspected Fake notice and confirmed entry is valid',
      'Owner Fake Review Dismissal',
      'verified'
    );
    return {
      success: res.success,
      deleted: false,
      anime: res.anime,
      record: res.record,
      message: `"${anime.title}" marked as Verified (Suspected Fake dismissed).`
    };
  }

  /**
   * Delete a confirmed duplicate anime entry
   */
  public deleteDuplicateEntry(animeId: string, operatorEmail: string): {
    success: boolean;
    deletedTitle?: string;
    error?: string;
  } {
    const anime = globalDataStore.getCatalogueAnime(animeId);
    if (!anime) {
      return { success: false, error: 'Anime entry not found.' };
    }
    const deletedTitle = anime.title;
    const ok = globalDataStore.deleteCatalogueAnime(animeId);
    if (!ok) {
      return { success: false, error: 'Failed to delete anime entry from catalogue.' };
    }
    this.recordsMap.delete(animeId);
    this.saveRecordsToDisk();

    logAdminAction(
      `Information Manager: Delete Duplicate "${deletedTitle}"`,
      operatorEmail,
      'success',
      animeId,
      `Removed duplicate anime entry ${animeId}`
    );

    return { success: true, deletedTitle };
  }

  /**
   * Start background batch verification/auto-fix job on the shared 50-worker pool
   */
  public startScan(
    operatorEmail: string,
    mode: 'all' | 'unverified' | 'fix_missing' = 'all',
    limit?: number
  ): InfoScanJobState {
    // First run instant static audit so all records are populated immediately
    this.inspectAllCatalogue(operatorEmail);

    const catalogue = globalDataStore.getAllCatalogueAnime();
    let targets = catalogue.filter(a => {
      if (mode === 'all') return true;
      const rec = this.recordsMap.get(a.id);
      if (mode === 'unverified') {
        return !rec || rec.status === 'unverified' || rec.status === 'needs_review' || rec.status === 'missing_info';
      }
      if (mode === 'fix_missing') {
        return !rec || rec.status === 'missing_info' || rec.status === 'needs_review';
      }
      return true;
    });

    if (limit && limit > 0) {
      targets = targets.slice(0, limit);
    }

    const jobId = `INFO-JOB-${Date.now()}`;
    const priority: TaskPriority = mode === 'fix_missing' ? 'HIGH' : 'NORMAL';
    const tasks: JobTask[] = targets.map(anime => ({
      taskId: createDeterministicTaskId('INFORMATION_VERIFICATION', anime.id, null),
      jobId,
      jobSystem: 'INFORMATION_VERIFICATION',
      animeId: anime.id,
      seasonId: null,
      title: anime.title,
      type: mode === 'fix_missing' ? 'info_fix_missing' : 'info_verify',
      payload: {
        animeId: anime.id,
        autoFix: true,
        operatorEmail,
        mode
      },
      priority,
      status: 'queued',
      retryCount: 0,
      maxRetries: 3
    }));

    this.scanState = {
      status: tasks.length > 0 ? 'running' : 'completed',
      mode,
      totalCount: tasks.length,
      processedCount: 0,
      progressPercent: tasks.length === 0 ? 100 : 0,
      currentAnimeId: targets[0]?.id || null,
      currentAnimeTitle: targets[0]?.title || null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: tasks.length === 0 ? new Date().toISOString() : null,
      lastLog: `Enqueued ${tasks.length} Information Verification jobs onto the shared 50-worker pool (${mode}).`
    };

    if (tasks.length > 0) {
      globalWorkerJobEngine.submitTasks(
        tasks,
        mode,
        limit,
        'INFORMATION_VERIFICATION'
      );
      globalWorkerJobEngine.ensureWorkerPoolRunning(
        async (task, workerId) => await this.processTaskByWorker(task, workerId)
      );
    }

    return this.getJobState();
  }

  /**
   * Retry all Needs Review / Conflict / Missing Info / Failed items on the shared worker pool
   */
  public retryAllNeedsReview(operatorEmail: string): {
    queuedCount: number;
    state: InfoScanJobState;
  } {
    const catalogue = globalDataStore.getAllCatalogueAnime();
    const targets = catalogue.filter(a => {
      const rec = this.recordsMap.get(a.id);
      if (!rec) return false;
      return (
        rec.status === 'needs_review' ||
        rec.status === 'conflict' ||
        rec.status === 'missing_info' ||
        rec.status === 'unverified'
      );
    });

    if (targets.length === 0) {
      return { queuedCount: 0, state: this.getJobState() };
    }

    const jobId = `INFO-RETRY-${Date.now()}`;
    const tasks: JobTask[] = targets.map(anime => ({
      taskId: createDeterministicTaskId('INFORMATION_VERIFICATION', anime.id, null),
      jobId,
      jobSystem: 'INFORMATION_VERIFICATION',
      animeId: anime.id,
      seasonId: null,
      title: anime.title,
      type: 'info_retry_review',
      payload: {
        animeId: anime.id,
        autoFix: true,
        operatorEmail,
        mode: 'retry_review'
      },
      priority: 'HIGH',
      status: 'queued',
      retryCount: 0,
      maxRetries: 3
    }));

    this.scanState.status = 'running';
    this.scanState.totalCount = tasks.length;
    this.scanState.processedCount = 0;
    this.scanState.progressPercent = 0;
    this.scanState.startedAt = new Date().toISOString();
    this.scanState.updatedAt = new Date().toISOString();
    this.scanState.lastLog = `Enqueued ${tasks.length} Needs Review items for high-priority worker re-verification.`;

    globalWorkerJobEngine.enqueueHighPriorityTasks(tasks);
    globalWorkerJobEngine.ensureWorkerPoolRunning(
      async (task, workerId) => await this.processTaskByWorker(task, workerId)
    );

    logAdminAction(
      'Information Manager: Retry All Needs Review',
      operatorEmail,
      'success',
      undefined,
      `Queued ${tasks.length} items onto shared worker pool for re-verification.`
    );

    return {
      queuedCount: tasks.length,
      state: this.getJobState()
    };
  }

  /**
   * Fix All High-Confidence Items:
   * Never blindly overwrites everything! Only automatically resolves items that meet high-confidence criteria (>= 78%)
   * and have no duplicate or suspected_fake human-judgment flags.
   */
  public fixAllHighConfidence(operatorEmail: string): {
    fixedCount: number;
    skippedHumanReviewCount: number;
    state: InfoScanJobState;
  } {
    const catalogue = globalDataStore.getAllCatalogueAnime();
    let fixedCount = 0;
    let skippedHumanReviewCount = 0;

    for (const anime of catalogue) {
      const rec = this.recordsMap.get(anime.id);
      if (!rec) continue;
      if (rec.status === 'verified' || rec.status === 'correct' || rec.status === 'auto_fixed') continue;

      // Items requiring human judgment (Duplicates, Suspected Fake, or Cross-Source Conflicts) must remain for individual review
      if (rec.status === 'duplicate' || rec.status === 'suspected_fake' || rec.status === 'conflict') {
        skippedHumanReviewCount++;
        continue;
      }

      const top = rec.candidates?.[0];
      const hasHighConfidenceCandidate = Boolean(top && top.confidence >= 0.78);
      const updates: Record<string, any> = {};

      for (const d of rec.discrepancies || []) {
        if (d.field === 'duplicate' || d.field === 'suspectedFake' || d.field === 'conflictingInformation') {
          continue;
        }
        // Deterministic internal fixes or high-confidence candidate fixes
        const isDeterministicInternal =
          d.source === 'Season Structure Audit' ||
          d.source === 'Season Episode Sum' ||
          d.source === 'Language Audit' ||
          d.source === 'RareToon Mapping Audit' ||
          d.source === 'Title Cleaner';

        if (!hasHighConfidenceCandidate && !isDeterministicInternal && rec.confidence < 0.78) {
          continue;
        }

        if (d.field === 'title' && typeof d.suggestedValue === 'string' && d.suggestedValue !== 'Valid Title Required') {
          updates.title = d.suggestedValue;
        } else if (d.field === 'alternateTitles' && d.suggestedValue) {
          updates.alternateTitle = d.suggestedValue;
        } else if (d.field === 'seasonsCount' && typeof d.suggestedValue === 'number') {
          updates.totalSeasons = d.suggestedValue;
        } else if (d.field === 'totalEpisodes' && typeof d.suggestedValue === 'number') {
          updates.totalEpisodes = d.suggestedValue;
        } else if (d.field === 'status' && ['Completed', 'Ongoing', 'Upcoming'].includes(d.suggestedValue)) {
          updates.status = d.suggestedValue;
        } else if (d.field === 'releaseYear' && typeof d.suggestedValue === 'number') {
          updates.releaseYear = d.suggestedValue;
        } else if (d.field === 'type' && ['TV', 'Movie', 'OVA', 'ONA', 'Special'].includes(d.suggestedValue)) {
          updates.type = d.suggestedValue;
        } else if (d.field === 'genres' && Array.isArray(d.suggestedValue)) {
          updates.genres = d.suggestedValue;
        } else if (d.field === 'languages' && Array.isArray(d.suggestedValue)) {
          updates.languages = d.suggestedValue;
        } else if (d.field === 'synopsis' && typeof d.suggestedValue === 'string') {
          updates.synopsis = d.suggestedValue;
        } else if (d.field === 'franchiseRelationships' && Array.isArray(d.suggestedValue)) {
          updates.franchiseRelationships = d.suggestedValue;
        } else if (d.field === 'raretoonMapping' && typeof d.suggestedValue === 'string') {
          updates.providerAnimeId = d.suggestedValue;
        }
      }

      if (Object.keys(updates).length > 0) {
        this.applyMetadataUpdate(
          anime.id,
          updates,
          operatorEmail,
          'Fix All High-Confidence metadata resolution',
          top?.source || 'High-Confidence Fix All',
          'auto_fixed'
        );
        fixedCount++;
      } else {
        skippedHumanReviewCount++;
      }
    }

    logAdminAction(
      'Information Manager: Fix All High-Confidence',
      operatorEmail,
      'success',
      undefined,
      `Auto-resolved ${fixedCount} high-confidence items; preserved ${skippedHumanReviewCount} items requiring human review.`
    );

    return {
      fixedCount,
      skippedHumanReviewCount,
      state: this.getJobState()
    };
  }

  /**
   * Resolve, Approve, Reject, Mark Needs Review, or Skip/Ignore an individual item
   */
  public resolveReviewItem(
    animeId: string,
    action: 'approve_suggestions' | 'mark_verified' | 'reject_suggestions' | 'skip_ignore' | 'mark_needs_review',
    operatorEmail: string,
    reason?: string
  ): {
    success: boolean;
    anime?: any;
    record?: InfoVerificationRecord;
    message?: string;
    error?: string;
  } {
    const anime = globalDataStore.getCatalogueAnime(animeId);
    if (!anime) {
      return { success: false, error: 'Anime not found in catalogue.' };
    }
    const rec = this.recordsMap.get(animeId);

    if (action === 'mark_needs_review') {
      const catalogue = globalDataStore.getAllCatalogueAnime();
      const catalogueById = new Map<string, any>();
      for (const a of catalogue) {
        if (a && a.id) catalogueById.set(a.id, a);
      }
      const duplicateMap = this.buildDuplicateIndex(catalogue);
      const evaluated = this.evaluateAnimeMetadata(
        anime,
        duplicateMap.get(animeId) || [],
        catalogueById,
        rec?.candidates || [],
        'needs_review'
      );
      evaluated.status = 'needs_review';
      evaluated.statusLabel = 'Needs Review';
      evaluated.decisionReason = reason || 'Explicitly flagged as Needs Review by Owner.';
      if (evaluated.discrepancies.length === 0) {
        evaluated.discrepancies.push({
          field: 'title',
          label: 'Owner Flagged for Review',
          severity: 'medium',
          currentValue: anime.title,
          suggestedValue: anime.title,
          source: 'Owner Manual Review Flag',
          message: reason || 'Flagged by Owner for manual metadata inspection.'
        });
      }
      this.recordsMap.set(animeId, evaluated);
      this.saveRecordsToDisk();
      logAdminAction(
        `Information Manager: Mark Needs Review "${anime.title}"`,
        operatorEmail,
        'success',
        animeId,
        reason || 'Owner marked record as Needs Review'
      );
      return {
        success: true,
        anime,
        record: evaluated,
        message: `"${anime.title}" marked as Needs Review.`
      };
    }

    if (action === 'approve_suggestions' && rec) {
      const updates: Record<string, any> = {};
      for (const d of rec.discrepancies || []) {
        if (d.field === 'title' && typeof d.suggestedValue === 'string' && d.suggestedValue !== 'Valid Title Required') {
          updates.title = d.suggestedValue;
        } else if (d.field === 'alternateTitles' && d.suggestedValue) {
          updates.alternateTitle = d.suggestedValue;
        } else if (d.field === 'seasonsCount' && typeof d.suggestedValue === 'number') {
          updates.totalSeasons = d.suggestedValue;
        } else if (d.field === 'totalEpisodes' && typeof d.suggestedValue === 'number') {
          updates.totalEpisodes = d.suggestedValue;
        } else if (d.field === 'status' && ['Completed', 'Ongoing', 'Upcoming'].includes(d.suggestedValue)) {
          updates.status = d.suggestedValue;
        } else if (d.field === 'releaseYear' && typeof d.suggestedValue === 'number') {
          updates.releaseYear = d.suggestedValue;
        } else if (d.field === 'type' && ['TV', 'Movie', 'OVA', 'ONA', 'Special'].includes(d.suggestedValue)) {
          updates.type = d.suggestedValue;
        } else if (d.field === 'genres' && Array.isArray(d.suggestedValue)) {
          updates.genres = d.suggestedValue;
        } else if (d.field === 'languages' && Array.isArray(d.suggestedValue)) {
          updates.languages = d.suggestedValue;
        } else if (d.field === 'synopsis' && typeof d.suggestedValue === 'string') {
          updates.synopsis = d.suggestedValue;
        } else if (d.field === 'franchiseRelationships' && Array.isArray(d.suggestedValue)) {
          updates.franchiseRelationships = d.suggestedValue;
        } else if (d.field === 'raretoonMapping' && typeof d.suggestedValue === 'string') {
          updates.providerAnimeId = d.suggestedValue;
        }
      }
      const res = this.applyMetadataUpdate(
        animeId,
        updates,
        operatorEmail,
        'Owner approved recommended metadata corrections',
        rec.source || 'Owner Review Approval',
        'verified'
      );
      return {
        ...res,
        message: `Approved & applied recommended fixes for "${anime.title}".`
      };
    }

    // mark_verified, reject_suggestions, or skip_ignore -> keep current catalogue values and mark record verified
    const reasonMap: Record<string, string> = {
      mark_verified: 'Owner resolved and marked metadata as Verified',
      reject_suggestions: 'Owner rejected external suggestions and confirmed existing catalogue data',
      skip_ignore: 'Owner skipped/ignored review flags and kept existing catalogue data'
    };
    const res = this.applyMetadataUpdate(
      animeId,
      {},
      operatorEmail,
      reasonMap[action] || 'Owner resolved review item',
      'Owner Review Resolution',
      'verified'
    );
    return {
      ...res,
      message: `"${anime.title}" resolved and marked Verified.`
    };
  }

  public pauseScan(): InfoScanJobState {
    globalWorkerJobEngine.pauseJob();
    this.scanState.status = 'paused';
    this.scanState.lastLog = 'Information scan paused by Owner.';
    this.scanState.updatedAt = new Date().toISOString();
    return this.getJobState();
  }

  public resumeScan(): InfoScanJobState {
    globalWorkerJobEngine.resumeJob();
    this.scanState.status = 'running';
    this.scanState.lastLog = 'Information scan resumed by Owner.';
    this.scanState.updatedAt = new Date().toISOString();
    return this.getJobState();
  }

  public stopScan(): InfoScanJobState {
    globalWorkerJobEngine.stopJob('INFORMATION_VERIFICATION');
    this.scanState.status = 'idle';
    this.scanState.currentAnimeId = null;
    this.scanState.currentAnimeTitle = null;
    this.scanState.lastLog = 'Information scan stopped.';
    this.scanState.updatedAt = new Date().toISOString();
    return this.getJobState();
  }

  public resetScan(): InfoScanJobState {
    globalWorkerJobEngine.resetJob('INFORMATION_VERIFICATION');
    this.scanState = {
      status: 'idle',
      mode: 'all',
      totalCount: 0,
      processedCount: 0,
      progressPercent: 0,
      currentAnimeId: null,
      currentAnimeTitle: null,
      startedAt: null,
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      lastLog: 'Information Manager scan state reset.'
    };
    return this.getJobState();
  }
}

export const infoManager = new InformationManagerEngine();
