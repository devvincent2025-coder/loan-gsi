import { computeTier, KycTierService, TierFacts } from './kyc-tier.service';

const base: TierFacts = { phoneVerified: true, bvnVerified: true, facePassed: false, ninVerified: false, govIdVerified: false, addressVerified: false };

describe('computeTier', () => {
  it('needs phone AND BVN for tier 1', () => {
    expect(computeTier({ ...base, phoneVerified: false })).toBe(0);
    expect(computeTier({ ...base, bvnVerified: false })).toBe(0);
    expect(computeTier(base)).toBe(1);
  });
  it('tier 2 = face + (NIN or gov ID)', () => {
    expect(computeTier({ ...base, facePassed: true })).toBe(1);
    expect(computeTier({ ...base, ninVerified: true })).toBe(1);
    expect(computeTier({ ...base, facePassed: true, ninVerified: true })).toBe(2);
    expect(computeTier({ ...base, facePassed: true, govIdVerified: true })).toBe(2);
  });
  it('tier 3 = tier 2 + address; address alone does nothing', () => {
    expect(computeTier({ ...base, facePassed: true, ninVerified: true, addressVerified: true })).toBe(3);
    expect(computeTier({ ...base, addressVerified: true })).toBe(1);
  });
});

describe('maxLoanKobo', () => {
  const svc = (caps: unknown) => new KycTierService({ systemSetting: { findUnique: () => Promise.resolve(caps === undefined ? null : { value: caps }) } } as never, {} as never);
  it('reads kyc.tier_loan_caps and falls back to the defaults', async () => {
    expect(await svc({ '1': 5, '2': 6, '3': 7 }).maxLoanKobo(2)).toBe(6);
    expect(await svc(undefined).maxLoanKobo(1)).toBe(100_000_00);
    expect(await svc(undefined).maxLoanKobo(3)).toBe(10_000_000_00);
    expect(await svc(undefined).maxLoanKobo(0)).toBe(0);
  });
});
