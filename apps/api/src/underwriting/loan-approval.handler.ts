import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { ApprovalHandler } from '../approvals/approval-registry';
import type { ActorRef } from '../applications/application-transitions';
import { ApplicationTransitions } from '../applications/application-transitions';
import type { AuthUser } from '../common/auth-user';
import type { PrismaService } from '../prisma/prisma.service';

const payloadSchema = z.object({
  applicationId: z.string().min(1),
  amountKobo: z.number().int().positive(),
  tenorMonths: z.number().int().min(1).max(120),
}).passthrough();

const parse = (p: unknown) => {
  const r = payloadSchema.safeParse(p);
  if (!r.success) throw new BadRequestException({ message: 'Invalid payload', code: 'VALIDATION_FAILED', errors: { payload: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } });
  return r.data;
};

const actorFromApprover = (approver: AuthUser): ActorRef => ({ type: 'STAFF', id: approver.id, name: approver.fullName, permissions: approver.permissions, branchId: approver.branchId });

/**
 * Registered by UnderwritingService.onModuleInit, overwriting the stub `ApprovalsService` registers for
 * LOAN_APPROVAL at bootstrap (last writer in the registry's Map wins — UnderwritingModule just needs to be
 * imported after ApprovalsModule in app.module.ts for this to take effect).
 */
export function loanApprovalHandler(prisma: PrismaService, transitions: ApplicationTransitions): ApprovalHandler {
  return {
    type: 'LOAN_APPROVAL',
    submitPermission: 'underwriting:decide',
    validate: async (p) => {
      const d = parse(p);
      const app = await prisma.loanApplication.findUnique({ where: { id: d.applicationId } });
      if (!app) throw new BadRequestException({ message: 'Application not found', code: 'VALIDATION_FAILED' });
      if (app.status !== 'UNDER_REVIEW') throw new BadRequestException({ message: `Application is ${app.status}, not under review`, code: 'ILLEGAL_STATE' });
      return d;
    },
    execute: async (req, _tx, approver) => {
      const d = parse(req.payload);
      // ApplicationTransitions manages its own transaction (it is frozen and does not accept an external `tx`), so this
      // commits separately from the approval row's transaction. Accepted trade-off: see the final report for this prompt.
      await transitions.apply(d.applicationId, 'APPROVED', actorFromApprover(approver), { reason: 'Approved via maker-checker' });
      return { applicationId: d.applicationId, amountKobo: d.amountKobo, tenorMonths: d.tenorMonths, approvedBy: approver.id };
    },
  };
}
