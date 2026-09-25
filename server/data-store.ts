import fs from 'fs';
import path from 'path';
import {
  ArtworkVerificationResult,
  ArtworkHistoryEntry,
  FakeAnimeIssue
} from './artwork-verifier-types.ts';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const CATALOGUE_PATH = path.join(DATA_DIR, 'anivault-catalogue.json');
const PUBLIC_CATALOGUE_PATH = path.join(process.cwd(), 'src', 'data', 'anivault-catalogue.json');
const VERIFICATION_RECORDS_PATH = path.join(DATA_DIR, 'artwork-verification-records.json');
const ARTWORK_HISTORY_PATH = path.join(DATA_DIR, 'artwork-history.json');
const FAKE_ISSUES_PATH = path.join(DATA_DIR, 'fake-anime-issues.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeAtomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err: any) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    console.error(`[DataStore] Error writing atomic file ${filePath}:`, err.message);
  }
}

/**
 * High-Performance In-Memory Data Stores with Asynchronous Debounced Flushes
 * Completely eliminates the per-task disk I/O lock contention that slowed down 50 workers.
 */
class AuthoritativeDataStore {
  // 1. In-Memory Catalogue Store
  private catalogueMap: Map<string, any> = new Map();
  private isCatalogueDirty = false;
  private catalogueFlushTimer: NodeJS.Timeout | null = null;

  // 2. In-Memory Verification Records Store
  private recordsMap: Map<string, ArtworkVerificationResult> = new Map();
  private isRecordsDirty = false;
  private recordsFlushTimer: NodeJS.Timeout | null = null;

  // 3. In-Memory Artwork History Store
  private historyList: ArtworkHistoryEntry[] = [];
  private isHistoryDirty = false;
  private historyFlushTimer: NodeJS.Timeout | null = null;

  // 4. In-Memory Fake Anime Issues Store
  private fakeIssuesList: FakeAnimeIssue[] = [];
  private isFakeIssuesDirty = false;
  private fakeIssuesFlushTimer: NodeJS.Timeout | null = null;

  // Latency & DB access metrics
  private totalDbReads = 0;
  private totalDbWrites = 0;
  private lastDbLatencyMs = 0;

  constructor() {
    this.initStores();
  }

  private initStores() {
    const startTime = Date.now();

    // 1. Load Catalogue
    try {
      let catalogueData: any[] = [];
      if (fs.existsSync(CATALOGUE_PATH)) {
        catalogueData = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));
      } else if (fs.existsSync(PUBLIC_CATALOGUE_PATH)) {
        catalogueData = JSON.parse(fs.readFileSync(PUBLIC_CATALOGUE_PATH, 'utf-8'));
      }
      this.catalogueMap.clear();
      for (const item of catalogueData) {
        if (item && item.id) {
          this.catalogueMap.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.error('[DataStore] Error loading catalogue:', err.message);
    }

    // 2. Load Verification Records
    try {
      if (fs.existsSync(VERIFICATION_RECORDS_PATH)) {
        const raw = fs.readFileSync(VERIFICATION_RECORDS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        this.recordsMap.clear();
        for (const [id, rec] of Object.entries(parsed)) {
          this.recordsMap.set(id, rec as ArtworkVerificationResult);
        }
      }
    } catch (err: any) {
      console.error('[DataStore] Error loading verification records:', err.message);
    }

    // 3. Load History
    try {
      if (fs.existsSync(ARTWORK_HISTORY_PATH)) {
        this.historyList = JSON.parse(fs.readFileSync(ARTWORK_HISTORY_PATH, 'utf-8'));
      }
    } catch {
      this.historyList = [];
    }

    // 4. Load Fake Issues
    try {
      if (fs.existsSync(FAKE_ISSUES_PATH)) {
        this.fakeIssuesList = JSON.parse(fs.readFileSync(FAKE_ISSUES_PATH, 'utf-8'));
      }
    } catch {
      this.fakeIssuesList = [];
    }

    this.lastDbLatencyMs = Date.now() - startTime;
  }

  // --- Catalogue Store Methods (Instant O(1) in-memory) ---
  public getCatalogueAnime(animeId: string): any | null {
    this.totalDbReads++;
    return this.catalogueMap.get(animeId) || null;
  }

  public getAllCatalogueAnime(): any[] {
    this.totalDbReads++;
    return Array.from(this.catalogueMap.values());
  }

  public updateCatalogueAnime(animeId: string, updateFn: (anime: any) => void): boolean {
    const item = this.catalogueMap.get(animeId);
    if (!item) return false;
    updateFn(item);
    this.isCatalogueDirty = true;
    this.totalDbWrites++;
    this.scheduleCatalogueFlush();
    return true;
  }

  public markCatalogueVerified(animeId: string, status: string): void {
    this.updateCatalogueAnime(animeId, (item) => {
      item.artwork = {
        ...(item.artwork || {}),
        isVerified: status === 'verified',
        verificationStatus: status
      };
    });
  }

  public applyCatalogueArtworkUpdate(
    animeId: string,
    newUrl: string,
    newStatus: string,
    previousUrl: string | null,
    source: string,
    seasonNumber?: number
  ): boolean {
    const anime = this.catalogueMap.get(animeId);
    if (!anime) return false;

    const prev = anime.artwork?.verifiedArtworkUrl || previousUrl || null;

    anime.artwork = {
      ...(anime.artwork || {}),
      verifiedArtworkUrl: newUrl,
      isVerified: newStatus === 'verified',
      verificationStatus: newStatus,
      verificationSource: source,
      aspectRatio: '3:4',
      originalArtworkUrl: prev || anime.artwork?.originalArtworkUrl
    };

    if (seasonNumber && Array.isArray(anime.seasons)) {
      const s = anime.seasons.find((sn: any) => sn.seasonNumber === seasonNumber);
      if (s) s.artworkUrl = newUrl;
    }

    this.isCatalogueDirty = true;
    this.totalDbWrites++;
    this.scheduleCatalogueFlush();

    // Add History Entry
    if (prev && prev !== newUrl) {
      this.addHistoryEntry({
        id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        animeId,
        animeTitle: anime.title,
        previousArtworkUrl: prev,
        newArtworkUrl: newUrl,
        replacedAt: new Date().toISOString(),
        replacedBy: 'auto_verifier',
        source,
        reason: 'Automated 50-worker verification replacement',
        seasonNumber
      });
    }

    return true;
  }

  private scheduleCatalogueFlush() {
    if (this.catalogueFlushTimer) return;
    this.catalogueFlushTimer = setTimeout(() => {
      this.catalogueFlushTimer = null;
      this.flushCatalogueSync();
    }, 250); // 250ms batch window
  }

  public flushCatalogueSync() {
    if (!this.isCatalogueDirty) return;
    const startTime = Date.now();
    try {
      const array = Array.from(this.catalogueMap.values());
      const json = JSON.stringify(array, null, 2);
      safeAtomicWriteSync(CATALOGUE_PATH, json);
      if (fs.existsSync(PUBLIC_CATALOGUE_PATH)) {
        safeAtomicWriteSync(PUBLIC_CATALOGUE_PATH, json);
      }
      this.isCatalogueDirty = false;
      this.lastDbLatencyMs = Date.now() - startTime;
    } catch (err: any) {
      console.error('[DataStore] Error flushing catalogue:', err.message);
    }
  }

  // --- Verification Records Store Methods ---
  public getVerificationRecord(animeId: string): ArtworkVerificationResult | null {
    this.totalDbReads++;
    return this.recordsMap.get(animeId) || null;
  }

  public getAllVerificationRecords(): Record<string, ArtworkVerificationResult> {
    this.totalDbReads++;
    const res: Record<string, ArtworkVerificationResult> = {};
    for (const [k, v] of this.recordsMap.entries()) {
      res[k] = v;
    }
    return res;
  }

  public saveVerificationRecord(animeId: string, record: ArtworkVerificationResult): void {
    this.recordsMap.set(animeId, record);
    this.isRecordsDirty = true;
    this.totalDbWrites++;
    this.scheduleRecordsFlush();
  }

  private scheduleRecordsFlush() {
    if (this.recordsFlushTimer) return;
    this.recordsFlushTimer = setTimeout(() => {
      this.recordsFlushTimer = null;
      this.flushRecordsSync();
    }, 250);
  }

  public flushRecordsSync() {
    if (!this.isRecordsDirty) return;
    const startTime = Date.now();
    try {
      const obj: Record<string, ArtworkVerificationResult> = {};
      for (const [k, v] of this.recordsMap.entries()) {
        obj[k] = v;
      }
      safeAtomicWriteSync(VERIFICATION_RECORDS_PATH, JSON.stringify(obj, null, 2));
      this.isRecordsDirty = false;
      this.lastDbLatencyMs = Date.now() - startTime;
    } catch (err: any) {
      console.error('[DataStore] Error flushing records:', err.message);
    }
  }

  // --- History Store Methods ---
  public addHistoryEntry(entry: ArtworkHistoryEntry) {
    this.historyList.unshift(entry);
    if (this.historyList.length > 500) this.historyList.pop();
    this.isHistoryDirty = true;
    this.scheduleHistoryFlush();
  }

  public getAllHistory(): ArtworkHistoryEntry[] {
    return [...this.historyList];
  }

  private scheduleHistoryFlush() {
    if (this.historyFlushTimer) return;
    this.historyFlushTimer = setTimeout(() => {
      this.historyFlushTimer = null;
      if (this.isHistoryDirty) {
        safeAtomicWriteSync(ARTWORK_HISTORY_PATH, JSON.stringify(this.historyList, null, 2));
        this.isHistoryDirty = false;
      }
    }, 500);
  }

  // --- Fake Issues Store Methods ---
  public addFakeIssue(issue: FakeAnimeIssue) {
    const idx = this.fakeIssuesList.findIndex(i => i.catalogueId === issue.catalogueId);
    if (idx !== -1) {
      this.fakeIssuesList[idx] = issue;
    } else {
      this.fakeIssuesList.unshift(issue);
    }
    this.isFakeIssuesDirty = true;
    this.scheduleFakeIssuesFlush();
  }

  public getAllFakeIssues(): FakeAnimeIssue[] {
    return [...this.fakeIssuesList];
  }

  private scheduleFakeIssuesFlush() {
    if (this.fakeIssuesFlushTimer) return;
    this.fakeIssuesFlushTimer = setTimeout(() => {
      this.fakeIssuesFlushTimer = null;
      if (this.isFakeIssuesDirty) {
        safeAtomicWriteSync(FAKE_ISSUES_PATH, JSON.stringify(this.fakeIssuesList, null, 2));
        this.isFakeIssuesDirty = false;
      }
    }, 500);
  }

  public getStoreMetrics() {
    return {
      catalogueSize: this.catalogueMap.size,
      recordsSize: this.recordsMap.size,
      historySize: this.historyList.length,
      fakeIssuesSize: this.fakeIssuesList.length,
      totalDbReads: this.totalDbReads,
      totalDbWrites: this.totalDbWrites,
      lastDbLatencyMs: this.lastDbLatencyMs
    };
  }
}

export const globalDataStore = new AuthoritativeDataStore();
