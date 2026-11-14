import { LoanStatus } from '@prisma/client';
import { DEFAULT_ECL_CONFIG, EclService } from './ecl.service';
import { eclConfigSchema } from './ledger-schemas';

/** selectStage is pure (no Prisma access), so a stub is enough for these dependencies. */
const svc = () => new EclService({} as never, {} as never, {} as never, {} as never);

describe('EclService.selectStage', () => {
  it('picks stage 1 below the stage-2 DPD threshold', () => {
    expect(svc().selectStage({ dpd: 0, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(1);
    expect(svc().selectStage({ dpd: 29, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(1);
  });
  it('picks stage 2 at/above the stage-2 threshold and below the stage-3 threshold', () => {
    expect(svc().selectStage({ dpd: 30, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(2);
    expect(svc().selectStage({ dpd: 89, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(2);
  });
  it('picks stage 3 at/above the stage-3 threshold', () => {
    expect(svc().selectStage({ dpd: 90, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(3);
    expect(svc().selectStage({ dpd: 400, status: LoanStatus.ACTIVE }, DEFAULT_ECL_CONFIG)).toBe(3);
  });
  it('forces at least stage 2 for Unpaid or RESTRUCTURED regardless of dpd', () => {
    expect(svc().selectStage({ dpd: 0, status: LoanStatus.Unpaid }, DEFAULT_ECL_CONFIG)).toBe(2);
    expect(svc().selectStage({ dpd: 0, status: LoanStatus.RESTRUCTURED }, DEFAULT_ECL_CONFIG)).toBe(2);
    // a Unpaid loan that is also 90+ dpd still escalates to stage 3
    expect(svc().selectStage({ dpd: 95, status: LoanStatus.Unpaid }, DEFAULT_ECL_CONFIG)).toBe(3);
  });
});

describe('eclConfigSchema', () => {
  it('accepts the default config', () => {
    expect(eclConfigSchema.safeParse(DEFAULT_ECL_CONFIG).success).toBe(true);
  });
  it('rejects PD bands that do not increase with stage', () => {
    expect(eclConfigSchema.safeParse({ ...DEFAULT_ECL_CONFIG, stage2PdBps: 100 }).success).toBe(false);
  });
  it('rejects stage2DpdThreshold >= stage3DpdThreshold', () => {
    expect(eclConfigSchema.safeParse({ ...DEFAULT_ECL_CONFIG, stage2DpdThreshold: 90, stage3DpdThreshold: 90 }).success).toBe(false);
  });
});
