import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditLogDto, auditQuerySchema, AuditFilters, Page } from '@damez/shared';
import { Prisma } from '@prisma/client';
import { AuthUser, branchWhere } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { paged, skipTake } from '../common/pagination';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

type Q = z.infer<typeof auditQuerySchema>;

@Controller('audit')
export class AuditController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private where(q: Q, user: AuthUser): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    const scope = branchWhere(user);
    if (scope.branchId) and.push({ OR: [{ branchId: scope.branchId as string }, { actorId: user.id }] });
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.action) and.push({ action: q.action });
    if (q.resourceType) and.push({ resourceType: q.resourceType });
    if (q.resourceId) and.push({ resourceId: q.resourceId });
    if (q.outcome) and.push({ outcome: q.outcome });
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
    if (q.q) {
      and.push({
        OR: [
          { action: { contains: q.q } },
          { actorName: { contains: q.q } },
          { actorEmail: { contains: q.q } },
          { resourceId: { contains: q.q } },
          { resourceType: { contains: q.q } },
        ],
      });
    }
    return { AND: and };
  }

  private toDto(r: Prisma.AuditLogGetPayload<object>): AuditLogDto {
    return {
      id: r.id,
      seq: Number(r.seq),
      createdAt: r.createdAt.toISOString(),
      actor: r.actorId ? { id: r.actorId, name: r.actorName ?? 'Unknown', email: r.actorEmail ?? '' } : null,
      actorRole: r.actorRole,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      userAgent: r.userAgent,
      branchId: r.branchId,
      outcome: r.outcome,
      metadata: r.metadata,
      hash: r.hash,
    };
  }

  @Get()
  @RequirePermission('audit:read')
  async list(@Query(new ZodPipe(auditQuerySchema)) q: Q, @CurrentUser() user: AuthUser): Promise<Page<AuditLogDto>> {
    const where = this.where(q, user);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(rows.map((r) => this.toDto(r)), total, q.page, q.pageSize);
  }

  @Get('filters')
  @RequirePermission('audit:read')
  async filters(): Promise<AuditFilters> {
    const [a, r] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.findMany({ distinct: ['resourceType'], select: { resourceType: true }, orderBy: { resourceType: 'asc' } }),
    ]);
    return { actions: a.map((x) => x.action), resourceTypes: r.map((x) => x.resourceType) };
  }

  @Get('verify')
  @RequirePermission('audit:read')
  verify() {
    return this.audit.verify();
  }

  @Get('export')
  @RequirePermission('audit:export')
  async export(@Query(new ZodPipe(auditQuerySchema)) q: Q, @CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const where = this.where(q, user);
    // Exporting is itself a sensitive action.
    await this.audit.record({ action: 'audit.export', resourceType: 'AuditLog', metadata: { filters: q } });
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      // CSV/Excel formula injection guard
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.write('seq,timestamp_utc,actor,actor_email,role,action,resource_type,resource_id,outcome,ip,before,after,hash\n');
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        where,
        orderBy: { seq: 'desc' },
        take: 1000,
        ...(cursor ? { cursor: { seq: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      for (const r of rows) {
        res.write(
          [r.seq, r.createdAt.toISOString(), r.actorName, r.actorEmail, r.actorRole, r.action, r.resourceType, r.resourceId, r.outcome, r.ip, r.before, r.after, r.hash]
            .map(esc)
            .join(',') + '\n',
        );
      }
      cursor = rows[rows.length - 1].seq;
      if (rows.length < 1000) break;
    }
    res.end();
  }
}
