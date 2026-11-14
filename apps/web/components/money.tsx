'use client';
import * as React from 'react';
import { formatNaira, nairaToKobo, type FormatNairaOptions } from '@damez/shared';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export function MoneyText({
  kobo,
  className,
  ...opts
}: { kobo: number | bigint | string | null | undefined; className?: string } & FormatNairaOptions) {
  return <span className={cn('tabular whitespace-nowrap', className)}>{formatNaira(kobo, opts)}</span>;
}

/** Parse naira text to kobo; null when empty/invalid. Never uses float math. */
export function parseNairaInput(text: string): number | null {
  if (!text.trim()) return null;
  try {
    return nairaToKobo(text);
  } catch {
    return null;
  }
}

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  /** kobo integer or null */
  value: number | null;
  onChange: (kobo: number | null) => void;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(({ value, onChange, className, ...props }, ref) => {
  const [text, setText] = React.useState(value === null ? '' : (value / 100).toFixed(2).replace(/\.00$/, ''));
  const [invalid, setInvalid] = React.useState(false);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₦</span>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className={cn('tabular pl-7', className)}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const k = parseNairaInput(t);
          setInvalid(t.trim() !== '' && k === null);
          onChange(k);
        }}
        {...props}
      />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';
