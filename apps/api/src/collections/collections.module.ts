import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { maskName, maskPhone, pageQuerySchema, type Page } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuditModule } from '../audit/audit.module';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalRegistry, type ApprovalHandler } from '../approvals/approval-registry';
import { ApprovalsModule } from '../approvals/approvals.module';
import type { AuthUser } from '../common/auth-user';
import { branchWhere } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { paged, skipTake } from '../common/pagination';
import { n } from '../common/bigint';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerPii } from '../kyc/customer-pii';

/* ─── Zod schemas ─────────────────────────────────────────────────────────── */

const BUCKET_VALUES = ['DPD_1_7', 'DPD_8_30', 'DPD_31_60', 'DPD_61_90', 'DPD_90_PLUS'] as const;
const STATUS_VALUES = ['OPEN', 'IN_PROGRESS', 'PROMISE_TO_PAY', 'LEGAL', 'AGENCY', 'WRITTEN_OFF', 'SETTLED', 'CLOSED'] as const;
const CHANNEL_VALUES = ['PHONE_CALL', 'SMS', 'EMAIL', 'WHATSAPP', 'FIELD_VISIT', 'PORTAL_MESSAGE', 'LEGAL_NOTICE'] as const;
const OUTCOME_VALUES = ['NO_ANSWER', 'WRONG_NUMBER', 'LEFT_VOICEMAIL', 'SPOKE_TO_BORROWER', 'SPOKE_TO_THIRD_PARTY', 'PROMISE_TO_PAY', 'REFUSED_TO_PAY', 'DISPUTE_RAISED', 'COMPLAINT_LODGED', 'VISITED_ADDRESS', 'PAYMENT_MADE', 'PARTIAL_PAYMENT'] as const;

const listSchema = pageQuerySchema.extend({
  bucket: z.enum(BUCKET_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  assignedToId: z.string().optional(),
  branchId: z.string().optional(),
});

const assignCaseSchema = z.object({ assignedToId: z.string().min(1) });

const logActivitySchema = z.object({
  channel: z.enum(CHANNEL_VALUES),
  outcome: z.enum(OUTCOME_VALUES),
  notes: z.string().trim().max(2000).optional(),
  nextActionAt: z.string().datetime().optional(),
  nextActionNote: z.string().trim().max(500).optional(),
  durationSecs: z.number().int().min(0).optional(),
  isFieldVisit: z.boolean().default(false),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const createPtpSchema = z.object({
  amountKobo: z.number().int().positive(),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO date format YYYY-MM-DD'),
});

const settlementSchema = z.object({
  offerAmountKobo: z.number().int().positive(),
  waivedAmountKobo: z.number().int().min(0),
  reason: z.string().trim().min(5).max(500),
});

const agencyAssignmentSchema = z.object({
  agencyId: z.string().min(1),
  reason: z.string().trim().min(5).max(500),
});

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function dpdToBucket(dpd: number): (typeof BUCKET_VALUES)[number] {
  if (dpd <= 7) return 'DPD_1_7';
  if (dpd <= 30) return 'DPD_8_30';
  if (dpd <= 60) return 'DPD_31_60';
  if (dpd <= 90) return 'DPD_61_90';
  return 'DPD_90_PLUS';
}

/* ─── CollectionsService ──────────────────────────────────────────────────── */

@Injectable()
export class CollectionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly registry: ApprovalRegistry,
    private readonly customerPii: CustomerPii,
  ) {}

  onModuleInit(): void {
    const settlementHandler: ApprovalHandler = {
      type: 'SETTLEMENT_OFFER',
      submitPermission: 'collections:update',
      validate: (p) => {
        const r = z.object({
          caseId: z.string().min(1),
          loanId: z.string().min(1),
          customerId: z.string().min(1),
          offerAmountKobo: z.number().int().positive(),
          waivedAmountKobo: z.number().int().min(0),
        }).safeParse(p);
        if (!r.success) throw new BadRequestException('Invalid SETTLEMENT_OFFER payload');
        return r.data;
      },
      execute: async (req, tx, approver) => {
        const p = req.payload as { caseId: string; loanId: string; customerId: string; offerAmountKobo: number; waivedAmountKobo: number };
        const offer = await tx.settlementOffer.create({
          data: {
            loanId: p.loanId,
            customerId: p.customerId,
            offerType: 'WRITE_OFF_PARTIAL',
            originalAmountKobo: BigInt(p.offerAmountKobo + p.waivedAmountKobo),
            settledAmountKobo: BigInt(p.offerAmountKobo),
            waivedKobo: BigInt(p.waivedAmountKobo),
            terms: { approvalId: req.id, caseId: p.caseId },
            approvalRequestId: req.id,
            executedById: approver.id,
          },
        });
        await tx.collectionCase.update({
          where: { id: p.caseId },
          data: { status: 'SETTLED', closedAt: new Date(), closedReason: `Settlement approved (approval ${req.id})` },
        });
        await this.audit.record({
          action: 'collection.settlement_executed',
          resourceType: 'CollectionCase',
          resourceId: p.caseId,
          after: { status: 'SETTLED', settlementOfferId: offer.id, approvalId: req.id },
        }, tx);
        return { caseId: p.caseId, settlementOfferId: offer.id };
      },
    };

    const agencyHandler: ApprovalHandler = {
      type: 'AGENCY_ASSIGNMENT',
      submitPermission: 'collections:escalate',
      validate: (p) => {
        const r = z.object({
          caseId: z.string().min(1),
          agencyId: z.string().min(1),
          commissionBps: z.number().int().min(0),
        }).safeParse(p);
        if (!r.success) throw new BadRequestException('Invalid AGENCY_ASSIGNMENT payload');
        return r.data;
      },
      execute: async (req, tx, approver) => {
        const p = req.payload as { caseId: string; agencyId: string; commissionBps: number };
        const assignment = await tx.agencyAssignment.create({
          data: {
            caseId: p.caseId,
            agencyId: p.agencyId,
            assignedById: approver.id,
            commissionBps: p.commissionBps,
            status: 'ACTIVE',
          },
        });
        await tx.collectionCase.update({
          where: { id: p.caseId },
          data: { status: 'AGENCY', agencyId: p.agencyId },
        });
        await this.audit.record({
          action: 'collection.agency_assigned',
          resourceType: 'CollectionCase',
          resourceId: p.caseId,
          after: { status: 'AGENCY', agencyId: p.agencyId, assignmentId: assignment.id, approvalId: req.id },
        }, tx);
        return { caseId: p.caseId, agencyId: p.agencyId, assignmentId: assignment.id };
      },
    };

    this.registry.register(settlementHandler);
    this.registry.register(agencyHandler);
  }

  /* ─── list ─────────────────────────────────────────────────────────────── */
  async list(user: AuthUser, q: z.infer<typeof listSchema>): Promise<Page<Record<string, unknown>>> {
    const { page, pageSize, bucket, status, assignedToId, branchId } = q;
    const bWhere = branchWhere(user);
    const where: Prisma.CollectionCaseWhereInput = {
      ...bWhere,
      ...(bucket && { bucket: bucket as never }),
      ...(status && { status: status as never }),
      ...(assignedToId && { assignedToId }),
      ...(branchId && !bWhere['branchId'] && { branchId }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.collectionCase.count({ where }),
      this.prisma.collectionCase.findMany({
        where,
        ...skipTake(page, pageSize),
        orderBy: [{ priority: 'desc' }, { dpd: 'desc' }, { createdAt: 'asc' }],
        include: {
          customer: { select: { firstName: true, lastName: true, phoneEnc: true } },
          loan: { select: { reference: true, product: { select: { name: true } } } },
          activities: {
            orderBy: { contactedAt: 'desc' },
            take: 1,
            select: { contactedAt: true, nextActionAt: true },
          },
          promisesToPay: {
            where: { status: { in: ['PENDING', 'PARTIAL'] } },
            select: { amountKobo: true },
          },
        },
      }),
    ]);

    const items = rows.map((r) => this.toCaseDto(r));
    return paged(items, total, page, pageSize);
  }

  /* ─── getCase ──────────────────────────────────────────────────────────── */
  async getCase(user: AuthUser, caseId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.collectionCase.findUnique({
      where: { id: caseId },
      include: {
        customer: { select: { firstName: true, lastName: true, phoneEnc: true } },
        loan: { select: { reference: true, product: { select: { name: true } } } },
        activities: { orderBy: { contactedAt: 'desc' } },
        promisesToPay: { orderBy: { createdAt: 'desc' } },
        agencyAssignments: {
          include: { agency: { select: { name: true } } },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Collection case not found');
    return this.toCaseDetailDto(row);
  }

  /* ─── assignAgent ──────────────────────────────────────────────────────── */
  async assignAgent(user: AuthUser, caseId: string, dto: z.infer<typeof assignCaseSchema>): Promise<void> {
    const existing = await this.prisma.collectionCase.findUnique({ where: { id: caseId }, select: { assignedToId: true, assignedToName: true } });
    if (!existing) throw new NotFoundException('Collection case not found');

    const agent = await this.prisma.staffUser.findUnique({ where: { id: dto.assignedToId }, select: { id: true, fullName: true } });
    if (!agent) throw new BadRequestException({ message: 'Agent not found', code: 'AGENT_NOT_FOUND' });

    await this.prisma.collectionCase.update({
      where: { id: caseId },
      data: { assignedToId: dto.assignedToId, assignedToName: agent.fullName, status: 'IN_PROGRESS' },
    });

    await this.audit.record({
      action: 'collection.agent_assigned',
      resourceType: 'CollectionCase',
      resourceId: caseId,
      before: { assignedToId: existing.assignedToId, assignedToName: existing.assignedToName },
      after: { assignedToId: dto.assignedToId, assignedToName: agent.fullName },
    });
  }

  /* ─── logActivity ──────────────────────────────────────────────────────── */
  async logActivity(user: AuthUser, caseId: string, dto: z.infer<typeof logActivitySchema>): Promise<Record<string, unknown>> {
    const existingCase = await this.prisma.collectionCase.findUnique({ where: { id: caseId }, select: { id: true, status: true } });
    if (!existingCase) throw new NotFoundException('Collection case not found');

    const activity = await this.prisma.$transaction(async (tx) => {
      const act = await tx.collectionActivity.create({
        data: {
          caseId,
          agentId: user.id,
          agentName: user.fullName,
          channel: dto.channel as never,
          outcome: dto.outcome as never,
          notes: dto.notes ?? null,
          nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null,
          nextActionNote: dto.nextActionNote ?? null,
          durationSecs: dto.durationSecs ?? null,
          isFieldVisit: dto.isFieldVisit,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
        },
      });

      const statusUpdates: Partial<{ status: string }> = {};
      if (dto.outcome === 'PROMISE_TO_PAY' && existingCase.status === 'OPEN') {
        statusUpdates.status = 'IN_PROGRESS';
      }

      if (existingCase.status === 'OPEN' || existingCase.status === 'IN_PROGRESS') {
        await tx.collectionCase.update({
          where: { id: caseId },
          data: { ...(statusUpdates as Prisma.CollectionCaseUpdateInput) },
        });
      }

      await this.audit.record({
        action: 'collection.activity_logged',
        resourceType: 'CollectionCase',
        resourceId: caseId,
        after: { activityId: act.id, channel: act.channel, outcome: act.outcome },
      }, tx);

      return act;
    });

    return {
      id: activity.id,
      caseId: activity.caseId,
      agentId: activity.agentId,
      agentName: activity.agentName,
      channel: activity.channel,
      outcome: activity.outcome,
      notes: activity.notes,
      contactedAt: activity.contactedAt.toISOString(),
      nextActionAt: activity.nextActionAt?.toISOString() ?? null,
      nextActionNote: activity.nextActionNote,
      durationSecs: activity.durationSecs,
      isFieldVisit: activity.isFieldVisit,
    };
  }

  /* ─── createPtp ─────────────────────────────────────────────────────────── */
  async createPtp(user: AuthUser, caseId: string, dto: z.infer<typeof createPtpSchema>): Promise<Record<string, unknown>> {
    const existingCase = await this.prisma.collectionCase.findUnique({ where: { id: caseId }, select: { id: true, customerId: true, status: true } });
    if (!existingCase) throw new NotFoundException('Collection case not found');

    const ptp = await this.prisma.$transaction(async (tx) => {
      // Supersede any pending PTPs for this case
      await tx.promiseToPay.updateMany({
        where: { caseId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });

      const p = await tx.promiseToPay.create({
        data: {
          caseId,
          customerId: existingCase.customerId,
          amountKobo: BigInt(dto.amountKobo),
          promisedDate: new Date(dto.promisedDate),
          status: 'PENDING',
        },
      });

      await tx.collectionCase.update({
        where: { id: caseId },
        data: { status: 'PROMISE_TO_PAY' },
      });

      await this.audit.record({
        action: 'collection.ptp_created',
        resourceType: 'CollectionCase',
        resourceId: caseId,
        after: { ptpId: p.id, amountKobo: n(p.amountKobo), promisedDate: p.promisedDate.toISOString() },
      }, tx);

      return p;
    });

    return this.toPtpDto(ptp);
  }

  /* ─── submitSettlement ──────────────────────────────────────────────────── */
  async submitSettlement(user: AuthUser, caseId: string, dto: z.infer<typeof settlementSchema>): Promise<{ approvalId: string }> {
    const existingCase = await this.prisma.collectionCase.findUnique({
      where: { id: caseId },
      select: { id: true, loanId: true, customerId: true, status: true },
    });
    if (!existingCase) throw new NotFoundException('Collection case not found');

    const approval = await this.approvals.submit(user, {
      type: 'SETTLEMENT_OFFER',
      summary: `Settlement offer for case ${caseId}: offer ${dto.offerAmountKobo} kobo, waiver ${dto.waivedAmountKobo} kobo`,
      reason: dto.reason,
      amountKobo: dto.waivedAmountKobo,
      payload: {
        caseId,
        loanId: existingCase.loanId,
        customerId: existingCase.customerId,
        offerAmountKobo: dto.offerAmountKobo,
        waivedAmountKobo: dto.waivedAmountKobo,
      },
    });

    await this.audit.record({
      action: 'collection.settlement_submitted',
      resourceType: 'CollectionCase',
      resourceId: caseId,
      after: { approvalId: approval.id, offerAmountKobo: dto.offerAmountKobo, waivedAmountKobo: dto.waivedAmountKobo },
    });

    return { approvalId: approval.id };
  }

  /* ─── submitAgencyAssignment ────────────────────────────────────────────── */
  async submitAgencyAssignment(user: AuthUser, caseId: string, dto: z.infer<typeof agencyAssignmentSchema>): Promise<{ approvalId: string }> {
    const existingCase = await this.prisma.collectionCase.findUnique({ where: { id: caseId }, select: { id: true, status: true } });
    if (!existingCase) throw new NotFoundException('Collection case not found');

    const agency = await this.prisma.thirdPartyAgency.findUnique({ where: { id: dto.agencyId }, select: { id: true, name: true, commissionBps: true, isActive: true } });
    if (!agency) throw new NotFoundException('Agency not found');
    if (!agency.isActive) throw new BadRequestException({ message: 'Agency is not active', code: 'AGENCY_INACTIVE' });

    const approval = await this.approvals.submit(user, {
      type: 'AGENCY_ASSIGNMENT',
      summary: `Assign case ${caseId} to agency ${agency.name}`,
      reason: dto.reason,
      payload: {
        caseId,
        agencyId: dto.agencyId,
        commissionBps: agency.commissionBps,
      },
    });

    await this.audit.record({
      action: 'collection.agency_assignment_submitted',
      resourceType: 'CollectionCase',
      resourceId: caseId,
      after: { approvalId: approval.id, agencyId: dto.agencyId, agencyName: agency.name },
    });

    return { approvalId: approval.id };
  }

  /* ─── listAgencies ──────────────────────────────────────────────────────── */
  async listAgencies(): Promise<Record<string, unknown>[]> {
    const agencies = await this.prisma.thirdPartyAgency.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return agencies.map((a) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      commissionBps: a.commissionBps,
      isActive: a.isActive,
    }));
  }

  /* ─── summary ───────────────────────────────────────────────────────────── */
  async summary(user: AuthUser): Promise<Record<string, unknown>> {
    const bWhere = branchWhere(user);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [total, allCases, recentPtps, recentActivities, recentlyClosed] = await Promise.all([
      this.prisma.collectionCase.count({ where: bWhere }),
      this.prisma.collectionCase.groupBy({
        by: ['bucket', 'status'],
        where: bWhere,
        _count: { id: true },
        _sum: { totalOutstandingKobo: true },
        _avg: { dpd: true },
      }),
      this.prisma.promiseToPay.findMany({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          case: bWhere,
        },
        select: { status: true },
      }),
      this.prisma.collectionActivity.findMany({
        where: {
          contactedAt: { gte: thirtyDaysAgo },
          agentId: { not: null },
          case: bWhere,
        },
        select: { agentId: true, agentName: true, caseId: true, outcome: true },
      }),
      this.prisma.collectionCase.count({
        where: {
          ...bWhere,
          status: { in: ['CLOSED', 'SETTLED'] },
          closedAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const openCases30dAgo = await this.prisma.collectionCase.count({
      where: {
        ...bWhere,
        createdAt: { lt: thirtyDaysAgo },
        OR: [
          { closedAt: { gte: thirtyDaysAgo } },
          { closedAt: null, status: { notIn: ['CLOSED', 'SETTLED', 'WRITTEN_OFF'] } },
        ],
      },
    });

    const byBucket: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalOutstandingKobo = 0;
    let totalDpd = 0;
    let dpdCount = 0;

    for (const g of allCases) {
      const bucket = g.bucket as string;
      const status = g.status as string;
      const cnt = g._count.id;
      byBucket[bucket] = (byBucket[bucket] ?? 0) + cnt;
      byStatus[status] = (byStatus[status] ?? 0) + cnt;
      totalOutstandingKobo += n(g._sum.totalOutstandingKobo) ?? 0;
      if (g._avg.dpd !== null) {
        totalDpd += g._avg.dpd * cnt;
        dpdCount += cnt;
      }
    }

    const ptpBroken = recentPtps.filter((p) => p.status === 'BROKEN').length;
    const ptpTotal = recentPtps.length;
    const ptpBreakRate = ptpTotal > 0 ? ptpBroken / ptpTotal : 0;
    const cureRate30d = openCases30dAgo > 0 ? recentlyClosed / openCases30dAgo : 0;

    const agentMap = new Map<string, { agentId: string; agentName: string; casesSet: Set<string>; ptpKept: number; ptpBroken: number; amountRecoveredKobo: number }>();
    for (const act of recentActivities) {
      if (!act.agentId) continue;
      if (!agentMap.has(act.agentId)) {
        agentMap.set(act.agentId, { agentId: act.agentId, agentName: act.agentName, casesSet: new Set(), ptpKept: 0, ptpBroken: 0, amountRecoveredKobo: 0 });
      }
      const entry = agentMap.get(act.agentId)!;
      entry.casesSet.add(act.caseId);
      if (act.outcome === 'PAYMENT_MADE') entry.ptpKept++;
      if (act.outcome === 'REFUSED_TO_PAY') entry.ptpBroken++;
    }

    const agentLeaderboard = [...agentMap.values()].map((e) => ({
      agentId: e.agentId,
      agentName: e.agentName,
      casesHandled: e.casesSet.size,
      ptpKept: e.ptpKept,
      ptpBroken: e.ptpBroken,
      amountRecoveredKobo: e.amountRecoveredKobo,
    })).sort((a, b) => b.casesHandled - a.casesHandled);

    return {
      total,
      byBucket,
      byStatus,
      totalOutstandingKobo,
      avgDpd: dpdCount > 0 ? Math.round(totalDpd / dpdCount) : 0,
      ptpBreakRate,
      cureRate30d,
      agentLeaderboard,
    };
  }

  /* ─── updateDelinquencyBuckets ──────────────────────────────────────────── */
  async updateDelinquencyBuckets(): Promise<void> {
    const now = new Date();

    const UnpaidLoans = await this.prisma.loan.findMany({
      where: {
        status: { in: ['DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED'] },
        OR: [
          { dpd: { gt: 0 } },
          { maturityDate: { lt: now } },
        ],
      },
      select: { id: true, customerId: true, branchId: true, dpd: true, maturityDate: true, disbursedAt: true, tenorMonths: true, outstandingPrincipalKobo: true, status: true },
    });

    for (const loan of UnpaidLoans) {
      let dpd = loan.dpd;
      if (dpd === 0 && loan.maturityDate < now) {
        dpd = Math.max(1, Math.floor((now.getTime() - loan.maturityDate.getTime()) / (1000 * 60 * 60 * 24)));
      }
      if (dpd === 0) continue;

      const bucket = dpdToBucket(dpd);

      const existingCase = await this.prisma.collectionCase.findFirst({
        where: { loanId: loan.id, status: { notIn: ['CLOSED', 'SETTLED', 'WRITTEN_OFF'] } },
        select: { id: true, bucket: true, dpd: true },
      });

      if (existingCase) {
        await this.prisma.collectionCase.update({
          where: { id: existingCase.id },
          data: {
            dpd,
            bucket: bucket as never,
            totalOutstandingKobo: loan.outstandingPrincipalKobo,
          },
        });
      } else {
        await this.prisma.collectionCase.create({
          data: {
            loanId: loan.id,
            customerId: loan.customerId,
            branchId: loan.branchId ?? null,
            bucket: bucket as never,
            dpd,
            status: 'OPEN',
            priority: Math.min(100, dpd),
            totalOutstandingKobo: loan.outstandingPrincipalKobo,
          },
        });
      }
    }
  }

  /* ─── private DTO mappers ────────────────────────────────────────────────── */

  private toCaseDto(r: {
    id: string;
    loanId: string;
    customerId: string;
    branchId: string | null;
    assignedToId: string | null;
    assignedToName: string | null;
    bucket: string;
    dpd: number;
    status: string;
    priority: number;
    totalOutstandingKobo: bigint;
    agencyId: string | null;
    legalCaseRef: string | null;
    createdAt: Date;
    updatedAt: Date;
    customer: { firstName: string; lastName: string; phoneEnc: string };
    loan: { reference: string; product: { name: string } };
    activities: { contactedAt: Date; nextActionAt: Date | null }[];
    promisesToPay: { amountKobo: bigint }[];
  }): Record<string, unknown> {
    const rawPhone = this.customerPii.dec(r.customerId, 'phone', r.customer.phoneEnc);
    const lastActivity = r.activities[0] ?? null;
    const openPtpAmount = r.promisesToPay.reduce((sum, p) => sum + Number(p.amountKobo), 0);

    return {
      id: r.id,
      loanId: r.loanId,
      customerId: r.customerId,
      customerName: maskName(`${r.customer.firstName} ${r.customer.lastName}`),
      customerPhone: maskPhone(rawPhone),
      branchId: r.branchId,
      assignedToId: r.assignedToId,
      assignedToName: r.assignedToName,
      bucket: r.bucket,
      dpd: r.dpd,
      status: r.status,
      priority: r.priority,
      totalOutstandingKobo: n(r.totalOutstandingKobo),
      loanReference: r.loan.reference,
      productName: r.loan.product.name,
      agencyId: r.agencyId,
      legalCaseRef: r.legalCaseRef,
      lastActivityAt: lastActivity?.contactedAt.toISOString() ?? null,
      nextActionAt: lastActivity?.nextActionAt?.toISOString() ?? null,
      promiseCount: r.promisesToPay.length,
      openPtpAmount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toCaseDetailDto(r: {
    id: string;
    loanId: string;
    customerId: string;
    branchId: string | null;
    assignedToId: string | null;
    assignedToName: string | null;
    bucket: string;
    dpd: number;
    status: string;
    priority: number;
    totalOutstandingKobo: bigint;
    agencyId: string | null;
    legalCaseRef: string | null;
    createdAt: Date;
    updatedAt: Date;
    customer: { firstName: string; lastName: string; phoneEnc: string };
    loan: { reference: string; product: { name: string } };
    activities: Array<{
      id: string;
      caseId: string;
      agentId: string | null;
      agentName: string;
      channel: string;
      outcome: string;
      notes: string | null;
      contactedAt: Date;
      nextActionAt: Date | null;
      nextActionNote: string | null;
      durationSecs: number | null;
      isFieldVisit: boolean;
    }>;
    promisesToPay: Array<{
      id: string;
      caseId: string;
      customerId: string;
      amountKobo: bigint;
      promisedDate: Date;
      status: string;
      brokenAt: Date | null;
      keptAt: Date | null;
      createdAt: Date;
    }>;
    agencyAssignments: Array<{
      id: string;
      caseId: string;
      agencyId: string;
      commissionBps: number;
      status: string;
      settledAt: Date | null;
      recoveredKobo: bigint;
      assignedAt: Date;
      agency: { name: string };
    }>;
  }): Record<string, unknown> {
    const rawPhone = this.customerPii.dec(r.customerId, 'phone', r.customer.phoneEnc);
    const lastActivity = r.activities[0] ?? null;
    const openPtps = r.promisesToPay.filter((p) => p.status === 'PENDING' || p.status === 'PARTIAL');
    const openPtpAmount = openPtps.reduce((sum, p) => sum + Number(p.amountKobo), 0);

    return {
      id: r.id,
      loanId: r.loanId,
      customerId: r.customerId,
      customerName: maskName(`${r.customer.firstName} ${r.customer.lastName}`),
      customerPhone: maskPhone(rawPhone),
      branchId: r.branchId,
      assignedToId: r.assignedToId,
      assignedToName: r.assignedToName,
      bucket: r.bucket,
      dpd: r.dpd,
      status: r.status,
      priority: r.priority,
      totalOutstandingKobo: n(r.totalOutstandingKobo),
      loanReference: r.loan.reference,
      productName: r.loan.product.name,
      agencyId: r.agencyId,
      legalCaseRef: r.legalCaseRef,
      lastActivityAt: lastActivity?.contactedAt.toISOString() ?? null,
      nextActionAt: lastActivity?.nextActionAt?.toISOString() ?? null,
      promiseCount: openPtps.length,
      openPtpAmount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      activities: r.activities.map((a) => ({
        id: a.id,
        caseId: a.caseId,
        agentId: a.agentId,
        agentName: a.agentName,
        channel: a.channel,
        outcome: a.outcome,
        notes: a.notes,
        contactedAt: a.contactedAt.toISOString(),
        nextActionAt: a.nextActionAt?.toISOString() ?? null,
        nextActionNote: a.nextActionNote,
        durationSecs: a.durationSecs,
        isFieldVisit: a.isFieldVisit,
      })),
      promisesToPay: r.promisesToPay.map((p) => this.toPtpDto(p)),
      agencyAssignments: r.agencyAssignments.map((a) => ({
        id: a.id,
        caseId: a.caseId,
        agencyId: a.agencyId,
        agencyName: a.agency.name,
        commissionBps: a.commissionBps,
        status: a.status,
        settledAt: a.settledAt?.toISOString() ?? null,
        recoveredKobo: n(a.recoveredKobo),
        assignedAt: a.assignedAt.toISOString(),
      })),
    };
  }

  private toPtpDto(p: {
    id: string;
    caseId: string;
    customerId: string;
    amountKobo: bigint;
    promisedDate: Date;
    status: string;
    brokenAt: Date | null;
    keptAt: Date | null;
    createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: p.id,
      caseId: p.caseId,
      customerId: p.customerId,
      amountKobo: n(p.amountKobo),
      promisedDate: p.promisedDate.toISOString().split('T')[0],
      status: p.status,
      keepRate: null,
      brokenAt: p.brokenAt?.toISOString() ?? null,
      keptAt: p.keptAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  }
}

/* ─── CollectionsController ───────────────────────────────────────────────── */

@Controller('collections')
export class CollectionsController {
  constructor(private readonly svc: CollectionsService) {}

  @Get()
  @RequirePermission('collections:read')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>,
  ) {
    return this.svc.list(user, q);
  }

  @Get('summary')
  @RequirePermission('collections:read')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.summary(user);
  }

  @Get('agencies')
  @RequirePermission('collections:read')
  listAgencies() {
    return this.svc.listAgencies();
  }

  @Get('cases/:caseId')
  @RequirePermission('collections:read')
  getCase(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.svc.getCase(user, caseId);
  }

  @Patch('cases/:caseId/assign')
  @HttpCode(200)
  @RequirePermission('collections:assign')
  assignAgent(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodPipe(assignCaseSchema)) body: z.infer<typeof assignCaseSchema>,
  ) {
    return this.svc.assignAgent(user, caseId, body);
  }

  @Post('cases/:caseId/activities')
  @RequirePermission('collections:update')
  logActivity(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodPipe(logActivitySchema)) body: z.infer<typeof logActivitySchema>,
  ) {
    return this.svc.logActivity(user, caseId, body);
  }

  @Post('cases/:caseId/ptp')
  @RequirePermission('collections:update')
  createPtp(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodPipe(createPtpSchema)) body: z.infer<typeof createPtpSchema>,
  ) {
    return this.svc.createPtp(user, caseId, body);
  }

  @Post('cases/:caseId/settlement')
  @RequirePermission('collections:update')
  submitSettlement(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodPipe(settlementSchema)) body: z.infer<typeof settlementSchema>,
  ) {
    return this.svc.submitSettlement(user, caseId, body);
  }

  @Post('cases/:caseId/agency')
  @RequirePermission('collections:escalate')
  submitAgencyAssignment(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body(new ZodPipe(agencyAssignmentSchema)) body: z.infer<typeof agencyAssignmentSchema>,
  ) {
    return this.svc.submitAgencyAssignment(user, caseId, body);
  }
}

/* ─── CollectionsModule ───────────────────────────────────────────────────── */

@Module({
  imports: [PrismaModule, AuditModule, ApprovalsModule],
  providers: [
    CustomerPii,
    CollectionsService,
  ],
  controllers: [CollectionsController],
  exports: [CollectionsService],
})
export class CollectionsModule {}
