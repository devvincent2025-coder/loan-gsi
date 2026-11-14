import { DEFAULT_SCORECARD_V1 } from '@damez/shared';
import { toCustomerView } from './eligibility-view';
import { EngineInput, runEligibilityEngine } from './engine';
import { blankFacts } from './eligibility.service';

const base = (over: Partial<ReturnType<typeof blankFacts>>, amountKobo = 20_000_000): ReturnType<typeof runEligibilityEngine> => runEligibilityEngine({
  facts: { ...blankFacts(), kycTier: 2, age: 35, declaredMonthlyIncomeKobo: 30_000_000, bureauScore: 720, bureauThinFile: false, bankStatementMonths: 6, avgMonthlyInflowKobo: 30_000_000, inflowStability: 90, avgBalanceKobo: 15_000_000, salaryDetected: true, ...over },
  definition: DEFAULT_SCORECARD_V1, scorecard: { id: 's', key: 'default', version: 1, name: 'Default' },
  product: { id: 'p', name: 'Personal', monthlyRateBps: 450, interestMethod: 'FLAT', minAmountKobo: 5_000_000, maxAmountKobo: 100_000_000, minTenorMonths: 1, maxTenorMonths: 12, minKycTier: 1, minAge: 18, maxAge: 65, allowGuarantor: true, allowCollateral: false },
  requested: { amountKobo, tenorMonths: 6 }, kycCapKobo: 100_000_000, otherProducts: [], now: new Date('2026-10-09T00:00:00Z'),
} satisfies EngineInput);
const wrap = (r: ReturnType<typeof base>) => ({ ...r, id: 'x', bureauReportId: null, simulated: false, createdAt: '2026-10-09T00:00:00.000Z' });

describe('toCustomerView', () => {
  it('eligible → good news headline', () => {
    const v = toCustomerView(wrap(base({})));
    expect(v.headline).toBe('Good news, you qualify');
    expect(v.summary).toMatch(/₦200,000 over 6 months/);
    expect(v.outcome).toBe('ELIGIBLE');
  });
  it('capped amount → smaller amount headline, no officer wording', () => {
    const v = toCustomerView(wrap(base({ kycTier: 1 }, 50_000_000))) ;
    // tier caps default: tier 1 → ₦100k, but kycCapKobo passed is ₦1M; use affordability instead
    expect(['You qualify for a smaller amount', 'Good news, you qualify']).toContain(v.headline);
    const r = base({ avgMonthlyInflowKobo: 10_000_000, declaredMonthlyIncomeKobo: 10_000_000 }, 50_000_000);
    const w = toCustomerView(wrap(r));
    expect(w.headline).toBe('You qualify for a smaller amount');
    expect(w.suggestions.length).toBeGreaterThan(0);
    for (const s of w.suggestions) expect(s).not.toHaveProperty('officerMessage');
    expect(JSON.stringify(w)).not.toMatch(/officerMessage|firedRules|score/i);
  });
  it('refer rule → quick review headline', () => {
    expect(toCustomerView(wrap(base({ bureauLegalAction: true }))).headline).toBe('Your application needs a quick review');
  });
  it('declined → cannot offer headline with friendly reasons', () => {
    const v = toCustomerView(wrap(base({ bureauWriteOff24m: true, bureauWriteOffAgeMonths: 8 })));
    expect(v.headline).toBe("We can't offer you this loan right now");
    expect(v.reasons[0].severity).toBe('BLOCKER');
    expect(v.suggestions.find((s) => s.type === 'REAPPLY_LATER')).toBeTruthy();
  });
});
