import { createHash } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  branchId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  metadata?: unknown;
  createdAt?: Date;
}

/** Stable JSON: sorted keys, nulls for undefined, so the hash survives a MySQL JSON round-trip. */
export function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export interface HashableRow {
  seq: bigint | number;
  createdAt: Date;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  outcome: string;
  ip: string | null;
  prevHash: string;
}

export function computeHash(r: HashableRow): string {
  const body = canonical({
    seq: r.seq.toString(),
    createdAt: r.createdAt.toISOString(),
    actorId: r.actorId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    before: r.before ?? null,
    after: r.after ?? null,
    outcome: r.outcome,
    ip: r.ip,
    prevHash: r.prevHash,
  });
  return createHash('sha256').update(body).digest('hex');
}

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Append one row to the audit chain. Serialised with a row lock on AuditChainHead.
 * MUST run inside a transaction (pass `tx`) or it opens its own.
 */
export async function appendAudit(prisma: PrismaClient, entry: AuditEntryInput, tx?: Prisma.TransactionClient) {
  const run = async (c: Prisma.TransactionClient) => {
    await c.auditChainHead.upsert({
      where: { id: 1 },
      create: { id: 1, lastSeq: 0n, lastHash: GENESIS_HASH },
      update: {},
    });
    const rows = await c.$queryRaw<Array<{ lastSeq: bigint; lastHash: string }>>(
      Prisma.sql`SELECT lastSeq, lastHash FROM AuditChainHead WHERE id = 1 FOR UPDATE`,
    );
    const head = rows[0];
    const seq = BigInt(head.lastSeq) + 1n;
    const createdAt = entry.createdAt ?? new Date();
    createdAt.setMilliseconds(createdAt.getMilliseconds()); // DATETIME(3) keeps ms
    const outcome = entry.outcome ?? 'SUCCESS';
    const toJson = (v: unknown) => (v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(canonical(v)) as Prisma.InputJsonValue));
    const hash = computeHash({
      seq,
      createdAt,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      outcome,
      ip: entry.ip ?? null,
      prevHash: head.lastHash,
    });
    const row = await c.auditLog.create({
      data: {
        seq,
        createdAt,
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        actorEmail: entry.actorEmail ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        branchId: entry.branchId ?? null,
        outcome,
        metadata: toJson(entry.metadata),
        prevHash: head.lastHash,
        hash,
      },
    });
    await c.auditChainHead.update({ where: { id: 1 }, data: { lastSeq: seq, lastHash: hash } });
    return row;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export type { Client };
