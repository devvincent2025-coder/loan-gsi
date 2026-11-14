import {
  allocateAcrossInstallments, applyUpdates, computeDailyPenaltyIncrementKobo, computeDpd, installmentOutstanding,
  totalOutstandingKobo, type InstallmentLike,
} from './servicing-logic';

const inst = (over: Partial<InstallmentLike> & { id: string }): InstallmentLike => ({
  totalKobo: 110_000, principalKobo: 100_000, interestKobo: 10_000, feeKobo: 0, paidKobo: 0, penaltyAccruedKobo: 0, status: 'PENDING',
  ...over,
});

describe('installmentOutstanding', () => {
  it('reports the full obligation when nothing has been paid', () => {
    const t = installmentOutstanding(inst({ id: 'a', feeKobo: 5_000 }));
    expect(t).toEqual({ penaltyOutstandingKobo: 0, feeOutstandingKobo: 5_000, interestOutstandingKobo: 10_000, principalOutstandingKobo: 100_000 });
  });

  it('unwinds paidKobo through fee -> interest -> principal priority', () => {
    // fee 5k, interest 10k, principal 100k; paidKobo covers fee fully + half of interest
    const t = installmentOutstanding(inst({ id: 'a', feeKobo: 5_000, paidKobo: 10_000 }));
    expect(t.feeOutstandingKobo).toBe(0);
    expect(t.interestOutstandingKobo).toBe(5_000);
    expect(t.principalOutstandingKobo).toBe(100_000);
  });

  it('keeps penalty as its own bucket, independent of paidKobo', () => {
    const t = installmentOutstanding(inst({ id: 'a', penaltyAccruedKobo: 2_000, paidKobo: 110_000 }));
    expect(t.penaltyOutstandingKobo).toBe(2_000);
    expect(t.principalOutstandingKobo).toBe(0);
  });
});

describe('allocateAcrossInstallments', () => {
  it('pays penalty -> fee -> interest -> principal on a single instalment before moving on', () => {
    const installments = [inst({ id: 'i1', feeKobo: 5_000, penaltyAccruedKobo: 1_000 })];
    const r = allocateAcrossInstallments(installments, 7_000);
    expect(r.totalPenaltyKobo).toBe(1_000);
    expect(r.totalFeeKobo).toBe(5_000);
    expect(r.totalInterestKobo).toBe(1_000);
    expect(r.totalPrincipalKobo).toBe(0);
    expect(r.unallocatedKobo).toBe(0);
    expect(r.updates).toEqual([{ id: 'i1', newPaidKobo: 6_000, newPenaltyAccruedKobo: 0, newStatus: 'PARTIAL' }]);
  });

  it('spreads a payment across multiple instalments in order, closing earlier ones first', () => {
    const installments = [
      inst({ id: 'i1', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
      inst({ id: 'i2', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
      inst({ id: 'i3', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
    ];
    // enough to fully pay i1 and i2, and partially pay i3
    const r = allocateAcrossInstallments(installments, 11_000 + 11_000 + 5_000);
    const byId = new Map(r.updates.map((u) => [u.id, u]));
    expect(byId.get('i1')!.newStatus).toBe('PAID');
    expect(byId.get('i2')!.newStatus).toBe('PAID');
    expect(byId.get('i3')!.newStatus).toBe('PARTIAL');
    expect(byId.get('i3')!.newPaidKobo).toBe(5_000);
    expect(r.unallocatedKobo).toBe(0);
  });

  it('allows an early/top-up overpayment to reduce principal on FUTURE (not-yet-due) instalments', () => {
    const installments = [
      inst({ id: 'i1', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
      inst({ id: 'i2', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
    ];
    const r = allocateAcrossInstallments(installments, 15_000); // fully clears i1 (11k) and reduces i2's principal by 4k
    const i2 = r.updates.find((u) => u.id === 'i2')!;
    expect(i2.newStatus).toBe('PARTIAL');
    expect(i2.newPaidKobo).toBe(4_000);
    expect(totalOutstandingKobo(applyUpdates(installments, r.updates))).toBe(11_000 + 11_000 - 15_000);
  });

  it('leaves amountKobo unallocated once every instalment (including future ones) is fully cleared', () => {
    const installments = [inst({ id: 'i1', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 })];
    const r = allocateAcrossInstallments(installments, 50_000);
    expect(r.unallocatedKobo).toBe(50_000 - 11_000);
    expect(totalOutstandingKobo(applyUpdates(installments, r.updates))).toBe(0);
  });

  it('is a no-op (nothing to allocate) once the loan is already fully paid', () => {
    const installments = [inst({ id: 'i1', paidKobo: 110_000, status: 'PAID' })];
    const r = allocateAcrossInstallments(installments, 5_000);
    expect(r.updates).toEqual([]);
    expect(r.unallocatedKobo).toBe(5_000);
  });
});

describe('totalOutstandingKobo (the zero-balance closure trigger)', () => {
  it('is zero only when every instalment is fully paid AND penalty-free', () => {
    const fullyPaid = [inst({ id: 'i1', paidKobo: 110_000, status: 'PAID' }), inst({ id: 'i2', paidKobo: 110_000, status: 'PAID' })];
    expect(totalOutstandingKobo(fullyPaid)).toBe(0);
  });

  it('is non-zero while any penalty remains, even if principal/interest/fee are cleared', () => {
    const withPenalty = [inst({ id: 'i1', paidKobo: 110_000, penaltyAccruedKobo: 500, status: 'PARTIAL' })];
    expect(totalOutstandingKobo(withPenalty)).toBe(500);
  });

  it('reflects the exact remaining balance for a partially paid schedule', () => {
    const installments = [
      inst({ id: 'i1', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000, paidKobo: 11_000, status: 'PAID' }),
      inst({ id: 'i2', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000, paidKobo: 4_000, status: 'PARTIAL' }),
      inst({ id: 'i3', totalKobo: 11_000, principalKobo: 10_000, interestKobo: 1_000 }),
    ];
    expect(totalOutstandingKobo(installments)).toBe(7_000 + 11_000);
  });
});

describe('computeDpd', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));

  it('is 0 when there is no oldest unpaid instalment', () => {
    expect(computeDpd(null, day(10))).toBe(0);
  });

  it('is 0 on the due date itself (not yet overdue)', () => {
    expect(computeDpd(day(10), day(10))).toBe(0);
  });

  it('counts whole days past the due date', () => {
    expect(computeDpd(day(1), day(6))).toBe(5);
  });

  it('never goes negative for a future due date', () => {
    expect(computeDpd(day(10), day(5))).toBe(0);
  });
});

describe('computeDailyPenaltyIncrementKobo', () => {
  it('charges nothing within the grace period', () => {
    expect(computeDailyPenaltyIncrementKobo(100_000, 25, 3, 3)).toBe(0);
  });

  it('charges one day of penalty once dpd exceeds the grace period', () => {
    // 25 bps/day of 100,000 kobo outstanding = 250 kobo
    expect(computeDailyPenaltyIncrementKobo(100_000, 25, 4, 3)).toBe(250);
  });

  it('is 0 when there is nothing outstanding', () => {
    expect(computeDailyPenaltyIncrementKobo(0, 25, 10, 0)).toBe(0);
  });

  it('is 0 when the product charges no penalty', () => {
    expect(computeDailyPenaltyIncrementKobo(100_000, 0, 10, 0)).toBe(0);
  });
});
