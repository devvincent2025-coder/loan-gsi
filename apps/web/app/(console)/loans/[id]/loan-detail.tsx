'use client';
import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import type { LoanDetailDto } from '@damez/shared';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { DataTable, type DataColumn } from '@/components/data-table';
import { KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { LoanStatusBadge, InstallmentStatusBadge, DebitAttemptStatusBadge, MandateStatusBadge, DpdValue } from '@/components/loans/loan-ui';
import { RecordRepaymentDialog, RestructureDialog, WriteOffDialog, RecoveryDialog } from '@/components/loans/loan-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { getLoan, listDebitAttempts, loanStatementUrl, repaymentReceiptUrl } from '@/lib/loans-api';
import type { DebitAttemptDto, LoanInstallmentDto, RepaymentDto, MandateDto } from '@damez/shared';

const ACTIONABLE_STATUSES: LoanDetailDto['status'][] = ['ACTIVE', 'Unpaid'];

export function LoanDetail({ id }: { id: string }) {
  const canCreate = useCan('loan:create');
  const canRestructure = useCan('loan:restructure');
  const canWriteOff = useCan('loan:writeoff');
  const canReadAutodebit = useCan('autodebit:read');

  const q = useQuery({ queryKey: ['loan', id], queryFn: () => getLoan(id) });
  const debitAttempts = useQuery({
    queryKey: ['loan-debit-attempts', id],
    queryFn: () => listDebitAttempts(id),
    enabled: canReadAutodebit,
  });

  const [recording, setRecording] = React.useState(false);
  const [restructuring, setRestructuring] = React.useState(false);
  const [writingOff, setWritingOff] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);

  if (q.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) return <Card><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Card>;

  const loan = q.data;
  const canRecordRepayment = canCreate && ACTIONABLE_STATUSES.includes(loan.status);
  const canRequestRestructure = canRestructure && ACTIONABLE_STATUSES.includes(loan.status);
  const canRequestWriteOff = canWriteOff && loan.status === 'Unpaid';
  const canRecordRecovery = canWriteOff && loan.status === 'WRITTEN_OFF';

  const installmentColumns: DataColumn<LoanInstallmentDto>[] = [
    { id: 'seq', header: '#', accessor: (i) => i.seq, cell: (i) => <span className="tabular">{i.seq}</span> },
    { id: 'due', header: 'Due date', accessor: (i) => i.dueDate, cell: (i) => <DateTime value={i.dueDate} style="date" /> },
    { id: 'principal', header: 'Principal', align: 'right', accessor: (i) => i.principalKobo, cell: (i) => <MoneyText kobo={i.principalKobo} /> },
    { id: 'interest', header: 'Interest', align: 'right', accessor: (i) => i.interestKobo, cell: (i) => <MoneyText kobo={i.interestKobo} /> },
    { id: 'fee', header: 'Fee', align: 'right', accessor: (i) => i.feeKobo, cell: (i) => <MoneyText kobo={i.feeKobo} /> },
    { id: 'penalty', header: 'Penalty accrued', align: 'right', accessor: (i) => i.penaltyAccruedKobo, cell: (i) => <MoneyText kobo={i.penaltyAccruedKobo} /> },
    { id: 'total', header: 'Total', align: 'right', accessor: (i) => i.totalKobo, cell: (i) => <MoneyText kobo={i.totalKobo} className="font-medium" /> },
    { id: 'paid', header: 'Paid', align: 'right', accessor: (i) => i.paidKobo, cell: (i) => <MoneyText kobo={i.paidKobo} /> },
    { id: 'status', header: 'Status', accessor: (i) => i.status, cell: (i) => <InstallmentStatusBadge status={i.status} /> },
    { id: 'paidAt', header: 'Paid at', accessor: (i) => i.paidAt ?? '', cell: (i) => <DateTime value={i.paidAt} style="short" /> },
  ];

  const repaymentColumns: DataColumn<RepaymentDto>[] = [
    { id: 'receipt', header: 'Receipt #', accessor: (r) => r.receiptNumber, cell: (r) => <span className="font-mono text-xs font-medium">{r.receiptNumber}</span> },
    { id: 'kind', header: 'Kind', accessor: (r) => r.kind },
    { id: 'method', header: 'Method', accessor: (r) => r.method },
    { id: 'amount', header: 'Amount', align: 'right', accessor: (r) => r.amountKobo, cell: (r) => <MoneyText kobo={r.amountKobo} className="font-medium" /> },
    { id: 'principal', header: 'Principal', align: 'right', accessor: (r) => r.allocatedPrincipalKobo, cell: (r) => <MoneyText kobo={r.allocatedPrincipalKobo} /> },
    { id: 'interest', header: 'Interest', align: 'right', accessor: (r) => r.allocatedInterestKobo, cell: (r) => <MoneyText kobo={r.allocatedInterestKobo} /> },
    { id: 'fee', header: 'Fee', align: 'right', accessor: (r) => r.allocatedFeeKobo, cell: (r) => <MoneyText kobo={r.allocatedFeeKobo} /> },
    { id: 'penalty', header: 'Penalty', align: 'right', accessor: (r) => r.allocatedPenaltyKobo, cell: (r) => <MoneyText kobo={r.allocatedPenaltyKobo} /> },
    { id: 'date', header: 'Date', accessor: (r) => r.createdAt, cell: (r) => <DateTime value={r.createdAt} style="short" /> },
    {
      id: 'receiptLink', header: '', noExport: true,
      cell: (r) => (
        <a href={repaymentReceiptUrl(r.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <Download className="size-3" aria-hidden /> Receipt
        </a>
      ),
    },
  ];

  const debitAttemptColumns: DataColumn<DebitAttemptDto>[] = [
    { id: 'stage', header: 'Retry stage', accessor: (a) => a.retryStage },
    { id: 'attempt', header: 'Attempt #', align: 'right', accessor: (a) => a.attemptNumber },
    { id: 'method', header: 'Method', accessor: (a) => a.method },
    { id: 'amount', header: 'Amount', align: 'right', accessor: (a) => a.amountKobo, cell: (a) => <MoneyText kobo={a.amountKobo} /> },
    { id: 'collected', header: 'Collected', align: 'right', accessor: (a) => a.collectedKobo, cell: (a) => <MoneyText kobo={a.collectedKobo} /> },
    { id: 'status', header: 'Status', accessor: (a) => a.status, cell: (a) => <DebitAttemptStatusBadge status={a.status} /> },
    { id: 'scheduled', header: 'Scheduled for', accessor: (a) => a.scheduledFor, cell: (a) => <DateTime value={a.scheduledFor} style="short" /> },
    { id: 'executed', header: 'Executed at', accessor: (a) => a.executedAt ?? '', cell: (a) => <DateTime value={a.executedAt} style="short" /> },
    { id: 'reason', header: 'Failure reason', accessor: (a) => a.failureReason ?? '', cell: (a) => a.failureReason ?? '—' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/loans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Loans
        </Link>
        <PageHeader
          title={loan.reference}
          description={`${loan.customerName} · ${loan.productName}`}
          actions={
            <>
              <LoanStatusBadge status={loan.status} />
              <Button variant="outline" asChild>
                <a href={loanStatementUrl(loan.id)} target="_blank" rel="noreferrer"><Download /> Statement</a>
              </Button>
              {canRecordRepayment && <Button onClick={() => setRecording(true)}>Record repayment</Button>}
              {canRequestRestructure && <Button variant="outline" onClick={() => setRestructuring(true)}>Request restructure</Button>}
              {canRequestWriteOff && <Button variant="destructive" onClick={() => setWritingOff(true)}>Write off</Button>}
              {canRecordRecovery && <Button variant="outline" onClick={() => setRecovering(true)}>Record recovery</Button>}
            </>
          }
        />
      </div>

      <section aria-label="Loan metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Principal" value={<MoneyText kobo={loan.principalKobo} />} />
        <KpiCard label="Outstanding" value={<MoneyText kobo={loan.outstandingTotalKobo} />} />
        <KpiCard label="Days past due" value={<DpdValue dpd={loan.dpd} />} />
        <KpiCard label="IFRS 9 stage" value={`Stage ${loan.ifrsStage}`} />
        <KpiCard label="Maturity date" value={<DateTime value={loan.maturityDate} style="date" />} />
      </section>

      <SectionCard title="Loan summary">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KeyValue label="Disbursed amount"><MoneyText kobo={loan.disbursedAmountKobo} /></KeyValue>
          <KeyValue label="Tenor">{loan.tenorMonths} months</KeyValue>
          <KeyValue label="Monthly rate"><span className="tabular">{(loan.monthlyRateBps / 100).toFixed(2)}%</span></KeyValue>
          <KeyValue label="Total cost of credit"><MoneyText kobo={loan.totalCostOfCreditKobo} /></KeyValue>
          <KeyValue label="Outstanding principal"><MoneyText kobo={loan.outstandingPrincipalKobo} /></KeyValue>
          <KeyValue label="Disbursed on"><DateTime value={loan.disbursedAt} style="date" /></KeyValue>
          <KeyValue label="Restructure count">{loan.restructureCount}</KeyValue>
          <KeyValue label="Closed on"><DateTime value={loan.closedAt} style="date" /></KeyValue>
          {loan.status === 'WRITTEN_OFF' && (
            <>
              <KeyValue label="Written off on"><DateTime value={loan.writtenOffAt} style="date" /></KeyValue>
              <KeyValue label="Written off amount"><MoneyText kobo={loan.writtenOffAmountKobo} /></KeyValue>
            </>
          )}
        </dl>
      </SectionCard>

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Repayment schedule</TabsTrigger>
          <TabsTrigger value="repayments">Repayments</TabsTrigger>
          {loan.mandates.length > 0 && <TabsTrigger value="mandates">Mandates</TabsTrigger>}
          {canReadAutodebit && <TabsTrigger value="autodebit">Autodebit history</TabsTrigger>}
        </TabsList>

        <TabsContent value="schedule">
          <DataTable
            mode="client"
            columns={installmentColumns}
            data={loan.installments}
            rowKey={(i) => i.id}
            pageSize={100}
            exportName={`${loan.reference}-schedule`}
            emptyTitle="No installments"
            searchPlaceholder="Search schedule…"
          />
        </TabsContent>

        <TabsContent value="repayments">
          <DataTable
            mode="client"
            columns={repaymentColumns}
            data={loan.repayments}
            rowKey={(r) => r.id}
            pageSize={50}
            exportName={`${loan.reference}-repayments`}
            emptyTitle="No repayments yet"
            searchPlaceholder="Search repayments…"
          />
        </TabsContent>

        {loan.mandates.length > 0 && (
          <TabsContent value="mandates">
            <MandatesPanel mandates={loan.mandates} />
          </TabsContent>
        )}

        {canReadAutodebit && (
          <TabsContent value="autodebit">
            <DataTable
              mode="client"
              columns={debitAttemptColumns}
              data={debitAttempts.data ?? []}
              rowKey={(a) => a.id}
              loading={debitAttempts.isLoading}
              error={debitAttempts.isError ? errorMessage(debitAttempts.error) : null}
              onRetry={() => debitAttempts.refetch()}
              pageSize={50}
              exportName={`${loan.reference}-debit-attempts`}
              emptyTitle="No autodebit attempts yet"
              searchPlaceholder="Search attempts…"
            />
          </TabsContent>
        )}
      </Tabs>

      {canRecordRepayment && <RecordRepaymentDialog loan={loan} open={recording} onOpenChange={setRecording} />}
      {canRequestRestructure && <RestructureDialog loan={loan} open={restructuring} onOpenChange={setRestructuring} />}
      {canRequestWriteOff && <WriteOffDialog loan={loan} open={writingOff} onOpenChange={setWritingOff} />}
      {canRecordRecovery && <RecoveryDialog loan={loan} open={recovering} onOpenChange={setRecovering} />}
    </div>
  );
}

function MandatesPanel({ mandates }: { mandates: MandateDto[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {mandates.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{m.type.replace(/_/g, ' ')}</span>
            <MandateStatusBadge status={m.status} />
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Provider</dt><dd>{m.provider}</dd></div>
            {/* <div className="flex justify-between"><dt className="text-muted-foreground">Priority</dt><dd className="tabular">{m.priority}</dd></div> */}
            {m.cardLast4 && <div className="flex justify-between"><dt className="text-muted-foreground">Card</dt><dd className="font-mono">•••• {m.cardLast4}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted-foreground">Activated</dt><dd><DateTime value={m.activatedAt} style="short" /></dd></div>
            {m.failureReason && <div className="flex justify-between"><dt className="text-muted-foreground">Failure</dt><dd className="text-right text-destructive">{m.failureReason}</dd></div>}
          </dl>
        </Card>
      ))}
    </div>
  );
}
