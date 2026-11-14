import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LoanStatus, Prisma } from '@prisma/client';
import { EclConfigDto, LoanStagingDto, ProvisioningReportDto, maskName } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { ACCOUNT_CODES } from './chart-of-accounts';
import { EclConfigInput } from './ledger-schemas';
import { LedgerService } from './ledger.service';

const SETTING_KEY = 'ifrs9.config';
const SETTING_NAMESPACE = 'ifrs9';

export const DEFAULT_ECL_CONFIG: EclConfigDto = {
  stage1PdBps: 300,
  stage2PdBps: 2000,
  stage3PdBps: 10000,
  lgdBps: 4500,
  stage2DpdThreshold: 30,
  stage3DpdThreshold: 90,
};

const EXCLUDED_STATUSES: LoanStatus[] = [LoanStatus.CLOSED, LoanStatus.WRITTEN_OFF];

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function parseAsOfDate(s?: string): Date {
  if (!s) return startOfTodayUtc();
  return new Date(`${s}T00:00:00.000Z`);
}
function provisioningSourceId(asOfDate: Date): string {
  return `ifrs9-provisioning:${asOfDate.toISOString().slice(0, 10)}`;
}

/**
 * IFRS 9 staging + ECL. Config lives in `SystemSetting` (namespace `ifrs9`, key `ifrs9.config`).
 * `computeStaging` is read-free of side effects on the loan portfolio beyond `Loan.ifrsStage` and posts
 * a provisioning journal entry (5100 Dr / 1900 Cr, or reversed on a release) for the delta vs the prior run.
 */
@Injectable()
export class EclService implements OnModuleInit {
  private log = new Logger('Ecl');

  constructor(private prisma: PrismaService, private audit: AuditService, private ledger: LedgerService, private queue: QueueService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.systemSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, namespace: SETTING_NAMESPACE, value: DEFAULT_ECL_CONFIG as unknown as Prisma.InputJsonValue, description: 'IFRS 9 staging & ECL parameters' },
        update: {},
      });
    } catch (e) {
      this.log.warn(`could not seed ${SETTING_KEY} setting: ${(e as Error).message}`);
    }

    this.queue.register(QUEUES.ledger, async (name) => {
      if (name === 'compute-staging') return this.computeStaging();
      return undefined;
    });
    const t = setTimeout(() => {
      void this.queue.schedule(QUEUES.ledger, 'ifrs9-staging', { pattern: '0 1 * * *', tz: 'Africa/Lagos' }, 'compute-staging').catch((e: Error) => this.log.warn(e.message));
    }, 4000);
    t.unref();
  }

  async getConfig(): Promise<EclConfigDto> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
    return (row?.value as unknown as EclConfigDto | undefined) ?? DEFAULT_ECL_CONFIG;
  }

  async setConfig(input: EclConfigInput, userId: string): Promise<EclConfigDto> {
    const before = await this.getConfig();
    const row = await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, namespace: SETTING_NAMESPACE, value: input as unknown as Prisma.InputJsonValue, description: 'IFRS 9 staging & ECL parameters', updatedById: userId },
      update: { value: input as unknown as Prisma.InputJsonValue, updatedById: userId },
    });
    await this.audit.record({ action: 'setting.updated', resourceType: 'SystemSetting', resourceId: SETTING_KEY, actorId: userId, before: { value: before }, after: { value: input } });
    return row.value as unknown as EclConfigDto;
  }

  /** Pure stage selection, exercised directly by unit tests. */
  selectStage(args: { dpd: number; status: LoanStatus }, cfg: EclConfigDto): number {
    let stage = args.dpd >= cfg.stage3DpdThreshold ? 3 : args.dpd >= cfg.stage2DpdThreshold ? 2 : 1;
    if (args.status === LoanStatus.Unpaid || args.status === LoanStatus.RESTRUCTURED) stage = Math.max(stage, 2);
    return stage;
  }

  async computeStaging(asOfDateStr?: string): Promise<ProvisioningReportDto> {
    const asOfDate = parseAsOfDate(asOfDateStr);
    const cfg = await this.getConfig();
    const loans = await this.prisma.loan.findMany({
      where: { status: { notIn: EXCLUDED_STATUSES } },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });

    const prevMax = await this.prisma.loanStagingSnapshot.aggregate({ where: { asOfDate: { lt: asOfDate } }, _max: { asOfDate: true } });
    const prevTotalAgg = prevMax._max.asOfDate
      ? await this.prisma.loanStagingSnapshot.aggregate({ where: { asOfDate: prevMax._max.asOfDate }, _sum: { eclKobo: true } })
      : null;
    const previousTotalEclKobo = Number(prevTotalAgg?._sum.eclKobo ?? 0n);

    const loanDtos: LoanStagingDto[] = [];
    const byStage = new Map<number, { loanCount: number; eadKobo: number; eclKobo: number }>();
    let totalEad = 0;
    let totalEcl = 0;

    await this.prisma.$transaction(async (db: Prisma.TransactionClient) => {
      for (const loan of loans) {
        const stage = this.selectStage({ dpd: loan.dpd, status: loan.status }, cfg);
        const pdBps = stage === 1 ? cfg.stage1PdBps : stage === 2 ? cfg.stage2PdBps : cfg.stage3PdBps;
        const lgdBps = cfg.lgdBps;
        const eadKobo = Number(loan.outstandingPrincipalKobo);
        const eclKobo = Math.round((eadKobo * pdBps * lgdBps) / 100_000_000);

        await db.loanStagingSnapshot.upsert({
          where: { loanId_asOfDate: { loanId: loan.id, asOfDate } },
          create: { loanId: loan.id, asOfDate, stage, dpd: loan.dpd, pdBps, lgdBps, eadKobo: BigInt(eadKobo), eclKobo: BigInt(eclKobo) },
          update: { stage, dpd: loan.dpd, pdBps, lgdBps, eadKobo: BigInt(eadKobo), eclKobo: BigInt(eclKobo) },
        });
        await db.loan.update({ where: { id: loan.id }, data: { ifrsStage: stage } });

        totalEad += eadKobo;
        totalEcl += eclKobo;
        const s = byStage.get(stage) ?? { loanCount: 0, eadKobo: 0, eclKobo: 0 };
        s.loanCount += 1;
        s.eadKobo += eadKobo;
        s.eclKobo += eclKobo;
        byStage.set(stage, s);

        loanDtos.push({
          loanId: loan.id,
          reference: loan.reference,
          customerName: maskName(`${loan.customer.firstName} ${loan.customer.lastName}`),
          outstandingKobo: eadKobo,
          dpd: loan.dpd,
          stage,
          pdBps,
          lgdBps,
          eadKobo,
          eclKobo,
        });
      }

      const sourceId = provisioningSourceId(asOfDate);
      const delta = totalEcl - previousTotalEclKobo;
      if (delta !== 0) {
        const already = await db.journalEntry.findFirst({ where: { sourceType: 'ACCRUAL', sourceId } });
        if (!already) {
          const amt = Math.abs(delta);
          const postings =
            delta > 0
              ? [
                  { accountCode: ACCOUNT_CODES.ECL_PROVISION_EXPENSE, side: 'DEBIT' as const, amountKobo: amt },
                  { accountCode: ACCOUNT_CODES.ALLOWANCE_FOR_ECL, side: 'CREDIT' as const, amountKobo: amt },
                ]
              : [
                  { accountCode: ACCOUNT_CODES.ALLOWANCE_FOR_ECL, side: 'DEBIT' as const, amountKobo: amt },
                  { accountCode: ACCOUNT_CODES.ECL_PROVISION_EXPENSE, side: 'CREDIT' as const, amountKobo: amt },
                ];
          await this.ledger.post(
            { date: asOfDate, memo: `IFRS 9 ECL provisioning as of ${asOfDate.toISOString().slice(0, 10)} (delta ${delta} kobo)`, sourceType: 'ACCRUAL', sourceId, postings },
            db,
          );
        }
      }
    });

    return {
      asOfDate: asOfDate.toISOString().slice(0, 10),
      byStage: [1, 2, 3].map((stage) => ({ stage, ...(byStage.get(stage) ?? { loanCount: 0, eadKobo: 0, eclKobo: 0 }) })),
      totalEadKobo: totalEad,
      totalEclKobo: totalEcl,
      loans: loanDtos,
    };
  }

  /** Read-only report from stored snapshots (defaults to the latest computed date); computes on demand if none exist yet. */
  async provisioningReport(asOfDateStr?: string): Promise<ProvisioningReportDto> {
    let asOfDate: Date;
    if (asOfDateStr) {
      asOfDate = parseAsOfDate(asOfDateStr);
    } else {
      const latest = await this.prisma.loanStagingSnapshot.aggregate({ _max: { asOfDate: true } });
      if (!latest._max.asOfDate) return this.computeStaging();
      asOfDate = latest._max.asOfDate;
    }

    const rows = await this.prisma.loanStagingSnapshot.findMany({
      where: { asOfDate },
      include: { loan: { include: { customer: { select: { firstName: true, lastName: true } } } } },
    });
    if (!rows.length) return this.computeStaging(asOfDateStr);

    const byStage = new Map<number, { loanCount: number; eadKobo: number; eclKobo: number }>();
    let totalEad = 0;
    let totalEcl = 0;
    const loans: LoanStagingDto[] = rows.map((r) => {
      const eadKobo = Number(r.eadKobo);
      const eclKobo = Number(r.eclKobo);
      totalEad += eadKobo;
      totalEcl += eclKobo;
      const s = byStage.get(r.stage) ?? { loanCount: 0, eadKobo: 0, eclKobo: 0 };
      s.loanCount += 1;
      s.eadKobo += eadKobo;
      s.eclKobo += eclKobo;
      byStage.set(r.stage, s);
      return {
        loanId: r.loanId,
        reference: r.loan.reference,
        customerName: maskName(`${r.loan.customer.firstName} ${r.loan.customer.lastName}`),
        outstandingKobo: eadKobo,
        dpd: r.dpd,
        stage: r.stage,
        pdBps: r.pdBps,
        lgdBps: r.lgdBps,
        eadKobo,
        eclKobo,
      };
    });

    return {
      asOfDate: asOfDate.toISOString().slice(0, 10),
      byStage: [1, 2, 3].map((stage) => ({ stage, ...(byStage.get(stage) ?? { loanCount: 0, eadKobo: 0, eclKobo: 0 }) })),
      totalEadKobo: totalEad,
      totalEclKobo: totalEcl,
      loans,
    };
  }
}
