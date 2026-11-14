'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PlayCircle } from 'lucide-react';
import { KpiCard } from '@/components/kpi-card';
import { MoneyText } from '@/components/money';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { getAutodebitDashboard, triggerAutodebit } from '@/lib/autodebit-api';

export function AutodebitTab() {
  const canTrigger = useCan('autodebit:trigger');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['autodebit', 'dashboard'], queryFn: getAutodebitDashboard, refetchInterval: 120_000 });
  const d = q.data;

  const trigger = useMutation({
    mutationFn: () => triggerAutodebit(),
    onSuccess: () => {
      toast.success('Autodebit run triggered');
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ['autodebit'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <section aria-label="Linked account health" className="grid flex-1 gap-4 sm:grid-cols-2">
          {q.isLoading || !d ? (
            <>
              <KpiCard loading label="" value="" />
              <KpiCard loading label="" value="" />
            </>
          ) : (
            <>
              <KpiCard label="Healthy customers" value={d.linkedAccountHealth.healthyCustomers.toLocaleString('en-NG')} />
              <KpiCard label="Total customers" value={d.linkedAccountHealth.totalCustomers.toLocaleString('en-NG')} />
            </>
          )}
        </section>
        {canTrigger && (
          <Button onClick={() => setConfirmOpen(true)}><PlayCircle /> Run autodebit now</Button>
        )}
      </div>

      <BarChartCard
        title="Debit success rate by bank"
        description="Share of attempted debits that succeeded"
        loading={q.isLoading}
        data={d?.successRateByBank ?? []}
        xKey="bankName"
        layout="vertical"
        yFormatter={(v) => `${(v / 100).toFixed(1)}%`}
        series={[{ key: 'successRateBps', label: 'Success rate (bps)' }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Mandate status</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {q.isLoading && <Skeleton className="h-32" />}
            {d && d.mandateStatusSummary.length === 0 && <EmptyState title="No mandates yet" />}
            {d && d.mandateStatusSummary.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {d.mandateStatusSummary.map((m) => (
                  <Badge key={m.status} variant="outline" className="gap-1.5 text-sm">
                    {m.status} <span className="tabular font-semibold">{m.count.toLocaleString('en-NG')}</span>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top failure reasons</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {q.isLoading && <Skeleton className="h-32" />}
            {d && d.failedReasons.length === 0 && <EmptyState title="No failed debits" />}
            {d && d.failedReasons.length > 0 && (
              <table className="w-full text-sm">
                <tbody>
                  {d.failedReasons.map((r) => (
                    <tr key={r.reason} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{r.reason}</td>
                      <td className="py-1.5 text-right tabular font-medium">{r.count.toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>GSI recovery</CardTitle><p className="text-xs text-muted-foreground">Monthly recovered amount and attempts</p></CardHeader>
        <CardContent className="pt-0">
          {q.isLoading && <Skeleton className="h-32" />}
          {d && d.gsiRecovery.length === 0 && <EmptyState title="No GSI recoveries yet" />}
          {d && d.gsiRecovery.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Period</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Attempts</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Successes</th>
                    <th className="py-1.5 text-right font-medium">Recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {d.gsiRecovery.map((g) => (
                    <tr key={g.period} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{g.period}</td>
                      <td className="py-1.5 pr-3 text-right tabular">{g.attempts.toLocaleString('en-NG')}</td>
                      <td className="py-1.5 pr-3 text-right tabular">{g.successes.toLocaleString('en-NG')}</td>
                      <td className="py-1.5 text-right font-medium"><MoneyText kobo={g.recoveredKobo} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Run autodebit now?"
        description="This triggers a live autodebit run against due installments immediately. It cannot be undone."
        confirmLabel="Run now"
        loading={trigger.isPending}
        onConfirm={() => trigger.mutate()}
      />
    </div>
  );
}
