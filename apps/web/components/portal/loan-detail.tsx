'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { formatLagos, type LoanInstallmentDto, type RepaymentDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { MoneyText } from '@/components/money';
import { PortalApiError, portalErrorMessage } from '@/lib/portal-api';
import { loanStatementUrl, useLoan } from '@/lib/portal-loans-api';
import { LoanStatusChip } from './loan-status-chip';
import { RepaySheet } from './repay-sheet';

const INSTALLMENT_BADGE: Record<LoanInstallmentDto['status'], string> = {
  PENDING: 'text-muted-foreground', PARTIAL: 'text-warning', PAID: 'text-success', OVERDUE: 'text-destructive',
};

function InstallmentsTable({ installments }: { installments: LoanInstallmentDto[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <caption className="sr-only">Repayment calendar</caption>
        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-2 font-medium">#</th>
            <th scope="col" className="px-2 py-2 font-medium">Due</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Paid</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {installments.map((l) => (
            <tr key={l.id}>
              <td className="px-2 py-1.5">{l.seq}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{formatLagos(`${l.dueDate}T12:00:00Z`, 'date')}</td>
              <td className="px-2 py-1.5 text-right"><MoneyText kobo={l.totalKobo} trimZeroKobo /></td>
              <td className="px-2 py-1.5 text-right"><MoneyText kobo={l.paidKobo} trimZeroKobo /></td>
              <td className={`px-2 py-1.5 text-right font-medium ${INSTALLMENT_BADGE[l.status]}`}>{l.status === 'OVERDUE' ? `Overdue` : l.status[0] + l.status.slice(1).toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepaymentHistory({ repayments }: { repayments: RepaymentDto[] }) {
  if (repayments.length === 0) return <p className="text-sm text-muted-foreground">No repayments recorded yet.</p>;
  return (
    <ul className="divide-y">
      {repayments.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{r.receiptNumber}</p>
            <p className="text-xs text-muted-foreground">{formatLagos(r.createdAt, 'date')} · {r.method.replace(/_/g, ' ').toLowerCase()}</p>
          </div>
          <p className="font-semibold tabular"><MoneyText kobo={r.amountKobo} trimZeroKobo /></p>
        </li>
      ))}
    </ul>
  );
}

export function LoanDetail({ id }: { id: string }) {
  const q = useLoan(id);
  const [repayOpen, setRepayOpen] = React.useState(false);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-56" /><Skeleton className="h-32 w-full" /><Skeleton className="h-60 w-full" /></div>;
  if (q.isError || !q.data) {
    const nf = q.error instanceof PortalApiError && q.error.statusCode === 404;
    return <ErrorState message={nf ? 'We could not find that loan.' : portalErrorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  const loan = q.data;
  const nextDue = loan.installments.find((i) => i.status === 'PENDING' || i.status === 'PARTIAL' || i.status === 'OVERDUE');
  const canRepay = loan.status !== 'CLOSED' && loan.status !== 'WRITTEN_OFF';

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" asChild><Link href="/portal/repay"><ArrowLeft /> My loans</Link></Button>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{loan.productName}</h1>
          <p className="text-xs text-muted-foreground">{loan.reference} · disbursed {formatLagos(loan.disbursedAt, 'date')}</p>
        </div>
        <LoanStatusChip status={loan.status} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-xl font-semibold"><MoneyText kobo={loan.outstandingTotalKobo} trimZeroKobo /></p>
        </CardContent></Card>
        <Card><CardContent className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">{nextDue ? 'Next due' : loan.dpd > 0 ? 'Days past due' : 'Status'}</p>
          {nextDue ? (
            <>
              <p className="text-xl font-semibold"><MoneyText kobo={nextDue.totalKobo - nextDue.paidKobo} trimZeroKobo /></p>
              <p className="text-xs text-muted-foreground">{formatLagos(`${nextDue.dueDate}T12:00:00Z`, 'date')}</p>
            </>
          ) : (
            <p className={`text-xl font-semibold ${loan.dpd > 0 ? 'text-destructive' : ''}`}>{loan.dpd > 0 ? `${loan.dpd} day${loan.dpd > 1 ? 's' : ''}` : 'Up to date'}</p>
          )}
        </CardContent></Card>
      </div>

      {canRepay && (
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={() => setRepayOpen(true)}>Repay now</Button>
          <Button size="lg" variant="outline" asChild><a href={loanStatementUrl(loan.id)} target="_blank" rel="noreferrer"><Download /> Statement</a></Button>
        </div>
      )}
      {!canRepay && (
        <Button size="lg" variant="outline" className="w-full" asChild><a href={loanStatementUrl(loan.id)} target="_blank" rel="noreferrer"><Download /> Download statement</a></Button>
      )}

      <Card>
        <CardHeader><CardTitle>Repayment calendar</CardTitle></CardHeader>
        <CardContent><InstallmentsTable installments={loan.installments} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Repayment history</CardTitle></CardHeader>
        <CardContent><RepaymentHistory repayments={loan.repayments} /></CardContent>
      </Card>

      <RepaySheet loan={loan} open={repayOpen} onOpenChange={setRepayOpen} />
    </div>
  );
}
