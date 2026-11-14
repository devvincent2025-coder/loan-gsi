import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUREAU_PORT, BureauPort, DOCUMENTS_PORT, DocumentsPort } from '../contracts/ports';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { CsvStatementAnalyzer } from './csv-statement-analyzer';
import { DojahStatementProvider, MonoStatementProvider } from './statement-providers';
import { MonthlyPoint, StatementAnalysis, StatementContext, StatementProvider } from './statement-types';

export interface StoredStatementAnalysis extends StatementAnalysis {
  id: string;
  customerId: string;
  /** CSV_UPLOAD | MOCK | MONO | DOJAH, suffixed _UNPARSED_PDF when the only upload was an unreadable PDF/CSV and we fell back */
  source: string;
  documentId: string | null;
  createdAt: Date;
}

const REUSE_MS = 24 * 3_600_000;
type Row = Prisma.BankStatementAnalysisGetPayload<object>;

@Injectable()
export class StatementService {
  private readonly log = new Logger(StatementService.name);
  private readonly csv = new CsvStatementAnalyzer();

  constructor(
    private prisma: PrismaService,
    private mono: MonoStatementProvider,
    private dojah: DojahStatementProvider,
    @Optional() @Inject(APP_ENV) private env?: AppEnv,
    @Optional() @Inject(DOCUMENTS_PORT) private documents?: DocumentsPort,
    @Optional() @Inject(BUREAU_PORT) private bureau?: BureauPort,
  ) {}

  private provider(): StatementProvider {
    return this.env?.BANK_STATEMENT_PROVIDER === 'mono' ? this.mono : this.dojah;
  }

  private toStored(r: Row): StoredStatementAnalysis {
    return {
      id: r.id, customerId: r.customerId, source: r.source, documentId: r.documentId, createdAt: r.createdAt,
      periodMonths: r.periodMonths, avgMonthlyInflowKobo: Number(r.avgMonthlyInflowKobo), inflowStability: r.inflowStability, avgBalanceKobo: Number(r.avgBalanceKobo),
      gamblingFlag: r.gamblingFlag, overdraftFlag: r.overdraftFlag, salaryDetected: r.salaryDetected, salaryDay: r.salaryDay, monthly: (r.monthly as unknown as MonthlyPoint[]) ?? [],
    };
  }

  async latest(customerId: string): Promise<StoredStatementAnalysis | null> {
    const r = await this.prisma.bankStatementAnalysis.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return r ? this.toStored(r) : null;
  }

  /**
   * Uploaded CSV statement → real parser; PDF / unparsable upload → provider fallback (marked `_UNPARSED_PDF`);
   * nothing uploaded → provider. Recent results are reused (same document / < 24h for provider-based ones).
   */
  async analyseForCustomer(customerId: string, applicationId?: string | null, opts: { force?: boolean } = {}): Promise<StoredStatementAnalysis> {
    const docIds = (await this.documents?.listIds(customerId, 'BANK_STATEMENT').catch(() => [] as string[])) ?? [];
    const latest = await this.latest(customerId);
    const newestDoc = docIds[0] ?? null;
    if (!opts.force && latest) {
      const sameDoc = latest.source === 'CSV_UPLOAD' && newestDoc !== null && latest.documentId === newestDoc;
      const freshProvider = !latest.source.startsWith('CSV') && Date.now() - latest.createdAt.getTime() < REUSE_MS && (newestDoc === null || latest.documentId === newestDoc);
      if (sameDoc || freshProvider) return latest;
    }

    let unparsedDoc: string | null = null;
    let unparsedBytes: Buffer | null = null;
    for (const id of docIds) {
      try {
        const doc = await this.documents!.readContent(id);
        if (doc.mimeType === 'application/pdf' || doc.bytes.subarray(0, 4).toString('latin1') === '%PDF') { unparsedDoc ??= id; unparsedBytes ??= doc.bytes; continue; }
        return await this.persist(customerId, applicationId ?? null, 'CSV_UPLOAD', id, this.csv.analyze(doc.bytes));
      } catch (e) {
        this.log.warn(`bank statement ${id} could not be parsed: ${(e as Error).message}`);
        unparsedDoc ??= id;
      }
    }

    const ctx = await this.context(customerId, unparsedBytes);
    const provider = this.provider();
    let analysis: StatementAnalysis;
    try {
      analysis = await provider.analyze(ctx);
    } catch (e) {
      this.log.warn(`${provider.name} statement provider failed: ${(e as Error).message}`);
      throw e instanceof ServiceUnavailableException ? e : new ServiceUnavailableException({ message: 'Bank statement analysis is not available right now', code: 'STATEMENT_UNAVAILABLE' });
    }
    return this.persist(customerId, applicationId ?? null, unparsedDoc ? `${provider.name}_UNPARSED_PDF` : provider.name, unparsedDoc, analysis);
  }

  private async context(customerId: string, statementBytes: Buffer | null): Promise<StatementContext> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { monthlyIncomeKobo: true, employmentStatus: true, bankCode: true } });
    const b = await this.bureau?.latestSummary(customerId).catch(() => null);
    return {
      customerId, declaredMonthlyIncomeKobo: Number(c?.monthlyIncomeKobo ?? 0n), employmentStatus: c?.employmentStatus ?? null, bureau: b?.summary ?? null,
      statementPdf: statementBytes && c?.bankCode ? { bytes: statementBytes, bankCode: c.bankCode } : null,
    };
  }

  private async persist(customerId: string, applicationId: string | null, source: string, documentId: string | null, a: StatementAnalysis): Promise<StoredStatementAnalysis> {
    const r = await this.prisma.bankStatementAnalysis.create({
      data: {
        customerId, applicationId, source, documentId, periodMonths: a.periodMonths, avgMonthlyInflowKobo: BigInt(a.avgMonthlyInflowKobo), inflowStability: a.inflowStability,
        avgBalanceKobo: BigInt(a.avgBalanceKobo), gamblingFlag: a.gamblingFlag, overdraftFlag: a.overdraftFlag, salaryDetected: a.salaryDetected, salaryDay: a.salaryDay,
        monthly: a.monthly as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toStored(r);
  }
}
