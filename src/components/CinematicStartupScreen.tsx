import React, { useEffect, useState } from 'react';
import { zenimePrimaryLogo, zenimeCinematicLogo } from './AnivexLogo.tsx';

// Eagerly preload both permanent built-in Zenime logo assets into browser memory on module evaluation
if (typeof window !== 'undefined') {
  for (const src of [zenimePrimaryLogo, zenimeCinematicLogo, '/zenime-logo.png', '/zenime-cinematic-logo.png']) {
    const img = new Image();
    img.src = src;
  }
}

export interface RealStartupState {
  sessionReady: boolean;
  catalogueReady: boolean;
  artworkReady: boolean;
  catalogueCount: number;
}

interface CinematicStartupScreenProps {
  startupState: RealStartupState;
  isExiting: boolean;
}

type IntroPhase = 'particles' | 'primary-reveal' | 'cinematic-transition' | 'final-composition';

const PARTICLES = [
  { id: 1, left: '14%', top: '24%', size: 4, color: '#ff1e9b', delay: '0s', duration: '6.5s' },
  { id: 2, left: '24%', top: '68%', size: 3, color: '#00f0ff', delay: '0.6s', duration: '7.2s' },
  { id: 3, left: '36%', top: '18%', size: 5, color: '#9333ea', delay: '1.1s', duration: '6.8s' },
  { id: 4, left: '48%', top: '78%', size: 3, color: '#3b82f6', delay: '0.3s', duration: '7.5s' },
  { id: 5, left: '64%', top: '22%', size: 4, color: '#00f0ff', delay: '0.9s', duration: '6.4s' },
  { id: 6, left: '76%', top: '64%', size: 5, color: '#c026d3', delay: '1.4s', duration: '7.0s' },
  { id: 7, left: '85%', top: '30%', size: 3, color: '#00d4ff', delay: '0.4s', duration: '6.9s' },
  { id: 8, left: '19%', top: '46%', size: 4, color: '#a855f7', delay: '1.7s', duration: '7.4s' },
  { id: 9, left: '81%', top: '48%', size: 4, color: '#ff1e9b', delay: '0.8s', duration: '6.6s' },
  { id: 10, left: '54%', top: '14%', size: 3, color: '#38bdf8', delay: '1.2s', duration: '7.1s' }
];

export const CinematicStartupScreen: React.FC<CinematicStartupScreenProps> = ({
  startupState,
  isExiting
}) => {
  const [phase, setPhase] = useState<IntroPhase>('particles');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  // Choreographed 10-second timeline:
  // 0–2s: Dark screen with subtle moving light particles ('particles')
  // 2–5s: Primary Zenime logo gradually appears with controlled glow ('primary-reveal')
  // 5–8s: Smooth cinematic transition toward the second Zenime logo ('cinematic-transition')
  // 8–10s+: Zenime branding settles into a clean final composition ('final-composition')
  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase('primary-reveal'), 2000);
    const t2 = window.setTimeout(() => setPhase('cinematic-transition'), 5000);
    const t3 = window.setTimeout(() => setPhase('final-composition'), 8000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  // Derive truthful status text strictly from real backend/startup state
  const getRealStatusMessage = (): string => {
    if (!startupState.sessionReady) {
      return 'Preparing Zenime…';
    }
    if (!startupState.catalogueReady) {
      return 'Loading anime catalogue…';
    }
    if (!startupState.artworkReady) {
      return 'Preparing artwork…';
    }
    return 'Finalizing Zenime…';
  };

  const statusText = getRealStatusMessage();

  const showPrimaryLogo = phase === 'primary-reveal' || phase === 'cinematic-transition';
  const showCinematicLogo = phase === 'cinematic-transition' || phase === 'final-composition';

  return (
    <div
      id="zenime-cinematic-startup-screen"
      role="status"
      aria-live="polite"
      aria-label={statusText}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-between overflow-hidden bg-[#010208] text-white select-none transition-opacity duration-700 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Ambient GPU-friendly background light fields matching both Zenime logos */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Left magenta-pink & violet nebula */}
        <div
          className={`absolute -left-24 top-1/4 w-[28rem] h-[28rem] rounded-full blur-[110px] transition-all duration-1000 ${
            phase === 'particles'
              ? 'opacity-25 scale-90'
              : phase === 'primary-reveal'
              ? 'opacity-50 scale-105'
              : 'opacity-40 scale-100'
          }`}
          style={{
            background: 'radial-gradient(circle, rgba(255,30,155,0.42) 0%, rgba(147,51,234,0.22) 55%, transparent 75%)',
            transform: 'translate3d(0,0,0)'
          }}
        />

        {/* Right electric cyan & sapphire blue nebula */}
        <div
          className={`absolute -right-24 top-1/3 w-[30rem] h-[30rem] rounded-full blur-[115px] transition-all duration-1000 ${
            phase === 'particles'
              ? 'opacity-25 scale-90'
              : phase === 'cinematic-transition' || phase === 'final-composition'
              ? 'opacity-55 scale-110'
              : 'opacity-45 scale-100'
          }`}
          style={{
            background: 'radial-gradient(circle, rgba(0,240,255,0.42) 0%, rgba(0,102,255,0.26) 55%, transparent 75%)',
            transform: 'translate3d(0,0,0)'
          }}
        />

        {/* Center crystalline halo */}
        <div
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[34rem] h-[34rem] rounded-full blur-[120px] transition-opacity duration-1000 ${
            phase === 'particles' ? 'opacity-15' : 'opacity-45'
          }`}
          style={{
            background: 'radial-gradient(circle, rgba(0,168,255,0.26) 0%, rgba(168,85,247,0.20) 50%, transparent 72%)',
            transform: 'translate3d(-50%,-50%,0)'
          }}
        />

        {/* Subtle moving crystalline light particles */}
        {PARTICLES.map((p) => (
          <span
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: p.left,
              top: p.top,
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              boxShadow: `0 0 12px ${p.color}, 0 0 24px ${p.color}`,
              animation: prefersReducedMotion
                ? 'none'
                : `zenimeParticleFloat ${p.duration} ease-in-out ${p.delay} infinite alternate`,
              opacity: phase === 'particles' ? 0.85 : 0.65,
              transform: 'translate3d(0,0,0)'
            }}
          />
        ))}

        {/* Bottom wet-glass horizon reflection inspired by both logos */}
        <div
          className="absolute bottom-0 inset-x-0 h-28 pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(147,51,234,0.16) 0%, rgba(0,180,255,0.06) 45%, transparent 100%)'
          }}
        />
        <div
          className="absolute bottom-12 left-1/2 -translate-x-1/2 w-3/4 max-w-2xl h-[1px]"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,30,155,0.65) 25%, rgba(255,255,255,0.85) 50%, rgba(0,240,255,0.75) 75%, transparent 100%)',
            boxShadow: '0 0 18px rgba(0,212,255,0.55), 0 0 28px rgba(255,30,155,0.45)'
          }}
        />
      </div>

      {/* Top subtle spacer */}
      <div className="h-12 shrink-0" />

      {/* Center Stage: Choreographed Dual-Logo Reveal & Transition */}
      <div className="relative z-10 flex flex-col items-center justify-center flex-1 w-full max-w-3xl px-6">
        <div className="relative flex items-center justify-center w-full min-h-[260px] sm:min-h-[340px]">
          {/* Phase 0–2s: Initial converging light core before logo reveal */}
          <div
            className={`absolute flex items-center justify-center transition-all duration-1000 ease-out ${
              phase === 'particles'
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-150 pointer-events-none'
            }`}
          >
            <div
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(0,240,255,0.55) 30%, rgba(147,51,234,0.35) 62%, transparent 78%)',
                boxShadow:
                  '0 0 45px rgba(0,240,255,0.5), 0 0 80px rgba(255,30,155,0.35)',
                animation: prefersReducedMotion ? 'none' : 'zenimePulseCore 2s ease-in-out infinite'
              }}
            />
          </div>

          {/* Phase 2–5s (and cross-dissolve 5–8s): 1. PRIMARY ZENIME LOGO */}
          <div
            id="startup-primary-logo-stage"
            className={`absolute flex flex-col items-center justify-center transition-all duration-[1400ms] ease-out ${
              phase === 'primary-reveal'
                ? 'opacity-100 scale-100 blur-0'
                : phase === 'cinematic-transition'
                ? 'opacity-0 scale-110 blur-[2px] pointer-events-none'
                : 'opacity-0 scale-90 blur-[4px] pointer-events-none'
            }`}
            style={{ transform: 'translate3d(0,0,0)' }}
          >
            <div className="relative p-1.5 rounded-3xl">
              {/* Controlled blue/cyan/purple/pink halo ring */}
              <div
                className="absolute -inset-3 rounded-3xl opacity-80 blur-xl"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(255,30,155,0.55) 0%, rgba(147,51,234,0.5) 36%, rgba(0,102,255,0.55) 68%, rgba(0,240,255,0.6) 100%)'
                }}
              />
              <div className="relative w-44 h-44 sm:w-56 sm:h-56 rounded-2xl overflow-hidden bg-black border border-sky-400/35 shadow-[0_0_50px_rgba(0,212,255,0.35),0_0_70px_rgba(255,30,155,0.25)]">
                <img
                  src={zenimePrimaryLogo}
                  alt="Zenime Primary Logo"
                  className="w-full h-full object-contain"
                />
                {!prefersReducedMotion && showPrimaryLogo && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                      animation: 'zenimeLightSweep 2.8s ease-in-out infinite'
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Phase 5–8s & 8–10s+: 2. ZENIME CINEMATIC LOGO */}
          <div
            id="startup-cinematic-logo-stage"
            className={`relative flex flex-col items-center justify-center transition-all duration-[1500ms] ease-out ${
              phase === 'cinematic-transition'
                ? 'opacity-95 scale-[0.98] blur-0'
                : phase === 'final-composition'
                ? 'opacity-100 scale-100 blur-0'
                : 'opacity-0 scale-95 blur-[4px] pointer-events-none'
            }`}
            style={{ transform: 'translate3d(0,0,0)' }}
          >
            <div className="relative">
              {/* Ambient energy ring glow behind the cinematic logo */}
              <div
                className="absolute -inset-4 rounded-3xl opacity-85 blur-2xl transition-opacity duration-1000"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(0,240,255,0.5) 0%, rgba(0,102,255,0.45) 38%, rgba(147,51,234,0.5) 72%, rgba(255,30,155,0.45) 100%)'
                }}
              />
              <div className="relative w-[19rem] sm:w-[27rem] md:w-[32rem] aspect-[16/10] rounded-2xl overflow-hidden bg-black border border-sky-400/40 shadow-[0_0_60px_rgba(0,168,255,0.42),0_0_90px_rgba(168,85,247,0.32)]">
                <img
                  src={zenimeCinematicLogo}
                  alt="Zenime Cinematic Logo"
                  className="w-full h-full object-cover"
                />
                {!prefersReducedMotion && showCinematicLogo && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background:
                        'linear-gradient(110deg, transparent 35%, rgba(56,232,255,0.16) 50%, transparent 65%)',
                      animation: 'zenimeLightSweep 3.4s ease-in-out infinite'
                    }}
                  />
                )}
              </div>
            </div>

            {/* Phase 8–10s+: Final Signature Branding Subtitle */}
            <div
              className={`mt-5 flex items-center gap-2.5 transition-all duration-700 ${
                phase === 'final-composition'
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-2'
              }`}
            >
              <img
                src={zenimePrimaryLogo}
                alt="Zenime Crest"
                className="w-6 h-6 rounded-md object-contain border border-sky-400/40"
              />
              <span
                className="text-xs sm:text-sm font-black uppercase tracking-[0.26em]"
                style={{
                  background:
                    'linear-gradient(90deg, #ff5cc0 0%, #a855f7 35%, #38bdf8 70%, #00f0ff 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent'
                }}
              >
                ZENIME • ANIME DISCOVERY &amp; METADATA ENGINE
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Real Startup Status Indicator (Strictly Authoritative State — No Fake Percentages) */}
      <div className="relative z-10 pb-8 sm:pb-10 px-6 flex flex-col items-center space-y-2.5 w-full max-w-md">
        <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-slate-950/85 border border-sky-500/30 shadow-[0_0_24px_rgba(0,168,255,0.2)]">
          <span
            className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_10px_#00f0ff]"
            style={{
              animation: prefersReducedMotion ? 'none' : 'zenimeStatusDot 1.4s ease-in-out infinite'
            }}
          />
          <span
            id="zenime-startup-status-text"
            className="text-xs font-semibold tracking-wide text-slate-200"
          >
            {statusText}
          </span>
        </div>

        {/* Subtle Indeterminate Shimmer Track (No fake percentage bar) */}
        <div className="w-40 h-[2px] rounded-full bg-slate-900/90 overflow-hidden relative">
          <div
            className="absolute inset-y-0 w-1/2 rounded-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, #ff1e9b 25%, #9333ea 55%, #00f0ff 85%, transparent 100%)',
              animation: prefersReducedMotion ? 'none' : 'zenimeTrackGlide 1.8s ease-in-out infinite'
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes zenimeParticleFloat {
          0% { transform: translate3d(0, 0px, 0) scale(0.9); }
          100% { transform: translate3d(0, -18px, 0) scale(1.15); }
        }
        @keyframes zenimePulseCore {
          0%, 100% { transform: scale(0.94); opacity: 0.8; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes zenimeLightSweep {
          0% { transform: translate3d(-120%, 0, 0); }
          100% { transform: translate3d(120%, 0, 0); }
        }
        @keyframes zenimeTrackGlide {
          0% { transform: translate3d(-100%, 0, 0); }
          100% { transform: translate3d(200%, 0, 0); }
        }
        @keyframes zenimeStatusDot {
          0%, 100% { opacity: 0.45; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
};
