'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, ShieldAlert, Users, Wallet, ArrowUpFromLine, BadgePercent, AlertTriangle, UserCheck, BarChart2, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatNaira, type DashboardSummary, type KpiDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { AreaChartCard } from '@/components/charts/area-chart-card';
import { LineChartCard } from '@/components/charts/line-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { DonutChartCard } from '@/components/charts/donut-chart-card';
import { FunnelChartCard } from '@/components/charts/funnel-chart-card';
import { HeatmapChart } from '@/components/charts/heatmap-chart';
import { ErrorState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { get, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const RANGES = [{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }] as const;

function formatKpi(k: KpiDto): string {
  if (k.format === 'naira') return formatNaira(k.value, { compact: true });
  if (k.format === 'percent') return `${k.value.toFixed(1)}%`;
  return k.value.toLocaleString('en-NG');
}
const shortDate = (d: string) => new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', timeZone: 'Africa/Lagos' });
const nairaAxis = (v: number) => formatNaira(v, { compact: true });

/* KPI icon config — icon + tailwind bg/text color + chart CSS color per key */
const KPI_ICON: Record<string, { icon: LucideIcon; iconColor: string; chartColor: string }> = {
  outstanding:    { icon: Wallet,           iconColor: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',           chartColor: '#e11d48' },
  disbursed:      { icon: ArrowUpFromLine,  iconColor: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',       chartColor: '#d97706' },
  collected:      { icon: TrendingUp,       iconColor: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400', chartColor: '#059669' },
  efficiency:     { icon: BadgePercent,     iconColor: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',               chartColor: '#0284c7' },
  par30:          { icon: AlertTriangle,    iconColor: 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400',   chartColor: '#ea580c' },
  borrowers:      { icon: UserCheck,        iconColor: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',   chartColor: '#7c3aed' },
  approval_rate:  { icon: BarChart2,        iconColor: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400',           chartColor: '#0d9488' },
};

/* Chart colour constants — one distinct colour per chart card */
const C_MAROON   = 'hsl(var(--chart-1))';   // maroon
const C_AMBER    = 'hsl(var(--chart-2))';   // amber/gold
const C_OCEAN    = 'hsl(var(--chart-3))';   // ocean blue
const C_PURPLE   = 'hsl(var(--chart-4))';   // purple
const C_CORAL    = 'hsl(var(--chart-5))';   // coral/orange
const C_GREEN    = 'hsl(var(--chart-6))';   // forest green

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardSummary>('/dashboard/summary'), refetchInterval: 120_000 });
  const [days, setDays] = React.useState<number>(30);
  const d = q.data;
  const loading = q.isLoading;
  const last = <T,>(a: T[] | undefined) => (a ?? []).slice(-days);

  if (q.isError) return (<><PageHeader title="Dashboard" /><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></>);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description=""
        actions={<></>}
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, i) => <KpiCard key={i} loading label="" value="" />)
          : d?.kpis.map((k, i) => (
              <KpiCard
                key={k.key}
                label={k.label}
                value={formatKpi(k)}
                delta={k.delta}
                invertDelta={k.invertDelta}
                index={i}
                icon={KPI_ICON[k.key]?.icon}
                iconColor={KPI_ICON[k.key]?.iconColor}
              />
            ))}
      </section>

      {d && (
        <section aria-label="Operations" className="mt-4 grid gap-3 sm:grid-cols-3">
          <OpTile href="/approvals" icon={CheckSquare} label="Waiting for approval" value={d.operational.pendingApprovals} />
          <OpTile icon={Users} label="Staff online now" value={d.operational.activeSessions} />
          <OpTile icon={ShieldAlert} label="Failed logins (last 24h)" value={d.operational.failedLogins24h} tone={d.operational.failedLogins24h > 10 ? 'bad' : undefined} />
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Money lent vs collected — maroon for lent, amber for collected */}
        <AreaChartCard
          title="Money lent vs collected" description={`Last ${days} days`} loading={loading}
          data={last(d?.disbursementSeries)} xKey="date" xFormatter={shortDate} yFormatter={nairaAxis}
          series={[
            { key: 'disbursedKobo', label: 'Lent out', color: C_MAROON },
            { key: 'collectedKobo', label: 'Collected', color: C_AMBER },
          ]}
        />

        {/* Unpaid loans balance — ocean blue */}
        <AreaChartCard
          title="Unpaid loans" description={`Balance over last ${days} days`} loading={loading}
          data={last(d?.outstandingSeries)} xKey="date" xFormatter={shortDate} yFormatter={nairaAxis}
          series={[{ key: 'outstandingKobo', label: 'Unpaid balance', color: C_OCEAN }]}
        />

        {/* Overdue loans — coral for 90d (most severe), amber for 30d, green for 1d */}
        <LineChartCard
          title="Overdue loans" description="% of loans 1, 30 or 90+ days late" loading={loading}
          data={last(d?.parSeries)} xKey="date" xFormatter={shortDate} yFormatter={(v) => `${v}%`}
          series={[
            { key: 'par1',  label: '1 day late',  color: C_GREEN },
            { key: 'par30', label: '30 days late', color: C_AMBER },
            { key: 'par90', label: '90+ days late', color: C_CORAL },
          ]}
        />

        {/* Application pipeline — funnel, "App visits" removed */}
        <FunnelChartCard
          title="Application pipeline" description="How far each application got"
          loading={loading}
          data={(d?.funnel ?? []).filter((f) => f.stage !== 'App visits')}
        />

        {/* When people apply — heatmap, purple accent */}
        <HeatmapChart
          title="When people apply" description="Day of week by hour"
          loading={loading} data={d?.heatmap ?? { rows: [], cols: [], values: [] }}
        />

        {/* Loan types breakdown — donut, all chart colours */}
        <DonutChartCard
          title="Loan types" description="By amount lent"
          loading={loading}
          data={(d?.productMix ?? []).map((p) => ({ name: p.product, value: p.amountKobo }))}
          valueFormatter={nairaAxis} centerLabel="total"
        />
      </div>
    </>
  );
}

function OpTile({ icon: Icon, label, value, href, tone }: { icon: React.ElementType; label: string; value: React.ReactNode; href?: string; tone?: 'good' | 'bad' }) {
  const body = (
    <Card className={cn('flex items-center gap-3 p-4 transition-colors', href && 'hover:bg-muted/40')}>
      <div className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground"><Icon className="size-4" aria-hidden /></div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="tabular text-lg font-semibold leading-tight">
          {tone ? <Badge variant={tone === 'good' ? 'success' : 'destructive'} className="text-sm">{value}</Badge> : value}
        </p>
      </div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
