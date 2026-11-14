import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function Sparkline({ data, className, color }: { data: number[]; className?: string; color?: string }) {
  if (data.length < 2) return null;
  const w = 100, h = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - pad - ((v - min) / span) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const c = color ?? 'hsl(var(--primary))';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-8 w-full', className)} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={c} opacity=".12" />
      <path d={line} fill="none" stroke={c} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export interface KpiCardProps {
  label: string;
  /** already formatted value */
  value: React.ReactNode;
  /** % change vs previous period */
  delta?: number;
  /** an increase is bad (e.g. PAR30) */
  invertDelta?: boolean;
  sparkline?: number[];
  loading?: boolean;
  className?: string;
  /** stagger index for entrance animation delay */
  index?: number;
  /** lucide icon to show in the card header */
  icon?: LucideIcon;
  /** tailwind bg + text classes for the icon chip, e.g. "bg-rose-100 text-rose-600" */
  iconColor?: string;
  /** CSS color value for the sparkline line and fill, e.g. "#e11d48" */
  chartColor?: string;
}

export function KpiCard({ label, value, delta, invertDelta, sparkline, loading, className, index = 0, icon: Icon, iconColor, chartColor }: KpiCardProps) {
  if (loading) {
    return (
      <Card className={cn('space-y-3 p-5', className)} aria-busy="true" data-testid="kpi-loading">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  }
  const d = delta ?? 0;
  const good = d === 0 ? null : invertDelta ? d < 0 : d > 0;
  const TrendIcon = d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card
      className={cn('flex flex-col gap-2 p-5 animate-slide-up', className)}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', iconColor ?? 'bg-muted text-muted-foreground')}>
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p
          className="tabular text-2xl font-semibold tracking-tight animate-number-reveal"
          style={{ animationDelay: `${index * 60 + 80}ms` }}
          data-testid="kpi-value"
        >{value}</p>
        {delta !== undefined && (
          <span
            data-testid="kpi-delta"
            data-good={good === null ? 'neutral' : good ? 'good' : 'bad'}
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular',
              good === null && 'bg-muted text-muted-foreground',
              good === true && 'bg-success/12 text-success',
              good === false && 'bg-destructive/10 text-destructive',
            )}
          >
            <TrendIcon className="size-3" aria-hidden />
            {Math.abs(d).toFixed(1)}%
            <span className="sr-only">{d > 0 ? ' increase' : d < 0 ? ' decrease' : ' no change'}</span>
          </span>
        )}
      </div>
      {sparkline && <Sparkline data={sparkline} color={chartColor} />}
    </Card>
  );
}
