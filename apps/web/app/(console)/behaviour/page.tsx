'use client';
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BehaviourPortfolioDto, EarlyWarningFlagDto, CustomerSegment } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { DonutChartCard } from '@/components/charts/donut-chart-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { get, post, errorMessage } from '@/lib/api';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

const SEGMENT_COLOR: Record<CustomerSegment, string> = {
  RELIABLE: '#22c55e',
  SALARY_CYCLE_PAYER: '#3b82f6',
  RELUCTANT: '#eab308',
  HIGH_RISK: '#ef4444',
  AT_RISK_OF_CHURN: '#f97316',
  UNKNOWN: '#6b7280',
};

const SEGMENT_VARIANT: Record<CustomerSegment, 'success' | 'info' | 'warning' | 'destructive' | 'secondary' | 'default'> = {
  RELIABLE: 'success', SALARY_CYCLE_PAYER: 'info' as never, RELUCTANT: 'warning', HIGH_RISK: 'destructive', AT_RISK_OF_CHURN: 'warning', UNKNOWN: 'secondary',
};

const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  RELIABLE: 'Reliable', SALARY_CYCLE_PAYER: 'Salary-Cycle Payer', RELUCTANT: 'Reluctant', HIGH_RISK: 'High Risk', AT_RISK_OF_CHURN: 'At Risk of Churn', UNKNOWN: 'Unknown',
};

function AcknowledgeModal({ flag, onClose }: { flag: EarlyWarningFlagDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = React.useState('');
  const mut = useMutation({
    mutationFn: () => post(`/behaviour/early-warnings/${flag.id}/acknowledge`, { note }),
    onSuccess: () => { toast.success('Warning acknowledged'); qc.invalidateQueries({ queryKey: ['early-warnings'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Acknowledge Warning</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">{flag.triggerReason}</p>
      <FormField label="Note" htmlFor="ack-note">
        <Textarea id="ack-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Action taken or observation…" />
      </FormField>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button loading={mut.isPending} onClick={() => mut.mutate()}>Acknowledge</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function BehaviourPage() {
  const [ackFlag, setAckFlag] = React.useState<EarlyWarningFlagDto | null>(null);

  const portfolio = useQuery({ queryKey: ['behaviour-portfolio'], queryFn: () => get<BehaviourPortfolioDto>('/behaviour/portfolio'), refetchInterval: 120_000 });
  const warnings = useQuery({
    queryKey: ['early-warnings'],
    queryFn: () => get<{ items: EarlyWarningFlagDto[]; total: number; page: number; pageSize: number }>('/behaviour/early-warnings').then((r) => r.items),
    refetchInterval: 60_000,
  });

  const p = portfolio.data;

  const segmentData = p
    ? (Object.entries(p.bySegment) as [CustomerSegment, number][])
        .filter(([, v]) => v > 0)
        .map(([seg, count]) => ({ name: SEGMENT_LABEL[seg], value: count, color: SEGMENT_COLOR[seg] }))
    : [];

  return (
    <>
      <PageHeader title="Credit Evaluation" description="Customer payment behaviour and early warnings." />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard loading={portfolio.isLoading} label="Total Customers" value={p ? p.totalCustomers.toLocaleString('en-NG') : '—'} />
        <KpiCard loading={portfolio.isLoading} label="Avg PD Score" value={p ? p.avgPdScore.toFixed(2) : '—'} />
        <KpiCard loading={portfolio.isLoading} label="Early Warnings" value={p ? p.earlyWarnings.toLocaleString('en-NG') : '—'} invertDelta />
        <KpiCard loading={portfolio.isLoading} label="30d Roll Rate" value={p ? `${(p.rollRate30d * 100).toFixed(1)}%` : '—'} invertDelta />
        <KpiCard loading={portfolio.isLoading} label="30d Cure Rate" value={p ? `${(p.cureRate30d * 100).toFixed(1)}%` : '—'} />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DonutChartCard
          title="Segment Distribution"
          description="Customers by payment behaviour segment"
          loading={portfolio.isLoading}
          data={segmentData}
          valueFormatter={(v) => v.toLocaleString('en-NG')}
          centerLabel="customers"
        />

        <Card>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Early Warning Flags</h2>
            <p className="text-xs text-muted-foreground">{warnings.data?.filter((f) => f.status === 'OPEN').length ?? '—'} open flags</p>
          </div>
          {warnings.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : warnings.data?.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <AlertTriangle className="size-8 opacity-40" />
              <p>No early warnings.</p>
            </div>
          ) : (
            <div className="divide-y max-h-80 overflow-y-auto">
              {(warnings.data ?? []).map((f) => (
                <div key={f.id} className="flex items-start gap-3 px-4 py-3">
                  <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${f.status === 'OPEN' ? 'text-warning' : 'text-muted-foreground'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{f.customerName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{f.loanReference}</span>
                      <Badge variant={f.status === 'OPEN' ? 'warning' : 'secondary'} className="ml-auto">{f.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{f.triggerReason}</p>
                    <p className="text-xs text-muted-foreground">PD: <span className="font-medium text-foreground">{f.pdScore.toFixed(2)}</span> · {new Date(f.flagDate).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}</p>
                  </div>
                  {f.status === 'OPEN' && (
                    <Button size="sm" variant="outline" onClick={() => setAckFlag(f)}>Acknowledge</Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={!!ackFlag} onOpenChange={(o) => !o && setAckFlag(null)}>
        {ackFlag && <AcknowledgeModal flag={ackFlag} onClose={() => setAckFlag(null)} />}
      </Dialog>
    </>
  );
}
