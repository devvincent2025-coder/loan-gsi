import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, PostingSide } from '@prisma/client';
import type { GlExportRowDto, JournalEntryDto, LedgerAccountDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { LedgerPort, PostJournalInput } from '../contracts/ports';
import { PrismaService } from '../prisma/prisma.service';
import { ACCOUNT_CODES, CHART_OF_ACCOUNTS, RECEIVABLE_ACCOUNT_CODES } from './chart-of-accounts';

type Db = Prisma.TransactionClient;

/** `to` filters are inclusive, plain yyyy-mm-dd dates; widen to the end of that day in UTC. */
const endOfDay = (dateStr: string): Date => new Date(`${dateStr}T23:59:59.999Z`);

/**
 * Double-entry ledger: posts balanced journal entries, reverses them, and derives account/loan balances
 * purely from `Posting` rows (never a running-balance column, so corrections are always a reversing entry).
 */
@Injectable()
export class LedgerService implements LedgerPort, OnModuleInit {
  private log = new Logger('Ledger');

  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Idempotent self-seed of the chart of accounts (system accounts are fixed; see chart-of-accounts.ts). */
  async onModuleInit(): Promise<void> {
    try {
      for (const a of CHART_OF_ACCOUNTS) {
        await this.prisma.ledgerAccount.upsert({
          where: { code: a.code },
          create: { code: a.code, name: a.name, type: a.type, normalSide: a.normalSide, isSystem: true },
          update: { name: a.name, type: a.type, normalSide: a.normalSide },
        });
      }
    } catch (e) {
      this.log.warn(`could not seed chart of accounts: ${(e as Error).message}`);
    }
  }

  private async generateReference(db: Db): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 8; i++) {
      const ref = `JE-${day}-${randomBytes(4).toString('hex')}`;
      const exists = await db.journalEntry.findUnique({ where: { reference: ref }, select: { id: true } });
      if (!exists) return ref;
    }
    throw new Error('Could not generate a unique journal reference');
  }

  async post(input: PostJournalInput, tx?: unknown): Promise<{ id: string; reference: string }> {
    if (!input.postings || input.postings.length < 2) {
      throw new BadRequestException({ message: 'A journal entry needs at least two postings', code: 'VALIDATION_FAILED' });
    }
    for (const p of input.postings) {
      if (!Number.isInteger(p.amountKobo) || p.amountKobo <= 0) {
        throw new BadRequestException({ message: 'Posting amounts must be positive integer kobo', code: 'VALIDATION_FAILED' });
      }
    }
    const debits = input.postings.filter((p) => p.side === 'DEBIT').reduce((s, p) => s + p.amountKobo, 0);
    const credits = input.postings.filter((p) => p.side === 'CREDIT').reduce((s, p) => s + p.amountKobo, 0);
    if (debits !== credits) {
      throw new BadRequestException({ message: `Unbalanced journal entry: debits ${debits} !== credits ${credits}`, code: 'LEDGER_UNBALANCED' });
    }

    const run = async (db: Db) => {
      const codes = [...new Set(input.postings.map((p) => p.accountCode))];
      const accounts = await db.ledgerAccount.findMany({ where: { code: { in: codes } } });
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      for (const c of codes) if (!byCode.has(c)) throw new BadRequestException({ message: `Unknown ledger account code ${c}`, code: 'VALIDATION_FAILED' });

      const reference = await this.generateReference(db);
      const je = await db.journalEntry.create({
        data: {
          reference,
          date: input.date ?? new Date(),
          memo: input.memo,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          loanId: input.loanId ?? null,
          createdById: input.createdById ?? null,
          postings: { create: input.postings.map((p) => ({ accountId: byCode.get(p.accountCode)!.id, loanId: input.loanId ?? null, side: p.side, amountKobo: BigInt(p.amountKobo) })) },
        },
      });
      await this.audit.record(
        {
          action: 'ledger.journal_posted',
          resourceType: 'JournalEntry',
          resourceId: je.id,
          actorId: input.createdById,
          after: { reference, memo: input.memo, sourceType: input.sourceType, loanId: input.loanId ?? null, postings: input.postings },
        },
        db,
      );
      return { id: je.id, reference };
    };

    if (tx) return run(tx as Db);
    return this.prisma.$transaction((db) => run(db));
  }

  async reverse(journalEntryId: string, memo: string, createdById?: string | null): Promise<{ id: string; reference: string }> {
    return this.prisma.$transaction(async (db) => {
      const je = await db.journalEntry.findUnique({ where: { id: journalEntryId }, include: { postings: true, reversedBy: true } });
      if (!je) throw new NotFoundException('Journal entry not found');
      if (je.reversedBy) throw new BadRequestException({ message: 'Journal entry already reversed', code: 'LEDGER_ALREADY_REVERSED' });

      const reference = await this.generateReference(db);
      const reversed = await db.journalEntry.create({
        data: {
          reference,
          date: new Date(),
          memo,
          sourceType: je.sourceType,
          sourceId: je.sourceId,
          loanId: je.loanId,
          reversalOfId: je.id,
          createdById: createdById ?? null,
          postings: {
            create: je.postings.map((p) => ({ accountId: p.accountId, loanId: p.loanId, side: p.side === PostingSide.DEBIT ? PostingSide.CREDIT : PostingSide.DEBIT, amountKobo: p.amountKobo })),
          },
        },
      });
      await this.audit.record(
        { action: 'ledger.journal_reversed', resourceType: 'JournalEntry', resourceId: reversed.id, actorId: createdById, before: { reversalOf: je.reference }, after: { reference, memo } },
        db,
      );
      return { id: reversed.id, reference };
    });
  }

  async accountBalance(accountCode: string): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { code: accountCode } });
    if (!account) throw new NotFoundException(`Unknown ledger account ${accountCode}`);
    const [debit, credit] = await Promise.all([
      this.prisma.posting.aggregate({ where: { accountId: account.id, side: 'DEBIT' }, _sum: { amountKobo: true } }),
      this.prisma.posting.aggregate({ where: { accountId: account.id, side: 'CREDIT' }, _sum: { amountKobo: true } }),
    ]);
    const d = Number(debit._sum.amountKobo ?? 0n);
    const c = Number(credit._sum.amountKobo ?? 0n);
    return account.normalSide === 'DEBIT' ? d - c : c - d;
  }

  async loanOutstanding(loanId: string): Promise<{ principalKobo: number; totalKobo: number }> {
    const accounts = await this.prisma.ledgerAccount.findMany({ where: { code: { in: RECEIVABLE_ACCOUNT_CODES } } });
    if (!accounts.length) return { principalKobo: 0, totalKobo: 0 };
    const postings = await this.prisma.posting.groupBy({
      by: ['accountId', 'side'],
      where: { loanId, accountId: { in: accounts.map((a) => a.id) } },
      _sum: { amountKobo: true },
    });
    const sums = new Map<string, { debit: bigint; credit: bigint }>();
    for (const row of postings) {
      const cur = sums.get(row.accountId) ?? { debit: 0n, credit: 0n };
      if (row.side === 'DEBIT') cur.debit += row._sum.amountKobo ?? 0n;
      else cur.credit += row._sum.amountKobo ?? 0n;
      sums.set(row.accountId, cur);
    }
    let total = 0;
    let principal = 0;
    for (const a of accounts) {
      const s = sums.get(a.id) ?? { debit: 0n, credit: 0n };
      const bal = Number(s.debit - s.credit); // all receivable accounts are normalSide DEBIT
      total += bal;
      if (a.code === ACCOUNT_CODES.LOAN_PRINCIPAL_RECEIVABLE) principal = bal;
    }
    return { principalKobo: principal, totalKobo: total };
  }

  /* ── read-side helpers for the controllers (not part of LedgerPort) ── */

  async listAccountsWithBalances(): Promise<LedgerAccountDto[]> {
    const accounts = await this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
    const balances = await Promise.all(accounts.map((a) => this.accountBalance(a.code)));
    return accounts.map((a, i) => ({ id: a.id, code: a.code, name: a.name, type: a.type, normalSide: a.normalSide, balanceKobo: balances[i] }));
  }

  async listJournal(filter: { loanId?: string; from?: string; to?: string }): Promise<JournalEntryDto[]> {
    const where: Prisma.JournalEntryWhereInput = {};
    if (filter.loanId) where.loanId = filter.loanId;
    if (filter.from || filter.to) where.date = { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: endOfDay(filter.to) } : {}) };
    const rows = await this.prisma.journalEntry.findMany({ where, orderBy: { date: 'desc' }, take: 500, include: { postings: { include: { account: true } } } });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      date: r.date.toISOString().slice(0, 10),
      memo: r.memo,
      sourceType: r.sourceType,
      loanId: r.loanId,
      postings: r.postings.map((p) => ({ accountCode: p.account.code, accountName: p.account.name, side: p.side, amountKobo: Number(p.amountKobo) })),
    }));
  }

  async getJournalEntry(id: string): Promise<JournalEntryDto | null> {
    const r = await this.prisma.journalEntry.findUnique({ where: { id }, include: { postings: { include: { account: true } } } });
    if (!r) return null;
    return {
      id: r.id,
      reference: r.reference,
      date: r.date.toISOString().slice(0, 10),
      memo: r.memo,
      sourceType: r.sourceType,
      loanId: r.loanId,
      postings: r.postings.map((p) => ({ accountCode: p.account.code, accountName: p.account.name, side: p.side, amountKobo: Number(p.amountKobo) })),
    };
  }

  async glExportRows(filter: { from?: string; to?: string }): Promise<GlExportRowDto[]> {
    const dateWhere: Prisma.JournalEntryWhereInput = {};
    if (filter.from || filter.to) dateWhere.date = { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lte: endOfDay(filter.to) } : {}) };
    const postings = await this.prisma.posting.findMany({
      where: { journalEntry: dateWhere },
      orderBy: [{ journalEntry: { date: 'asc' } }, { createdAt: 'asc' }],
      include: { journalEntry: true, account: true },
      take: 50_000,
    });
    return postings.map((p) => ({
      date: p.journalEntry.date.toISOString().slice(0, 10),
      reference: p.journalEntry.reference,
      accountCode: p.account.code,
      accountName: p.account.name,
      debitKobo: p.side === 'DEBIT' ? Number(p.amountKobo) : 0,
      creditKobo: p.side === 'CREDIT' ? Number(p.amountKobo) : 0,
      memo: p.journalEntry.memo,
    }));
  }
}
