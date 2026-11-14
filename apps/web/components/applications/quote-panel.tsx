'use client';
import type { CostOfCredit, LoanQuoteDto, ScheduleLine } from '@damez/shared';
import { DataTable, type DataColumn } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { MoneyText } from '@/components/money';
import { KeyValue, SectionCard } from '@/components/staff/ui-bits';
import { titleCase } from '@/lib/utils';

export function CostOfCreditCard({ cost, title = 'Cost of credit' }: { cost: CostOfCredit; title?: string }) {
  return (
    <SectionCard title={title} description="Total cost disclosure (fees are deducted upfront).">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="cost-of-credit">
        <KeyValue label="Monthly instalment"><MoneyText kobo={cost.monthlyInstalmentKobo} /></KeyValue>
        <KeyValue label="Total interest"><MoneyText kobo={cost.totalInterestKobo} /></KeyValue>
        <KeyValue label="Total fees"><MoneyText kobo={cost.totalFeesKobo} /></KeyValue>
        <KeyValue label="Net disbursed"><MoneyText kobo={cost.netDisbursedKobo} /></KeyValue>
        <KeyValue label="Total repayable"><MoneyText kobo={cost.totalRepayableKobo} /></KeyValue>
        <KeyValue label="Total cost of credit"><MoneyText kobo={cost.totalCostOfCreditKobo} /></KeyValue>
        <KeyValue label="Nominal annual rate"><span className="tabular">{cost.nominalAnnualRatePct.toFixed(2)}%</span></KeyValue>
        <KeyValue label="Effective annual rate (EIR)"><span className="tabular" data-testid="eir">{cost.effectiveAnnualRatePct.toFixed(2)}%</span></KeyValue>
        <KeyValue label="Method">{titleCase(cost.method)}</KeyValue>
        <KeyValue label="Processing / mgmt / insurance">
          <span className="tabular text-xs"><MoneyText kobo={cost.processingFeeKobo} /> / <MoneyText kobo={cost.managementFeeKobo} /> / <MoneyText kobo={cost.insuranceFeeKobo} /></span>
        </KeyValue>
        <KeyValue label="First / last due"><DateTime value={cost.firstDueDate} style="date" /> – <DateTime value={cost.lastDueDate} style="date" /></KeyValue>
        <KeyValue label="Penalty">{cost.penaltyDescription}</KeyValue>
      </dl>
    </SectionCard>
  );
}

export function ScheduleTable({ schedule }: { schedule: ScheduleLine[] }) {
  const columns: DataColumn<ScheduleLine>[] = [
    { id: 'n', header: '#', accessor: (l) => l.n, cell: (l) => <span className="tabular">{l.n}</span> },
    { id: 'due', header: 'Due', accessor: (l) => l.dueDate, cell: (l) => <DateTime value={l.dueDate} style="date" /> },
    { id: 'principal', header: 'Principal', align: 'right', accessor: (l) => l.principalKobo, cell: (l) => <MoneyText kobo={l.principalKobo} /> },
    { id: 'interest', header: 'Interest', align: 'right', accessor: (l) => l.interestKobo, cell: (l) => <MoneyText kobo={l.interestKobo} /> },
    { id: 'total', header: 'Instalment', align: 'right', accessor: (l) => l.totalKobo, cell: (l) => <MoneyText kobo={l.totalKobo} className="font-medium" /> },
    { id: 'balance', header: 'Balance', align: 'right', accessor: (l) => l.balanceKobo, cell: (l) => <MoneyText kobo={l.balanceKobo} /> },
  ];
  return <DataTable columns={columns} data={schedule} rowKey={(l) => String(l.n)} pageSize={12} exportName="repayment-schedule" searchPlaceholder="Filter schedule…" />;
}

export function QuoteSummary({ quote }: { quote: LoanQuoteDto }) {
  return (
    <div className="space-y-5">
      <CostOfCreditCard cost={quote.cost} />
      <SectionCard title="Repayment schedule"><ScheduleTable schedule={quote.schedule} /></SectionCard>
    </div>
  );
}
