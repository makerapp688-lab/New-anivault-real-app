import React, { useState, useEffect } from 'react';
import { Film, ImageOff } from 'lucide-react';
import { Artwork } from '../types.ts';

interface AnimeArtworkProps {
  src?: string;
  artwork?: Artwork;
  alt?: string;
  title?: string;
  className?: string;
  aspectRatio?: string;
  priority?: boolean;
}

export const AnimeArtwork: React.FC<AnimeArtworkProps> = ({
  src,
  artwork,
  alt,
  title,
  className = '',
  aspectRatio = 'aspect-[3/4]'
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const displayTitle = title || alt || 'Anime';
  const effectiveUrl = (src || artwork?.verifiedArtworkUrl || '').trim();

  // Normalize aspect ratio to Tailwind classes
  const normalizedAspect = aspectRatio === '16:9'
    ? 'aspect-video'
    : aspectRatio === '3:4'
    ? 'aspect-[3/4]'
    : aspectRatio || 'aspect-[3/4]';

  useEffect(() => {
    setHasError(false);
    setIsLoading(true);
  }, [effectiveUrl]);

  if (!effectiveUrl || hasError) {
    return (
      <div
        className={`w-full ${normalizedAspect} bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 border border-slate-800 rounded-xl flex flex-col items-center justify-center p-4 text-center text-slate-400 select-none shadow-inner ${className}`}
        id={`artwork-placeholder-${displayTitle.replace(/\s+/g, '-').toLowerCase()}`}
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-2 text-rose-500">
          {hasError ? <ImageOff className="w-6 h-6 text-amber-400" /> : <Film className="w-6 h-6 text-rose-500" />}
        </div>
        <span className="text-xs font-bold text-slate-200 dark:text-slate-200 light:text-slate-800 line-clamp-2 px-1">
          {displayTitle}
        </span>
        <span className="text-[10px] text-rose-400 mt-1 uppercase tracking-wider font-bold">
          AniVault Key Visual
        </span>
      </div>
    );
  }

  return (
    <div className={`relative w-full ${normalizedAspect} overflow-hidden rounded-xl bg-slate-950 border border-slate-800/80 ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/80 animate-pulse flex items-center justify-center z-10">
          <Film className="w-6 h-6 text-rose-500/50 animate-spin" />
        </div>
      )}
      <img
        src={effectiveUrl}
        alt={displayTitle}
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        className={`w-full h-full object-cover transition-all duration-300 ${
          isLoading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      />
    </div>
  );
};
