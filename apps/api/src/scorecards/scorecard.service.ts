import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApprovalDto, DEFAULT_SCORECARD_V1, ScorecardDefinition, ScorecardDto, ScorecardStatus } from '@damez/shared';
import { ApprovalHandler, ApprovalRegistry } from '../approvals/approval-registry';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { validateDefinition } from './scorecard-validation';

export const SCORECARD_KEY = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'lowercase letters, digits, - and _ (2-40 chars)');
export const scorecardCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  key: SCORECARD_KEY.optional(),
  fromId: z.string().min(1).optional(),
  definition: z.unknown().optional(),
  notes: z.string().max(2000).nullish(),
});
export const scorecardUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  definition: z.unknown(),
  notes: z.string().max(2000).nullish(),
});
export const activationRequestSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const activationPayload = z.object({ scorecardId: z.string().min(1), key: z.string().min(1), version: z.number().int().positive() }).passthrough();

const OPEN = ['PENDING', 'ESCALATED'] as const;
type Row = Prisma.ScorecardGetPayload<object>;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

@Injectable()
export class ScorecardService implements OnModuleInit {
  private readonly log = new Logger(ScorecardService.name);
  constructor(private prisma: PrismaService, private audit: AuditService, private registry: ApprovalRegistry, private approvals: ApprovalsService) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this.activationHandler());
    try { await this.seedDefault(); } catch (e) { this.log.error(`could not seed the default scorecard: ${(e as Error).message}`); }
  }

  /** Idempotent: only creates 'default' v1 when the key has no versions at all. */
  async seedDefault(): Promise<void> {
    if (await this.prisma.scorecard.findFirst({ where: { key: 'default' } })) return;
    try {
      const r = await this.prisma.scorecard.create({
        data: { key: 'default', version: 1, name: 'Default credit scorecard', status: 'ACTIVE', definition: DEFAULT_SCORECARD_V1 as unknown as Prisma.InputJsonValue, notes: 'Seeded default scorecard (v1).', activatedAt: new Date() },
      });
      await this.audit.record({ action: 'scorecard.seeded', resourceType: 'Scorecard', resourceId: r.id, actorId: null, after: { key: r.key, version: r.version, status: r.status } });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e; // another instance seeded concurrently
    }
  }

  /* ───────── reads ───────── */
  private async userNames(rows: Row[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    return new Map((await this.prisma.staffUser.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  }
  private async pending(): Promise<Map<string, string>> {
    const open = await this.prisma.approvalRequest.findMany({ where: { type: 'SCORECARD_ACTIVATION', status: { in: [...OPEN] } }, select: { id: true, payload: true } });
    const m = new Map<string, string>();
    for (const a of open) { const sid = (a.payload as { scorecardId?: string } | null)?.scorecardId; if (sid) m.set(sid, a.id); }
    return m;
  }
  private toDto(r: Row, names: Map<string, string>, pending: Map<string, string>): ScorecardDto {
    return {
      id: r.id, key: r.key, name: r.name, version: r.version, status: r.status as ScorecardStatus, definition: r.definition as unknown as ScorecardDefinition, notes: r.notes,
      createdBy: r.createdById ? { id: r.createdById, name: names.get(r.createdById) ?? 'Unknown' } : null, createdAt: r.createdAt.toISOString(),
      activatedAt: r.activatedAt?.toISOString() ?? null, pendingApprovalId: pending.get(r.id) ?? null,
    };
  }
  async list(): Promise<ScorecardDto[]> {
    const rows = await this.prisma.scorecard.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] });
    const [names, pending] = await Promise.all([this.userNames(rows), this.pending()]);
    return rows.map((r) => this.toDto(r, names, pending));
  }
  async get(id: string): Promise<ScorecardDto> {
    const r = await this.prisma.scorecard.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Scorecard not found');
    return this.toDto(r, await this.userNames([r]), await this.pending());
  }
  /** The live scorecard for a key (null if none is ACTIVE). Used by the eligibility service. */
  async activeFor(key: string): Promise<{ id: string; key: string; version: number; name: string; definition: ScorecardDefinition } | null> {
    const r = await this.prisma.scorecard.findFirst({ where: { key, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    return r ? { id: r.id, key: r.key, version: r.version, name: r.name, definition: validateDefinition(r.definition) } : null;
  }
  async byId(id: string): Promise<{ id: string; key: string; version: number; name: string; definition: ScorecardDefinition }> {
    const r = await this.prisma.scorecard.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Scorecard not found');
    return { id: r.id, key: r.key, version: r.version, name: r.name, definition: validateDefinition(r.definition) };
  }

  /* ───────── writes ───────── */
  async create(user: AuthUser, b: z.infer<typeof scorecardCreateSchema>): Promise<ScorecardDto> {
    let source: Row | null = null;
    if (b.fromId) {
      source = await this.prisma.scorecard.findUnique({ where: { id: b.fromId } });
      if (!source) throw new NotFoundException('Source scorecard not found');
    }
    const raw = b.definition ?? source?.definition;
    if (raw === undefined) throw new BadRequestException({ message: 'Validation failed', code: 'VALIDATION_FAILED', errors: { definition: ['Required (or pass fromId to copy a version)'] } });
    const definition = validateDefinition(raw);
    const key = b.key ?? source?.key ?? (slug(b.name) || 'scorecard');
    if (!SCORECARD_KEY.safeParse(key).success) throw new BadRequestException({ message: 'Validation failed', code: 'VALIDATION_FAILED', errors: { key: ['Invalid scorecard key'] } });

    for (let attempt = 0; attempt < 3; attempt++) {
      const last = await this.prisma.scorecard.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
      try {
        const r = await this.prisma.$transaction(async (tx) => {
          const c = await tx.scorecard.create({ data: { key, version: (last?.version ?? 0) + 1, name: b.name, status: 'DRAFT', definition: definition as unknown as Prisma.InputJsonValue, notes: b.notes ?? null, createdById: user.id } });
          await this.audit.record({ action: 'scorecard.created', resourceType: 'Scorecard', resourceId: c.id, after: { key: c.key, version: c.version, name: c.name, fromId: b.fromId ?? null } }, tx);
          return c;
        });
        return this.toDto(r, new Map([[user.id, user.fullName]]), new Map());
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e; // version race: retry with the next number
      }
    }
    throw new ConflictException('Could not allocate a version number, please retry');
  }

  async update(user: AuthUser, id: string, b: z.infer<typeof scorecardUpdateSchema>): Promise<ScorecardDto> {
    const cur = await this.prisma.scorecard.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Scorecard not found');
    if (cur.status !== 'DRAFT') throw new ConflictException({ message: `A ${cur.status.toLowerCase()} scorecard version is immutable. Create a new version instead.`, code: 'SCORECARD_IMMUTABLE' });
    if ((await this.pending()).has(id)) throw new ConflictException({ message: 'An activation request is open for this draft; cancel it before editing.', code: 'ACTIVATION_PENDING' });
    const definition = validateDefinition(b.definition);
    const r = await this.prisma.$transaction(async (tx) => {
      // status guard in the WHERE: a concurrent activation cannot be overwritten
      const res = await tx.scorecard.updateMany({ where: { id, status: 'DRAFT' }, data: { name: b.name ?? cur.name, definition: definition as unknown as Prisma.InputJsonValue, notes: b.notes === undefined ? cur.notes : b.notes } });
      if (res.count !== 1) throw new ConflictException({ message: 'Scorecard is no longer a draft', code: 'SCORECARD_IMMUTABLE' });
      const u = await tx.scorecard.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ action: 'scorecard.updated', resourceType: 'Scorecard', resourceId: id, before: { name: cur.name, definition: cur.definition, notes: cur.notes }, after: { name: u.name, definition: u.definition, notes: u.notes } }, tx);
      return u;
    });
    return this.toDto(r, await this.userNames([r]), new Map());
  }

  async requestActivation(user: AuthUser, id: string, reason: string): Promise<ApprovalDto> {
    const sc = await this.prisma.scorecard.findUnique({ where: { id } });
    if (!sc) throw new NotFoundException('Scorecard not found');
    if (sc.status !== 'DRAFT') throw new ConflictException({ message: `Only a draft can be activated (this one is ${sc.status.toLowerCase()})`, code: 'SCORECARD_NOT_DRAFT' });
    validateDefinition(sc.definition);
    if ((await this.pending()).has(id)) throw new ConflictException({ message: 'An activation request is already open for this scorecard', code: 'ACTIVATION_PENDING' });
    return this.approvals.submit(user, {
      type: 'SCORECARD_ACTIVATION', summary: `Activate scorecard "${sc.name}" (${sc.key} v${sc.version})`, reason,
      payload: { scorecardId: sc.id, key: sc.key, version: sc.version },
    });
  }

  /** Four-eyes activation: previous ACTIVE of the key → RETIRED, target → ACTIVE, atomically with the audit rows. */
  private activationHandler(): ApprovalHandler {
    const parse = (p: unknown) => {
      const r = activationPayload.safeParse(p);
      if (!r.success) throw new BadRequestException({ message: 'Invalid payload', code: 'VALIDATION_FAILED', errors: { payload: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } });
      return r.data;
    };
    return {
      type: 'SCORECARD_ACTIVATION',
      submitPermission: 'scorecard:update',
      validate: async (p) => {
        const d = parse(p);
        const sc = await this.prisma.scorecard.findUnique({ where: { id: d.scorecardId } });
        if (!sc) throw new BadRequestException({ message: 'Scorecard not found', code: 'VALIDATION_FAILED' });
        if (sc.status !== 'DRAFT') throw new BadRequestException({ message: 'Only a draft scorecard can be activated', code: 'SCORECARD_NOT_DRAFT' });
        return { scorecardId: sc.id, key: sc.key, version: sc.version };
      },
      execute: async (req, tx) => {
        const d = parse(req.payload);
        const target = await tx.scorecard.findUnique({ where: { id: d.scorecardId } });
        if (!target) throw new Error('Scorecard no longer exists');
        if (target.status !== 'DRAFT') throw new Error(`Scorecard is ${target.status}, not DRAFT`);
        validateDefinition(target.definition);
        const now = new Date();
        const prev = await tx.scorecard.findMany({ where: { key: target.key, status: 'ACTIVE' } });
        for (const p of prev) {
          await tx.scorecard.update({ where: { id: p.id }, data: { status: 'RETIRED', retiredAt: now } });
          await this.audit.record({ action: 'scorecard.retired', resourceType: 'Scorecard', resourceId: p.id, before: { status: 'ACTIVE', version: p.version }, after: { status: 'RETIRED' }, metadata: { approvalId: req.id, replacedBy: target.id } }, tx);
        }
        await tx.scorecard.update({ where: { id: target.id }, data: { status: 'ACTIVE', activatedAt: now } });
        await this.audit.record({ action: 'scorecard.activated', resourceType: 'Scorecard', resourceId: target.id, before: { status: 'DRAFT', version: target.version, previousActive: prev.map((p) => p.version) }, after: { status: 'ACTIVE', version: target.version, activatedAt: now.toISOString() }, metadata: { approvalId: req.id, key: target.key } }, tx);
        return { scorecardId: target.id, key: target.key, version: target.version, retired: prev.map((p) => p.id) };
      },
    };
  }
}
