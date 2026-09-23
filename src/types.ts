export type AnimeStatus = 'Completed' | 'Ongoing' | 'Upcoming';
export type AnimeType = 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special' | 'Collection';

export interface Artwork {
  verifiedArtworkUrl: string;
  isVerified: boolean;
  verificationSource: string;
  aspectRatio: string;
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

export interface Season {
  seasonNumber: number;
  title: string;
  canonicalUrl: string;
  episodeCount: number;
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
  releaseYear: number;
  releaseDate?: string | null;
  status: AnimeStatus;
  type: AnimeType;
  genres: string[];
  artwork: Artwork;
  bannerArtwork?: string | null;
  totalEpisodes?: number;
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

export type ThemeMode = 'dark' | 'light' | 'system';

export interface UserAccount {
  id: string;
  username: string; // Chosen AniVault username
  name: string;     // Provider account identity (e.g. Apple ID Name, Google account)
  email?: string;
  avatar?: string;
  provider: 'guest' | 'google' | 'apple' | 'email';
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
