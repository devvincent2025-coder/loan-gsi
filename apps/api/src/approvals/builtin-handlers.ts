import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ApprovalActionType } from '@damez/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalHandler } from './approval-registry';

const parse = <T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> => {
  const r = schema.safeParse(v);
  if (!r.success) throw new BadRequestException({ message: 'Invalid payload', code: 'VALIDATION_FAILED', errors: { payload: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } });
  return r.data;
};

const roleChangeSchema = z.object({ userId: z.string(), toRoleId: z.string() }).passthrough();
const legacyRateChangeSchema = z.object({ productId: z.string(), newMonthlyRateBps: z.number().int().min(1).max(2500) }).passthrough();

/** Pricing fields of a loan product: the ONLY fields that go through PRODUCT_RATE_CHANGE maker-checker. */
export const PRODUCT_PRICING_FIELDS = ['monthlyRateBps', 'interestMethod', 'processingFeeBps', 'managementFeeBps', 'insuranceFeeBps', 'penaltyBpsPerDay', 'penaltyGraceDays'] as const;
export const productPricingChangesSchema = z.object({
  monthlyRateBps: z.number().int().min(1).max(2500),
  interestMethod: z.enum(['FLAT', 'REDUCING_BALANCE']),
  processingFeeBps: z.number().int().min(0).max(1000),
  managementFeeBps: z.number().int().min(0).max(1000),
  insuranceFeeBps: z.number().int().min(0).max(1000),
  penaltyBpsPerDay: z.number().int().min(0).max(500),
  penaltyGraceDays: z.number().int().min(0).max(90),
}).partial().strict().refine((c) => Object.keys(c).length > 0, 'changes must contain at least one pricing field');
const rateChangeSchema = z.union([
  z.object({ productId: z.string(), changes: productPricingChangesSchema }).passthrough(),
  legacyRateChangeSchema,
]);

export function roleChangeHandler(audit: AuditService, notify: NotificationsService, revokeSessions: (userId: string, tx: Prisma.TransactionClient) => Promise<void>): ApprovalHandler {
  return {
    type: 'ROLE_CHANGE',
    submitPermission: 'user:role_change',
    validate: (p) => parse(roleChangeSchema, p),
    async execute(req, tx) {
      const p = parse(roleChangeSchema, req.payload);
      const user = await tx.staffUser.findUniqueOrThrow({ where: { id: p.userId }, include: { role: true } });
      const target = await tx.role.findUniqueOrThrow({ where: { id: p.toRoleId } });
      if (typeof req.payload.fromRoleId === 'string' && req.payload.fromRoleId !== user.roleId) {
        throw new Error('The user\'s role changed since this request was made; submit a new request');
      }
      if (user.role.key === 'super_admin' && target.key !== 'super_admin') {
        const others = await tx.staffUser.count({ where: { role: { key: 'super_admin' }, status: 'ACTIVE', id: { not: user.id } } });
        if (others === 0) throw new Error('Cannot remove the last active Super Admin');
      }
      await tx.staffUser.update({ where: { id: user.id }, data: { roleId: target.id } });
      await revokeSessions(user.id, tx);
      await audit.record({ action: 'user.role_changed', resourceType: 'StaffUser', resourceId: user.id, before: { role: user.role.key }, after: { role: target.key }, metadata: { approvalId: req.id } }, tx);
      await notify.notifyUsers([user.id], 'Your role was changed', `Your role is now ${target.name}. Please sign in again.`);
      return { userId: user.id, from: user.role.key, to: target.key };
    },
  };
}

/** Accepts the legacy {productId, newMonthlyRateBps} or {productId, changes:{…pricing fields}}; all fields apply atomically. */
export function productRateHandler(audit: AuditService): ApprovalHandler {
  return {
    type: 'PRODUCT_RATE_CHANGE',
    submitPermission: 'product:update',
    validate: (p) => parse(rateChangeSchema, p),
    async execute(req, tx) {
      const p = parse(rateChangeSchema, req.payload);
      const before = await tx.loanProduct.findUniqueOrThrow({ where: { id: p.productId } });
      if ('changes' in p) {
        const changes = p.changes as z.infer<typeof productPricingChangesSchema>;
        const after = await tx.loanProduct.update({ where: { id: p.productId }, data: changes });
        const pick = (row: Record<string, unknown>) => Object.fromEntries(Object.keys(changes).map((k) => [k, row[k]]));
        await audit.record({ action: 'product.pricing_changed', resourceType: 'LoanProduct', resourceId: before.id, before: pick(before), after: pick(after), metadata: { approvalId: req.id, productName: before.name } }, tx);
        return { productId: before.id, before: pick(before), after: pick(after) };
      }
      const after = await tx.loanProduct.update({ where: { id: p.productId }, data: { monthlyRateBps: (p as z.infer<typeof legacyRateChangeSchema>).newMonthlyRateBps } });
      await audit.record({ action: 'product.rate_changed', resourceType: 'LoanProduct', resourceId: before.id, before: { monthlyRateBps: before.monthlyRateBps }, after: { monthlyRateBps: after.monthlyRateBps }, metadata: { approvalId: req.id } }, tx);
      return { productId: before.id, from: before.monthlyRateBps, to: after.monthlyRateBps };
    },
  };
}

const loanApprovalSchema = z.object({ applicationId: z.string().min(1) }).passthrough();

/** Transitions the application to APPROVED; the offers module generates the offer letter from there. */
export function loanApprovalHandler(audit: AuditService, notify: NotificationsService): ApprovalHandler {
  return {
    type: 'LOAN_APPROVAL',
    submitPermission: 'application:update',
    validate: (p) => parse(loanApprovalSchema, p),
    async execute(req, tx) {
      const p = parse(loanApprovalSchema, req.payload);
      const app = await tx.loanApplication.findUniqueOrThrow({ where: { id: p.applicationId }, include: { customer: true } });
      if (app.status !== 'UNDER_REVIEW') throw new Error(`Application ${app.id} is ${app.status}, expected UNDER_REVIEW`);
      await tx.loanApplication.update({ where: { id: app.id }, data: { status: 'APPROVED', statusReason: 'Approved by credit committee', decidedAt: new Date() } });
      await tx.applicationEvent.create({
        data: { applicationId: app.id, fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', actorType: 'STAFF', actorId: req.makerId, actorName: 'Credit Committee (maker-checker)', reason: req.reason ?? 'Approved via maker-checker' },
      });
      await audit.record({ action: 'application.approved', resourceType: 'LoanApplication', resourceId: app.id, after: { approvalRequestId: req.id, reference: app.reference } }, tx);
      // Customer SMS notification is sent by the ApplicationTransitions service on status change; this handler only needs to update the DB.
      void notify; // notify may be used later for in-app staff notifications
      return { applicationId: app.id, reference: app.reference, approvedAt: new Date().toISOString() };
    },
  };
}

/** Placeholder until the owning module (prompts 3 and 4) registers the real handler. Decision is still four-eyes controlled and audited. */
export function stubHandler(type: ApprovalActionType, submitPermission: string, owner: string): ApprovalHandler {
  return {
    type,
    submitPermission,
    validate: (p) => p,
    execute: async () => ({ note: `Approved and recorded. The ${owner} module (later prompt) will register the handler that applies the change.` }),
  };
}
