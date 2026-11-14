import { ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { BureauName, BureauReportDto, BureauReportListItem, BureauSummaryDto, PullReason } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { ConsentService } from '../consent/consent.module';
import { BureauPort, EnsureReportOptions } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { BureauAggregator, scrubError } from './bureau-aggregator';
import { BureauSettingsService } from './bureau-settings';
import { persistBureauReport, reportInclude, summaryFromRow, toReportDto } from './bureau-store';
import { BureauRequest, BureauSettings, MergedReport, PerBureauOutcome } from './bureau.types';

const aad = (id: string, field: string) => `customer:${id}:${field}`;

@Injectable()
export class BureauService implements BureauPort {
  private log = new Logger('Bureau');
  /** concurrent requests for one customer share a single (billable) pull */
  private inflight = new Map<string, Promise<BureauReportDto>>();

  constructor(
    private prisma: PrismaService, private cipher: FieldCipher, private consent: ConsentService, private audit: AuditService,
    private aggregator: BureauAggregator, private settings: BureauSettingsService,
  ) {}

  async ensureReport(customerId: string, opts: EnsureReportOptions): Promise<BureauReportDto> {
    const key = `${customerId}:${opts.force ? 'f' : 'n'}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.doEnsure(customerId, opts).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doEnsure(customerId: string, opts: EnsureReportOptions): Promise<BureauReportDto> {
    const base = { customerId, reason: opts.reason, requestedById: opts.requestedById ?? null, applicationId: opts.applicationId ?? null };
    const cfg = await this.settings.get();

    // (a) consent gate comes before anything else, including cache
    if (!(await this.consent.hasValidConsent(customerId, 'BUREAU_PULL'))) {
      await this.prisma.bureauPull.create({ data: { ...base, bureau: 'ALL', status: 'BLOCKED_NO_CONSENT', costKobo: 0n, attempts: 0 } });
      await this.audit.record({ action: 'bureau.pull_blocked', resourceType: 'Customer', resourceId: customerId, outcome: 'DENIED', metadata: { reason: opts.reason, purpose: 'BUREAU_PULL', applicationId: base.applicationId } });
      throw new ForbiddenException({ message: 'Bureau consent is required before we can check your credit report', code: 'CONSENT_REQUIRED', purpose: 'BUREAU_PULL' });
    }

    // (b) cache
    const maxAgeDays = opts.maxAgeDays ?? cfg.cacheTtlDays;
    if (!opts.force) {
      const cached = await this.prisma.bureauReport.findFirst({
        where: { customerId, pulledAt: { gt: new Date(Date.now() - maxAgeDays * 86_400_000) } }, orderBy: { pulledAt: 'desc' }, include: reportInclude,
      });
      if (cached) {
        await this.prisma.bureauPull.create({ data: { ...base, bureau: 'ALL', status: 'CACHED', costKobo: 0n, reportId: cached.id, attempts: 0 } });
        return toReportDto(cached, cfg.preDisbursementMaxAgeDays);
      }
    }

    // (c) fresh pull
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.erasedAt) throw new NotFoundException('Customer not found');
    // identifiers are decrypted just-in-time and live only in this scope; they are never logged
    const request: BureauRequest = {
      bvn: customer.bvnEnc ? this.cipher.decrypt(customer.bvnEnc, aad(customer.id, 'bvn')) : undefined,
      fullName: `${customer.firstName} ${customer.lastName}`.trim(),
      dateOfBirth: customer.dobEnc ? this.cipher.decrypt(customer.dobEnc, aad(customer.id, 'dob')) : undefined,
      phone: this.cipher.decrypt(customer.phoneEnc, aad(customer.id, 'phone')),
      reference: `DMZ-${customer.id.slice(-8)}-${Date.now().toString(36)}`,
    };
    const consentRow = await this.prisma.consent.findFirst({ where: { subjectType: 'CUSTOMER', subjectId: customerId, purpose: 'BUREAU_PULL', status: 'GRANTED' }, orderBy: { grantedAt: 'desc' }, select: { id: true } });
    const { outcomes, merged } = await this.aggregator.query(request, customerId, { bureaus: cfg.enabledBureaus, retry: cfg.retry });

    let report: { id: string; pulledAt: Date } | null = null;
    try {
      if (merged) report = await persistBureauReport(this.prisma, customerId, merged, { reason: opts.reason, cacheTtlDays: cfg.cacheTtlDays });
    } finally {
      await this.writePullRows(base, outcomes, cfg, report?.id ?? null, consentRow?.id ?? null);
    }
    const costKobo = outcomes.reduce((a, o) => a + this.costOf(o, cfg), 0);
    if (!merged || !report) {
      await this.audit.record({ action: 'bureau.pull_failed', resourceType: 'Customer', resourceId: customerId, outcome: 'FAILURE', metadata: { reason: opts.reason, bureaus: outcomes.map((o) => o.bureau), costKobo } });
      throw new ServiceUnavailableException({ message: 'Credit bureaus are currently unavailable. Please try again shortly.', code: 'BUREAU_UNAVAILABLE' });
    }
    await this.audit.record({
      action: 'bureau.pulled', resourceType: 'Customer', resourceId: customerId, branchId: customer.branchId,
      metadata: { reason: opts.reason, requestedById: base.requestedById, applicationId: base.applicationId, bureaus: merged.bureausQueried, failed: merged.bureausFailed.map((f) => f.bureau), costKobo, reportId: report.id },
    });
    await this.syncRiskFlags(customerId, merged).catch((e) => this.log.warn(`risk flag sync failed: ${scrubError(e)}`));
    return this.getReport(report.id);
  }

  private costOf(o: PerBureauOutcome, cfg: BureauSettings): number {
    return o.status === 'FAILED' ? 0 : cfg.costsKobo[o.bureau];
  }

  private async writePullRows(
    base: { customerId: string; reason: PullReason; requestedById: string | null; applicationId: string | null },
    outcomes: PerBureauOutcome[], cfg: BureauSettings, reportId: string | null, consentId: string | null,
  ): Promise<void> {
    await this.prisma.bureauPull.createMany({
      data: outcomes.map((o) => ({
        ...base, bureau: o.bureau, status: o.status, costKobo: BigInt(this.costOf(o, cfg)), durationMs: o.durationMs, attempts: o.attempts, error: o.error ?? null,
        reportId: o.status === 'FAILED' ? null : reportId, consentId,
      })),
    });
  }

  /** FRAUD_WATCHLIST / ELSEWHERE_DEFAULT flags (source BUREAU_PULL) follow the latest report so collections can prioritise. */
  private async syncRiskFlags(customerId: string, merged: MergedReport): Promise<void> {
    const want: { type: string; severity: string; detail: string; on: boolean }[] = [
      { type: 'FRAUD_WATCHLIST', severity: 'HIGH', detail: 'Fraud or watchlist flag returned by a credit bureau', on: merged.summary.fraudFlag },
      { type: 'ELSEWHERE_DEFAULT', severity: 'HIGH', detail: 'Unpaid or defaulted (30+ days) on a facility with another lender', on: merged.summary.elsewhereDefault },
    ];
    for (const w of want) {
      const active = await this.prisma.customerRiskFlag.findFirst({ where: { customerId, type: w.type, source: 'BUREAU_PULL', active: true } });
      if (w.on && !active) await this.prisma.customerRiskFlag.create({ data: { customerId, type: w.type, source: 'BUREAU_PULL', severity: w.severity, detail: w.detail } });
      else if (!w.on && active) await this.prisma.customerRiskFlag.updateMany({ where: { customerId, type: w.type, source: 'BUREAU_PULL', active: true }, data: { active: false, clearedAt: new Date() } });
    }
  }

  async ensureFreshForDisbursement(customerId: string, requestedById?: string | null): Promise<BureauReportDto> {
    const cfg = await this.settings.get();
    return this.ensureReport(customerId, { reason: 'PRE_DISBURSEMENT', maxAgeDays: cfg.preDisbursementMaxAgeDays, requestedById });
  }

  /* ── reads ── */
  async getReport(reportId: string): Promise<BureauReportDto> {
    const r = await this.prisma.bureauReport.findUnique({ where: { id: reportId }, include: reportInclude });
    if (!r) throw new NotFoundException('Bureau report not found');
    return toReportDto(r, (await this.settings.get()).preDisbursementMaxAgeDays);
  }

  async latestReport(customerId: string): Promise<BureauReportDto | null> {
    const r = await this.prisma.bureauReport.findFirst({ where: { customerId }, orderBy: { pulledAt: 'desc' }, include: reportInclude });
    return r ? toReportDto(r, (await this.settings.get()).preDisbursementMaxAgeDays) : null;
  }

  async latestSummary(customerId: string): Promise<{ reportId: string; pulledAt: Date; summary: BureauSummaryDto } | null> {
    const r = await this.prisma.bureauReport.findFirst({ where: { customerId }, orderBy: { pulledAt: 'desc' } });
    return r ? { reportId: r.id, pulledAt: r.pulledAt, summary: summaryFromRow(r) } : null;
  }

  async history(customerId: string): Promise<BureauReportListItem[]> {
    const rows = await this.prisma.bureauReport.findMany({ where: { customerId }, orderBy: { pulledAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ id: r.id, pulledAt: r.pulledAt.toISOString(), reason: r.pullReason as PullReason, averageScore: r.averageScore, bureausQueried: r.bureausQueried as BureauName[] }));
  }
}
