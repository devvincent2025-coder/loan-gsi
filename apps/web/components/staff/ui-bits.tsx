'use client';
import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export function SectionCard({ title, description, actions, children, className, id }: {
  title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <Card className={className} id={id}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1"><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children ?? '—'}</dd>
    </div>
  );
}

const TONES = {
  info: 'border-info/30 bg-info/10',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-success/30 bg-success/10',
} as const;
export function Callout({ tone = 'info', title, children, icon, className, role, ...rest }: {
  tone?: keyof typeof TONES; title?: string; children?: React.ReactNode; icon?: React.ReactNode; className?: string; role?: string; 'data-testid'?: string;
}) {
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={cn('flex gap-3 rounded-md border px-4 py-3 text-sm', TONES[tone], className)} {...rest}>
      <div className="mt-0.5 shrink-0">{icon ?? (tone === 'info' ? <Info className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />)}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', tone !== 'danger' && 'text-foreground/90')}>{children}</div>}
      </div>
    </div>
  );
}

/** Numeric input that edits a percentage but reports basis points (and vice versa). */
export function BpsInput({ value, onChange, id, 'aria-label': ariaLabel, disabled, max }: {
  value: number; onChange: (bps: number) => void; id?: string; 'aria-label'?: string; disabled?: boolean; max?: number;
}) {
  const [text, setText] = React.useState(String(value / 100));
  React.useEffect(() => {
    setText((t) => (Math.round(Number(t) * 100) === value ? t : String(value / 100)));
  }, [value]);
  return (
    <div className="relative">
      <Input
        id={id} aria-label={ariaLabel} disabled={disabled} inputMode="decimal" className="tabular pr-14" value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0 && (max === undefined || n * 100 <= max)) onChange(Math.round(n * 100));
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step, id, disabled, 'aria-label': ariaLabel, className, nullable }: {
  value: number | null; onChange: (n: number | null) => void; min?: number; max?: number; step?: number; id?: string; disabled?: boolean;
  'aria-label'?: string; className?: string; nullable?: boolean;
}) {
  // local text so intermediate input ("-", "1.") is not clobbered by the parent's number
  const [text, setText] = React.useState(value === null ? '' : String(value));
  React.useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === '' ? null : Number(t);
      return parsed === value || (parsed === null && value === 0 && !nullable) ? t : value === null ? '' : String(value);
    });
  }, [value, nullable]);
  return (
    <Input
      id={id} aria-label={ariaLabel} type="text" inputMode="decimal" disabled={disabled} data-min={min} data-max={max} data-step={step} className={cn('tabular', className)}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^-?\d*\.?\d*$/.test(t)) return;
        setText(t);
        if (t.trim() === '') return onChange(nullable ? null : 0);
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
