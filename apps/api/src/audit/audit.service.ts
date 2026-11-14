import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { defaultRedactor } from '@damez/shared';
import { requestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { appendAudit, AuditEntryInput, computeHash, GENESIS_HASH } from './audit-chain';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * The ONLY way application code writes audit rows. Actor / ip / user-agent default from the request context.
   * before/after are passed through the PII redactor (sensitive keys become [REDACTED]).
   */
  record(entry: AuditEntryInput, tx?: Prisma.TransactionClient) {
    const ctx = requestContext.get();
    const u = ctx?.user;
    return appendAudit(
      this.prisma,
      {
        ...entry,
        actorId: entry.actorId === undefined ? (u?.id ?? ctx?.customer?.id ?? null) : entry.actorId,
        actorName: entry.actorName ?? u?.fullName ?? (ctx?.customer ? 'Customer' : null),
        actorEmail: entry.actorEmail ?? u?.email ?? null,
        actorRole: entry.actorRole ?? u?.roleName ?? (ctx?.customer ? 'Customer (portal)' : null),
        ip: entry.ip === undefined ? (ctx?.ip ?? null) : entry.ip,
        userAgent: entry.userAgent === undefined ? (ctx?.userAgent ?? null) : entry.userAgent,
        branchId: entry.branchId === undefined ? (u?.branchId ?? null) : entry.branchId,
        before: entry.before === undefined ? undefined : defaultRedactor.redact(entry.before),
        after: entry.after === undefined ? undefined : defaultRedactor.redact(entry.after),
        metadata: entry.metadata === undefined ? undefined : defaultRedactor.redact(entry.metadata),
      },
      tx,
    );
  }

  /** Recompute the whole chain; any edit/delete/insert-in-the-middle shows up as the first broken seq. */
  async verify(): Promise<{ valid: boolean; checked: number; brokenAtSeq: number | null }> {
    let prev = GENESIS_HASH;
    let checked = 0;
    let cursor = 0n;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: 'asc' }, take: 500 });
      if (!rows.length) break;
      for (const r of rows) {
        const expectedSeq = cursor + 1n;
        const hash = computeHash({ ...r, before: r.before, after: r.after });
        if (r.seq !== expectedSeq || r.prevHash !== prev || r.hash !== hash) {
          return { valid: false, checked, brokenAtSeq: Number(r.seq) };
        }
        prev = r.hash;
        cursor = r.seq;
        checked++;
      }
    }
    return { valid: true, checked, brokenAtSeq: null };
  }
}
