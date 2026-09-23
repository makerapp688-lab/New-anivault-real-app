import React, { useState } from 'react';

interface AniVaultLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showText?: boolean;
  textClassName?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
  '2xl': 'w-24 h-24'
};

export const AniVaultLogo: React.FC<AniVaultLogoProps> = ({
  className = '',
  size = 'md',
  showText = false,
  textClassName = ''
}) => {
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const [imageError, setImageError] = useState(false);

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`} id="anivault-brand-logo">
      <div
        className={`${sizeClass} relative rounded-xl overflow-hidden shrink-0 shadow-md shadow-rose-950/40 border border-slate-700/50 bg-slate-950 flex items-center justify-center group`}
      >
        {!imageError ? (
          <img
            src="/anivault-logo.png"
            alt="AniVault Official Logo"
            className="w-full h-full object-cover transform transition-transform duration-300 group-hover:scale-105"
            onError={() => setImageError(true)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full bg-slate-950 flex items-center justify-center text-rose-500 font-black text-sm">
            AV
          </div>
        )}
      </div>

      {showText && (
        <span
          className={`font-black tracking-tight font-display text-white dark:text-white light:text-slate-900 ${
            textClassName || (size === 'lg' ? 'text-2xl' : size === 'xl' ? 'text-3xl' : size === '2xl' ? 'text-4xl' : 'text-xl')
          }`}
        >
          Ani<span className="text-rose-500">Vault</span>
        </span>
      )}
    </div>
  );
};
