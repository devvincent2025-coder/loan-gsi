import { EligibilityCustomerDto, EligibilityResultDto, formatNaira } from '@damez/shared';

const naira = (k: number) => formatNaira(k, { trimZeroKobo: true });

/** Customer-safe projection: friendly wording only, no scorecard internals, no officer messages, no rule codes. */
export function toCustomerView(r: EligibilityResultDto): EligibilityCustomerDto {
  const { amountKobo, tenorMonths } = r.requested;
  let headline: string;
  let summary: string;
  if (r.outcome === 'ELIGIBLE') {
    headline = 'Good news, you qualify';
    summary = `You can borrow ${naira(amountKobo)} over ${tenorMonths} months, repaying about ${naira(r.requestedMonthlyRepaymentKobo)} a month.`;
  } else if (r.outcome === 'CONDITIONAL' && r.maxAmountKobo > 0 && r.maxAmountKobo < amountKobo) {
    headline = 'You qualify for a smaller amount';
    summary = `Based on your finances, you can borrow up to ${naira(r.maxAmountKobo)} over ${tenorMonths} months.`;
  } else if (r.outcome === 'CONDITIONAL') {
    headline = 'Your application needs a quick review';
    summary = 'A member of our team will review your application and get back to you.';
  } else {
    headline = "We can't offer you this loan right now";
    summary = 'Here is what affected this decision and what you can do about it.';
  }
  return {
    id: r.id, outcome: r.outcome, headline, summary, requested: r.requested, maxAmountKobo: r.maxAmountKobo,
    reasons: r.reasons.map((x) => ({ message: x.customerMessage, severity: x.severity })),
    suggestions: r.suggestions.map(({ officerMessage: _o, ...s }) => s),
    alternatives: r.alternatives,
  };
}
