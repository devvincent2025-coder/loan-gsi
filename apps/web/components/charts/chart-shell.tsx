import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const CHART_COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--chart-6))',
];

export interface SeriesDef { key: string; label: string; color?: string }

export interface ChartCardBase {
  title: string;
  description?: string;
  loading?: boolean;
  actions?: React.ReactNode;
  height?: number;
  className?: string;
  empty?: boolean;
}

export function ChartShell({ title, description, loading, actions, height = 260, className, empty, children }: ChartCardBase & { children: React.ReactNode }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : empty ? (
          <EmptyState icon={BarChart3} title="No data yet" className="py-8" />
        ) : (
          <div style={{ height }} className="w-full text-xs">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export const axisProps = {
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 },
  axisLine: { stroke: 'hsl(var(--border))' },
  tickLine: false as const,
};
export const gridStroke = 'hsl(var(--border))';

export function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string | number;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 tabular">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-4 font-medium">{typeof p.value === 'number' && formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}
