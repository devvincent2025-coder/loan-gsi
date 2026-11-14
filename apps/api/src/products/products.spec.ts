import { BadRequestException } from '@nestjs/common';
import { feesSummary, ProductsService, toPortalDto } from './products.service';
import { productCreateSchema, productPatchSchema } from './product-schemas';
import { productPricingChangesSchema, productRateHandler } from '../approvals/builtin-handlers';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'p1', code: 'PERS', name: 'Personal Loan', minAmountKobo: 5_000_000n, maxAmountKobo: 200_000_000n, monthlyRateBps: 450, minTenorMonths: 3, maxTenorMonths: 12, isActive: true,
  description: 'd', interestMethod: 'FLAT', processingFeeBps: 0, managementFeeBps: 100, insuranceFeeBps: 50, penaltyBpsPerDay: 25, penaltyGraceDays: 3, gracePeriodDays: 0,
  minKycTier: 1, requiredDocs: ['ID_CARD', 'bogus'], minAge: 18, maxAge: 65, eligibilityOverrides: null, scorecardKey: 'default', allowGuarantor: true, allowCollateral: false,
  createdAt: new Date(), updatedAt: new Date(), ...o,
});

describe('fees summary / portal dto', () => {
  it('describes upfront fees', () => {
    expect(feesSummary({ processingFeeBps: 0, managementFeeBps: 100, insuranceFeeBps: 50 })).toBe('1% management + 0.5% insurance deducted upfront');
    expect(feesSummary({ processingFeeBps: 75, managementFeeBps: 0, insuranceFeeBps: 0 })).toBe('0.75% processing deducted upfront');
    expect(feesSummary({ processingFeeBps: 0, managementFeeBps: 0, insuranceFeeBps: 0 })).toBe('No upfront fees');
  });
  it('toPortalDto filters unknown doc kinds and supports locking', () => {
    const d = toPortalDto(row() as never);
    expect(d.requiredDocs).toEqual(['ID_CARD']);
    expect(d.available).toBe(true);
    const l = toPortalDto(row() as never, { lockedReason: 'Complete Tier 2 verification' });
    expect(l.available).toBe(false);
    expect(l.lockedReason).toBe('Complete Tier 2 verification');
    expect(toPortalDto(row({ isActive: false }) as never).available).toBe(false);
  });
});

describe('schemas', () => {
  it('create applies defaults and rejects unknown/invalid input', () => {
    const ok = productCreateSchema.safeParse({ code: 'NEW-1', name: 'New', minAmountKobo: 100_000, maxAmountKobo: 1_000_000, minTenorMonths: 1, maxTenorMonths: 6, monthlyRateBps: 400 });
    expect(ok.success).toBe(true);
    expect(productCreateSchema.safeParse({ code: 'x', name: 'N' }).success).toBe(false);
    expect(productCreateSchema.safeParse({ code: 'NEW-1', name: 'New', minAmountKobo: 100_000, maxAmountKobo: 1_000_000, minTenorMonths: 1, maxTenorMonths: 6, monthlyRateBps: 4000 }).success).toBe(false);
    expect(productCreateSchema.safeParse({ code: 'NEW-1', name: 'New', minAmountKobo: 100_000, maxAmountKobo: 1_000_000, minTenorMonths: 1, maxTenorMonths: 6, monthlyRateBps: 400, requiredDocs: ['SELFIE'] }).success).toBe(false);
    expect(productCreateSchema.safeParse({ code: 'NEW-1', name: 'New', minAmountKobo: 100_000, maxAmountKobo: 1_000_000, minTenorMonths: 1, maxTenorMonths: 6, monthlyRateBps: 400, isActive: true }).success).toBe(false);
  });
  it('patch validates ranges and rejects empty bodies / unknown keys', () => {
    expect(productPatchSchema.safeParse({}).success).toBe(false);
    expect(productPatchSchema.safeParse({ foo: 1 }).success).toBe(false);
    expect(productPatchSchema.safeParse({ penaltyBpsPerDay: 501 }).success).toBe(false);
    expect(productPatchSchema.safeParse({ managementFeeBps: 1001 }).success).toBe(false);
    expect(productPatchSchema.safeParse({ interestMethod: 'COMPOUND' }).success).toBe(false);
    expect(productPatchSchema.safeParse({ eligibilityOverrides: { maxDtiBps: 100 } }).success).toBe(false);
    expect(productPatchSchema.safeParse({ eligibilityOverrides: { maxDtiBps: 3500 }, isActive: true, monthlyRateBps: 500 }).success).toBe(true);
  });
});

describe('ProductsService.patch', () => {
  const build = (current = row()) => {
    const updates: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    const submitted: Array<Record<string, unknown>> = [];
    const prisma = {
      loanProduct: { findUnique: async () => current, update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { ...current, ...data }; } },
      scorecard: { findFirst: async () => ({ id: 's' }) },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ loanProduct: { update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { ...current, ...data }; } } }),
    };
    const audit = { record: async (e: Record<string, unknown>) => { audits.push(e); } };
    const approvals = { submit: async (_u: unknown, i: Record<string, unknown>) => { submitted.push(i); return { id: 'appr1', status: 'PENDING' }; } };
    return { svc: new ProductsService(prisma as never, audit as never, approvals as never), updates, audits, submitted };
  };
  const user = { id: 'u1' } as never;

  it('applies non-pricing fields immediately with audit and does not request approval', async () => {
    const { svc, updates, audits, submitted } = build();
    const r = await svc.patch(user, 'p1', { name: 'Personal Loan Plus', isActive: false, minKycTier: 2 });
    expect(updates).toEqual([{ name: 'Personal Loan Plus', isActive: false, minKycTier: 2 }]);
    expect(r.approval).toBeNull();
    expect(r.product.name).toBe('Personal Loan Plus');
    expect(audits[0]).toMatchObject({ action: 'product.updated', before: { name: 'Personal Loan', isActive: true, minKycTier: 1 }, after: { name: 'Personal Loan Plus', isActive: false, minKycTier: 2 } });
    expect(submitted).toHaveLength(0);
  });
  it('sends pricing fields to ONE maker-checker request and leaves the product unchanged', async () => {
    const { svc, updates, submitted } = build();
    const r = await svc.patch(user, 'p1', { monthlyRateBps: 500, managementFeeBps: 150, interestMethod: 'REDUCING_BALANCE' });
    expect(updates).toHaveLength(0);
    expect(r.product.monthlyRateBps).toBe(450);
    expect(r.approval).toMatchObject({ id: 'appr1' });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ type: 'PRODUCT_RATE_CHANGE', payload: { productId: 'p1', productName: 'Personal Loan', changes: { monthlyRateBps: 500, managementFeeBps: 150, interestMethod: 'REDUCING_BALANCE' }, current: { monthlyRateBps: 450, managementFeeBps: 100, interestMethod: 'FLAT' } } });
  });
  it('splits a mixed patch and ignores no-op pricing values', async () => {
    const { svc, updates, submitted } = build();
    const r = await svc.patch(user, 'p1', { description: 'new text', monthlyRateBps: 450, penaltyBpsPerDay: 30 });
    expect(updates).toEqual([{ description: 'new text' }]);
    expect(submitted[0]).toMatchObject({ payload: { changes: { penaltyBpsPerDay: 30 } } });
    expect(Object.keys((submitted[0].payload as { changes: object }).changes)).toEqual(['penaltyBpsPerDay']);
    expect(r.approval).not.toBeNull();
  });
  it('validates merged bounds', async () => {
    const { svc } = build();
    await expect(svc.patch(user, 'p1', { minAmountKobo: 900_000_000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.patch(user, 'p1', { maxTenorMonths: 2 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PRODUCT_RATE_CHANGE handler (generalised)', () => {
  const run = async (payload: Record<string, unknown>) => {
    const audits: Array<Record<string, unknown>> = [];
    const store = { ...row() } as Record<string, unknown>;
    const tx = { loanProduct: { findUniqueOrThrow: async () => ({ ...store }), update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(store, data) && { ...store } } };
    const h = productRateHandler({ record: async (e: Record<string, unknown>) => { audits.push(e); } } as never);
    const res = await h.execute({ id: 'a1', type: 'PRODUCT_RATE_CHANGE', payload, amountKobo: null, makerId: 'm', summary: '', reason: null }, tx as never, {} as never);
    return { res, audits, store };
  };
  it('applies all fields atomically with before/after audit', async () => {
    const { res, audits, store } = await run({ productId: 'p1', changes: { monthlyRateBps: 520, insuranceFeeBps: 75, interestMethod: 'REDUCING_BALANCE' } });
    expect(store).toMatchObject({ monthlyRateBps: 520, insuranceFeeBps: 75, interestMethod: 'REDUCING_BALANCE' });
    expect(audits[0]).toMatchObject({ action: 'product.pricing_changed', before: { monthlyRateBps: 450, insuranceFeeBps: 50, interestMethod: 'FLAT' }, after: { monthlyRateBps: 520, insuranceFeeBps: 75, interestMethod: 'REDUCING_BALANCE' } });
    expect(res).toMatchObject({ productId: 'p1' });
  });
  it('still accepts the legacy payload', async () => {
    const { res, audits, store } = await run({ productId: 'p1', newMonthlyRateBps: 480 });
    expect(store.monthlyRateBps).toBe(480);
    expect(audits[0]).toMatchObject({ action: 'product.rate_changed' });
    expect(res).toEqual({ productId: 'p1', from: 450, to: 480 });
  });
  it('validates ranges at submit time', () => {
    const h = productRateHandler({} as never);
    expect(() => h.validate({ productId: 'p1', changes: { penaltyBpsPerDay: 900 } }, null)).toThrow(BadRequestException);
    expect(() => h.validate({ productId: 'p1', changes: { interestMethod: 'X' } }, null)).toThrow(BadRequestException);
    expect(() => h.validate({ productId: 'p1', changes: {} }, null)).toThrow(BadRequestException);
    expect(() => h.validate({ productId: 'p1', newMonthlyRateBps: 9999 }, null)).toThrow(BadRequestException);
    expect(() => h.validate({ productId: 'p1', changes: { managementFeeBps: 0 } }, null)).not.toThrow();
    expect(productPricingChangesSchema.safeParse({ monthlyRateBps: 0 }).success).toBe(false);
  });
});
