import React, { useState, useEffect } from 'react';
import { X, Dice5, Sparkles, Play, RefreshCw, Layers, Calendar, ExternalLink } from 'lucide-react';
import { Anime } from '../types.ts';
import { AnimeArtwork } from './AnimeArtwork.tsx';
import { calculateTotalEpisodes, resolveWatchUrl } from '../utils/provider.ts';

interface SurpriseMeModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogue: Anime[];
  onSelectAnime: (anime: Anime) => void;
}

export const SurpriseMeModal: React.FC<SurpriseMeModalProps> = ({
  isOpen,
  onClose,
  catalogue,
  onSelectAnime
}) => {
  const [isRolling, setIsRolling] = useState(true);
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [diceRotation, setDiceRotation] = useState(0);

  const rollDice = () => {
    if (!catalogue || catalogue.length === 0) return;
    setIsRolling(true);
    setDiceRotation(prev => prev + 720);

    setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * catalogue.length);
      setSelectedAnime(catalogue[randomIndex]);
      setIsRolling(false);
    }, 600);
  };

  useEffect(() => {
    if (isOpen) {
      rollDice();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalEpisodes = selectedAnime ? calculateTotalEpisodes(selectedAnime) : null;
  const watchResolution = selectedAnime ? resolveWatchUrl(selectedAnime) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      id="surprise-modal-overlay"
    >
      <div
        className="relative w-full max-w-lg bg-slate-900 dark:bg-slate-900 light:bg-white border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-2xl shadow-2xl overflow-hidden my-auto flex flex-col transition-colors"
        onClick={e => e.stopPropagation()}
        id="surprise-modal-content"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950/90 dark:bg-slate-950/90 light:bg-slate-100 border-b border-slate-800 dark:border-slate-800 light:border-slate-200">
          <div className="flex items-center gap-2">
            <Dice5
              className="w-5 h-5 text-rose-500 transition-transform duration-500"
              style={{ transform: `rotate(${diceRotation}deg)` }}
            />
            <h2 className="text-base font-bold text-white dark:text-white light:text-slate-900">
              🎲 Surprise Me — Random Anime Pick
            </h2>
          </div>
          <button
            type="button"
            id="btn-close-surprise-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-200 light:hover:bg-slate-300 text-slate-300 hover:text-white dark:text-slate-300 light:text-slate-700 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 text-center space-y-5">
          {isRolling ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Dice5 className="w-16 h-16 text-rose-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-amber-400 absolute -top-1 -right-1 animate-bounce" />
              </div>
              <p className="text-sm font-semibold text-slate-300 animate-pulse">
                Rolling the AniVault catalogue dice...
              </p>
            </div>
          ) : selectedAnime ? (
            <div className="space-y-4 text-left">
              {/* Anime Card Preview */}
              <div className="flex flex-col sm:flex-row gap-4 p-4 bg-slate-950/80 dark:bg-slate-950/80 light:bg-slate-50 border border-slate-800 dark:border-slate-800 light:border-slate-200 rounded-xl">
                <div className="w-full sm:w-32 aspect-[3/4] shrink-0 rounded-lg overflow-hidden">
                  <AnimeArtwork
                    src={selectedAnime.artwork?.verifiedArtworkUrl}
                    alt={selectedAnime.title}
                    aspectRatio="aspect-[3/4]"
                  />
                </div>
                <div className="flex flex-col justify-between space-y-2 flex-1">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-semibold text-slate-400 mb-1">
                      <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/40">
                        {selectedAnime.type}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {selectedAnime.releaseYear}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/40">
                        {selectedAnime.status}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-white dark:text-white light:text-slate-900 leading-tight">
                      {selectedAnime.title}
                    </h3>
                    {selectedAnime.alternateTitle && (
                      <p className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 italic line-clamp-1">
                        {selectedAnime.alternateTitle}
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 dark:text-slate-300 light:text-slate-700 line-clamp-3 leading-relaxed">
                    {selectedAnime.synopsis}
                  </p>

                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      {selectedAnime.seasons?.length || 1} Seasons
                    </span>
                    <span>•</span>
                    <span className="text-rose-400 font-semibold">
                      {totalEpisodes !== null ? `${totalEpisodes} Episodes` : 'Episodes: Not available'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  id="btn-surprise-open-details"
                  onClick={() => {
                    onClose();
                    onSelectAnime(selectedAnime);
                  }}
                  className="py-2.5 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>View Full Details &amp; Seasons</span>
                </button>

                <button
                  type="button"
                  id="btn-surprise-roll-again"
                  onClick={rollDice}
                  className="py-2.5 px-4 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 light:bg-slate-100 light:hover:bg-slate-200 text-slate-200 dark:text-slate-200 light:text-slate-800 border border-slate-700 dark:border-slate-700 light:border-slate-300 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Roll Again (Pick Another)</span>
                </button>
              </div>

              {watchResolution && watchResolution.url && (
                <div className="text-center pt-1">
                  <a
                    href={watchResolution.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    <span>Or open directly on RareAnimes</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
