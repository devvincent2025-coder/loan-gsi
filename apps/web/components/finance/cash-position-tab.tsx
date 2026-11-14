'use client';
import { useQuery } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import { KpiCard } from '@/components/kpi-card';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { DateTime } from '@/components/date-time';
import { errorMessage } from '@/lib/api';
import { getCashPosition } from '@/lib/finance-api';

export function CashPositionTab() {
  const q = useQuery({ queryKey: ['treasury', 'cash-position'], queryFn: getCashPosition, refetchInterval: 120_000 });
  const d = q.data;

  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;

  return (
    <div className="space-y-3">
      {d && (
        <p className="text-sm text-muted-foreground">
          As of <DateTime value={d.asOfDate} style="short" />
        </p>
      )}
      <section aria-label="Cash position" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {q.isLoading || !d ? (
          Array.from({ length: 5 }, (_, i) => <KpiCard key={i} loading label="" value="" />)
        ) : (
          <>
            <KpiCard label="Cash" value={formatNaira(d.cashKobo, { compact: true })} />
            <KpiCard label="Disbursed today" value={formatNaira(d.disbursedTodayKobo, { compact: true })} />
            <KpiCard label="Collected today" value={formatNaira(d.collectedTodayKobo, { compact: true })} />
            <KpiCard label="Pending disbursements" value={formatNaira(d.pendingDisbursementsKobo, { compact: true })} />
            <KpiCard label="Unreconciled" value={formatNaira(d.unreconciledKobo, { compact: true })} />
          </>
        )}
      </section>
    </div>
  );
}
