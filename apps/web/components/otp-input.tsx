'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  /** fired once when all digits are entered */
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}

export function OtpInput({ length = 6, value, onChange, onComplete, disabled, autoFocus, label = 'One-time code' }: OtpInputProps) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${label} digit ${i + 1}`}
          maxLength={length}
          className={cn(
            'size-12 rounded-md border border-input bg-card text-center text-xl font-semibold tabular shadow-card transition-colors disabled:opacity-50',
            d && 'border-primary/60',
          )}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) {
              commit(value.slice(0, i) + value.slice(i + 1));
              return;
            }
            const next = (value.slice(0, i) + v + value.slice(i + 1)).slice(0, length);
            commit(next);
            refs.current[Math.min(i + v.length, length - 1)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              commit(value.slice(0, i - 1));
              refs.current[i - 1]?.focus();
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            commit(e.clipboardData.getData('text'));
            refs.current[length - 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
