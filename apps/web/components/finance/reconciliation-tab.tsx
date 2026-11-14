'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import { KpiCard } from '@/components/kpi-card';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { ErrorState } from '@/components/ui/empty-state';
import { errorMessage } from '@/lib/api';
import { getReconciliationSummary } from '@/lib/finance-api';

function lastMonths(n: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
    out.push({ value, label });
  }
  return out;
}

export function ReconciliationTab() {
  const months = React.useMemo(() => lastMonths(12), []);
  const [period, setPeriod] = React.useState(months[0]!.value);
  const q = useQuery({
    queryKey: ['treasury', 'reconciliation-summary', period],
    queryFn: () => getReconciliationSummary(period),
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="recon-period" className="text-sm font-medium text-muted-foreground">Period</label>
        <Select id="recon-period" className="w-48" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
      </div>

      {q.isError && <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>}

      <section aria-label="Reconciliation summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {q.isLoading || !d ? (
          Array.from({ length: 3 }, (_, i) => <KpiCard key={i} loading label="" value="" />)
        ) : (
          <>
            <KpiCard label="Matched" value={d.matched.toLocaleString('en-NG')} />
            <KpiCard label="Unmatched" value={d.unmatched.toLocaleString('en-NG')} />
            <KpiCard label="Exceptions" value={d.exceptions.toLocaleString('en-NG')} />
            <KpiCard label="Matched amount" value={formatNaira(d.matchedKobo, { compact: true })} />
            <KpiCard label="Unmatched amount" value={formatNaira(d.unmatchedKobo, { compact: true })} />
          </>
        )}
      </section>
    </div>
  );
}
