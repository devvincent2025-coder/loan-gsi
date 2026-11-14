'use client';
import * as React from 'react';
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Info, Lightbulb, ShieldCheck, Upload } from 'lucide-react';
import { formatLagos, type EligibilityCustomerDto, type ReasonSeverity } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MoneyText } from '@/components/money';
import { cn } from '@/lib/utils';

type Suggestion = EligibilityCustomerDto['suggestions'][number];

const OUTCOME = {
  ELIGIBLE: { icon: CheckCircle2, tone: 'border-success/40 bg-success/10 text-success', label: 'You qualify' },
  CONDITIONAL: { icon: AlertTriangle, tone: 'border-warning/50 bg-warning/10 text-warning', label: 'Almost there' },
  INELIGIBLE: { icon: AlertOctagon, tone: 'border-destructive/40 bg-destructive/10 text-destructive', label: 'Not this time' },
} as const;

const SEVERITY: Record<ReasonSeverity, { icon: typeof Info; cls: string; label: string }> = {
  BLOCKER: { icon: AlertOctagon, cls: 'text-destructive', label: 'Blocking' },
  WARNING: { icon: AlertTriangle, cls: 'text-warning', label: 'Warning' },
  INFO: { icon: Info, cls: 'text-info', label: 'Info' },
  POSITIVE: { icon: CheckCircle2, cls: 'text-success', label: 'Positive' },
};
const SEV_ORDER: ReasonSeverity[] = ['BLOCKER', 'WARNING', 'INFO', 'POSITIVE'];

export interface EligibilityResultViewProps {
  result: EligibilityCustomerDto;
  /** apply suggested amount/tenor to the form and re-preview */
  onApplySuggestion?: (s: { amountKobo?: number; tenorMonths?: number }) => void;
  /** switch to another product offer */
  onApplyAlternative?: (a: EligibilityCustomerDto['alternatives'][number]) => void;
}

function SuggestionCard({ s, onApply }: { s: Suggestion; onApply?: EligibilityResultViewProps['onApplySuggestion'] }) {
  let action: React.ReactNode = null;
  let Icon = Lightbulb;
  if (s.type === 'REDUCE_AMOUNT' && s.amountKobo !== undefined) {
    action = <Button size="sm" onClick={() => onApply?.({ amountKobo: s.amountKobo, tenorMonths: s.tenorMonths })}>Borrow <MoneyText kobo={s.amountKobo} trimZeroKobo /> instead</Button>;
  } else if (s.type === 'LONGER_TENOR' && s.tenorMonths !== undefined) {
    action = <Button size="sm" onClick={() => onApply?.({ tenorMonths: s.tenorMonths, amountKobo: s.amountKobo })}>Choose {s.tenorMonths} months</Button>;
  } else if (s.type === 'UPGRADE_KYC') {
    Icon = ShieldCheck;
    action = <Button size="sm" asChild><Link href="/portal/onboarding">Upgrade your KYC <ArrowRight /></Link></Button>;
  } else if (s.type === 'UPLOAD_DOCUMENT') {
    Icon = Upload;
    action = <Button size="sm" asChild><Link href="/portal/onboarding">Upload documents <ArrowRight /></Link></Button>;
  } else if (s.type === 'REAPPLY_LATER') {
    Icon = CalendarClock;
    if (s.reapplyDate) action = <p className="text-sm font-medium">Reapply on {formatLagos(s.reapplyDate, 'date')}</p>;
  }
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-card" data-suggestion={s.type}>
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">{s.customerMessage}</p>
        {s.monthlyRepaymentKobo !== undefined && <p className="text-xs text-muted-foreground">About <MoneyText kobo={s.monthlyRepaymentKobo} trimZeroKobo /> a month</p>}
        {action}
      </div>
    </li>
  );
}

/** Eligibility outcome screen: headline, ranked reasons, actionable suggestions and alternative offers. */
export function EligibilityResultView({ result, onApplySuggestion, onApplyAlternative }: EligibilityResultViewProps) {
  const o = OUTCOME[result.outcome];
  const reasons = [...result.reasons].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  return (
    <div className="space-y-4" data-testid="eligibility-result" data-outcome={result.outcome}>
      <div className={cn('rounded-lg border p-4', o.tone)}>
        <div className="flex items-center gap-2 text-sm font-semibold"><o.icon className="size-5" aria-hidden /> {o.label}</div>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{result.headline}</h2>
        <p className="mt-1 text-sm text-foreground/80">{result.summary}</p>
        {result.maxAmountKobo > 0 && result.outcome !== 'ELIGIBLE' && (
          <p className="mt-2 text-sm text-foreground">You may qualify for up to <MoneyText kobo={result.maxAmountKobo} trimZeroKobo className="font-semibold" /> on this product.</p>
        )}
      </div>

      {reasons.length > 0 && (
        <section aria-labelledby="why">
          <h3 id="why" className="mb-2 text-sm font-semibold">Why we decided this</h3>
          <ul className="space-y-2">
            {reasons.map((r, i) => {
              const sv = SEVERITY[r.severity];
              return (
                <li key={i} className="flex items-start gap-2.5 text-sm" data-severity={r.severity}>
                  <sv.icon className={cn('mt-0.5 size-4 shrink-0', sv.cls)} aria-hidden /><span className="sr-only">{sv.label}: </span>
                  <span>{r.message}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {result.suggestions.length > 0 && (
        <section aria-labelledby="next">
          <h3 id="next" className="mb-2 text-sm font-semibold">What you can do</h3>
          <ul className="space-y-2">{result.suggestions.map((s, i) => <SuggestionCard key={i} s={s} onApply={onApplySuggestion} />)}</ul>
        </section>
      )}

      {result.alternatives.length > 0 && (
        <section aria-labelledby="alts">
          <h3 id="alts" className="mb-2 text-sm font-semibold">Other offers for you</h3>
          <ul className="space-y-2">
            {result.alternatives.map((a) => (
              <li key={`${a.productId}-${a.amountKobo}-${a.tenorMonths}`}>
                <Card><CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{a.productName}</p>
                    <p className="text-sm"><MoneyText kobo={a.amountKobo} trimZeroKobo /> over {a.tenorMonths} months</p>
                    <p className="text-xs text-muted-foreground"><MoneyText kobo={a.monthlyRepaymentKobo} trimZeroKobo /> a month. {a.note}</p>
                  </div>
                  <Button size="sm" onClick={() => onApplyAlternative?.(a)}>Apply for this</Button>
                </CardContent></Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
