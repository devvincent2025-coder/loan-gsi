import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ApplicationDetailDto, ApplicationStatus, UnderwritingDecisionDto, UnderwritingNoteDto, UnderwritingQueueItemDto } from '@damez/shared';
import { maskName } from '@damez/shared';
import { Prisma } from '@prisma/client';
import { ApplicationsService } from '../applications/applications.service';
import type { ActorRef } from '../applications/application-transitions';
import { ApplicationTransitions, STATUS_TEMPLATE_KEY } from '../applications/application-transitions';
import { ApprovalRegistry } from '../approvals/approval-registry';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { branchWhere } from '../common/auth-user';
import { FieldCipher } from '../crypto/field-cipher';
import { NotificationsService } from '../notifications/notifications.service';
import { OffersService } from '../offers/offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { loanApprovalHandler } from './loan-approval.handler';

/** Applications fall off the queue's SLA clock after this many hours (no dedicated SystemSetting yet). */
const SLA_HOURS = 48;
const QUEUE_STATUSES: ApplicationStatus[] = ['UNDER_REVIEW', 'APPROVED', 'OFFER_SENT'];

const staffActor = (u: AuthUser): ActorRef => ({ type: 'STAFF', id: u.id, name: u.fullName, permissions: u.permissions, branchId: u.branchId });

type QueueRow = Prisma.LoanApplicationGetPayload<{ include: { customer: true; product: true; assessments: { take: 1 } } }>;
const queueInclude = { customer: true, product: true, assessments: { orderBy: { createdAt: 'desc' as const }, take: 1 } } satisfies Prisma.LoanApplicationInclude;

@Injectable()
export class UnderwritingService implements OnModuleInit {
  private log = new Logger('UnderwritingService');

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private transitions: ApplicationTransitions,
    private registry: ApprovalRegistry,
    private approvals: ApprovalsService,
    private apps: ApplicationsService,
    private notifications: NotificationsService,
    private cipher: FieldCipher,
    private offers: OffersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(loanApprovalHandler(this.prisma, this.transitions));
  }

  /* ───────── queue ───────── */

  async queue(user: AuthUser, q: { status?: ApplicationStatus; branchId?: string; assignedToId?: string }): Promise<UnderwritingQueueItemDto[]> {
    const and: Prisma.LoanApplicationWhereInput[] = [branchWhere(user) as Prisma.LoanApplicationWhereInput];
    and.push({ status: q.status ? q.status : { in: QUEUE_STATUSES } });
    if (q.branchId) and.push({ branchId: q.branchId });
    if (q.assignedToId) and.push({ assignedToId: q.assignedToId });
    const rows = await this.prisma.loanApplication.findMany({ where: { AND: and }, include: queueInclude, orderBy: { submittedAt: 'asc' }, take: 200 });
    const now = Date.now();
    return rows.map((r) => this.toQueueItem(r, now));
  }

  private toQueueItem(r: QueueRow, now: number): UnderwritingQueueItemDto {
    const a = r.assessments[0];
    const hoursWaiting = r.submittedAt ? (now - r.submittedAt.getTime()) / 3_600_000 : null;
    return {
      applicationId: r.id, reference: r.reference, customerId: r.customerId, customerName: maskName(`${r.customer.firstName} ${r.customer.lastName}`),
      productName: r.product.name, requestedAmountKobo: Number(r.requestedAmountKobo), tenorMonths: r.tenorMonths, status: r.status as ApplicationStatus,
      eligibilityOutcome: (a?.outcome as UnderwritingQueueItemDto['eligibilityOutcome']) ?? null, score: a?.score ?? null,
      submittedAt: r.submittedAt?.toISOString() ?? null, assignedToId: r.assignedToId, branchId: r.branchId,
      slaHoursRemaining: hoursWaiting === null ? null : Math.round((SLA_HOURS - hoursWaiting) * 10) / 10,
    };
  }

  /* ───────── notes ───────── */

  private toNoteDto(n: { id: string; applicationId: string; authorId: string | null; authorName: string; kind: string; body: string; createdAt: Date }): UnderwritingNoteDto {
    return { id: n.id, applicationId: n.applicationId, authorId: n.authorId, authorName: n.authorName, kind: n.kind as UnderwritingNoteDto['kind'], body: n.body, createdAt: n.createdAt.toISOString() };
  }

  async listNotes(user: AuthUser, applicationId: string): Promise<UnderwritingNoteDto[]> {
    await this.apps.getForStaff(user, applicationId);
    const rows = await this.prisma.underwritingNote.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toNoteDto(r));
  }

  private async addNote(user: AuthUser, applicationId: string, kind: 'NOTE' | 'DECISION' | 'REQUEST_INFO', body: string): Promise<UnderwritingNoteDto> {
    const row = await this.prisma.underwritingNote.create({ data: { applicationId, authorId: user.id, authorName: user.fullName, kind, body } });
    return this.toNoteDto(row);
  }

  async addFreeNote(user: AuthUser, applicationId: string, body: string): Promise<UnderwritingNoteDto> {
    const app = await this.apps.getForStaff(user, applicationId);
    const note = await this.addNote(user, applicationId, 'NOTE', body);
    await this.audit.record({ action: 'underwriting.note_added', resourceType: 'LoanApplication', resourceId: applicationId, branchId: app.branchId, after: { kind: 'NOTE' } });
    return note;
  }

  /** Verified-phone SMS, mirroring ApplicationTransitions.notifyCustomer (that method is private there, so this is a thin local equivalent). Never throws. */
  private async notifyCustomer(customerId: string, reference: string, message: string): Promise<void> {
    try {
      const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { phoneEnc: true, phoneVerifiedAt: true } });
      if (!c?.phoneVerifiedAt || !c.phoneEnc) return;
      const phone = this.cipher.decrypt(c.phoneEnc, `customer:${customerId}:phone`);
      await this.notifications.send({ channel: 'SMS', to: phone, templateKey: STATUS_TEMPLATE_KEY, variables: { reference, statusLabel: 'More information needed', message: message.slice(0, 200) } });
    } catch (e) {
      this.log.warn(`notify failed for customer ${customerId}: ${(e as Error).message}`);
    }
  }

  /* ───────── decisions ───────── */

  async decide(user: AuthUser, applicationId: string, d: UnderwritingDecisionDto): Promise<ApplicationDetailDto> {
    const app = await this.apps.getForStaff(user, applicationId);

    switch (d.action) {
      case 'APPROVE': {
        const amountKobo = d.amountKobo ?? Number(app.requestedAmountKobo);
        const tenorMonths = d.tenorMonths ?? app.tenorMonths;
        await this.approvals.submit(user, {
          type: 'LOAN_APPROVAL', summary: `Approve application ${app.reference}`, reason: d.reason,
          amountKobo, payload: { applicationId, amountKobo, tenorMonths },
        });
        await this.addNote(user, applicationId, 'DECISION', `Approval requested for ₦${(amountKobo / 100).toLocaleString('en-NG')} over ${tenorMonths} months.${d.reason ? ` Reason: ${d.reason}` : ''}`);
        break;
      }
      case 'REJECT': {
        if (!d.reason?.trim()) throw new BadRequestException({ message: 'A reason is required to reject an application', code: 'REASON_REQUIRED' });
        await this.transitions.apply(applicationId, 'REJECTED', staffActor(user), { reason: d.reason });
        await this.addNote(user, applicationId, 'DECISION', `Rejected: ${d.reason}`);
        break;
      }
      case 'REFER': {
        const assigneeIds = d.assigneeIds ?? [];
        if (assigneeIds.length === 0) throw new BadRequestException({ message: 'Pick 1 or 2 staff members to refer this application to', code: 'ASSIGNEE_REQUIRED' });
        const staff = await this.prisma.staffUser.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } });
        if (staff.length !== assigneeIds.length) throw new BadRequestException({ message: 'One or more selected staff members could not be found', code: 'VALIDATION_FAILED' });
        const names = assigneeIds.map((id) => staff.find((s) => s.id === id)?.fullName ?? id);
        await this.prisma.loanApplication.update({ where: { id: applicationId }, data: { assignedToId: assigneeIds[0] } });
        await this.prisma.inAppNotification.createMany({
          data: assigneeIds.map((id) => ({
            userId: id, title: `Application ${app.reference} referred to you`,
            body: `${user.fullName} referred this application for a second opinion.${d.reason ? ` ${d.reason}` : ''}${d.note ? ` ${d.note}` : ''}`,
            href: `/applications/${applicationId}`,
          })),
        });
        await this.addNote(user, applicationId, 'NOTE', `Referred to ${names.join(' and ')} for a second opinion.${d.reason ? ` ${d.reason}` : ''}${d.note ? ` ${d.note}` : ''}`);
        break;
      }
      case 'REQUEST_INFO': {
        const message = d.reason ?? d.note ?? 'We need more information to continue reviewing your application. Please contact us.';
        await this.addNote(user, applicationId, 'REQUEST_INFO', message);
        await this.notifyCustomer(app.customerId, app.reference, message);
        break;
      }
      case 'COUNTER_OFFER': {
        if (!d.amountKobo || !d.tenorMonths) throw new BadRequestException({ message: 'amountKobo and tenorMonths are required for a counter-offer', code: 'VALIDATION_FAILED' });
        const offer = await this.offers.createOffer(user, applicationId, { principalKobo: d.amountKobo, tenorMonths: d.tenorMonths, isCounterOffer: true, note: d.note });
        await this.addNote(user, applicationId, 'NOTE', `Counter-offer ${offer.offerNumber} drafted: ₦${(d.amountKobo / 100).toLocaleString('en-NG')} over ${d.tenorMonths} months.${d.reason ? ` ${d.reason}` : ''}`);
        break;
      }
      default:
        throw new BadRequestException({ message: `Unknown decision action`, code: 'VALIDATION_FAILED' });
    }

    await this.audit.record({ action: 'underwriting.decision', resourceType: 'LoanApplication', resourceId: applicationId, branchId: app.branchId, after: { action: d.action, reason: d.reason ?? null, assigneeIds: d.assigneeIds ?? null } });
    return this.apps.detail(user, applicationId);
  }
}
