import React from 'react';

interface AnivexLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  showText?: boolean;
  textClassName?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
  xl: 'w-20 h-20',
  '2xl': 'w-32 h-32',
  '3xl': 'w-48 h-48'
};

export const AnivexLogo: React.FC<AnivexLogoProps> = ({
  className = '',
  size = 'md',
  showText = false,
  textClassName = ''
}) => {
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;

  return (
    <div className={`inline-flex items-center gap-3 ${className}`} id="anivex-brand-logo">
      <div
        className={`${sizeClass} relative shrink-0 flex items-center justify-center`}
      >
        <svg
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_0_12px_rgba(56,189,248,0.3)]"
        >
          {/* Gradients and Filters */}
          <defs>
            <linearGradient id="aBodyGrad" x1="15%" y1="10%" x2="85%" y2="90%">
              <stop offset="0%" stopColor="#38bdf8" /> {/* sky-400 */}
              <stop offset="45%" stopColor="#2563eb" /> {/* blue-600 */}
              <stop offset="100%" stopColor="#8b5cf6" /> {/* violet-600 */}
            </linearGradient>
            
            <linearGradient id="swooshGrad" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#38bdf8" /> {/* sky-400 */}
              <stop offset="60%" stopColor="#a855f7" /> {/* purple-500 */}
              <stop offset="100%" stopColor="#ec4899" /> {/* pink-500 */}
            </linearGradient>

            <linearGradient id="wingGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>

            <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background Ambient Glow Layer */}
          <path
            d="M60 15 L25 88 L44 88 L54 62 L66 62 L76 88 L95 88 Z"
            fill="#2563eb"
            opacity="0.15"
            filter="url(#neonGlow)"
          />

          {/* Main Futuristic Bold 'A' Shape */}
          {/* Left Leg & Apex */}
          <path
            d="M60 14 L24 88 L44 88 L53 62 L67 62 L60 45 L56 45 Z"
            fill="url(#aBodyGrad)"
          />
          {/* Right Leg */}
          <path
            d="M60 14 L96 88 L76 88 L67 62 L53 62 L60 45 L64 45 Z"
            fill="url(#aBodyGrad)"
          />
          
          {/* Inner Cut-out / Counter of the 'A' */}
          <path
            d="M60 32 L47 62 L73 62 Z"
            fill="#030712" /* Blends into dark theme background for sleek stenciled look */
            opacity="0.85"
          />

          {/* Wing / Feather Elements on the Top Right Peak */}
          <g filter="url(#neonGlow)">
            {/* Wing Feather 1 */}
            <path
              d="M62 25 C69 21 78 23 83 29 C79 28 75 27 72 28 C76 30 79 34 78 39 C74 36 70 35 66 36 C68 40 69 45 66 49 C64 44 61 41 58 40 Z"
              fill="url(#wingGrad)"
            />
          </g>

          {/* Glowing Dynamic Orbiting Swoosh / Ring */}
          <path
            d="M18 80 C28 66 52 42 78 44 C96 46 94 62 76 72 C52 84 26 84 18 80 Z"
            stroke="url(#swooshGrad)"
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
            filter="url(#neonGlow)"
            className="animate-pulse"
            style={{ animationDuration: '3s' }}
          />
        </svg>
      </div>

      {showText && (
        <span
          className={`font-black tracking-tight font-display text-white dark:text-white light:text-slate-900 ${
            textClassName || (size === 'lg' ? 'text-2xl' : size === 'xl' ? 'text-3xl' : size === '2xl' ? 'text-4xl' : 'text-xl')
          }`}
        >
          ANI<span className="text-blue-500">VEX</span>
        </span>
      )}
    </div>
  );
};
