import { z } from 'zod';
import { APPROVAL_ACTION_TYPES } from './approvals';

export const emailSchema = z.string().trim().toLowerCase().email();
export const ngPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number');
export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a digit');

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });
export const totpVerifySchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const totpEnrollSchema = z.object({ challengeToken: z.string().min(10) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
});

export const userCreateSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  phone: ngPhoneSchema.optional(),
  roleId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  allBranches: z.boolean().optional(),
  password: passwordSchema,
});
export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: ngPhoneSchema.nullable().optional(),
  branchId: z.string().min(1).nullable().optional(),
  allBranches: z.boolean().optional(),
});
export const roleChangeSchema = z.object({
  roleId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
});
export const resetPasswordSchema = z.object({ password: passwordSchema });

export const roleCreateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  branchScoped: z.boolean().default(false),
});
export const rolePermissionsSchema = z.object({ permissions: z.array(z.string()).max(500) });
export const roleApprovalLimitsSchema = z.object({
  limits: z.array(
    z.object({
      actionType: z.enum(APPROVAL_ACTION_TYPES),
      maxAmountKobo: z.number().int().min(0).nullable(),
    }),
  ),
});

export const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/),
  name: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(50),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().max(250).optional(),
  isHeadOffice: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const branchUpdateSchema = branchSchema.partial();

export const approvalSubmitSchema = z.object({
  type: z.enum(APPROVAL_ACTION_TYPES),
  summary: z.string().trim().min(5).max(300),
  reason: z.string().trim().max(500).optional(),
  amountKobo: z.number().int().min(0).optional(),
  payload: z.record(z.unknown()).default({}),
});
export const approvalDecisionSchema = z.object({ comment: z.string().trim().max(500).optional() });
export const approvalPolicySchema = z.object({
  thresholdKobo: z.number().int().min(0),
  enabled: z.boolean(),
});

export const settingUpdateSchema = z.object({ value: z.unknown() });
export const templateUpdateSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(4000),
  isActive: z.boolean().optional(),
});
export const notificationTestSchema = z.object({
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP']),
  to: z.string().min(3),
  templateKey: z.string().min(1),
  variables: z.record(z.string()).default({}),
});

export const piiRevealSchema = z.object({
  resource: z.enum(['customer']),
  id: z.string().min(1),
  field: z.enum(['bvn', 'nin', 'phone', 'email', 'accountNumber']),
  reason: z.string().trim().min(5).max(300),
});

export const auditQuerySchema = pageQuerySchema.extend({
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;
export const ABOUT_US_CHANNELS = ['SOCIAL_MEDIA', 'CUSTOMER_REFERRAL', 'RADIO_TV_NEWSPAPER', 'WALK_IN', 'OTHER'] as const;
export const GUARANTOR_ID_TYPES = ['NIN', 'INTL_PASSPORT', 'DRIVERS_LICENSE', 'VOTERS_CARD'] as const;
export const GUARANTOR_RELATIONSHIPS = ['SPOUSE', 'PARENT', 'SIBLING', 'CHILD', 'FRIEND', 'COLLEAGUE', 'EMPLOYER', 'OTHER'] as const;

export const bvnLookupSchema = z.object({ bvn: z.string().regex(/^\d{11}$/, 'BVN must be 11 digits') });

export const customerCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(60).regex(/^[\p{L}][\p{L} '.-]*$/u, 'Letters only'),
  lastName: z.string().trim().min(1).max(60).regex(/^[\p{L}][\p{L} '.-]*$/u, 'Letters only'),
  phone: ngPhoneSchema,
  bvn: z.string().regex(/^\d{11}$/, 'BVN must be 11 digits'),
  email: emailSchema.optional(),
  state: z.string().trim().max(40).optional(),
  branchId: z.string().optional(),
});

export const guarantorCreateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: ngPhoneSchema,
  relationship: z.enum(GUARANTOR_RELATIONSHIPS),
  occupation: z.string().trim().max(120).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd').optional(),
  bvn: z.string().regex(/^\d{11}$/, 'BVN must be 11 digits').optional(),
  address: z.object({
    line1: z.string().trim().min(2).max(200),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    landmark: z.string().trim().max(100).optional(),
  }),
  idType: z.enum(GUARANTOR_ID_TYPES).optional(),
});

export const applicationExtrasSchema = z.object({
  selfReportedIncomeKobo: z.number().int().min(0).optional(),
  selfReportedOutstandingKobo: z.number().int().min(0).optional(),
  collateralStockDesc: z.string().trim().max(1000).optional(),
  collateralPropertyDesc: z.string().trim().max(1000).optional(),
});

export const customerExtrasSchema = z.object({
  maritalStatus: z.enum(MARITAL_STATUSES).optional(),
  aboutUsChannel: z.enum(ABOUT_US_CHANNELS).optional(),
  nok: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: ngPhoneSchema,
    relationship: z.string().trim().max(80),
    address: z.string().trim().max(300).optional(),
  }).optional(),
});
