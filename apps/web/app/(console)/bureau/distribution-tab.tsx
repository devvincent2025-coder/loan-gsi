'use client';
import { useQuery } from '@tanstack/react-query';
import type { BureauDistributionDto } from '@damez/shared';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { DateTime } from '@/components/date-time';
import { KpiCard } from '@/components/kpi-card';
import { MoneyText } from '@/components/money';
import { Callout } from '@/components/staff/ui-bits';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { errorMessage, get } from '@/lib/api';

export function DistributionTab() {
  const q = useQuery({ queryKey: ['bureau-distribution'], queryFn: () => get<BureauDistributionDto>('/bureau/distribution') });
  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const pct = (v: number) => `${v.toFixed(1)}%`;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard loading={q.isLoading} label="Scored customers" value={d?.totalCustomers ?? 0} />
        <KpiCard loading={q.isLoading} label="Average score" value={d?.averageScore ?? '—'} />
        <KpiCard loading={q.isLoading} label="Elsewhere default" value={pct(d?.elsewhereDefaultPct ?? 0)} />
        <KpiCard loading={q.isLoading} label="Write-off" value={pct(d?.writeOffPct ?? 0)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <BarChartCard title="Customers by score band" loading={q.isLoading} data={(d?.bands ?? []).map((b) => ({ band: b.label, customers: b.customers }))} xKey="band" series={[{ key: 'customers', label: 'Customers' }]} height={260} />
        <Card className="overflow-hidden">
          <table className="w-full text-sm" data-testid="distribution-table">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2.5 font-medium">Band</th><th className="px-3 font-medium">Range</th><th className="px-3 text-right font-medium">Customers</th><th className="px-3 text-right font-medium">Exposure</th></tr></thead>
            <tbody>
              {(d?.bands ?? []).map((b) => (
                <tr key={b.label} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{b.label}</td><td className="tabular px-3">{b.min}-{b.max}</td><td className="tabular px-3 text-right">{b.customers}</td><td className="px-3 text-right"><MoneyText kobo={b.exposureKobo} compact /></td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Callout tone="info">This dataset also feeds the executive dashboards. {d && <>As of <DateTime value={d.asOf} />.</>}</Callout>
    </div>
  );
}
