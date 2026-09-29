export type AnimeStatus = 'Completed' | 'Ongoing' | 'Upcoming' | 'Unknown';
export type AnimeType = 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' | 'Collection';

export interface Artwork {
  verifiedArtworkUrl: string;
  isVerified: boolean;
  verificationSource: string;
  aspectRatio: string;
  verificationStatus?: string;
  originalArtworkUrl?: string;
}

export interface RareToonProviderInfo {
  providerAnimeId: string;
  canonicalUrl: string;
  verificationStatus: 'VERIFIED' | 'UNAVAILABLE';
  dubLanguage: string;
  quality: string;
}

export interface Episode {
  episodeNumber: number;
  title: string;
  canonicalUrl: string;
}

export type EpisodeListStatus = 'complete' | 'partial' | 'empty' | 'unknown';

export interface Season {
  seasonNumber: number;
  title: string;
  canonicalUrl: string;
  episodeCount: number | null;
  authoritativeEpisodeCount?: number | null;
  importedEpisodeCount?: number;
  isEpisodeListComplete?: boolean;
  episodeListStatus?: EpisodeListStatus;
  episodeImportStatus?: EpisodeListStatus;
  episodes: Episode[];
}

export interface Anime {
  id: string;
  malId?: number | null;
  aniListId?: number | null;
  title: string;
  alternateTitle: string | null;
  japaneseTitle?: string | null;
  synopsis: string;
  releaseYear: number | null;
  releaseDate?: string | null;
  status: AnimeStatus;
  type: AnimeType;
  genres: string[];
  artwork: Artwork;
  bannerArtwork?: string | null;
  totalEpisodes?: number | null;
  authoritativeTotalEpisodes?: number | null;
  authoritativeEpisodeCount?: number | null;
  importedEpisodesCount?: number;
  importedEpisodeCount?: number;
  isEpisodeListComplete?: boolean;
  episodeListStatus?: EpisodeListStatus;
  episodeImportStatus?: EpisodeListStatus;
  totalSeasons?: number;
  seasonsCount?: number;
  runtime?: string | null;
  studios?: string[];
  source?: string | null;
  rating?: string | null;
  score?: number | null;
  languages?: string[];
  provider?: string;
  canonicalProviderUrl?: string;
  watchUrl?: string;
  providerId?: string;
  providers?: {
    raretoonIndia: RareToonProviderInfo;
  };
  seasons?: Season[];
  storyDetails?: string | null;
  relatedAnime?: string[];
  franchiseRelationships?: string[];
}

export interface CatalogueStats {
  totalUniqueAnime: number;
  totalRareToonUrlsScraped: number;
  verifiedArtworkCount: number;
  placeholderArtworkCount: number;
  exactProviderMappings: number;
  genresBreakdown: Record<string, number>;
  totalScraped?: number;
  totalAnime?: number;
  totalSeasons?: number;
  totalEpisodes?: number;
  moviesCount?: number;
  qualifyingMoviesCount?: number;
  seriesCount?: number;
  genreCounts?: Record<string, number>;
}

export interface SyncStatus {
  isSyncing: boolean;
  message: string;
  lastSyncTimestamp?: string;
  stats?: CatalogueStats;
}

export type ThemeMode =
  | 'dark'
  | 'light'
  | 'system'
  | 'zenime-signature'
  | 'cyber-neon'
  | 'calm-ocean'
  | 'modern-tech'
  | 'aurora'
  | 'midnight-premium'
  | 'pixel'
  | 'space'
  | 'golden-sunset';

export interface UserAccount {
  id: string;
  username: string; // Chosen Zenime username
  name: string;     // Display identity name
  email?: string;
  avatar?: string;
  theme?: ThemeMode;
  provider: 'guest' | 'email';
  role?: 'user' | 'owner';
  createdAt: string;
}

export interface UserData {
  favorites: string[]; // anime IDs
  watchlist: string[]; // Watch Later anime IDs
  completed: string[]; // Watched anime IDs
  history: { animeId: string; timestamp: number }[];
  theme: ThemeMode;
}
