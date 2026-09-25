export type VerificationStatus =
  | 'verified'
  | 'auto_fixed'
  | 'needs_review'
  | 'unable_to_verify'
  | 'possible_fake';

export interface ArtworkCandidate {
  source: 'anilist' | 'jikan' | 'anidb' | 'tmdb' | 'tvmaze' | 'thetvdb' | 'provider' | string;
  sourceId: string | number;
  title: string;
  imageUrl: string;
  aspectRatio: string;
  confidence: number;
  dimensions?: string;
  format?: string;
  year?: number;
  seasonNumber?: number;
}

export interface SeasonArtworkResult {
  seasonNumber: number;
  seasonTitle: string;
  artworkUrl?: string | null;
  status: 'verified' | 'auto_fixed' | 'needs_review' | 'not_found';
  source?: string;
  confidence?: number;
}

export interface ArtworkVerificationResult {
  animeId: string;
  animeTitle: string;
  status: VerificationStatus;
  confidence: number;
  currentArtworkUrl: string | null;
  replacedArtworkUrl?: string | null;
  source: string;
  dimensions?: string;
  lastVerifiedAt: string;
  isFastPath?: boolean;
  aniListMatch?: {
    id: number;
    title: string;
    englishTitle?: string;
    romajiTitle?: string;
    year?: number;
    coverUrl?: string;
    score: number;
  } | null;
  jikanMatch?: {
    malId: number;
    title: string;
    englishTitle?: string;
    year?: number;
    coverUrl?: string;
    score: number;
  } | null;
  anidbMatch?: {
    aid: number;
    title: string;
    score: number;
  } | null;
  seasonResults?: SeasonArtworkResult[];
  candidates: ArtworkCandidate[];
  issue?: string | null;
  evidence?: string[];
}

export interface FakeAnimeIssue {
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
  anidbResult?: {
    queried: boolean;
    found: number;
    error?: string | null;
  };
  verdict: 'unlisted_on_anilist' | 'unlisted_everywhere' | 'likely_fanmade' | 'verified_real';
  details: string;
  recordedAt: string;
  flaggedBy: string;
  status?: 'active' | 'dismissed' | 'resolved' | 'manual_verified';
  reason?: string;
  evidence?: string[];
}

export interface ArtworkHistoryEntry {
  id: string;
  animeId: string;
  animeTitle: string;
  previousArtworkUrl: string;
  newArtworkUrl: string;
  replacedAt: string;
  replacedBy: 'auto_verifier' | 'owner';
  source: string;
  reason: string;
  seasonNumber?: number;
}
