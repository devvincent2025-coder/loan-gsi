'use client';
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import type { LoanQuoteDto } from '@damez/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MoneyText } from '@/components/money';
import { ScheduleTable } from './schedule-table';

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold' : 'font-medium'}>{children}</dd>
    </div>
  );
}

/** Repayment preview + FCCPC-style "total cost of credit" disclosure + expandable schedule. */
export function QuoteSummary({ quote, loading }: { quote: LoanQuoteDto; loading?: boolean }) {
  const c = quote.cost;
  return (
    <div className={loading ? 'space-y-3 opacity-60 transition-opacity' : 'space-y-3 transition-opacity'} aria-busy={loading || undefined}>
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="p-5">
          <p className="text-xs text-primary-foreground/80">You will pay monthly</p>
          <p className="text-3xl font-semibold" data-testid="monthly-instalment"><MoneyText kobo={c.monthlyInstalmentKobo} trimZeroKobo /></p>
          <p className="mt-1 text-xs text-primary-foreground/80">for {c.tenorMonths} month{c.tenorMonths > 1 ? 's' : ''}, first payment {c.firstDueDate}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Total cost of credit</CardTitle><CardDescription>Everything you will pay, in plain numbers.</CardDescription></CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Loan amount"><MoneyText kobo={c.principalKobo} trimZeroKobo /></Row>
            <Row label="Total interest"><MoneyText kobo={c.totalInterestKobo} trimZeroKobo /></Row>
            <Row label="Fees (taken upfront)"><MoneyText kobo={c.totalFeesKobo} trimZeroKobo /></Row>
            <Row label="Total you repay" strong><MoneyText kobo={c.totalRepayableKobo} trimZeroKobo /></Row>
            <Row label="You receive (net)" strong><MoneyText kobo={c.netDisbursedKobo} trimZeroKobo /></Row>
            <Row label="Total cost of credit"><MoneyText kobo={c.totalCostOfCreditKobo} trimZeroKobo /></Row>
            <Row label="Interest rate">{(c.monthlyRateBps / 100).toFixed(2)}% per month ({c.method === 'FLAT' ? 'flat' : 'reducing balance'})</Row>
            <Row label="Effective annual rate">{c.effectiveAnnualRatePct.toFixed(2)}%</Row>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Fees: management <MoneyText kobo={c.managementFeeKobo} trimZeroKobo />, processing <MoneyText kobo={c.processingFeeKobo} trimZeroKobo />, insurance <MoneyText kobo={c.insuranceFeeKobo} trimZeroKobo />. Late payment: {c.penaltyDescription}.</p>
        </CardContent>
      </Card>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-sm font-medium shadow-card">
          View repayment schedule
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2"><ScheduleTable schedule={quote.schedule} /></CollapsibleContent>
      </Collapsible>
    </div>
  );
}
