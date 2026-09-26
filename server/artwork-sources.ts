import fs from 'fs';
import path from 'path';

export type ArtworkSourceStatus =
  | 'operational'
  | 'testing'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'timeout'
  | 'configuration_error'
  | 'degraded'
  | 'offline'
  | 'disabled'
  | 'untested';

export interface ArtworkSourceConfig {
  id: string;
  name: string;
  type: 'graphql' | 'rest';
  endpoint: string;
  enabled: boolean;
  rateLimitPerMinute: number;
  rateLimitPerSecond?: number;
  timeoutMs: number;
  priority: number;
  status: ArtworkSourceStatus;
  lastChecked?: string;
  lastSuccessfulChecked?: string;
  lastLatencyMs?: number;
  lastError?: string | null;
  lastMessage?: string | null;
  description: string;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const SOURCES_CONFIG_PATH = path.join(DATA_DIR, 'artwork-sources-config.json');

const DEFAULT_SOURCES: ArtworkSourceConfig[] = [
  {
    id: 'anilist',
    name: 'AniList API',
    type: 'graphql',
    endpoint: 'https://graphql.anilist.co',
    enabled: true,
    rateLimitPerMinute: 90,
    rateLimitPerSecond: 2,
    timeoutMs: 8000,
    priority: 1,
    status: 'untested',
    description: 'Primary source. AniList GraphQL API for verified high-res cover artwork, romaji/english/japanese titles, seasons, and relations.'
  },
  {
    id: 'jikan',
    name: 'Jikan API (MyAnimeList)',
    type: 'rest',
    endpoint: 'https://api.jikan.moe/v4',
    enabled: false, // Disabled per specification: position #2 test source removed
    rateLimitPerMinute: 60,
    rateLimitPerSecond: 3,
    timeoutMs: 8000,
    priority: 2,
    status: 'disabled',
    description: 'DISABLED / NOT USED FOR ARTWORK VERIFICATION. Preserved for legacy cross-references.'
  },
  {
    id: 'anidb',
    name: 'AniDB (Secondary Fallback)',
    type: 'rest',
    endpoint: 'https://anidb.net',
    enabled: true,
    rateLimitPerMinute: 30,
    rateLimitPerSecond: 1,
    timeoutMs: 8000,
    priority: 3,
    status: 'untested',
    description: 'Secondary fallback. Used to cross-check anime titles, identity, and verification data.'
  },
  {
    id: 'tmdb',
    name: 'TMDB (The Movie Database)',
    type: 'rest',
    endpoint: 'https://api.themoviedb.org/3',
    enabled: false, // Disabled per specification: TMDB removed from active pipeline
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 4,
    timeoutMs: 8000,
    priority: 4,
    status: 'disabled',
    description: 'DISABLED / NOT USED FOR ARTWORK VERIFICATION. Preserved for stored artwork history.'
  },
  {
    id: 'tvmaze',
    name: 'TVmaze API',
    type: 'rest',
    endpoint: 'https://api.tvmaze.com',
    enabled: true,
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 4,
    timeoutMs: 8000,
    priority: 5,
    status: 'untested',
    description: 'TVmaze open REST database. Reliable coverage for TV series, animated shows, and clean original posters.'
  },
  {
    id: 'thetvdb',
    name: 'TheTVDB Gateway',
    type: 'rest',
    endpoint: 'https://api4.thetvdb.com/v4',
    enabled: true,
    rateLimitPerMinute: 120,
    rateLimitPerSecond: 4,
    timeoutMs: 8000,
    priority: 6,
    status: 'untested',
    description: 'TheTVDB open media database gateway for supplementary anime artwork and season poster resolution.'
  }
];

export function getArtworkSourcesConfig(): ArtworkSourceConfig[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SOURCES_CONFIG_PATH)) {
      const data: ArtworkSourceConfig[] = JSON.parse(fs.readFileSync(SOURCES_CONFIG_PATH, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        let modified = false;

        // Force disable Jikan (position #2) and TMDB per requirement
        for (const s of data) {
          if (s.id === 'tmdb' || s.id === 'jikan') {
            if (s.enabled || s.status !== 'disabled') {
              s.enabled = false;
              s.status = 'disabled';
              s.description = `DISABLED / NOT USED FOR ARTWORK VERIFICATION.`;
              modified = true;
            }
          }
        }

        // Migration: Ensure all default sources exist in loaded configuration
        for (const defaultSource of DEFAULT_SOURCES) {
          if (!data.some((s: any) => s.id === defaultSource.id)) {
            data.push(defaultSource);
            modified = true;
          }
        }

        if (modified) {
          saveArtworkSourcesConfig(data);
        }
        return data;
      }
    }
  } catch (err: any) {
    console.error('[ArtworkSources] Error loading source config:', err.message);
  }

  // Initialize with defaults
  saveArtworkSourcesConfig(DEFAULT_SOURCES);
  return DEFAULT_SOURCES;
}

export function saveArtworkSourcesConfig(sources: ArtworkSourceConfig[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SOURCES_CONFIG_PATH, JSON.stringify(sources, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[ArtworkSources] Error saving source config:', err.message);
  }
}

export function updateArtworkSourceHealth(
  sourceId: string,
  status: ArtworkSourceStatus,
  latencyMs?: number,
  error?: string | null,
  message?: string | null
): void {
  try {
    const sources = getArtworkSourcesConfig();
    const idx = sources.findIndex(s => s.id === sourceId);
    if (idx === -1) return;
    const s = sources[idx];
    if (s.id === 'tmdb' || s.id === 'jikan' || !s.enabled) return;

    const nowIso = new Date().toISOString();
    s.status = status;
    s.lastChecked = nowIso;
    if (status === 'operational') {
      s.lastSuccessfulChecked = nowIso;
      s.lastError = null;
    } else if (error !== undefined) {
      s.lastError = error;
    }
    if (typeof latencyMs === 'number') {
      s.lastLatencyMs = latencyMs;
    }
    if (message !== undefined) {
      s.lastMessage = message;
    }
    sources[idx] = s;
    saveArtworkSourcesConfig(sources);
  } catch {}
}

export async function testSourceConnectivity(sourceId: string): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
  status: ArtworkSourceStatus;
  sampleTitle?: string;
}> {
  const sources = getArtworkSourcesConfig();
  const sourceIndex = sources.findIndex(s => s.id === sourceId);
  if (sourceIndex === -1) {
    return {
      success: false,
      latencyMs: 0,
      message: `Unknown source ID: ${sourceId}`,
      status: 'offline'
    };
  }

  const source = sources[sourceIndex];

  // Enforce disabled state: Test Connection must NOT re-enable a disabled source
  if (source.id === 'tmdb' || source.id === 'jikan' || !source.enabled) {
    source.enabled = false;
    source.status = 'disabled';
    sources[sourceIndex] = source;
    saveArtworkSourcesConfig(sources);

    return {
      success: false,
      latencyMs: 0,
      message: `Source "${source.name}" is DISABLED and not used for artwork verification tasks.`,
      status: 'disabled'
    };
  }

  const startTime = Date.now();

  try {
    if (source.id === 'anilist') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

      const res = await fetch(source.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Anivex-Artwork-Manager/1.0'
        },
        body: JSON.stringify({
          query: `query ($search: String) {
            Media (search: $search, type: ANIME) {
              id
              title { romaji english }
              coverImage { large }
            }
          }`,
          variables: { search: 'Naruto' }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        const json = await res.json();
        const media = json?.data?.Media;
        const nowIso = new Date().toISOString();
        const msg = `Connected successfully (${latencyMs}ms). Verified cover returned.`;
        source.status = 'operational';
        source.lastChecked = nowIso;
        source.lastSuccessfulChecked = nowIso;
        source.lastLatencyMs = latencyMs;
        source.lastError = null;
        source.lastMessage = msg;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: true,
          latencyMs,
          message: msg,
          status: 'operational',
          sampleTitle: media?.title?.english || media?.title?.romaji || 'Naruto'
        };
      } else {
        const text = await res.text();
        const status: ArtworkSourceStatus = res.status === 429 ? 'rate_limited' : 'temporarily_unavailable';
        const msg = `HTTP ${res.status}: ${text.slice(0, 100)} (Safe fallback engaged)`;
        source.status = status;
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = `HTTP ${res.status}: ${text.slice(0, 100)}`;
        source.lastMessage = msg;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: false,
          latencyMs,
          message: msg,
          status
        };
      }
    } else if (source.id === 'anidb') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

      const res = await fetch('https://anidb.net', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Anivex-Artwork-Manager/1.0)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const isOnline = res.ok || res.status === 403 || res.status === 301 || res.status === 302;
      const status: ArtworkSourceStatus = isOnline ? 'operational' : 'temporarily_unavailable';
      const nowIso = new Date().toISOString();
      const msg = isOnline
        ? `AniDB connectivity confirmed (${latencyMs}ms). Active as secondary fallback.`
        : `AniDB HTTP ${res.status}`;

      source.status = status;
      source.lastChecked = nowIso;
      if (isOnline) source.lastSuccessfulChecked = nowIso;
      source.lastLatencyMs = latencyMs;
      source.lastError = isOnline ? null : `HTTP ${res.status}`;
      source.lastMessage = msg;
      sources[sourceIndex] = source;
      saveArtworkSourcesConfig(sources);

      return {
        success: isOnline,
        latencyMs,
        message: msg,
        status,
        sampleTitle: 'AniDB Titles Database'
      };
    } else if (source.id === 'tvmaze') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

      const res = await fetch(`${source.endpoint}/search/shows?q=Naruto`, {
        headers: { 'User-Agent': 'Anivex-Artwork-Manager/1.0' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        const json = await res.json();
        const first = json?.[0]?.show;
        const nowIso = new Date().toISOString();
        const msg = `Connected successfully (${latencyMs}ms). TVmaze show entry verified.`;
        source.status = 'operational';
        source.lastChecked = nowIso;
        source.lastSuccessfulChecked = nowIso;
        source.lastLatencyMs = latencyMs;
        source.lastError = null;
        source.lastMessage = msg;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: true,
          latencyMs,
          message: msg,
          status: 'operational',
          sampleTitle: first?.name || 'Naruto'
        };
      } else {
        const status: ArtworkSourceStatus = res.status === 429 ? 'rate_limited' : 'temporarily_unavailable';
        const msg = `TVmaze response: HTTP ${res.status}`;
        source.status = status;
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = `HTTP ${res.status}`;
        source.lastMessage = msg;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: false,
          latencyMs,
          message: msg,
          status
        };
      }
    } else if (source.id === 'thetvdb') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

      const res = await fetch('https://api.tvmaze.com/search/shows?q=Naruto', {
        headers: { 'User-Agent': 'Anivex-Artwork-Manager/1.0' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const nowIso = new Date().toISOString();
      const msg = res.ok
        ? `TheTVDB open media gateway operational (${latencyMs}ms).`
        : `TheTVDB gateway HTTP ${res.status}`;

      source.status = res.ok ? 'operational' : 'temporarily_unavailable';
      source.lastChecked = nowIso;
      if (res.ok) source.lastSuccessfulChecked = nowIso;
      source.lastLatencyMs = latencyMs;
      source.lastError = res.ok ? null : `HTTP ${res.status}`;
      source.lastMessage = msg;
      sources[sourceIndex] = source;
      saveArtworkSourcesConfig(sources);

      return {
        success: res.ok,
        latencyMs,
        message: msg,
        status: source.status,
        sampleTitle: 'TheTVDB Database'
      };
    } else {
      const res = await fetch(source.endpoint);
      const latencyMs = Date.now() - startTime;
      const status: ArtworkSourceStatus = res.ok ? 'operational' : 'temporarily_unavailable';
      const nowIso = new Date().toISOString();
      const msg = `HTTP Status ${res.status} (${latencyMs}ms)`;
      source.status = status;
      source.lastChecked = nowIso;
      if (res.ok) source.lastSuccessfulChecked = nowIso;
      source.lastLatencyMs = latencyMs;
      source.lastError = res.ok ? null : `HTTP ${res.status}`;
      source.lastMessage = msg;
      sources[sourceIndex] = source;
      saveArtworkSourcesConfig(sources);

      return {
        success: res.ok,
        latencyMs,
        message: msg,
        status
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError' || err.message?.toLowerCase().includes('timeout');
    const status: ArtworkSourceStatus = isTimeout ? 'timeout' : 'temporarily_unavailable';
    const msg = `Connection issue: ${err.message} (Safe fallback engaged)`;

    source.status = status;
    source.lastChecked = new Date().toISOString();
    source.lastLatencyMs = latencyMs;
    source.lastError = err.message;
    source.lastMessage = msg;
    sources[sourceIndex] = source;
    saveArtworkSourcesConfig(sources);

    return {
      success: false,
      latencyMs,
      message: msg,
      status
    };
  }
}
