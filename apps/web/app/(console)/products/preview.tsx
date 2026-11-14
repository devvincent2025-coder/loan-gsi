'use client';
import type { LoanQuoteDto } from '@damez/shared';
import { MoneyText } from '@/components/money';
import { KeyValue } from '@/components/staff/ui-bits';
import { ScheduleTable } from '@/components/applications/quote-panel';

export function QuoteSummaryCompact({ quote }: { quote: LoanQuoteDto }) {
  const c = quote.cost;
  return (
    <div className="space-y-4" data-testid="product-preview">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KeyValue label="Monthly instalment"><MoneyText kobo={c.monthlyInstalmentKobo} /></KeyValue>
        <KeyValue label="Net disbursed"><MoneyText kobo={c.netDisbursedKobo} /></KeyValue>
        <KeyValue label="Total interest"><MoneyText kobo={c.totalInterestKobo} /></KeyValue>
        <KeyValue label="Total fees"><MoneyText kobo={c.totalFeesKobo} /></KeyValue>
        <KeyValue label="Total cost of credit"><MoneyText kobo={c.totalCostOfCreditKobo} /></KeyValue>
        <KeyValue label="Effective annual rate (EIR)"><span className="tabular font-semibold" data-testid="preview-eir">{c.effectiveAnnualRatePct.toFixed(2)}%</span></KeyValue>
      </dl>
      <ScheduleTable schedule={quote.schedule} />
    </div>
  );
}
