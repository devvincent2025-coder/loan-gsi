import type { PricingSnapshot } from '../applications/mappers';
import { computeOffer } from './offer-schedule';

const flatPricing: PricingSnapshot = {
  monthlyRateBps: 450, interestMethod: 'FLAT', processingFeeBps: 150, managementFeeBps: 100, insuranceFeeBps: 50,
  penaltyBpsPerDay: 25, penaltyGraceDays: 3, gracePeriodDays: 0,
};
const reducingPricing: PricingSnapshot = { ...flatPricing, interestMethod: 'REDUCING_BALANCE' };

describe('computeOffer', () => {
  it('builds a FLAT schedule whose instalments total principal + interest and whose balance reaches zero', () => {
    const r = computeOffer({ principalKobo: 500_000_00, tenorMonths: 6, pricing: flatPricing });
    expect(r.schedule).toHaveLength(6);
    expect(r.interestMethod).toBe('FLAT');
    expect(r.monthlyRateBps).toBe(450);
    const sumInstalments = r.schedule.reduce((s, l) => s + l.totalKobo, 0);
    expect(sumInstalments).toBe(r.totalRepayableKobo);
    expect(r.totalRepayableKobo).toBe(500_000_00 + r.totalInterestKobo);
    expect(r.schedule.at(-1)!.balanceAfterKobo).toBe(0);
    // fees are charged upfront, never spread across instalments
    expect(r.schedule.every((l) => l.feeKobo === 0)).toBe(true);
    expect(r.totalFeesKobo).toBe(Math.round(500_000_00 * ((150 + 100 + 50) / 10_000)));
  });

  it('builds a REDUCING_BALANCE schedule with a declining balance and zero at the end', () => {
    const r = computeOffer({ principalKobo: 1_000_000_00, tenorMonths: 12, pricing: reducingPricing });
    expect(r.schedule).toHaveLength(12);
    for (let i = 1; i < r.schedule.length; i++) {
      expect(r.schedule[i].balanceAfterKobo).toBeLessThan(r.schedule[i - 1].balanceAfterKobo);
    }
    expect(r.schedule.at(-1)!.balanceAfterKobo).toBe(0);
  });

  it('lets a counter-offer override the monthly rate independently of the pricing snapshot', () => {
    const r = computeOffer({ principalKobo: 200_000_00, tenorMonths: 3, pricing: flatPricing, monthlyRateBps: 300 });
    expect(r.monthlyRateBps).toBe(300);
  });

  it('discloses a non-zero projected penalty when the product charges a penalty rate', () => {
    const r = computeOffer({ principalKobo: 100_000_00, tenorMonths: 3, pricing: flatPricing });
    expect(r.totalPenaltyProjectedKobo).toBeGreaterThan(0);
    const noPenalty = computeOffer({ principalKobo: 100_000_00, tenorMonths: 3, pricing: { ...flatPricing, penaltyBpsPerDay: 0 } });
    expect(noPenalty.totalPenaltyProjectedKobo).toBe(0);
  });
});
