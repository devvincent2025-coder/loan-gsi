import { describe, expect, it } from 'vitest';
import { buildSchedule, maxPrincipalForInstalment, monthlyInstalment } from './amortization';

const start = new Date('2026-01-31T00:00:00Z');

describe('amortization', () => {
  it('flat: totals are exact and the last instalment absorbs rounding', () => {
    const { schedule, cost } = buildSchedule({ principalKobo: 100_000_00, monthlyRateBps: 450, tenorMonths: 6, method: 'FLAT', startDate: start });
    expect(schedule).toHaveLength(6);
    expect(cost.totalInterestKobo).toBe(Math.round(100_000_00 * 0.045 * 6)); // ₦27,000
    expect(schedule.reduce((s, l) => s + l.principalKobo, 0)).toBe(100_000_00);
    expect(schedule[5].balanceKobo).toBe(0);
    expect(cost.totalRepayableKobo).toBe(127_000_00);
    expect(schedule[0].dueDate).toBe('2026-02-28'); // month-end clamp
  });
  it('reducing balance: interest falls over time and balance hits zero', () => {
    const { schedule, cost } = buildSchedule({ principalKobo: 500_000_00, monthlyRateBps: 400, tenorMonths: 12, method: 'REDUCING_BALANCE', startDate: start });
    expect(schedule[0].interestKobo).toBeGreaterThan(schedule[11].interestKobo);
    expect(schedule[11].balanceKobo).toBe(0);
    expect(schedule.reduce((s, l) => s + l.principalKobo, 0)).toBe(500_000_00);
    expect(cost.totalInterestKobo).toBe(schedule.reduce((s, l) => s + l.interestKobo, 0));
    // reducing cost < flat cost at the same nominal rate
    const flat = buildSchedule({ principalKobo: 500_000_00, monthlyRateBps: 400, tenorMonths: 12, method: 'FLAT', startDate: start });
    expect(cost.totalInterestKobo).toBeLessThan(flat.cost.totalInterestKobo);
  });
  it('fees reduce net disbursed and raise the effective rate', () => {
    const a = buildSchedule({ principalKobo: 200_000_00, monthlyRateBps: 400, tenorMonths: 6, method: 'FLAT', startDate: start });
    const b = buildSchedule({ principalKobo: 200_000_00, monthlyRateBps: 400, tenorMonths: 6, method: 'FLAT', managementFeeBps: 100, insuranceFeeBps: 50, processingFeeBps: 100, startDate: start });
    expect(b.cost.totalFeesKobo).toBe(5_000_00);
    expect(b.cost.netDisbursedKobo).toBe(195_000_00);
    expect(b.cost.effectiveAnnualRatePct).toBeGreaterThan(a.cost.effectiveAnnualRatePct);
    expect(b.cost.totalCostOfCreditKobo).toBe(b.cost.totalInterestKobo + 5_000_00);
  });
  it('zero-rate loans work', () => {
    const { schedule, cost } = buildSchedule({ principalKobo: 120_000_00, monthlyRateBps: 0, tenorMonths: 12, method: 'REDUCING_BALANCE', startDate: start });
    expect(cost.totalInterestKobo).toBe(0);
    expect(schedule[0].totalKobo).toBe(10_000_00);
  });
  it('max principal inverse is consistent with the instalment', () => {
    for (const method of ['FLAT', 'REDUCING_BALANCE'] as const) {
      const max = maxPrincipalForInstalment(45_000_00, 450, 6, method);
      expect(monthlyInstalment(max, 450, 6, method)).toBeLessThanOrEqual(45_000_00);
      expect(monthlyInstalment(max + 200_000, 450, 6, method)).toBeGreaterThan(45_000_00 - 1);
    }
  });
  it('rejects invalid input', () => {
    expect(() => buildSchedule({ principalKobo: 0, monthlyRateBps: 400, tenorMonths: 3, method: 'FLAT' })).toThrow();
    expect(() => buildSchedule({ principalKobo: 1000, monthlyRateBps: 400, tenorMonths: 0, method: 'FLAT' })).toThrow();
  });
});
