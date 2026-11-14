'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Landmark } from 'lucide-react';
import { formatNaira, type EligibilityCustomerDto, type EligibilityResultDto } from '@damez/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { portalErrorMessage } from '@/lib/portal-api';
import { useLoans, useRepeatBorrowingEligibility } from '@/lib/portal-loans-api';
import { useProducts } from './hooks';
import { EligibilityResultView } from './eligibility-result';
import { LoanCard } from './loan-card';

const OUTCOME_COPY: Record<EligibilityResultDto['outcome'], { headline: string; summary: (maxKobo: number) => string }> = {
  ELIGIBLE: { headline: 'You may qualify for another loan', summary: (m) => `Based on your repayment history, you could qualify for up to ${formatNaira(m, { trimZeroKobo: true })}.` },
  CONDITIONAL: { headline: 'Almost eligible for another loan', summary: () => 'You may qualify for a smaller amount or a longer tenor.' },
  INELIGIBLE: { headline: 'Not eligible for another loan right now', summary: () => 'Keep repaying on time and check back later.' },
};

/**
 * `GET /portal/eligibility/repeat-borrowing` returns the staff-shaped `EligibilityResultDto` (score, dtiBps,
 * scorecard internals, reasons/suggestions carrying both customerMessage+officerMessage) — not the customer-friendly
 * `EligibilityCustomerDto` that `EligibilityResultView` was built for. We adapt the customer-facing fields across.
 */
function toCustomerView(r: EligibilityResultDto): EligibilityCustomerDto {
  const copy = OUTCOME_COPY[r.outcome];
  return {
    id: r.id,
    outcome: r.outcome,
    headline: copy.headline,
    summary: copy.summary(r.maxAmountKobo),
    requested: r.requested,
    maxAmountKobo: r.maxAmountKobo,
    reasons: r.reasons.map((x) => ({ message: x.customerMessage, severity: x.severity })),
    suggestions: r.suggestions.map(({ officerMessage: _officerMessage, ...s }) => s),
    alternatives: r.alternatives,
  };
}

function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), max); }

/** Small banner surfacing repeat-borrowing eligibility, built from the customer's first available product. */
function RepeatBorrowingBanner() {
  const products = useProducts();
  const product = React.useMemo(() => products.data?.find((p) => p.available) ?? null, [products.data]);
  const args = React.useMemo(() => {
    if (!product) return null;
    const amountKobo = clamp(20_000_00, product.minAmountKobo, product.maxAmountKobo);
    const tenorMonths = clamp(6, product.minTenorMonths, product.maxTenorMonths);
    return { productId: product.id, amountKobo, tenorMonths };
  }, [product]);
  const q = useRepeatBorrowingEligibility(args);

  if (!product || products.isLoading) return null;
  if (q.isLoading) return <Skeleton className="h-28 w-full" />;
  if (q.isError || !q.data) return null; // non-essential banner: fail quietly

  return (
    <Card data-testid="repeat-borrowing-banner">
      <CardHeader><CardTitle>Borrow again</CardTitle></CardHeader>
      <CardContent><EligibilityResultView result={toCustomerView(q.data)} /></CardContent>
    </Card>
  );
}

/** Card-list of booked loans (prompt-3 surface), rendered at the existing "Repay" bottom-nav tab. */
export function LoansDashboard() {
  const loans = useLoans();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Repay</h1>
        <Link href="/portal/linked-accounts" className="inline-flex items-center gap-1 text-xs font-medium text-primary">Linked accounts <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      <RepeatBorrowingBanner />
      {loans.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : loans.isError ? (
        <ErrorState message={portalErrorMessage(loans.error)} onRetry={() => void loans.refetch()} />
      ) : loans.data && loans.data.length > 0 ? (
        <div className="space-y-3">{loans.data.map((l) => <LoanCard key={l.id} loan={l} />)}</div>
      ) : (
        <Card><EmptyState icon={Landmark} title="No booked loans yet" description="Once a loan offer is disbursed, you will repay it here by one-tap repayment or autodebit." /></Card>
      )}
    </div>
  );
}
