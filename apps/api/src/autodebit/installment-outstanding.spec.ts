import { allocateRepayment } from '../common/repayment-allocation';
import { outstandingTarget, totalOutstandingKobo } from './installment-outstanding';

describe('outstandingTarget', () => {
  it('fully outstanding when nothing has been paid', () => {
    const inst = { feeKobo: 1000n, interestKobo: 2000n, principalKobo: 10_000n, paidKobo: 0n, penaltyAccruedKobo: 500n };
    expect(outstandingTarget(inst)).toEqual({ penaltyOutstandingKobo: 500, feeOutstandingKobo: 1000, interestOutstandingKobo: 2000, principalOutstandingKobo: 10_000 });
    expect(totalOutstandingKobo(inst)).toBe(13_500);
  });

  it('replays the fee->interest->principal waterfall against paidKobo (penalty tracked separately)', () => {
    // fee (1000) fully covered, interest partially (500 of 2000), principal untouched
    const inst = { feeKobo: 1000n, interestKobo: 2000n, principalKobo: 10_000n, paidKobo: 1500n, penaltyAccruedKobo: 0n };
    expect(outstandingTarget(inst)).toEqual({ penaltyOutstandingKobo: 0, feeOutstandingKobo: 0, interestOutstandingKobo: 1500, principalOutstandingKobo: 10_000 });
  });

  it('fully paid down to principal only', () => {
    const inst = { feeKobo: 1000n, interestKobo: 2000n, principalKobo: 10_000n, paidKobo: 3000n, penaltyAccruedKobo: 0n };
    const target = outstandingTarget(inst);
    expect(target.feeOutstandingKobo).toBe(0);
    expect(target.interestOutstandingKobo).toBe(0);
    expect(target.principalOutstandingKobo).toBe(10_000);
  });

  it('feeds allocateRepayment correctly (penalty -> fee -> interest -> principal order, used by the debit engine)', () => {
    const inst = { feeKobo: 1000n, interestKobo: 2000n, principalKobo: 10_000n, paidKobo: 0n, penaltyAccruedKobo: 500n };
    const target = outstandingTarget(inst);
    const alloc = allocateRepayment(2500, target);
    expect(alloc).toEqual({ penaltyKobo: 500, feeKobo: 1000, interestKobo: 1000, principalKobo: 0, unallocatedKobo: 0 });
  });

  it('a collection larger than the full outstanding balance leaves nothing unallocated against the whole installment', () => {
    const inst = { feeKobo: 1000n, interestKobo: 2000n, principalKobo: 10_000n, paidKobo: 0n, penaltyAccruedKobo: 500n };
    const target = outstandingTarget(inst);
    const alloc = allocateRepayment(totalOutstandingKobo(inst), target);
    expect(alloc.unallocatedKobo).toBe(0);
    expect(alloc.penaltyKobo + alloc.feeKobo + alloc.interestKobo + alloc.principalKobo).toBe(totalOutstandingKobo(inst));
  });
});
