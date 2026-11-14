import { ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maskPhone, type ApplicationStatus } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { FieldCipher } from '../crypto/field-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CUSTOMER_STATUS_COPY } from './mappers';
import { Actor, isTerminal, resolveTransition } from './state-machine';

export interface ActorRef { type: Actor; id: string | null; name: string; permissions?: ReadonlySet<string>; branchId?: string | null }
export const SYSTEM_ACTOR: ActorRef = { type: 'SYSTEM', id: null, name: 'System' };

/** Statuses that trigger an SMS to the customer. */
const NOTIFY: ApplicationStatus[] = ['KYC_PENDING', 'UNDER_REVIEW', 'APPROVED', 'OFFER_SENT', 'DISBURSED', 'REJECTED', 'CANCELLED'];
const DECIDED: ApplicationStatus[] = ['REJECTED', 'CANCELLED', 'APPROVED', 'DISBURSED', 'CLOSED', 'WRITTEN_OFF'];
export const STATUS_TEMPLATE_KEY = 'application_status';

export interface ApplyOptions { reason?: string | null; statusReason?: string | null; notify?: boolean }

/**
 * Executes ONE state change: validates against the pure state machine, writes status + event + audit atomically,
 * then (best effort) texts the customer. Everything that moves an application goes through here.
 */
@Injectable()
export class ApplicationTransitions implements OnModuleInit {
  private log = new Logger('ApplicationTransitions');

  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService, private cipher: FieldCipher) {}

  /** Idempotent self-seed of the SMS template (the seed script is owned by the lead). */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.notificationTemplate.upsert({
        where: { key_channel: { key: STATUS_TEMPLATE_KEY, channel: 'SMS' } },
        create: {
          key: STATUS_TEMPLATE_KEY, channel: 'SMS', name: 'Loan application status update', subject: null, isActive: true,
          body: 'Damez: your loan application {{reference}} is now "{{statusLabel}}". {{message}}',
          variables: ['reference', 'statusLabel', 'message'],
        },
        update: {},
      });
    } catch (e) {
      this.log.warn(`could not seed ${STATUS_TEMPLATE_KEY} template: ${(e as Error).message}`);
    }
  }

  async apply(applicationId: string, to: ApplicationStatus, actor: ActorRef, opts: ApplyOptions = {}) {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application not found');
    const from = app.status as ApplicationStatus;
    const def = resolveTransition(from, to, actor.type, opts.reason);
    if (actor.type === 'STAFF' && def.permission && !actor.permissions?.has(def.permission)) {
      throw new HttpException({ statusCode: 403, message: 'You do not have permission to perform this action', code: 'FORBIDDEN', required: [def.permission] }, 403);
    }
    const statusReason = (opts.statusReason ?? opts.reason ?? null)?.slice(0, 500) ?? null;
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // optimistic guard: two advancers must not both apply the same transition
      const r = await tx.loanApplication.updateMany({
        where: { id: app.id, status: from },
        data: { status: to, statusReason, ...(DECIDED.includes(to) || isTerminal(to) ? { decidedAt: now } : {}), ...(to === 'SUBMITTED' ? { submittedAt: app.submittedAt ?? now } : {}) },
      });
      if (r.count === 0) throw new ConflictException({ message: 'The application was changed by someone else. Refresh and try again.', code: 'CONCURRENT_MODIFICATION' });
      await tx.applicationEvent.create({
        data: { applicationId: app.id, fromStatus: from, toStatus: to, actorType: actor.type, actorId: actor.id, actorName: actor.name, reason: opts.reason ?? opts.statusReason ?? null },
      });
      await this.audit.record({
        action: 'application.transition', resourceType: 'LoanApplication', resourceId: app.id, branchId: app.branchId,
        actorId: actor.id, actorName: actor.name, ...(actor.type !== 'STAFF' ? { actorEmail: null, actorRole: actor.type === 'CUSTOMER' ? 'Customer (portal)' : 'System' } : {}),
        before: { status: from, statusReason: app.statusReason }, after: { status: to, statusReason }, metadata: { actor: actor.type, reason: opts.reason ?? null, reference: app.reference },
      }, tx as Prisma.TransactionClient);
      return tx.loanApplication.findUniqueOrThrow({ where: { id: app.id } });
    });
    if (opts.notify !== false && NOTIFY.includes(to) && !(actor.type === 'CUSTOMER' && to === 'CANCELLED')) {
      await this.notifyCustomer(updated.customerId, updated.reference, to, statusReason);
    }
    return updated;
  }

  /** Update the explanation without changing state (waiting for consent / documents). No-op when unchanged. */
  async setStatusReason(applicationId: string, statusReason: string): Promise<void> {
    await this.prisma.loanApplication.updateMany({ where: { id: applicationId, NOT: { statusReason } }, data: { statusReason: statusReason.slice(0, 500) } });
  }

  /** SMS to the customer's VERIFIED phone only; PII decrypted just-in-time and never logged unmasked. Never throws. */
  async notifyCustomer(customerId: string, reference: string, status: ApplicationStatus, detail: string | null): Promise<void> {
    try {
      const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { phoneEnc: true, phoneVerifiedAt: true } });
      if (!c?.phoneVerifiedAt || !c.phoneEnc) return;
      const phone = this.cipher.decrypt(c.phoneEnc, `customer:${customerId}:phone`);
      const copy = CUSTOMER_STATUS_COPY[status];
      try {
        await this.notifications.send({
          channel: 'SMS', to: phone, templateKey: STATUS_TEMPLATE_KEY,
          variables: { reference, statusLabel: copy.label, message: (detail && ['REJECTED', 'KYC_PENDING'].includes(status) ? detail : copy.message).slice(0, 200) },
        });
      } catch (e) {
        this.log.warn(`SMS to ${maskPhone(phone)} failed: ${(e as Error).message}`);
      }
    } catch (e) {
      this.log.warn(`notify failed for customer ${customerId}: ${(e as Error).message}`);
    }
  }
}
