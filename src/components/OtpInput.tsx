import React, { useRef, useEffect } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (val: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  theme?: 'normal' | 'owner';
  error?: boolean;
  onComplete?: (code: string) => void;
  idPrefix?: string;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = true,
  theme = 'normal',
  error = false,
  onComplete,
  idPrefix = 'otp-input'
}) => {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first empty box on mount if autoFocus
  useEffect(() => {
    if (autoFocus && inputsRef.current[0]) {
      const firstEmptyIdx = value.length < length ? value.length : 0;
      inputsRef.current[firstEmptyIdx]?.focus();
    }
  }, [autoFocus]);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const handlePasteRaw = (pastedText: string) => {
    const clean = pastedText.replace(/\D/g, '').slice(0, length);
    if (!clean) return;
    onChange(clean);
    if (clean.length === length && onComplete) {
      onComplete(clean);
    }
    // Focus next box or last box
    const nextIdx = Math.min(clean.length, length - 1);
    inputsRef.current[nextIdx]?.focus();
  };

  const handleContainerPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    handlePasteRaw(pasted);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const rawVal = e.target.value;
    // Check if user pasted multi-character text via mobile autofill/paste
    if (rawVal.length > 1) {
      handlePasteRaw(rawVal);
      return;
    }

    const cleanChar = rawVal.replace(/\D/g, '');
    const newDigits = [...digits];
    newDigits[idx] = cleanChar;
    const combined = newDigits.join('').slice(0, length);
    onChange(combined);

    if (cleanChar && idx < length - 1) {
      inputsRef.current[idx + 1]?.focus();
    }

    if (combined.length === length && onComplete) {
      onComplete(combined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (!digits[idx] && idx > 0) {
        e.preventDefault();
        const newDigits = [...digits];
        newDigits[idx - 1] = '';
        onChange(newDigits.join(''));
        inputsRef.current[idx - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      e.preventDefault();
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const isOwnerTheme = theme === 'owner';

  return (
    <div
      className="flex items-center justify-center gap-2 sm:gap-2.5 py-2 select-none"
      onPaste={handleContainerPaste}
      role="group"
      aria-label="6-digit verification code"
    >
      {Array.from({ length }).map((_, idx) => {
        const char = digits[idx];
        const isCurrent = (value.length === idx) || (idx === length - 1 && value.length === length);

        return (
          <input
            key={idx}
            id={`${idPrefix}-${idx}`}
            ref={el => {
              inputsRef.current[idx] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={idx === 0 ? 'one-time-code' : 'off'}
            maxLength={length} // allow paste multi-character in single input
            value={char}
            disabled={disabled}
            onChange={e => handleChange(e, idx)}
            onKeyDown={e => handleKeyDown(e, idx)}
            onPaste={e => {
              e.preventDefault();
              const pasted = e.clipboardData.getData('text');
              handlePasteRaw(pasted);
            }}
            onFocus={e => e.target.select()}
            className={`w-10 h-12 sm:w-12 sm:h-14 rounded-xl border text-center text-lg sm:text-xl font-mono font-black transition-all focus:outline-none select-text ${
              error
                ? 'border-rose-600 bg-rose-950/40 text-rose-300'
                : char
                ? isOwnerTheme
                  ? 'border-amber-400 bg-amber-950/40 text-amber-300 shadow-md shadow-amber-500/10'
                  : 'border-rose-500 bg-rose-950/40 text-rose-300 shadow-sm'
                : isCurrent
                ? isOwnerTheme
                  ? 'border-amber-400/80 bg-black text-amber-300 ring-2 ring-amber-400/30'
                  : 'border-rose-400/80 bg-slate-900 text-white ring-2 ring-rose-500/20'
                : isOwnerTheme
                ? 'border-slate-800 bg-black text-slate-500 hover:border-slate-700'
                : 'border-slate-800 dark:border-slate-800 light:border-slate-300 bg-slate-950 dark:bg-slate-950 light:bg-white text-slate-400'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-text'}`}
            aria-label={`Digit ${idx + 1}`}
          />
        );
      })}
    </div>
  );
};
export default OtpInput;
