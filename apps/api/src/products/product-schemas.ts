import { z } from 'zod';
import { DOCUMENT_KINDS } from '@damez/shared';

const kobo = z.number().int().min(100).max(100_000_000_000);
const docs = z.array(z.enum(DOCUMENT_KINDS)).max(DOCUMENT_KINDS.length).transform((a) => [...new Set(a)]);
const overrides = z.record(z.unknown()).superRefine((o, ctx) => {
  if ('maxDtiBps' in o && !(typeof o.maxDtiBps === 'number' && Number.isInteger(o.maxDtiBps) && o.maxDtiBps >= 500 && o.maxDtiBps <= 9000)) {
    ctx.addIssue({ code: 'custom', message: 'maxDtiBps must be an integer between 500 and 9000', path: ['maxDtiBps'] });
  }
});

/** non-pricing: applies immediately */
const general = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  minAmountKobo: kobo,
  maxAmountKobo: kobo,
  minTenorMonths: z.number().int().min(1).max(120),
  maxTenorMonths: z.number().int().min(1).max(120),
  isActive: z.boolean(),
  requiredDocs: docs,
  minKycTier: z.number().int().min(0).max(3),
  minAge: z.number().int().min(18).max(100),
  maxAge: z.number().int().min(18).max(100),
  gracePeriodDays: z.number().int().min(0).max(180),
  eligibilityOverrides: overrides,
  scorecardKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  allowGuarantor: z.boolean(),
  allowCollateral: z.boolean(),
};
/** pricing: always maker-checker (PRODUCT_RATE_CHANGE) once the product exists */
const pricing = {
  monthlyRateBps: z.number().int().min(1).max(2500),
  interestMethod: z.enum(['FLAT', 'REDUCING_BALANCE']),
  processingFeeBps: z.number().int().min(0).max(1000),
  managementFeeBps: z.number().int().min(0).max(1000),
  insuranceFeeBps: z.number().int().min(0).max(1000),
  penaltyBpsPerDay: z.number().int().min(0).max(500),
  penaltyGraceDays: z.number().int().min(0).max(90),
};

export const GENERAL_FIELDS = Object.keys(general) as (keyof typeof general)[];

export const productCreateSchema = z.object({
  code: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, 'uppercase letters, digits, - and _ (2-30 chars)'),
  ...general,
  description: general.description.default(''),
  requiredDocs: docs.default([]),
  minKycTier: general.minKycTier.default(1),
  minAge: general.minAge.default(18),
  maxAge: general.maxAge.default(65),
  gracePeriodDays: general.gracePeriodDays.default(0),
  eligibilityOverrides: overrides.default({}),
  scorecardKey: general.scorecardKey.default('default'),
  allowGuarantor: z.boolean().default(true),
  allowCollateral: z.boolean().default(false),
  ...pricing,
  interestMethod: pricing.interestMethod.default('FLAT'),
  processingFeeBps: pricing.processingFeeBps.default(0),
  managementFeeBps: pricing.managementFeeBps.default(100),
  insuranceFeeBps: pricing.insuranceFeeBps.default(50),
  penaltyBpsPerDay: pricing.penaltyBpsPerDay.default(25),
  penaltyGraceDays: pricing.penaltyGraceDays.default(3),
}).omit({ isActive: true }).strict();

export const productPatchSchema = z.object({ ...general, ...pricing }).partial().strict()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to change');

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductPatchInput = z.infer<typeof productPatchSchema>;
