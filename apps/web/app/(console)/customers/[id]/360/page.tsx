'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatNaira } from '@damez/shared';
import type { Customer360Dto, RepaymentTimelineEntryDto, CustomerSegment, CollectionBucket } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';
import { get, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react';

const SEGMENT_VARIANT: Record<CustomerSegment, string> = {
  RELIABLE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  SALARY_CYCLE_PAYER: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  RELUCTANT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  HIGH_RISK: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  AT_RISK_OF_CHURN: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  UNKNOWN: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  RELIABLE: 'Reliable', SALARY_CYCLE_PAYER: 'Salary-Cycle Payer', RELUCTANT: 'Reluctant',
  HIGH_RISK: 'High Risk', AT_RISK_OF_CHURN: 'At Risk of Churn', UNKNOWN: 'Unknown',
};

const IFRS_BADGE: Record<number, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  1: { label: 'Stage 1', variant: 'success' },
  2: { label: 'Stage 2', variant: 'warning' },
  3: { label: 'Stage 3', variant: 'destructive' },
};

const BUCKET_LABEL: Record<CollectionBucket, string> = {
  DPD_1_7: '1–7 DPD', DPD_8_30: '8–30 DPD', DPD_31_60: '31–60 DPD', DPD_61_90: '61–90 DPD', DPD_90_PLUS: '90+ DPD',
};

function TimelineEntry({ entry }: { entry: RepaymentTimelineEntryDto }) {
  const isRepayment = entry.type === 'REPAYMENT';
  const isDebit = entry.type === 'DEBIT_ATTEMPT';
  const isPtp = entry.type === 'PTP';
  const failed = isDebit && entry.status !== 'SUCCESS' && entry.status !== 'SETTLED';

  let icon: React.ReactNode;
  let dot: string;

  if (isRepayment) { icon = <CheckCircle2 className="size-4 text-success" />; dot = 'border-success bg-success/20'; }
  else if (isDebit && !failed) { icon = <CheckCircle2 className="size-4 text-blue-500" />; dot = 'border-blue-400 bg-blue-100 dark:bg-blue-900/30'; }
  else if (isDebit && failed) { icon = <XCircle className="size-4 text-destructive" />; dot = 'border-destructive bg-destructive/10'; }
  else if (isPtp) { icon = <AlertTriangle className="size-4 text-warning" />; dot = 'border-warning bg-warning/15'; }
  else { icon = <Circle className="size-4 text-muted-foreground" />; dot = 'border-muted-foreground bg-muted'; }

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn('flex size-7 items-center justify-center rounded-full border-2', dot)}>{icon}</div>
        <div className="w-0.5 flex-1 bg-border" />
      </div>
      <div className="min-w-0 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{entry.type.replace(/_/g, ' ')}</span>
          {entry.amountKobo != null && <span className="tabular text-sm font-semibold">{formatNaira(entry.amountKobo)}</span>}
          <span className="ml-auto text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short' })}</span>
        </div>
        {entry.channel && <p className="text-xs text-muted-foreground">{entry.channel}</p>}
        {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
      </div>
    </div>
  );
}

export default function Customer360Page() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['customer-360', id], queryFn: () => get<Customer360Dto>(`/customers/${id}/360`) });
  const c = q.data;

  if (q.isLoading) return (
    <><PageHeader title="Customer 360" /><div className="space-y-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div></>
  );

  if (q.isError || !c) return (
    <><PageHeader title="Customer 360" /><Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card></>
  );

  return (
    <>
      <PageHeader
        title={c.displayName}
        description="Unified customer view: behaviour, loans, and contact history."
      />

      {/* Identity & risk */}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground">Phone:</span>
                <span className="font-mono text-sm">{c.phone}</span>
              </div>
              {c.email && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-muted-foreground">Email:</span>
                  <span className="font-mono text-sm">{c.email}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline">KYC Tier {c.kycTier}</Badge>
                <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', SEGMENT_VARIANT[c.segment])}>{SEGMENT_LABEL[c.segment]}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">PD: {c.pdScore.toFixed(2)}</span>
              </div>
            </div>
          </div>
          {c.riskFlags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {c.riskFlags.map((f) => <Badge key={f} variant="destructive">{f}</Badge>)}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Behaviour Summary</h3>
          <p className="text-sm">{c.behaviourSummary}</p>
          {c.lastContactAt && (
            <p className="mt-2 text-xs text-muted-foreground">Last contact: {new Date(c.lastContactAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}</p>
          )}
        </Card>
      </div>

      {/* Loans */}
      <Card className="mb-4 overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Loans ({c.loans.length})</h2>
        </div>
        {c.loans.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No loans found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                  <th className="px-4 py-2.5 text-left font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Principal</th>
                  <th className="px-4 py-2.5 text-right font-medium">Unpaid</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Days late</th>
                  <th className="px-4 py-2.5 text-left font-medium">IFRS</th>
                </tr>
              </thead>
              <tbody>
                {c.loans.map((loan) => {
                  const ifrs = IFRS_BADGE[loan.ifrsStage];
                  return (
                    <tr key={loan.loanId} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <Link href={`/loans/${loan.loanId}`} className="font-mono text-xs hover:underline">{loan.reference}</Link>
                      </td>
                      <td className="px-4 py-2.5">{loan.productName}</td>
                      <td className="px-4 py-2.5 text-right tabular">{formatNaira(loan.principalKobo)}</td>
                      <td className="px-4 py-2.5 text-right tabular">{formatNaira(loan.outstandingKobo)}</td>
                      <td className="px-4 py-2.5"><Badge variant={loan.status === 'ACTIVE' ? 'success' : loan.status === 'DEFAULTED' ? 'destructive' : 'secondary'}>{loan.status}</Badge></td>
                      <td className="px-4 py-2.5 text-right tabular font-semibold">{loan.dpd}</td>
                      <td className="px-4 py-2.5">{ifrs ? <Badge variant={ifrs.variant}>{ifrs.label}</Badge> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Active collection case */}
      {c.activeCase && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 text-sm font-semibold">Active Collection Case</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs">{c.activeCase.loanReference}</span>
            <Badge variant="secondary">{BUCKET_LABEL[c.activeCase.bucket]}</Badge>
            <Badge variant="warning">{c.activeCase.status.replace(/_/g, ' ')}</Badge>
            <span className="text-sm">{formatNaira(c.activeCase.totalOutstandingKobo)} unpaid</span>
            <Link href={`/collections/${c.activeCase.id}`} className="ml-auto text-sm text-primary hover:underline">View case →</Link>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Repayment timeline */}
        <Card className="p-4">
          <h2 className="mb-4 text-sm font-semibold">Repayment Timeline</h2>
          {c.repaymentTimeline.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No timeline entries.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {c.repaymentTimeline.slice(0, 20).map((entry, i) => (
                <TimelineEntry key={i} entry={entry} />
              ))}
            </div>
          )}
        </Card>

        {/* Linked accounts */}
        <Card className="p-4">
          <h2 className="mb-4 text-sm font-semibold">Linked Accounts ({c.linkedAccounts.length})</h2>
          {c.linkedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No linked accounts.</p>
          ) : (
            <div className="space-y-2">
              {c.linkedAccounts.map((acct) => (
                <div key={acct.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold">{acct.bankCode}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm">{acct.accountNumberMasked}</p>
                    <p className="text-xs text-muted-foreground">{acct.accountNameMasked}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {acct.isPrimary && <Badge variant="success">Primary</Badge>}
                    <Badge variant={acct.status === 'ACTIVE' ? 'default' : 'secondary'}>{acct.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
