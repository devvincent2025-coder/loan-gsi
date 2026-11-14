import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPROVAL_ACTION_TYPES, APPROVAL_TYPE_META, ApprovalActionType, ApprovalDto, ApprovalTypeDto, formatNaira, Page,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, branchWhere, canSeeBranch } from '../common/auth-user';
import { n } from '../common/bigint';
import { paged } from '../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ApprovalRegistry } from './approval-registry';
import { loanApprovalHandler, productRateHandler, roleChangeHandler, stubHandler } from './builtin-handlers';

const OPEN = ['PENDING', 'ESCALATED'] as const;
const CORE_TYPES: ApprovalActionType[] = ['ROLE_CHANGE', 'PRODUCT_RATE_CHANGE', 'WRITE_OFF'];

type Row = Prisma.ApprovalRequestGetPayload<{ include: { maker: { include: { role: true; branch: true } }; steps: { include: { approver: { include: { role: true } } } } } }>;
const include = { maker: { include: { role: true, branch: true } }, steps: { include: { approver: { include: { role: true } } }, orderBy: { createdAt: 'asc' } } } satisfies Prisma.ApprovalRequestInclude;

export interface SubmitInput {
  type: ApprovalActionType;
  summary: string;
  reason?: string;
  amountKobo?: number | bigint | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class ApprovalsService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private registry: ApprovalRegistry,
    private notify: NotificationsService,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  onModuleInit(): void {
    this.registry.register(roleChangeHandler(this.audit, this.notify, (uid, tx) => this.auth.revokeAllForUser(uid, 'role_changed', tx)));
    this.registry.register(productRateHandler(this.audit));
    this.registry.register(loanApprovalHandler(this.audit, this.notify));
    this.registry.register(stubHandler('WRITE_OFF', 'loan:writeoff', 'Collections'));
    this.registry.register(stubHandler('RESTRUCTURE', 'loan:restructure', 'Loans'));
    this.registry.register(stubHandler('MANUAL_DISBURSEMENT', 'loan:disburse_manual', 'Disbursement'));
    this.registry.register(stubHandler('WAIVER', 'loan:waive', 'Collections'));
  }

  /* ───── policy ───── */
  async types(): Promise<ApprovalTypeDto[]> {
    const policies = new Map((await this.prisma.approvalPolicy.findMany()).map((p) => [p.type, p]));
    return APPROVAL_ACTION_TYPES.map((t) => {
      const m = APPROVAL_TYPE_META[t];
      const pol = policies.get(t);
      return {
        type: t, label: m.label, description: m.description, approvePermission: m.approvePermission, hasAmount: m.hasAmount,
        thresholdKobo: Number(pol?.thresholdKobo ?? BigInt(m.defaultThresholdKobo)), enabled: pol?.enabled ?? true,
      };
    });
  }

  /** For modules: does this action need four-eyes approval right now? */
  async requiresApproval(type: ApprovalActionType, amountKobo?: number | bigint | null): Promise<boolean> {
    const pol = await this.prisma.approvalPolicy.findUnique({ where: { type } });
    if (pol && !pol.enabled && !CORE_TYPES.includes(type)) return false;
    const threshold = pol?.thresholdKobo ?? BigInt(APPROVAL_TYPE_META[type].defaultThresholdKobo);
    return BigInt(amountKobo ?? 0) >= threshold;
  }

  async setPolicy(type: ApprovalActionType, thresholdKobo: number, enabled: boolean): Promise<ApprovalTypeDto> {
    if (!enabled && CORE_TYPES.includes(type)) throw new BadRequestException({ message: `${APPROVAL_TYPE_META[type].label} approvals cannot be disabled`, code: 'POLICY_LOCKED' });
    const before = await this.prisma.approvalPolicy.findUnique({ where: { type } });
    const p = await this.prisma.approvalPolicy.upsert({ where: { type }, create: { type, thresholdKobo: BigInt(thresholdKobo), enabled }, update: { thresholdKobo: BigInt(thresholdKobo), enabled } });
    await this.audit.record({
      action: 'approval.policy_changed', resourceType: 'ApprovalPolicy', resourceId: type,
      before: before ? { thresholdKobo: Number(before.thresholdKobo), enabled: before.enabled } : null, after: { thresholdKobo: Number(p.thresholdKobo), enabled: p.enabled },
    });
    return (await this.types()).find((t) => t.type === type)!;
  }

  /* ───── submit ───── */
  async submit(maker: AuthUser, input: SubmitInput): Promise<ApprovalDto> {
    const meta = APPROVAL_TYPE_META[input.type];
    const handler = this.registry.get(input.type);
    if (!handler) throw new BadRequestException(`No handler registered for ${input.type}`);
    if (!maker.permissions.has(handler.submitPermission)) {
      throw new ForbiddenException({ message: `You need ${handler.submitPermission} to submit a ${meta.label.toLowerCase()}`, code: 'FORBIDDEN' });
    }
    const amount = input.amountKobo === undefined || input.amountKobo === null ? null : BigInt(input.amountKobo);
    if (meta.hasAmount && (amount === null || amount <= 0n)) throw new BadRequestException({ message: 'An amount greater than zero is required', code: 'VALIDATION_FAILED', errors: { amountKobo: ['Required'] } });
    const payload = await handler.validate(input.payload ?? {}, amount);

    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.approvalRequest.create({
        data: { type: input.type, summary: input.summary, reason: input.reason ?? null, amountKobo: amount, payload: payload as Prisma.InputJsonValue, makerId: maker.id, branchId: maker.branchId },
        include,
      });
      await this.audit.record({ action: 'approval.submitted', resourceType: 'ApprovalRequest', resourceId: r.id, after: { type: r.type, summary: r.summary, amountKobo: n(r.amountKobo) } }, tx);
      return r;
    });
    await this.notifyApprovers(row, 'New approval request', `${maker.fullName} requested: ${row.summary}${amount !== null ? ` (${formatNaira(amount)})` : ''}`);
    return this.toDto(row, maker, await this.limitsFor(maker.roleId));
  }

  /* ───── queries ───── */
  private async limitsFor(roleId: string): Promise<Map<string, bigint | null>> {
    const rows = await this.prisma.roleApprovalLimit.findMany({ where: { roleId } });
    return new Map(rows.map((r) => [r.actionType, r.maxAmountKobo]));
  }

  async get(user: AuthUser, id: string): Promise<ApprovalDto> {
    const row = await this.prisma.approvalRequest.findUnique({ where: { id }, include });
    if (!row || !this.visible(user, row)) throw new NotFoundException('Approval request not found');
    return this.toDto(row, user, await this.limitsFor(user.roleId));
  }

  private visible(user: AuthUser, row: { makerId: string; branchId: string | null }): boolean {
    return row.makerId === user.id || canSeeBranch(user, row.branchId);
  }

  async list(user: AuthUser, q: { scope: 'pending_mine' | 'submitted_by_me' | 'all'; status?: string[]; type?: string; page: number; pageSize: number }): Promise<Page<ApprovalDto>> {
    const where: Prisma.ApprovalRequestWhereInput = {};
    const and: Prisma.ApprovalRequestWhereInput[] = [];
    if (q.type) and.push({ type: q.type });
    if (q.status?.length) and.push({ status: { in: q.status as Row['status'][] } });
    const limits = await this.limitsFor(user.roleId);

    if (q.scope === 'submitted_by_me') and.push({ makerId: user.id });
    else {
      const scope = branchWhere(user);
      if (scope.branchId) and.push({ OR: [{ makerId: user.id }, { branchId: scope.branchId as string }] });
    }
    if (q.scope === 'pending_mine') {
      const approvable = APPROVAL_ACTION_TYPES.filter((t) => user.permissions.has(APPROVAL_TYPE_META[t].approvePermission));
      and.push({ status: { in: [...OPEN] }, makerId: { not: user.id }, type: { in: approvable }, steps: { none: { approverId: user.id } } });
    }
    where.AND = and;
    const all = await this.prisma.approvalRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 500 });
    let rows = all;
    if (q.scope === 'pending_mine') rows = all.filter((r) => this.canDecide(user, r, limits).ok);
    const total = rows.length;
    const slice = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return paged(slice.map((r) => this.toDto(r, user, limits)), total, q.page, q.pageSize);
  }

  async pendingCount(user: AuthUser): Promise<number> {
    return (await this.list(user, { scope: 'pending_mine', page: 1, pageSize: 1 })).total;
  }

  /* ───── rules ───── */
  canDecide(user: AuthUser, r: Row, limits: Map<string, bigint | null>): { ok: boolean; reason: string | null } {
    const meta = APPROVAL_TYPE_META[r.type as ApprovalActionType];
    if (!OPEN.includes(r.status as 'PENDING')) return { ok: false, reason: `Request is already ${r.status.toLowerCase()}` };
    if (r.makerId === user.id) return { ok: false, reason: 'Four-eyes rule: you cannot approve your own request' };
    if (!user.permissions.has('approval:decide')) return { ok: false, reason: 'You need the approval:decide permission' };
    if (!user.permissions.has(meta.approvePermission)) return { ok: false, reason: `You need the ${meta.approvePermission} permission` };
    if (!canSeeBranch(user, r.branchId)) return { ok: false, reason: 'This request belongs to another branch' };
    if (r.steps.some((s) => s.approverId === user.id)) return { ok: false, reason: 'You have already acted on this request' };
    if (meta.hasAmount) {
      if (!limits.has(r.type)) return { ok: false, reason: `Your role has no approval limit for ${meta.label.toLowerCase()}s` };
      const mine = limits.get(r.type) ?? null; // null = unlimited
      const prior = r.steps.filter((s) => s.decision !== 'REJECTED');
      if (mine !== null && prior.length) {
        const highest = prior.reduce<bigint>((m, s) => { const l = s.approverUnlimited ? BigInt(Number.MAX_SAFE_INTEGER) * 1000n : (s.approverLimitKobo ?? 0n); return l > m ? l : m; }, 0n);
        if (mine <= highest) return { ok: false, reason: `Needs an approver with a limit above ${formatNaira(highest)}` };
      }
    }
    return { ok: true, reason: null };
  }

  /* ───── decisions ───── */
  async approve(user: AuthUser, id: string, comment?: string): Promise<ApprovalDto> {
    const limits = await this.limitsFor(user.roleId);
    let failure: Error | null = null;
    let escalated = false;
    let finalRow: Row | null = null;

    try {
      finalRow = await this.prisma.$transaction(async (tx) => {
        const r = await tx.approvalRequest.findUnique({ where: { id }, include });
        if (!r || !this.visible(user, r)) throw new NotFoundException('Approval request not found');
        const chk = this.canDecide(user, r, limits);
        if (!chk.ok) throw new ForbiddenException({ message: chk.reason, code: 'CANNOT_DECIDE' });
        const meta = APPROVAL_TYPE_META[r.type as ApprovalActionType];
        const mine = meta.hasAmount ? (limits.get(r.type) ?? null) : null;
        const isFinal = !meta.hasAmount || mine === null || (r.amountKobo !== null && r.amountKobo <= mine);
        const stepBase = { requestId: id, approverId: user.id, approverRole: user.roleName, approverLimitKobo: mine, approverUnlimited: meta.hasAmount && mine === null, comment: comment ?? null };

        // claim the row (optimistic concurrency) so two checkers can't both execute it
        const claim = await tx.approvalRequest.updateMany({
          where: { id, status: { in: [...OPEN] }, updatedAt: r.updatedAt },
          data: isFinal ? { status: 'EXECUTED', decidedAt: new Date() } : { status: 'ESCALATED', escalationLevel: { increment: 1 } },
        });
        if (claim.count !== 1) throw new ConflictException('This request was just updated by someone else. Refresh and retry.');

        if (!isFinal) {
          await tx.approvalStep.create({ data: { ...stepBase, decision: 'ESCALATED' } });
          await this.audit.record({ action: 'approval.escalated', resourceType: 'ApprovalRequest', resourceId: id, before: { status: r.status }, after: { status: 'ESCALATED', approverLimitKobo: n(mine) }, metadata: { comment } }, tx);
          escalated = true;
        } else {
          await tx.approvalStep.create({ data: { ...stepBase, decision: 'APPROVED' } });
          const handler = this.registry.get(r.type as ApprovalActionType);
          if (!handler) throw new Error(`No handler for ${r.type}`);
          const result = await handler.execute(
            { id, type: r.type as ApprovalActionType, payload: r.payload as Record<string, unknown>, amountKobo: r.amountKobo, makerId: r.makerId, summary: r.summary, reason: r.reason ?? null }, tx, user,
          );
          await tx.approvalRequest.update({ where: { id }, data: { executionResult: (result ?? {}) as Prisma.InputJsonValue } });
          await this.audit.record({ action: 'approval.executed', resourceType: 'ApprovalRequest', resourceId: id, before: { status: r.status }, after: { status: 'EXECUTED', result }, metadata: { comment, type: r.type } }, tx);
        }
        return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include });
      });
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof NotFoundException || e instanceof ConflictException) throw e;
      failure = e as Error;
    }

    if (failure) {
      // execution handler failed: roll back happened; record the approval attempt as FAILED
      await this.prisma.approvalRequest.update({ where: { id }, data: { status: 'FAILED', decidedAt: new Date(), executionResult: { error: failure.message } } });
      await this.prisma.approvalStep.create({ data: { requestId: id, approverId: user.id, approverRole: user.roleName, decision: 'APPROVED', comment: comment ?? null } });
      await this.audit.record({ action: 'approval.failed', resourceType: 'ApprovalRequest', resourceId: id, outcome: 'FAILURE', metadata: { error: failure.message } });
      finalRow = await this.prisma.approvalRequest.findUniqueOrThrow({ where: { id }, include });
    }
    const row = finalRow!;
    if (escalated) await this.notifyApprovers(row, 'Approval escalated', `${row.summary} needs a higher approval authority`);
    await this.notify.notifyUsers([row.makerId], failure ? 'Approval failed' : escalated ? 'Request escalated' : 'Request approved', `${row.summary}${failure ? `: ${failure.message}` : escalated ? ' (awaiting higher authority)' : ''}`, `/approvals?open=${row.id}`);
    return this.toDto(row, user, limits);
  }

  async reject(user: AuthUser, id: string, comment?: string): Promise<ApprovalDto> {
    const limits = await this.limitsFor(user.roleId);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.approvalRequest.findUnique({ where: { id }, include });
      if (!r || !this.visible(user, r)) throw new NotFoundException('Approval request not found');
      const chk = this.canDecide(user, r, limits);
      if (!chk.ok) throw new ForbiddenException({ message: chk.reason, code: 'CANNOT_DECIDE' });
      const claim = await tx.approvalRequest.updateMany({ where: { id, status: { in: [...OPEN] }, updatedAt: r.updatedAt }, data: { status: 'REJECTED', decidedAt: new Date() } });
      if (claim.count !== 1) throw new ConflictException('This request was just updated by someone else. Refresh and retry.');
      await tx.approvalStep.create({ data: { requestId: id, approverId: user.id, approverRole: user.roleName, decision: 'REJECTED', comment: comment ?? null } });
      await this.audit.record({ action: 'approval.rejected', resourceType: 'ApprovalRequest', resourceId: id, before: { status: r.status }, after: { status: 'REJECTED' }, metadata: { comment } }, tx);
      return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include });
    });
    await this.notify.notifyUsers([row.makerId], 'Request rejected', `${row.summary}${comment ? `: ${comment}` : ''}`, `/approvals?open=${row.id}`);
    return this.toDto(row, user, limits);
  }

  async cancel(user: AuthUser, id: string): Promise<ApprovalDto> {
    const r = await this.prisma.approvalRequest.findUnique({ where: { id }, include });
    if (!r || !this.visible(user, r)) throw new NotFoundException('Approval request not found');
    if (r.makerId !== user.id) throw new ForbiddenException('Only the requester can cancel');
    if (!OPEN.includes(r.status as 'PENDING')) throw new BadRequestException('Request is no longer open');
    const row = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.approvalRequest.updateMany({ where: { id, status: { in: [...OPEN] } }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      if (claim.count !== 1) throw new ConflictException('Request changed; refresh');
      await this.audit.record({ action: 'approval.cancelled', resourceType: 'ApprovalRequest', resourceId: id, before: { status: r.status }, after: { status: 'CANCELLED' } }, tx);
      return tx.approvalRequest.findUniqueOrThrow({ where: { id }, include });
    });
    return this.toDto(row, user, await this.limitsFor(user.roleId));
  }

  /** Housekeeping: auto-cancel requests nobody decided within `days`. */
  async expireStale(days = 7): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86400_000);
    const stale = await this.prisma.approvalRequest.findMany({ where: { status: { in: [...OPEN] }, createdAt: { lt: cutoff } }, select: { id: true } });
    for (const s of stale) {
      await this.prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({ where: { id: s.id }, data: { status: 'CANCELLED', decidedAt: new Date(), executionResult: { reason: `Expired after ${days} days` } } });
        await this.audit.record({ actorId: null, actorName: 'System', action: 'approval.expired', resourceType: 'ApprovalRequest', resourceId: s.id }, tx);
      });
    }
    return stale.length;
  }

  /* ───── helpers ───── */
  private async notifyApprovers(r: Row, title: string, body: string): Promise<void> {
    const meta = APPROVAL_TYPE_META[r.type as ApprovalActionType];
    const prior = new Set(r.steps.map((s) => s.approverId));
    const users = await this.prisma.staffUser.findMany({
      where: {
        status: 'ACTIVE', id: { not: r.makerId },
        role: { AND: [{ permissions: { some: { permission: { key: meta.approvePermission } } } }, { permissions: { some: { permission: { key: 'approval:decide' } } } }] },
      },
      include: { role: true },
    });
    const ids = users.filter((u) => !prior.has(u.id) && (u.allBranches || !u.role.branchScoped || u.branchId === r.branchId)).map((u) => u.id);
    await this.notify.notifyUsers(ids, title, body, `/approvals?open=${r.id}`);
  }

  toDto(r: Row, user: AuthUser, limits: Map<string, bigint | null>): ApprovalDto {
    const meta = APPROVAL_TYPE_META[r.type as ApprovalActionType];
    const chk = this.canDecide(user, r, limits);
    return {
      id: r.id, type: r.type as ApprovalActionType, typeLabel: meta?.label ?? r.type, status: r.status, summary: r.summary, reason: r.reason,
      amountKobo: n(r.amountKobo), payload: r.payload as Record<string, unknown>,
      maker: { id: r.maker.id, name: r.maker.fullName, role: r.maker.role.name },
      branch: r.maker.branch ? { id: r.maker.branch.id, code: r.maker.branch.code, name: r.maker.branch.name } : null,
      createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, escalationLevel: r.escalationLevel,
      canDecide: chk.ok, cannotDecideReason: chk.ok ? null : chk.reason,
      steps: r.steps.map((s) => ({ id: s.id, approver: { id: s.approver.id, name: s.approver.fullName, role: s.approverRole }, decision: s.decision, comment: s.comment, createdAt: s.createdAt.toISOString() })),
      executionResult: r.executionResult,
    };
  }
}
