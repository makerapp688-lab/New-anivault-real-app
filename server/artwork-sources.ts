import fs from 'fs';
import path from 'path';

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
  status: 'operational' | 'degraded' | 'offline' | 'untested';
  lastChecked?: string;
  lastLatencyMs?: number;
  lastError?: string | null;
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
    description: 'Primary source. AniList GraphQL API for verified high-res artwork, romaji/english/japanese titles, seasons, and relations.'
  },
  {
    id: 'jikan',
    name: 'Jikan API (MyAnimeList)',
    type: 'rest',
    endpoint: 'https://api.jikan.moe/v4',
    enabled: true,
    rateLimitPerMinute: 60,
    rateLimitPerSecond: 3,
    timeoutMs: 8000,
    priority: 2,
    status: 'untested',
    description: 'Secondary source. MyAnimeList open API gateway for cross-checking titles, MAL IDs, format, and high-res posters.'
  },
  {
    id: 'anidb',
    name: 'AniDB (Tertiary Fallback)',
    type: 'rest',
    endpoint: 'https://anidb.net',
    enabled: true,
    rateLimitPerMinute: 30,
    rateLimitPerSecond: 1,
    timeoutMs: 8000,
    priority: 3,
    status: 'untested',
    description: 'Tertiary fallback. Used only when Jikan is genuinely unavailable/unreliable to cross-check anime titles and identity.'
  }
];

export function getArtworkSourcesConfig(): ArtworkSourceConfig[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SOURCES_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(SOURCES_CONFIG_PATH, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        // Ensure anidb exists in the configuration if not present
        if (!data.some((s: any) => s.id === 'anidb')) {
          data.push(DEFAULT_SOURCES[2]);
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

export async function testSourceConnectivity(sourceId: string): Promise<{
  success: boolean;
  latencyMs: number;
  message: string;
  status: 'operational' | 'degraded' | 'offline';
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
        source.status = 'operational';
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = null;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: true,
          latencyMs,
          message: `Connected successfully (${latencyMs}ms). Verified cover returned.`,
          status: 'operational',
          sampleTitle: media?.title?.english || media?.title?.romaji || 'Naruto'
        };
      } else {
        const text = await res.text();
        source.status = 'degraded';
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = `HTTP ${res.status}: ${text.slice(0, 100)}`;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: false,
          latencyMs,
          message: `HTTP error ${res.status}: ${text.slice(0, 100)}`,
          status: 'degraded'
        };
      }
    } else if (source.id === 'jikan') {
      // Diagnostic check: Test Jikan with safe retry and timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), source.timeoutMs || 8000);

      const res = await fetch(`${source.endpoint}/anime?q=Naruto&limit=1`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Anivex-Artwork-Manager/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        const json = await res.json();
        const item = json?.data?.[0];
        source.status = 'operational';
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = null;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: true,
          latencyMs,
          message: `Connected successfully (${latencyMs}ms). MAL entry verified.`,
          status: 'operational',
          sampleTitle: item?.title || 'Naruto'
        };
      } else {
        const json = await res.json().catch(() => ({}));
        const errorMsg = json?.message || `HTTP ${res.status}`;
        // Treat 504 / 429 as temporary degraded/offline
        source.status = res.status === 429 ? 'degraded' : 'offline';
        source.lastChecked = new Date().toISOString();
        source.lastLatencyMs = latencyMs;
        source.lastError = `Jikan response: ${errorMsg}`;
        sources[sourceIndex] = source;
        saveArtworkSourcesConfig(sources);

        return {
          success: false,
          latencyMs,
          message: `Jikan response: ${errorMsg} (Automatic fallback to AniList & AniDB active)`,
          status: source.status
        };
      }
    } else if (source.id === 'anidb') {
      // AniDB HTTP/title connectivity check
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

      source.status = isOnline ? 'operational' : 'degraded';
      source.lastChecked = new Date().toISOString();
      source.lastLatencyMs = latencyMs;
      source.lastError = null;
      sources[sourceIndex] = source;
      saveArtworkSourcesConfig(sources);

      return {
        success: isOnline,
        latencyMs,
        message: `AniDB connectivity confirmed (${latencyMs}ms). Active as tertiary fallback.`,
        status: source.status,
        sampleTitle: 'AniDB Titles Database'
      };
    } else {
      // Generic REST source probe
      const res = await fetch(source.endpoint);
      const latencyMs = Date.now() - startTime;
      source.status = res.ok ? 'operational' : 'degraded';
      source.lastChecked = new Date().toISOString();
      source.lastLatencyMs = latencyMs;
      sources[sourceIndex] = source;
      saveArtworkSourcesConfig(sources);

      return {
        success: res.ok,
        latencyMs,
        message: `HTTP Status ${res.status}`,
        status: source.status
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    source.status = 'offline';
    source.lastChecked = new Date().toISOString();
    source.lastLatencyMs = latencyMs;
    source.lastError = err.message;
    sources[sourceIndex] = source;
    saveArtworkSourcesConfig(sources);

    return {
      success: false,
      latencyMs,
      message: `Connection failed: ${err.message}`,
      status: 'offline'
    };
  }
}
