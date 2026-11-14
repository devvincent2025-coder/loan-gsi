'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PiiLeakReportDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { get, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ShieldAlert } from 'lucide-react';

const PERIOD_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

export default function PiiReportPage() {
  const [days, setDays] = React.useState(30);

  const q = useQuery({ queryKey: ['pii-report', days], queryFn: () => get<PiiLeakReportDto>('/pii-vault/leak-report', { days }) });

  const r = q.data;

  const featureData = r
    ? Object.entries(r.blocksByFeature).map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count)
    : [];

  const typeData = r
    ? Object.entries(r.blocksByType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
    : [];

  if (q.isError) return (
    <><PageHeader title="PII Leak Report" /><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></>
  );

  return (
    <>
      <PageHeader
        title="PII Leak Report"
        description="Outbound PII detection blocks and reveal events from the LLM gateway."
        actions={
          <div role="group" aria-label="Period" className="inline-flex rounded-lg bg-muted p-1">
            {PERIOD_OPTIONS.map((p) => (
              <Button key={p.value} size="sm" variant={days === p.value ? 'default' : 'ghost'} aria-pressed={days === p.value} onClick={() => setDays(p.value)} className={cn('h-7', days !== p.value && 'hover:bg-card')}>
                {p.label}
              </Button>
            ))}
          </div>
        }
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-3">
        <KpiCard loading={q.isLoading} label="Blocked Requests" value={r ? r.blockedRequests.toLocaleString('en-NG') : '—'} />
        <KpiCard loading={q.isLoading} label="Reveal Events" value={r ? r.revealEvents.toLocaleString('en-NG') : '—'} />
        <KpiCard loading={q.isLoading} label="Detector Hit Rate" value={r ? `${(r.detectorHitRate * 100).toFixed(1)}%` : '—'} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BarChartCard
          title="Blocks by Feature"
          description="Number of blocked outbound requests per product feature"
          loading={q.isLoading}
          data={featureData}
          xKey="feature"
          series={[{ key: 'count', label: 'Blocks' }]}
          layout="vertical"
          height={Math.max(200, featureData.length * 36)}
          yFormatter={(v) => v.toLocaleString('en-NG')}
        />

        <BarChartCard
          title="Blocks by PII Type"
          description="Number of blocked outbound requests per detected PII type"
          loading={q.isLoading}
          data={typeData}
          xKey="type"
          series={[{ key: 'count', label: 'Blocks' }]}
          layout="vertical"
          height={Math.max(200, typeData.length * 36)}
          yFormatter={(v) => v.toLocaleString('en-NG')}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            <h2 className="text-sm font-semibold">Reveals by User</h2>
          </div>
          <p className="text-xs text-muted-foreground">Staff who used the PII reveal endpoint in the period.</p>
        </div>
        {q.isLoading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !r || r.revealsByUser.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No reveal events in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">User</th>
                <th className="px-4 py-2.5 text-right font-medium">Reveal Count</th>
              </tr>
            </thead>
            <tbody>
              {r.revealsByUser.sort((a, b) => b.count - a.count).map((row) => (
                <tr key={row.userId} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{row.userName}</td>
                  <td className="px-4 py-2.5 text-right tabular">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
