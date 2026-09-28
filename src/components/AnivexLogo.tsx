import React from 'react';
import zenimePrimaryLogo from '../assets/images/zenime_primary_logo_1790572796973.jpg';
import zenimeCinematicLogo from '../assets/images/zenime_official_logo_1790572469771.jpg';

export { zenimePrimaryLogo, zenimeCinematicLogo };

interface ZenimeLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  variant?: 'primary' | 'cinematic';
  showText?: boolean;
  textClassName?: string;
}

const PRIMARY_SIZE_MAP = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-14 h-14 text-xl',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-32 h-32 text-4xl',
  '3xl': 'w-48 h-48 text-5xl'
};

const CINEMATIC_SIZE_MAP = {
  xs: 'w-12 h-7 text-xs',
  sm: 'w-16 h-10 text-sm',
  md: 'w-24 h-14 text-base',
  lg: 'w-32 h-20 text-xl',
  xl: 'w-44 h-28 text-2xl',
  '2xl': 'w-56 h-36 text-4xl',
  '3xl': 'w-72 h-44 text-5xl'
};

export const ZenimeLogo: React.FC<ZenimeLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'primary',
  showText = false,
  textClassName = ''
}) => {
  const isCinematic = variant === 'cinematic';
  const sizeClass = isCinematic
    ? CINEMATIC_SIZE_MAP[size] || CINEMATIC_SIZE_MAP.lg
    : PRIMARY_SIZE_MAP[size] || PRIMARY_SIZE_MAP.md;

  const logoSrc = isCinematic ? zenimeCinematicLogo : zenimePrimaryLogo;
  const fallbackStaticPath = isCinematic ? '/zenime-cinematic-logo.png' : '/zenime-logo.png';

  return (
    <div
      className={`inline-flex items-center gap-3 ${className}`}
      id={isCinematic ? 'zenime-cinematic-logo' : 'zenime-brand-logo'}
    >
      <div
        className={`${sizeClass} relative shrink-0 flex items-center justify-center select-none overflow-hidden rounded-xl bg-black`}
      >
        <img
          src={logoSrc}
          alt="Zenime"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain pointer-events-none"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.src.endsWith(fallbackStaticPath)) {
              target.src = fallbackStaticPath;
            }
          }}
        />
      </div>

      {showText && (
        <span
          className={`font-black tracking-tight font-display text-white dark:text-white light:text-slate-900 ${
            textClassName || (size === 'lg' ? 'text-2xl' : size === 'xl' ? 'text-3xl' : size === '2xl' ? 'text-4xl' : 'text-xl')
          }`}
        >
          Zen<span className="text-rose-500">ime</span>
        </span>
      )}
    </div>
  );
};

export const ZenimeCinematicLogo: React.FC<Omit<ZenimeLogoProps, 'variant'>> = (props) => (
  <ZenimeLogo {...props} variant="cinematic" />
);

export const AnivexLogo = ZenimeLogo;
