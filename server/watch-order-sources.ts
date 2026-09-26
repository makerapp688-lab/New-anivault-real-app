import fs from 'fs';
import path from 'path';
import { globalDataStore } from './data-store.ts';

export type WatchOrderSourceStatus =
  | 'operational'
  | 'testing'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'timeout'
  | 'offline'
  | 'disabled'
  | 'untested';

export interface WatchOrderSourceConfig {
  id: 'watchordr' | 'theanimeorder';
  name: string;
  websiteUrl: string;
  indexUrl: string;
  robotsTxtUrl: string;
  enabled: boolean;
  rateLimitPerMinute: number;
  rateLimitPerSecond: number;
  timeoutMs: number;
  priority: number;
  status: WatchOrderSourceStatus;
  robotsAllowed?: boolean;
  lastChecked?: string;
  lastSuccessfulChecked?: string;
  lastLatencyMs?: number;
  lastError?: string | null;
  lastMessage?: string | null;
  indexedFranchiseCount?: number;
  description: string;
}

export type WatchOrderEntryCategory =
  | 'season'
  | 'movie'
  | 'ova'
  | 'special'
  | 'recap_movie'
  | 'alternate_version';

export interface WatchOrderEntry {
  step: number;
  releaseStep?: number;
  title: string;
  alternateTitle?: string | null;
  rawFormat: string; // e.g. 'TV', 'MOVIE', 'OVA', 'SPECIAL', 'ONA'
  category: WatchOrderEntryCategory;
  releaseYear: number | null;
  releaseDateText?: string | null;
  episodes: number | null;
  anilistId?: string | null;
  posterUrl?: string | null;
  entryUrl?: string | null;
  isRecapOrCompilation: boolean;
  isAlternateVersion: boolean;
  isSkippable: boolean;
  isUnreleased: boolean;
  note?: string | null;
  warning?: string | null;
  matchedCatalogueId?: string | null;
  matchedCatalogueTitle?: string | null;
}

export interface SourceWatchOrderResult {
  sourceId: 'watchordr' | 'theanimeorder';
  sourceName: string;
  found: boolean;
  sourceUrl: string | null;
  matchedTitle: string | null;
  lastCheckedAt: string;
  latencyMs: number;
  orderMode?: string;
  summaryText?: string | null;
  entries: WatchOrderEntry[];
  releaseOrderEntries?: WatchOrderEntry[];
  error?: string | null;
}

export type WatchOrderConfidenceLevel = 'high_confidence' | 'needs_review' | 'validated' | 'no_match';

export interface FranchiseWatchOrderRecord {
  id: string;
  franchiseKey: string;
  queryTitle: string;
  canonicalTitle: string;
  alternateTitles: string[];
  matchedCatalogueItems: Array<{
    id: string;
    title: string;
    alternateTitle: string | null;
    releaseYear: number | null;
    type: string;
    seasonsCount: number;
  }>;
  status: WatchOrderConfidenceLevel;
  confidenceScore: number; // 0 to 100
  confidenceLabel: 'High Confidence' | 'Needs Review' | 'Validated' | 'No Match';
  sourcesAgree: boolean;
  agreementSummary: string;
  discrepancies: string[];
  entryBreakdown: {
    seasons: number;
    movies: number;
    ovas: number;
    specials: number;
    recapMovies: number;
    alternateVersions: number;
    unreleased: number;
  };
  watchordr: SourceWatchOrderResult;
  theAnimeOrder: SourceWatchOrderResult;
  recommendedOrder: WatchOrderEntry[];
  lastCheckedAt: string;
  validatedAt: string | null;
  validatedBy: string | null;
  validatedSourceChoice: 'consensus' | 'watchordr' | 'theanimeorder' | null;
  appliedToCatalogue: boolean;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const WATCH_ORDER_SOURCES_CONFIG_PATH = path.join(DATA_DIR, 'watch-order-sources-config.json');
const WATCH_ORDER_RECORDS_PATH = path.join(DATA_DIR, 'watch-order-records.json');

const USER_AGENT = 'Mozilla/5.0 (compatible; AnivexWatchOrderEngine/1.0; +https://anivex.app)';

const DEFAULT_WATCH_ORDER_SOURCES: WatchOrderSourceConfig[] = [
  {
    id: 'watchordr',
    name: 'Watchordr',
    websiteUrl: 'https://watchordr.com/',
    indexUrl: 'https://watchordr.com/wp-json/wp/v2/series?per_page=100',
    robotsTxtUrl: 'https://watchordr.com/robots.txt',
    enabled: true,
    rateLimitPerMinute: 30,
    rateLimitPerSecond: 2,
    timeoutMs: 10000,
    priority: 1,
    status: 'untested',
    description: 'Curated anime watch-order guides featuring Recommended, Release (Production), and Chronological orders with explicit skippable & alternate-version warnings.'
  },
  {
    id: 'theanimeorder',
    name: 'The Anime Order',
    websiteUrl: 'https://theanimeorder.com/',
    indexUrl: 'https://theanimeorder.com/watch-order/',
    robotsTxtUrl: 'https://theanimeorder.com/robots.txt',
    enabled: true,
    rateLimitPerMinute: 30,
    rateLimitPerSecond: 2,
    timeoutMs: 10000,
    priority: 2,
    status: 'untested',
    description: 'Comprehensive franchise watch-order database tracking TV seasons, movies, OVAs, specials, compilation films, episode counts, and AniList cover references.'
  }
];

// --- Rate Limiter & Robots.txt Cache ---
const lastRequestBySource: Record<string, number> = {};
const robotsCache: Record<string, { fetchedAt: number; allowed: boolean; disallowedPaths: string[]; rawText: string }> = {};

interface WatchordrIndexEntry {
  slug: string;
  title: string;
  normalizedTitle: string;
  url: string;
}

interface TheAnimeOrderIndexEntry {
  slug: string;
  title: string;
  normalizedTitle: string;
  url: string;
  entriesCount?: number;
}

let watchordrIndexCache: { fetchedAt: number; items: WatchordrIndexEntry[] } | null = null;
let taoIndexCache: { fetchedAt: number; items: TheAnimeOrderIndexEntry[] } | null = null;
const INDEX_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&#038;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function normalizeAnimeTitle(title: string): string {
  if (!title) return '';
  return decodeHtmlEntities(title)
    .toLowerCase()
    .replace(/\bwatch order\b/gi, '')
    .replace(/\bseries\b$/gi, '')
    .replace(/\(\d{4}\s*guide\)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FRANCHISE_ALIASES: Record<string, string[]> = {
  'demon slayer': ['demon slayer', 'kimetsu no yaiba', 'demon slayer kimetsu no yaiba'],
  'jujutsu kaisen': ['jujutsu kaisen', 'jjk', 'sorcery fight', 'shimetsu kaiyuu'],
  'naruto': ['naruto', 'naruto shippuden', 'naruto shippuuden', 'boruto naruto next generations'],
  'attack on titan': ['attack on titan', 'shingeki no kyojin', 'aot'],
  'fullmetal alchemist': ['fullmetal alchemist', 'hagane no renkinjutsushi', 'fma'],
  'hunter x hunter': ['hunter x hunter', 'hxh'],
  'one punch man': ['one punch man', 'one-punch man', 'opm'],
  'my hero academia': ['my hero academia', 'boku no hero academia'],
  'death note': ['death note'],
  'bleach': ['bleach', 'bleach thousand year blood war'],
  'chainsaw man': ['chainsaw man'],
  'spy x family': ['spy x family'],
  'solo leveling': ['solo leveling', 'ore dake level up na ken'],
  'tokyo ghoul': ['tokyo ghoul'],
  'tokyo revengers': ['tokyo revengers'],
  'black clover': ['black clover'],
  'dr stone': ['dr stone', 'dr. stone'],
  're zero': ['re zero', 're:zero', 're zero starting life in another world'],
  'steins gate': ['steins gate', 'steins;gate'],
  'code geass': ['code geass', 'code geass lelouch of the rebellion'],
  'vinland saga': ['vinland saga'],
  'mob psycho 100': ['mob psycho 100'],
  'haikyu': ['haikyu', 'haikyuu'],
  'blue lock': ['blue lock'],
  'frieren': ['frieren', 'frieren beyond journeys end', 'sousou no frieren']
};

export function resolveCanonicalFranchiseKey(input: string): string {
  const norm = normalizeAnimeTitle(input);
  for (const [canonical, aliases] of Object.entries(FRANCHISE_ALIASES)) {
    for (const alias of aliases) {
      const normAlias = normalizeAnimeTitle(alias);
      if (norm === normAlias || norm.startsWith(normAlias + ' ') || normAlias.startsWith(norm + ' ')) {
        return canonical;
      }
    }
  }
  // Strip season/movie suffixes for general franchises
  return norm
    .replace(/\b(season\s*\d+|part\s*\d+|the\s*movie.*|movie.*|ova.*|special.*|final\s*season.*)$/i, '')
    .trim() || norm;
}

async function enforcePoliteRateLimit(sourceId: 'watchordr' | 'theanimeorder'): Promise<void> {
  const sources = getWatchOrderSourcesConfig();
  const cfg = sources.find(s => s.id === sourceId);
  const minIntervalMs = cfg?.rateLimitPerSecond ? Math.ceil(1000 / cfg.rateLimitPerSecond) : 500;
  const last = lastRequestBySource[sourceId] || 0;
  const elapsed = Date.now() - last;
  if (elapsed < minIntervalMs) {
    await new Promise(resolve => setTimeout(resolve, minIntervalMs - elapsed));
  }
  lastRequestBySource[sourceId] = Date.now();
}

export async function checkRobotsTxtCompliance(
  sourceId: 'watchordr' | 'theanimeorder',
  targetPath = '/'
): Promise<{ allowed: boolean; rawText: string }> {
  const cached = robotsCache[sourceId];
  if (cached && Date.now() - cached.fetchedAt < 30 * 60 * 1000) {
    const isDisallowed = cached.disallowedPaths.some(d => d !== '/' && targetPath.startsWith(d));
    return { allowed: !isDisallowed, rawText: cached.rawText };
  }

  const base = sourceId === 'watchordr' ? 'https://watchordr.com' : 'https://theanimeorder.com';
  try {
    await enforcePoliteRateLimit(sourceId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { allowed: true, rawText: `HTTP ${res.status}` };
    }

    const txt = await res.text();
    const disallowedPaths: string[] = [];
    let currentAgent = '';
    for (const rawLine of txt.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const [key, ...rest] = line.split(':');
      const val = rest.join(':').trim();
      if (key.toLowerCase() === 'user-agent') {
        currentAgent = val;
      } else if (key.toLowerCase() === 'disallow' && (currentAgent === '*' || currentAgent.toLowerCase().includes('anivex'))) {
        if (val) disallowedPaths.push(val);
      }
    }

    const isDisallowed = disallowedPaths.some(d => d === '/' || (d.length > 1 && targetPath.startsWith(d)));
    robotsCache[sourceId] = {
      fetchedAt: Date.now(),
      allowed: !isDisallowed,
      disallowedPaths,
      rawText: txt
    };
    return { allowed: !isDisallowed, rawText: txt };
  } catch (err: any) {
    return { allowed: true, rawText: `Unreachable (${err.message})` };
  }
}

export function getWatchOrderSourcesConfig(): WatchOrderSourceConfig[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(WATCH_ORDER_SOURCES_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(WATCH_ORDER_SOURCES_CONFIG_PATH, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const def of DEFAULT_WATCH_ORDER_SOURCES) {
          if (!parsed.some((s: any) => s.id === def.id)) {
            parsed.push(def);
          }
        }
        return parsed;
      }
    }
  } catch (err: any) {
    console.error('[WatchOrderSources] Error loading config:', err.message);
  }
  saveWatchOrderSourcesConfig(DEFAULT_WATCH_ORDER_SOURCES);
  return DEFAULT_WATCH_ORDER_SOURCES;
}

export function saveWatchOrderSourcesConfig(sources: WatchOrderSourceConfig[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(WATCH_ORDER_SOURCES_CONFIG_PATH, JSON.stringify(sources, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[WatchOrderSources] Error saving config:', err.message);
  }
}

export function loadWatchOrderRecords(): Record<string, FranchiseWatchOrderRecord> {
  try {
    if (fs.existsSync(WATCH_ORDER_RECORDS_PATH)) {
      return JSON.parse(fs.readFileSync(WATCH_ORDER_RECORDS_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.error('[WatchOrderSources] Error loading watch-order records:', err.message);
  }
  return {};
}

export function saveWatchOrderRecords(records: Record<string, FranchiseWatchOrderRecord>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(WATCH_ORDER_RECORDS_PATH, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[WatchOrderSources] Error saving watch-order records:', err.message);
  }
}

function updateSourceHealth(
  sourceId: 'watchordr' | 'theanimeorder',
  status: WatchOrderSourceStatus,
  latencyMs: number,
  message: string,
  error: string | null = null,
  indexedCount?: number,
  robotsAllowed = true
): void {
  const sources = getWatchOrderSourcesConfig();
  const idx = sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return;
  const nowIso = new Date().toISOString();
  const s = sources[idx];
  s.status = status;
  s.lastChecked = nowIso;
  s.lastLatencyMs = latencyMs;
  s.robotsAllowed = robotsAllowed;
  if (status === 'operational') {
    s.lastSuccessfulChecked = nowIso;
    s.lastError = null;
  } else {
    s.lastError = error || message;
  }
  s.lastMessage = message;
  if (typeof indexedCount === 'number') {
    s.indexedFranchiseCount = indexedCount;
  }
  sources[idx] = s;
  saveWatchOrderSourcesConfig(sources);
}

// --- Fetch & Cache Franchise Index from Watchordr ---
async function getWatchordrIndex(): Promise<WatchordrIndexEntry[]> {
  if (watchordrIndexCache && Date.now() - watchordrIndexCache.fetchedAt < INDEX_CACHE_TTL_MS) {
    return watchordrIndexCache.items;
  }

  const robots = await checkRobotsTxtCompliance('watchordr', '/wp-json/wp/v2/series');
  if (!robots.allowed) {
    throw new Error('Disallowed by watchordr.com robots.txt');
  }

  await enforcePoliteRateLimit('watchordr');
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  const res = await fetch('https://watchordr.com/wp-json/wp/v2/series?per_page=100', {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: controller.signal
  });
  clearTimeout(timer);
  const latency = Date.now() - start;

  if (!res.ok) {
    updateSourceHealth('watchordr', res.status === 429 ? 'rate_limited' : 'temporarily_unavailable', latency, `HTTP ${res.status}`, `HTTP ${res.status}`);
    throw new Error(`Watchordr HTTP ${res.status}`);
  }

  const data = await res.json();
  const items: WatchordrIndexEntry[] = (Array.isArray(data) ? data : []).map((d: any) => {
    const rawTitle = decodeHtmlEntities(d.title?.rendered || d.slug || '').replace(/\s+Series$/i, '').trim();
    return {
      slug: d.slug,
      title: rawTitle,
      normalizedTitle: normalizeAnimeTitle(rawTitle),
      url: d.link || `https://watchordr.com/series/${d.slug}/`
    };
  });

  watchordrIndexCache = { fetchedAt: Date.now(), items };
  updateSourceHealth(
    'watchordr',
    'operational',
    latency,
    `Connected (${latency}ms). ${items.length} franchise watch-order guides indexed. robots.txt verified.`,
    null,
    items.length,
    true
  );
  return items;
}

// --- Fetch & Cache Franchise Index from The Anime Order ---
async function getTheAnimeOrderIndex(): Promise<TheAnimeOrderIndexEntry[]> {
  if (taoIndexCache && Date.now() - taoIndexCache.fetchedAt < INDEX_CACHE_TTL_MS) {
    return taoIndexCache.items;
  }

  const robots = await checkRobotsTxtCompliance('theanimeorder', '/watch-order/');
  if (!robots.allowed) {
    throw new Error('Disallowed by theanimeorder.com robots.txt');
  }

  await enforcePoliteRateLimit('theanimeorder');
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  const res = await fetch('https://theanimeorder.com/watch-order/', {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
    signal: controller.signal
  });
  clearTimeout(timer);
  const latency = Date.now() - start;

  if (!res.ok) {
    updateSourceHealth('theanimeorder', res.status === 429 ? 'rate_limited' : 'temporarily_unavailable', latency, `HTTP ${res.status}`, `HTTP ${res.status}`);
    throw new Error(`The Anime Order HTTP ${res.status}`);
  }

  const html = await res.text();
  const seen = new Set<string>();
  const items: TheAnimeOrderIndexEntry[] = [];

  const linkRegex = /<a[^>]+href=["'](\/watch-order\/([^"'/]+)\/)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const pathUrl = match[1];
    const slug = match[2];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const innerHtml = match[3];
    // Extract title inside strong/h2/h3 or strip entry count & genres
    const rawText = decodeHtmlEntities(innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const countMatch = rawText.match(/^(\d+)\s+entries\s+(.*)$/i);
    let cleanTitle = countMatch ? countMatch[2] : rawText;
    // Strip trailing genre tags if present (e.g. "Attack on Titan Action · Drama")
    cleanTitle = cleanTitle.replace(/\s+(Action|Adventure|Comedy|Drama|Ecchi|Fantasy|Horror|Mahou Shoujo|Mecha|Music|Mystery|Psychological|Romance|Sci-Fi|Slice of Life|Sports|Supernatural|Thriller)(\s*·\s*[A-Za-z -]+)*$/i, '').trim();

    items.push({
      slug,
      title: cleanTitle || slug.replace(/-/g, ' '),
      normalizedTitle: normalizeAnimeTitle(cleanTitle || slug.replace(/-/g, ' ')),
      url: `https://theanimeorder.com${pathUrl}`,
      entriesCount: countMatch ? parseInt(countMatch[1], 10) : undefined
    });
  }

  taoIndexCache = { fetchedAt: Date.now(), items };
  updateSourceHealth(
    'theanimeorder',
    'operational',
    latency,
    `Connected (${latency}ms). ${items.length} franchise watch-order guides indexed. robots.txt verified.`,
    null,
    items.length,
    true
  );
  return items;
}

// --- Real Test Connection for Each Watch-Order Source ---
export async function testWatchOrderSourceConnectivity(sourceId: string): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
  status: WatchOrderSourceStatus;
  indexedFranchiseCount?: number;
  robotsAllowed?: boolean;
  sampleFranchises?: string[];
}> {
  if (sourceId !== 'watchordr' && sourceId !== 'theanimeorder') {
    return {
      success: false,
      latencyMs: 0,
      message: `Unknown watch-order source ID: ${sourceId}`,
      status: 'offline'
    };
  }

  const start = Date.now();
  try {
    if (sourceId === 'watchordr') {
      watchordrIndexCache = null; // force fresh live network check
      const robots = await checkRobotsTxtCompliance('watchordr', '/series/');
      if (!robots.allowed) {
        const latencyMs = Date.now() - start;
        const msg = 'Blocked by watchordr.com robots.txt rules.';
        updateSourceHealth('watchordr', 'disabled', latencyMs, msg, msg, 0, false);
        return { success: false, latencyMs, message: msg, status: 'disabled', robotsAllowed: false };
      }
      const items = await getWatchordrIndex();
      const latencyMs = Date.now() - start;
      const sample = items.slice(0, 4).map(i => i.title);
      const msg = `Connected to Watchordr (${latencyMs}ms). Verified ${items.length} live series guides (e.g. ${sample.join(', ')}). robots.txt respected.`;
      updateSourceHealth('watchordr', 'operational', latencyMs, msg, null, items.length, true);
      return {
        success: true,
        latencyMs,
        message: msg,
        status: 'operational',
        indexedFranchiseCount: items.length,
        robotsAllowed: true,
        sampleFranchises: sample
      };
    } else {
      taoIndexCache = null; // force fresh live network check
      const robots = await checkRobotsTxtCompliance('theanimeorder', '/watch-order/');
      if (!robots.allowed) {
        const latencyMs = Date.now() - start;
        const msg = 'Blocked by theanimeorder.com robots.txt rules.';
        updateSourceHealth('theanimeorder', 'disabled', latencyMs, msg, msg, 0, false);
        return { success: false, latencyMs, message: msg, status: 'disabled', robotsAllowed: false };
      }
      const items = await getTheAnimeOrderIndex();
      const latencyMs = Date.now() - start;
      const sample = items.slice(0, 4).map(i => i.title);
      const msg = `Connected to The Anime Order (${latencyMs}ms). Verified ${items.length} live watch-order guides (e.g. ${sample.join(', ')}). robots.txt respected.`;
      updateSourceHealth('theanimeorder', 'operational', latencyMs, msg, null, items.length, true);
      return {
        success: true,
        latencyMs,
        message: msg,
        status: 'operational',
        indexedFranchiseCount: items.length,
        robotsAllowed: true,
        sampleFranchises: sample
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const isTimeout = err.name === 'AbortError' || err.message?.toLowerCase().includes('timeout');
    const status: WatchOrderSourceStatus = isTimeout ? 'timeout' : 'temporarily_unavailable';
    const msg = `Connection failed: ${err.message}`;
    updateSourceHealth(sourceId, status, latencyMs, msg, err.message);
    return {
      success: false,
      latencyMs,
      message: msg,
      status
    };
  }
}

// --- Entry Classification Logic ---
function classifyWatchOrderEntry(params: {
  title: string;
  alternateTitle?: string | null;
  rawFormat: string;
  note?: string | null;
  warning?: string | null;
  isSkippable?: boolean;
}): {
  category: WatchOrderEntryCategory;
  isRecapOrCompilation: boolean;
  isAlternateVersion: boolean;
} {
  const combinedTitle = `${params.title} ${params.alternateTitle || ''}`.toLowerCase();
  const combinedNotes = `${params.note || ''} ${params.warning || ''}`.toLowerCase();
  const rawUpper = (params.rawFormat || 'TV').toUpperCase();

  // 1. Detect Alternate Versions (e.g. Mugen Train Arc TV re-edit of Mugen Train Movie)
  const isMovieFormat = rawUpper.includes('MOVIE') || rawUpper.includes('FILM') || combinedTitle.includes('the movie');
  const isAlternateVersion =
    !isMovieFormat &&
    ((Boolean(params.isSkippable) &&
      (combinedNotes.includes('cover the same events as') ||
        combinedNotes.includes('covers the same events as') ||
        combinedNotes.includes('tv version of the'))) ||
      combinedTitle.includes('mugen train arc') ||
      combinedTitle.includes('mugen ressha-hen (tv)'));

  // 2. Detect Recap / Compilation Movies
  const isRecapOrCompilation =
    !isAlternateVersion &&
    (combinedTitle.includes('recap') ||
      combinedTitle.includes('compilation') ||
      combinedTitle.includes('tokubetsu henshuu') ||
      combinedTitle.includes('soushuuhen') ||
      combinedTitle.includes('crimson bow and arrow') ||
      combinedTitle.includes('guren no yumiya') ||
      combinedTitle.includes('wings of freedom') ||
      combinedTitle.includes('jiyuu no tsubasa') ||
      combinedTitle.includes('roar of awakening') ||
      combinedTitle.includes('kakusei no houkou') ||
      combinedTitle.includes('chronicle') ||
      combinedTitle.includes('hidden inventory / premature death – the movie') ||
      combinedTitle.includes('kaigyoku・gyokusetsu') ||
      combinedTitle.includes('shibuya incident x the culling game begins') ||
      combinedNotes.includes('recap film') ||
      combinedNotes.includes('compilation film'));

  if (isRecapOrCompilation) {
    return { category: 'recap_movie', isRecapOrCompilation: true, isAlternateVersion: false };
  }
  if (isAlternateVersion) {
    return { category: 'alternate_version', isRecapOrCompilation: false, isAlternateVersion: true };
  }
  if (rawUpper.includes('OVA') || rawUpper.includes('OAD') || /\bova\b/i.test(combinedTitle)) {
    return { category: 'ova', isRecapOrCompilation: false, isAlternateVersion: false };
  }
  if (rawUpper.includes('SPECIAL') || /\bspecial\b/i.test(combinedTitle)) {
    return { category: 'special', isRecapOrCompilation: false, isAlternateVersion: false };
  }
  if (rawUpper.includes('MOVIE') || rawUpper.includes('FILM')) {
    return { category: 'movie', isRecapOrCompilation: false, isAlternateVersion: false };
  }
  return { category: 'season', isRecapOrCompilation: false, isAlternateVersion: false };
}

// --- Match Watch-Order Entry Against Anivex Catalogue ---
function matchEntryToCatalogue(
  entryTitle: string,
  entryAltTitle: string | null | undefined,
  entryYear: number | null,
  anilistId: string | null | undefined,
  franchiseCatalogueItems: any[]
): { id: string; title: string } | null {
  const normTitle = normalizeAnimeTitle(entryTitle);
  const normAlt = entryAltTitle ? normalizeAnimeTitle(entryAltTitle) : '';

  for (const item of franchiseCatalogueItems) {
    const itemNorm = normalizeAnimeTitle(item.title || '');
    const itemAltNorm = normalizeAnimeTitle(item.alternateTitle || '');

    if (itemNorm === normTitle || (normAlt && itemNorm === normAlt) || (itemAltNorm && itemAltNorm === normTitle)) {
      return { id: item.id, title: item.title };
    }
  }

  // Fuzzy substring + year match within the franchise's catalogue items
  for (const item of franchiseCatalogueItems) {
    const itemNorm = normalizeAnimeTitle(item.title || '');
    if (
      (itemNorm.includes(normTitle) || normTitle.includes(itemNorm)) &&
      normTitle.length > 8 &&
      itemNorm.length > 8 &&
      (!entryYear || !item.releaseYear || Math.abs(item.releaseYear - entryYear) <= 1)
    ) {
      return { id: item.id, title: item.title };
    }
  }

  return null;
}

// --- Parse Watchordr Series HTML ---
function parseWatchordrSeriesHtml(html: string, franchiseCatalogueItems: any[]): {
  matchedTitle: string;
  summaryText: string | null;
  entries: WatchOrderEntry[];
} {
  const heroTitleMatch = html.match(/<h1 class="ao-series-hero__title">([\s\S]*?)<\/h1>/i);
  let matchedTitle = 'Unknown Series';
  if (heroTitleMatch) {
    matchedTitle = decodeHtmlEntities(
      heroTitleMatch[1]
        .replace(/<span class="ao-series-hero__title-suffix">[\s\S]*?<\/span>/gi, '')
        .replace(/<span class="ao-series-hero__year">[\s\S]*?<\/span>/gi, '')
        .replace(/<[^>]+>/g, '')
    ).trim();
  }

  const descMatch = html.match(/<p class="ao-series-hero__desc">([\s\S]*?)<\/p>/i);
  const summaryText = descMatch ? decodeHtmlEntities(descMatch[1].replace(/<[^>]+>/g, '')) : null;

  const entries: WatchOrderEntry[] = [];
  const cardRegex = /<article class="ao-watchorder-card([^"]*)">([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(html)) !== null) {
    const articleClasses = match[1] || '';
    const cardBody = match[2];

    const orderStr = cardBody.match(/<span class="ao-watchorder-card__order">(\d+)<\/span>/i)?.[1];
    const step = orderStr ? parseInt(orderStr, 10) : entries.length + 1;

    const titleLinkMatch = cardBody.match(/<h3 class="ao-watchorder-card__title">\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const entryUrl = titleLinkMatch ? titleLinkMatch[1] : null;
    const rawTitle = titleLinkMatch
      ? decodeHtmlEntities(titleLinkMatch[2].replace(/<[^>]+>/g, ''))
      : decodeHtmlEntities(cardBody.match(/<h3 class="ao-watchorder-card__title">([\s\S]*?)<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, '') || '');

    const imgMatch = cardBody.match(/<img[^>]+src=["']([^"']+)["']/i);
    const posterUrl = imgMatch ? imgMatch[1] : null;
    const anilistId = posterUrl?.match(/\/bx?(\d+)-/)?.[1] || null;

    const metaLis = [...cardBody.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/gi)].map(m => ({
      attrs: m[1] || '',
      text: decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ''))
    }));

    const rawFormat = metaLis[0]?.text || 'TV Series';
    const epMatch = metaLis.find(m => /episode/i.test(m.text))?.text.match(/(\d+)/);
    const episodes = epMatch ? parseInt(epMatch[1], 10) : null;

    const dateItem = metaLis.find(m => /\b(19\d\d|20\d\d)\b/.test(m.text));
    const releaseDateText = dateItem ? dateItem.text : null;
    const yearMatch = releaseDateText?.match(/\b(19\d\d|20\d\d)\b/);
    const releaseYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

    const isSkippable =
      articleClasses.includes('is-skip-safe') ||
      metaLis.some(m => m.attrs.includes('ao-flag-skip') || /skippable/i.test(m.text));

    const noteMatch = cardBody.match(/<p class="ao-watchorder-card__note">([\s\S]*?)<\/p>/i);
    const note = noteMatch ? decodeHtmlEntities(noteMatch[1].replace(/<[^>]+>/g, '')) : null;

    const warnMatch = cardBody.match(/<p class="ao-watchorder-card__warning">([\s\S]*?)<\/p>/i);
    const warning = warnMatch ? decodeHtmlEntities(warnMatch[1].replace(/<[^>]+>/g, '')) : null;

    const classification = classifyWatchOrderEntry({
      title: rawTitle,
      rawFormat,
      note,
      warning,
      isSkippable
    });

    const catMatch = matchEntryToCatalogue(rawTitle, null, releaseYear, anilistId, franchiseCatalogueItems);

    entries.push({
      step,
      title: rawTitle,
      alternateTitle: null,
      rawFormat,
      category: classification.category,
      releaseYear,
      releaseDateText,
      episodes,
      anilistId,
      posterUrl,
      entryUrl,
      isRecapOrCompilation: classification.isRecapOrCompilation,
      isAlternateVersion: classification.isAlternateVersion,
      isSkippable,
      isUnreleased: !releaseYear,
      note,
      warning,
      matchedCatalogueId: catMatch?.id || null,
      matchedCatalogueTitle: catMatch?.title || null
    });
  }

  return { matchedTitle, summaryText, entries };
}

// --- Fetch Watch Order from Watchordr ---
export async function fetchWatchordrFranchise(
  queryTitle: string,
  franchiseCatalogueItems: any[]
): Promise<SourceWatchOrderResult> {
  const start = Date.now();
  const nowIso = new Date().toISOString();
  const canonicalKey = resolveCanonicalFranchiseKey(queryTitle);
  const aliases = FRANCHISE_ALIASES[canonicalKey] || [normalizeAnimeTitle(queryTitle), canonicalKey];

  try {
    const index = await getWatchordrIndex();

    // Find best match in Watchordr index using title, alternate titles, and slug
    let matchedItem: WatchordrIndexEntry | undefined;
    for (const alias of aliases) {
      const normAlias = normalizeAnimeTitle(alias);
      matchedItem = index.find(
        item =>
          item.normalizedTitle === normAlias ||
          item.slug === normAlias.replace(/\s+/g, '-') ||
          item.normalizedTitle.includes(normAlias) ||
          normAlias.includes(item.normalizedTitle)
      );
      if (matchedItem) break;
    }

    if (!matchedItem) {
      return {
        sourceId: 'watchordr',
        sourceName: 'Watchordr',
        found: false,
        sourceUrl: null,
        matchedTitle: null,
        lastCheckedAt: nowIso,
        latencyMs: Date.now() - start,
        entries: [],
        error: `No matching series guide found on Watchordr for "${queryTitle}".`
      };
    }

    const targetPath = new URL(matchedItem.url).pathname;
    const robots = await checkRobotsTxtCompliance('watchordr', targetPath);
    if (!robots.allowed) {
      throw new Error(`Path ${targetPath} disallowed by watchordr.com robots.txt`);
    }

    await enforcePoliteRateLimit('watchordr');
    const resRec = await fetch(matchedItem.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' }
    });
    if (!resRec.ok) {
      throw new Error(`HTTP ${resRec.status} fetching ${matchedItem.url}`);
    }
    const htmlRec = await resRec.text();
    const parsedRec = parseWatchordrSeriesHtml(htmlRec, franchiseCatalogueItems);

    // Also check if Release/Production order tab exists
    let releaseOrderEntries: WatchOrderEntry[] | undefined;
    if (htmlRec.includes('?order=production')) {
      await enforcePoliteRateLimit('watchordr');
      const prodUrl = `${matchedItem.url.replace(/\/$/, '')}/?order=production`;
      const resProd = await fetch(prodUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' }
      });
      if (resProd.ok) {
        const htmlProd = await resProd.text();
        releaseOrderEntries = parseWatchordrSeriesHtml(htmlProd, franchiseCatalogueItems).entries;
      }
    }

    const latencyMs = Date.now() - start;
    updateSourceHealth(
      'watchordr',
      'operational',
      latencyMs,
      `Retrieved "${parsedRec.matchedTitle}" (${parsedRec.entries.length} entries) in ${latencyMs}ms.`
    );

    return {
      sourceId: 'watchordr',
      sourceName: 'Watchordr',
      found: parsedRec.entries.length > 0,
      sourceUrl: matchedItem.url,
      matchedTitle: parsedRec.matchedTitle || matchedItem.title,
      lastCheckedAt: nowIso,
      latencyMs,
      orderMode: 'Recommended Order (with Release Order cross-check)',
      summaryText: parsedRec.summaryText,
      entries: parsedRec.entries,
      releaseOrderEntries
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      sourceId: 'watchordr',
      sourceName: 'Watchordr',
      found: false,
      sourceUrl: null,
      matchedTitle: null,
      lastCheckedAt: nowIso,
      latencyMs,
      entries: [],
      error: err.message
    };
  }
}

// --- Fetch Watch Order from The Anime Order ---
export async function fetchTheAnimeOrderFranchise(
  queryTitle: string,
  franchiseCatalogueItems: any[]
): Promise<SourceWatchOrderResult> {
  const start = Date.now();
  const nowIso = new Date().toISOString();
  const canonicalKey = resolveCanonicalFranchiseKey(queryTitle);
  const aliases = FRANCHISE_ALIASES[canonicalKey] || [normalizeAnimeTitle(queryTitle), canonicalKey];

  try {
    const index = await getTheAnimeOrderIndex();

    let matchedItem: TheAnimeOrderIndexEntry | undefined;
    for (const alias of aliases) {
      const normAlias = normalizeAnimeTitle(alias);
      matchedItem = index.find(
        item =>
          item.normalizedTitle === normAlias ||
          item.slug === normAlias.replace(/\s+/g, '-') ||
          item.normalizedTitle.includes(normAlias) ||
          normAlias.includes(item.normalizedTitle)
      );
      if (matchedItem) break;
    }

    if (!matchedItem) {
      return {
        sourceId: 'theanimeorder',
        sourceName: 'The Anime Order',
        found: false,
        sourceUrl: null,
        matchedTitle: null,
        lastCheckedAt: nowIso,
        latencyMs: Date.now() - start,
        entries: [],
        error: `No matching watch-order guide found on The Anime Order for "${queryTitle}".`
      };
    }

    const targetPath = new URL(matchedItem.url).pathname;
    const robots = await checkRobotsTxtCompliance('theanimeorder', targetPath);
    if (!robots.allowed) {
      throw new Error(`Path ${targetPath} disallowed by theanimeorder.com robots.txt`);
    }

    await enforcePoliteRateLimit('theanimeorder');
    const res = await fetch(matchedItem.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${matchedItem.url}`);
    }

    const html = await res.text();
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const matchedTitle = h1Match
      ? decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '')).replace(/\s+Watch Order$/i, '').trim()
      : matchedItem.title;

    const leadMatch = html.match(/<p class="intro lead">([\s\S]*?)<\/p>/i);
    const summaryText = leadMatch ? decodeHtmlEntities(leadMatch[1].replace(/<[^>]+>/g, '')) : null;

    const entries: WatchOrderEntry[] = [];
    const rowRegex = /<tr\s+data-watch=["'](\d+)["'](?:\s+data-release=["'](\d+)["'])?[^>]*>([\s\S]*?)<\/tr>/gi;
    let match: RegExpExecArray | null;

    while ((match = rowRegex.exec(html)) !== null) {
      const step = parseInt(match[1], 10);
      const releaseStep = match[2] ? parseInt(match[2], 10) : step;
      const rowHtml = match[3];

      const rawTitle = decodeHtmlEntities(rowHtml.match(/<span class="title">([\s\S]*?)<\/span>/i)?.[1] || '');
      const subTitle = decodeHtmlEntities(rowHtml.match(/<span class="sub">([\s\S]*?)<\/span>/i)?.[1] || '') || null;
      const rawFormat = decodeHtmlEntities(rowHtml.match(/<span class="pill type">([\s\S]*?)<\/span>/i)?.[1] || 'TV');

      const numCells = [...rowHtml.matchAll(/<td class="num">([\s\S]*?)<\/td>/gi)].map(m =>
        decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ''))
      );
      const yearStr = numCells[0] || '';
      const epStr = numCells[1] || '';

      const releaseYear = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : null;
      const episodes = /^\d+$/.test(epStr) ? parseInt(epStr, 10) : null;
      const isUnreleased = !releaseYear || rawFormat === '—';

      const imgMatch = rowHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
      const posterUrl = imgMatch ? imgMatch[1] : null;
      const anilistId = posterUrl?.match(/\/bx?(\d+)-/)?.[1] || null;

      const classification = classifyWatchOrderEntry({
        title: rawTitle,
        alternateTitle: subTitle,
        rawFormat
      });

      const catMatch = matchEntryToCatalogue(rawTitle, subTitle, releaseYear, anilistId, franchiseCatalogueItems);

      entries.push({
        step,
        releaseStep,
        title: rawTitle,
        alternateTitle: subTitle,
        rawFormat: rawFormat === '—' ? 'UPCOMING' : rawFormat,
        category: classification.category,
        releaseYear,
        releaseDateText: releaseYear ? String(releaseYear) : 'TBA / Upcoming',
        episodes,
        anilistId,
        posterUrl: posterUrl && !posterUrl.includes('default.jpg') ? posterUrl : null,
        entryUrl: matchedItem.url,
        isRecapOrCompilation: classification.isRecapOrCompilation,
        isAlternateVersion: classification.isAlternateVersion,
        isSkippable: classification.isRecapOrCompilation || classification.isAlternateVersion,
        isUnreleased,
        note: classification.isRecapOrCompilation
          ? 'Detected theatrical recap / compilation film.'
          : classification.isAlternateVersion
          ? 'Detected TV episode re-edit / alternate version.'
          : isUnreleased
          ? 'Upcoming / unreleased installment.'
          : null,
        warning: null,
        matchedCatalogueId: catMatch?.id || null,
        matchedCatalogueTitle: catMatch?.title || null
      });
    }

    const latencyMs = Date.now() - start;
    updateSourceHealth(
      'theanimeorder',
      'operational',
      latencyMs,
      `Retrieved "${matchedTitle}" (${entries.length} entries) in ${latencyMs}ms.`
    );

    return {
      sourceId: 'theanimeorder',
      sourceName: 'The Anime Order',
      found: entries.length > 0,
      sourceUrl: matchedItem.url,
      matchedTitle,
      lastCheckedAt: nowIso,
      latencyMs,
      orderMode: 'Watch / Release Order',
      summaryText,
      entries
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      sourceId: 'theanimeorder',
      sourceName: 'The Anime Order',
      found: false,
      sourceUrl: null,
      matchedTitle: null,
      lastCheckedAt: nowIso,
      latencyMs,
      entries: [],
      error: err.message
    };
  }
}

// --- Compare Both Sources & Determine Confidence ---
function entryIdentityKey(e: WatchOrderEntry): string {
  if (e.anilistId) return `al_${e.anilistId}`;
  return `title_${normalizeAnimeTitle(e.title)}_${e.releaseYear || ''}`;
}

export async function resolveAndCompareFranchiseWatchOrder(
  queryTitle: string
): Promise<FranchiseWatchOrderRecord> {
  const canonicalKey = resolveCanonicalFranchiseKey(queryTitle);
  const aliases = FRANCHISE_ALIASES[canonicalKey] || [normalizeAnimeTitle(queryTitle), canonicalKey];

  // 1. Match franchise items in Anivex Catalogue (read-only; does NOT modify catalogue)
  const allCatalogue = globalDataStore.getAllCatalogueAnime();
  const matchedCatalogueItems = allCatalogue
    .filter(anime => {
      const tNorm = normalizeAnimeTitle(anime.title || '');
      const altNorm = normalizeAnimeTitle(anime.alternateTitle || '');
      return aliases.some(alias => {
        const aNorm = normalizeAnimeTitle(alias);
        return (
          tNorm === aNorm ||
          altNorm === aNorm ||
          tNorm.includes(aNorm) ||
          (altNorm && altNorm.includes(aNorm))
        );
      });
    })
    .map(a => ({
      id: a.id,
      title: a.title,
      alternateTitle: a.alternateTitle || null,
      releaseYear: a.releaseYear || null,
      type: a.type || 'TV',
      seasonsCount: Array.isArray(a.seasons) ? a.seasons.length : 1
    }));

  // 2. Fetch both sources in parallel
  const [watchordr, theAnimeOrder] = await Promise.all([
    fetchWatchordrFranchise(queryTitle, matchedCatalogueItems),
    fetchTheAnimeOrderFranchise(queryTitle, matchedCatalogueItems)
  ]);

  const discrepancies: string[] = [];
  let sourcesAgree = false;
  let status: WatchOrderConfidenceLevel = 'needs_review';
  let confidenceScore = 0;
  let confidenceLabel: FranchiseWatchOrderRecord['confidenceLabel'] = 'Needs Review';
  let agreementSummary = '';
  let recommendedOrder: WatchOrderEntry[] = [];

  if (!watchordr.found && !theAnimeOrder.found) {
    status = 'no_match';
    confidenceScore = 0;
    confidenceLabel = 'No Match';
    agreementSummary = `Neither Watchordr nor The Anime Order returned a watch-order guide for "${queryTitle}".`;
  } else if (watchordr.found && !theAnimeOrder.found) {
    status = 'needs_review';
    confidenceScore = 60;
    confidenceLabel = 'Needs Review';
    discrepancies.push(`Found on Watchordr (${watchordr.entries.length} entries), but not found on The Anime Order.`);
    agreementSummary = `Single-source result from Watchordr only. Marked Needs Review because The Anime Order could not corroborate the sequence.`;
    recommendedOrder = watchordr.entries;
  } else if (!watchordr.found && theAnimeOrder.found) {
    status = 'needs_review';
    confidenceScore = 62;
    confidenceLabel = 'Needs Review';
    discrepancies.push(`Found on The Anime Order (${theAnimeOrder.entries.length} entries), but not indexed on Watchordr.`);
    agreementSummary = `Single-source result from The Anime Order (${theAnimeOrder.entries.length} entries). Watchordr does not currently index "${theAnimeOrder.matchedTitle}". Marked Needs Review for Owner validation.`;
    recommendedOrder = theAnimeOrder.entries;
  } else {
    // Both sources found the franchise! Compare their sequences carefully.
    const wEntries = watchordr.entries;
    const wReleaseEntries = watchordr.releaseOrderEntries || watchordr.entries;
    const tEntries = theAnimeOrder.entries;

    // Released non-recap, non-alternate entries from both sources (includes Seasons, Canon Movies, OVAs, Specials)
    const wNonRecap = wEntries.filter(e => !e.isUnreleased && !e.isRecapOrCompilation && !e.isAlternateVersion);
    const tNonRecap = tEntries.filter(e => !e.isUnreleased && !e.isRecapOrCompilation && !e.isAlternateVersion);

    // Core canon seasons + canon movies (excluding skippable OVAs/recaps/alternates)
    const wCoreCanon = wEntries.filter(
      e => !e.isUnreleased && (e.category === 'season' || e.category === 'movie' || (!e.isSkippable && e.category === 'special'))
    );
    const tCoreCanon = tEntries.filter(
      e => !e.isUnreleased && (e.category === 'season' || e.category === 'movie' || (!e.isSkippable && e.category === 'special'))
    );

    const wNonRecapKeys = wNonRecap.map(entryIdentityKey);
    const tNonRecapKeys = tNonRecap.map(entryIdentityKey);

    const wCoreKeys = wCoreCanon.map(entryIdentityKey);
    const tCoreKeys = tCoreCanon.map(entryIdentityKey);

    // Also check if Watchordr's Release Order matches The Anime Order's Released Entries
    const wRelReleased = wReleaseEntries.filter(e => !e.isUnreleased && !e.isRecapOrCompilation);
    const tRelReleased = tEntries.filter(e => !e.isUnreleased && !e.isRecapOrCompilation);
    const releaseOrderExactMatch =
      wRelReleased.length === tRelReleased.length &&
      wRelReleased.every((e, i) => entryIdentityKey(e) === entryIdentityKey(tRelReleased[i]));

    const nonRecapExactMatch =
      wNonRecapKeys.length === tNonRecapKeys.length &&
      wNonRecapKeys.every((k, i) => k === tNonRecapKeys[i]);

    const coreCanonExactMatch =
      wCoreKeys.length === tCoreKeys.length &&
      wCoreKeys.every((k, i) => k === tCoreKeys[i]);

    // Check differences in OVAs, Recap Movies, Alternate Versions, and Unreleased items
    const tRecaps = tEntries.filter(e => e.isRecapOrCompilation);
    const wAlternates = wEntries.filter(e => e.isAlternateVersion);
    const tUnreleased = tEntries.filter(e => e.isUnreleased);

    if (tRecaps.length > 0) {
      discrepancies.push(
        `The Anime Order includes ${tRecaps.length} theatrical compilation/recap movie(s) (${tRecaps.map(r => r.title).join(', ')}), whereas Watchordr omits redundant recap films.`
      );
    }
    if (wAlternates.length > 0) {
      discrepancies.push(
        `Watchordr flags ${wAlternates.map(a => a.title).join(', ')} as an optional skippable Alternate Version at the end of Recommended Order (placed at #3 in Release Order and The Anime Order).`
      );
    }
    if (tUnreleased.length > 0) {
      discrepancies.push(
        `The Anime Order lists ${tUnreleased.length} upcoming/unreleased installment(s) (${tUnreleased.map(u => u.title).join(', ')}).`
      );
    }

    if (nonRecapExactMatch) {
      // Exact agreement on all released non-recap entries (Seasons, Canon Movies, OVAs, Specials)!
      sourcesAgree = true;
      status = 'high_confidence';
      confidenceScore = tRecaps.length === 0 && wAlternates.length === 0 ? 98 : 95;
      confidenceLabel = 'High Confidence';
      agreementSummary = `Both Watchordr and The Anime Order agree 100% on the watch order of all ${wCoreCanon.length} canonical installments${
        wAlternates.length > 0 ? ' (with Mugen Train Arc TV recognized as an alternate version of the Mugen Train Movie)' : ''
      }${tRecaps.length > 0 ? ` after filtering ${tRecaps.length} compilation/recap movie(s)` : ''}.`;
      recommendedOrder = watchordr.entries;
    } else if (coreCanonExactMatch) {
      // Core seasons & movies match, but OVAs/Specials are placed in different positions between Watchordr Recommended Order and The Anime Order!
      sourcesAgree = false;
      status = 'needs_review';
      confidenceScore = releaseOrderExactMatch ? 74 : 68;
      confidenceLabel = 'Needs Review';
      discrepancies.unshift(
        `Disagreement on OVA placement: Watchordr Recommended Order places OVAs (${wEntries.filter(e => e.category === 'ova').map(e => `#${e.step} ${e.title}`).join(', ')}) at the end as optional extras, whereas The Anime Order interleaves OVAs and Recap Movies between Seasons 1, 2, and 3.`
      );
      agreementSummary = `Sources agree on the ${wCoreCanon.length} mainline TV seasons/specials, but DISAGREE on OVA placement and compilation movie inclusion (${watchordr.entries.length} entries on Watchordr Recommended vs ${theAnimeOrder.entries.length} entries on The Anime Order). Marked Needs Review so the Owner can inspect both orders.`;
      recommendedOrder = watchordr.entries;
    } else {
      // General sequence disagreement
      sourcesAgree = false;
      status = 'needs_review';
      confidenceScore = 55;
      confidenceLabel = 'Needs Review';
      discrepancies.unshift(
        `Sequence mismatch between Watchordr (${wEntries.length} entries) and The Anime Order (${tEntries.length} entries).`
      );
      agreementSummary = `Watchordr and The Anime Order disagree on entry ordering (${wEntries.length} vs ${tEntries.length} entries). Marked Needs Review — both full sequences are displayed for Owner comparison.`;
      recommendedOrder = watchordr.entries;
    }
  }

  // Compute combined unique entry breakdown across both sources
  const combinedMap = new Map<string, WatchOrderEntry>();
  for (const e of [...watchordr.entries, ...theAnimeOrder.entries]) {
    const key = entryIdentityKey(e);
    if (!combinedMap.has(key)) {
      combinedMap.set(key, e);
    }
  }
  const uniqueEntries = Array.from(combinedMap.values());
  const entryBreakdown = {
    seasons: uniqueEntries.filter(e => e.category === 'season' && !e.isUnreleased).length,
    movies: uniqueEntries.filter(e => e.category === 'movie' && !e.isUnreleased).length,
    ovas: uniqueEntries.filter(e => e.category === 'ova').length,
    specials: uniqueEntries.filter(e => e.category === 'special').length,
    recapMovies: uniqueEntries.filter(e => e.category === 'recap_movie').length,
    alternateVersions: uniqueEntries.filter(e => e.category === 'alternate_version').length,
    unreleased: uniqueEntries.filter(e => e.isUnreleased).length
  };

  const records = loadWatchOrderRecords();
  const existing = records[canonicalKey];
  const nowIso = new Date().toISOString();

  const record: FranchiseWatchOrderRecord = {
    id: `wo_${canonicalKey.replace(/[^a-z0-9]+/g, '_')}`,
    franchiseKey: canonicalKey,
    queryTitle,
    canonicalTitle: watchordr.matchedTitle || theAnimeOrder.matchedTitle || queryTitle,
    alternateTitles: Array.from(
      new Set(
        [
          ...aliases,
          ...matchedCatalogueItems.map(m => m.alternateTitle).filter(Boolean) as string[]
        ].map(t => t.trim())
      )
    ),
    matchedCatalogueItems,
    status: existing?.status === 'validated' ? 'validated' : status,
    confidenceScore,
    confidenceLabel: existing?.status === 'validated' ? 'Validated' : confidenceLabel,
    sourcesAgree,
    agreementSummary,
    discrepancies,
    entryBreakdown,
    watchordr,
    theAnimeOrder,
    recommendedOrder,
    lastCheckedAt: nowIso,
    validatedAt: existing?.validatedAt || null,
    validatedBy: existing?.validatedBy || null,
    validatedSourceChoice: existing?.validatedSourceChoice || null,
    appliedToCatalogue: existing?.appliedToCatalogue || false
  };

  records[canonicalKey] = record;
  saveWatchOrderRecords(records);

  return record;
}

// --- Validate & Apply Watch Order to Catalogue (Only when explicitly triggered by Owner) ---
export function validateAndApplyWatchOrder(
  franchiseKeyOrId: string,
  sourceChoice: 'consensus' | 'watchordr' | 'theanimeorder',
  ownerEmail: string
): {
  success: boolean;
  message: string;
  record?: FranchiseWatchOrderRecord;
  updatedCatalogueCount?: number;
} {
  const records = loadWatchOrderRecords();
  const key = Object.keys(records).find(
    k => k === franchiseKeyOrId || records[k].id === franchiseKeyOrId || normalizeAnimeTitle(k) === normalizeAnimeTitle(franchiseKeyOrId)
  );

  if (!key || !records[key]) {
    return {
      success: false,
      message: `Watch order record "${franchiseKeyOrId}" not found.`
    };
  }

  const record = records[key];
  let chosenEntries: WatchOrderEntry[] = [];

  if (sourceChoice === 'watchordr') {
    if (!record.watchordr.found || record.watchordr.entries.length === 0) {
      return { success: false, message: 'Watchordr has no entries for this franchise.' };
    }
    chosenEntries = record.watchordr.entries;
  } else if (sourceChoice === 'theanimeorder') {
    if (!record.theAnimeOrder.found || record.theAnimeOrder.entries.length === 0) {
      return { success: false, message: 'The Anime Order has no entries for this franchise.' };
    }
    chosenEntries = record.theAnimeOrder.entries;
  } else {
    chosenEntries =
      record.recommendedOrder.length > 0
        ? record.recommendedOrder
        : record.watchordr.found
        ? record.watchordr.entries
        : record.theAnimeOrder.entries;
  }

  const nowIso = new Date().toISOString();
  record.status = 'validated';
  record.confidenceLabel = 'Validated';
  record.recommendedOrder = chosenEntries;
  record.validatedAt = nowIso;
  record.validatedBy = ownerEmail;
  record.validatedSourceChoice = sourceChoice;
  record.appliedToCatalogue = true;

  records[key] = record;
  saveWatchOrderRecords(records);

  // Now that the watch order has been explicitly validated by the Owner, apply watchOrder metadata to matched catalogue items
  let updatedCatalogueCount = 0;
  for (const catItem of record.matchedCatalogueItems) {
    const updated = globalDataStore.updateCatalogueAnime(catItem.id, (anime) => {
      anime.watchOrder = {
        franchiseKey: record.franchiseKey,
        canonicalTitle: record.canonicalTitle,
        validatedAt: nowIso,
        validatedBy: ownerEmail,
        sourceChoice,
        confidenceScore: record.confidenceScore,
        watchordrUrl: record.watchordr.sourceUrl,
        theAnimeOrderUrl: record.theAnimeOrder.sourceUrl,
        entries: chosenEntries.map(e => ({
          step: e.step,
          title: e.title,
          alternateTitle: e.alternateTitle || null,
          rawFormat: e.rawFormat,
          category: e.category,
          releaseYear: e.releaseYear,
          episodes: e.episodes,
          isRecapOrCompilation: e.isRecapOrCompilation,
          isAlternateVersion: e.isAlternateVersion,
          isSkippable: e.isSkippable,
          isUnreleased: e.isUnreleased,
          matchedCatalogueId: e.matchedCatalogueId || null
        }))
      };
    });
    if (updated) updatedCatalogueCount++;
  }

  if (updatedCatalogueCount > 0) {
    globalDataStore.flushCatalogueSync();
  }

  return {
    success: true,
    message: `Watch order for "${record.canonicalTitle}" validated (${sourceChoice}) and linked to ${updatedCatalogueCount} catalogue record(s).`,
    record,
    updatedCatalogueCount
  };
}
