import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_TIER_LOAN_CAPS_KOBO, EligibilityFacts, EligibilityResultDto, FACT_FIELDS, ScorecardDefinition, SimulateResponse,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, canSeeBranch } from '../common/auth-user';
import {
  BUREAU_PORT, BureauPort, EligibilityPort, FRAUD_PORT, FraudPort, KYC_TIER_PORT, KycTierPort, LOAN_PORTFOLIO_PORT, LoanPortfolioPort,
} from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { ScorecardService } from '../scorecards/scorecard.service';
import { validateDefinition } from '../scorecards/scorecard-validation';
import { StatementService } from '../statements/statement.service';
import { EngineProduct, EngineResult, runEligibilityEngine } from './engine';

const EMPLOYMENT = ['EMPLOYED', 'SELF_EMPLOYED', 'CIVIL_SERVANT', 'STUDENT', 'UNEMPLOYED', 'RETIRED'] as const;
const NULLABLE_FACTS = new Set(['bureauScore', 'bureauWriteOffAgeMonths']);

/** Neutral starting point for what-if simulations without a base customer: a thin-file applicant with no history. */
export function blankFacts(): EligibilityFacts {
  return {
    age: 30, employmentStatus: 'EMPLOYED', declaredMonthlyIncomeKobo: 0, accountAgeDays: 0, kycTier: 1,
    bureauScore: null, bureauThinFile: true, bureauWorstDpdEver: 0, bureauDpd90In12m: false, bureauWriteOff24m: false, bureauWriteOffAgeMonths: null, bureauDefaultCount: 0,
    bureauActiveLoans: 0, bureauMonthlyObligationKobo: 0, bureauEnquiries30d: 0, bureauEnquiries90d: 0, bureauEnquiries180d: 0, bureauFraudFlag: false, bureauElsewhereDefault: false, bureauLegalAction: false,
    bankStatementMonths: 0, avgMonthlyInflowKobo: 0, inflowStability: 0, avgBalanceKobo: 0, gamblingFlag: false, overdraftFlag: false, salaryDetected: false,
    internalCompletedLoans: 0, internalLateInstalments: 0, internalActiveLoan: false, internalWrittenOff: false, fraudHighSignals: 0, fraudMediumSignals: 0,
  };
}

const factShape: Record<string, z.ZodTypeAny> = {};
for (const f of FACT_FIELDS) {
  const base = f.key === 'employmentStatus' ? z.enum(EMPLOYMENT) : f.type === 'boolean' ? z.boolean() : f.type === 'string' ? z.string() : z.number().finite();
  factShape[f.key] = NULLABLE_FACTS.has(f.key) ? base.nullable() : base;
}
export const simulateSchema = z.object({
  productId: z.string().min(1),
  amountKobo: z.number().int().positive(),
  tenorMonths: z.number().int().min(1).max(120),
  scorecardId: z.string().min(1).optional(),
  definition: z.unknown().optional(),
  baseCustomerId: z.string().min(1).optional(),
  facts: z.object(factShape).partial().strict().optional(),
});
export const eligibilityListQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

type ProductRow = Prisma.LoanProductGetPayload<object>;
type AssessmentRow = Prisma.EligibilityAssessmentGetPayload<object>;

export const toEngineProduct = (p: ProductRow): EngineProduct => ({
  id: p.id, name: p.name, monthlyRateBps: p.monthlyRateBps, interestMethod: p.interestMethod === 'REDUCING_BALANCE' ? 'REDUCING_BALANCE' : 'FLAT',
  minAmountKobo: Number(p.minAmountKobo), maxAmountKobo: Number(p.maxAmountKobo), minTenorMonths: p.minTenorMonths, maxTenorMonths: p.maxTenorMonths,
  minKycTier: p.minKycTier, minAge: p.minAge, maxAge: p.maxAge, allowGuarantor: p.allowGuarantor, allowCollateral: p.allowCollateral, isActive: p.isActive,
  eligibilityOverrides: (p.eligibilityOverrides as Record<string, unknown> | null) ?? {},
});

interface GatherOptions { pull: boolean; readOnly: boolean; applicationId?: string | null; createdById?: string | null }
interface Gathered { facts: EligibilityFacts; bureauReportId: string | null }

@Injectable()
export class EligibilityService implements EligibilityPort {
  private readonly log = new Logger(EligibilityService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private scorecards: ScorecardService,
    private statements: StatementService,
    private cipher: FieldCipher,
    @Optional() @Inject(BUREAU_PORT) private bureau?: BureauPort,
    @Optional() @Inject(KYC_TIER_PORT) private kyc?: KycTierPort,
    @Optional() @Inject(FRAUD_PORT) private fraud?: FraudPort,
    @Optional() @Inject(LOAN_PORTFOLIO_PORT) private portfolio?: LoanPortfolioPort,
  ) {}

  /* ───────── fact gathering ───────── */
  private async age(c: { id: string; dobEnc: string | null; birthYear: number | null }, now: Date): Promise<number> {
    if (c.dobEnc) {
      try {
        const d = new Date(`${this.cipher.decrypt(c.dobEnc, `customer:${c.id}:dob`)}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) {
          let a = now.getUTCFullYear() - d.getUTCFullYear();
          if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) a--;
          return a;
        }
      } catch { this.log.warn(`could not decrypt date of birth for customer ${c.id}`); }
    }
    return c.birthYear ? now.getUTCFullYear() - c.birthYear : 30;
  }

  async tierCaps(): Promise<Record<string, number>> {
    const caps: Record<string, number> = { ...DEFAULT_TIER_LOAN_CAPS_KOBO };
    const s = await this.prisma.systemSetting.findUnique({ where: { key: 'kyc.tier_loan_caps' } });
    const v = s?.value as Record<string, unknown> | null;
    if (v && typeof v === 'object') for (const t of ['1', '2', '3']) if (typeof v[t] === 'number') caps[t] = v[t] as number;
    if (this.kyc) for (const t of [1, 2, 3]) { try { caps[String(t)] = await this.kyc.maxLoanKobo(t); } catch { /* keep the setting value */ } }
    return caps;
  }

  /** Builds the non-PII facts. `readOnly` never creates rows or refreshes anything (used by the simulator); `pull` allows a bureau pull. */
  async gatherFacts(customerId: string, now: Date, o: GatherOptions): Promise<Gathered> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c || c.erasedAt) throw new NotFoundException('Customer not found');
    const facts = blankFacts();

    facts.age = await this.age(c, now);
    facts.employmentStatus = (EMPLOYMENT as readonly string[]).includes(c.employmentStatus ?? '') ? (c.employmentStatus as EligibilityFacts['employmentStatus']) : 'SELF_EMPLOYED';
    facts.declaredMonthlyIncomeKobo = Number(c.monthlyIncomeKobo ?? 0n);
    facts.accountAgeDays = Math.max(0, Math.floor((now.getTime() - c.createdAt.getTime()) / 86_400_000));
    facts.kycTier = !o.readOnly && this.kyc ? await this.kyc.refreshTier(customerId) : c.kycTier;

    // bureau: ForbiddenException(CONSENT_REQUIRED) from ensureReport deliberately propagates to the caller
    let bureauReportId: string | null = null;
    if (this.bureau) {
      let summary = null;
      if (o.pull) {
        const rep = await this.bureau.ensureReport(customerId, { reason: 'APPLICATION', requestedById: o.createdById ?? null, applicationId: o.applicationId ?? null });
        summary = rep.summary; bureauReportId = rep.id;
      } else {
        const l = await this.bureau.latestSummary(customerId);
        if (l) { summary = l.summary; bureauReportId = l.reportId; }
      }
      if (summary) {
        Object.assign(facts, {
          bureauScore: summary.averageScore, bureauThinFile: summary.thinFile, bureauWorstDpdEver: summary.worstDpdEver, bureauDpd90In12m: summary.hasDpd90In12m,
          bureauWriteOff24m: summary.hasWriteOff24m, bureauWriteOffAgeMonths: summary.lastWriteOffMonthsAgo, bureauDefaultCount: summary.defaultCount,
          bureauActiveLoans: summary.activeFacilityCount, bureauMonthlyObligationKobo: summary.totalMonthlyObligationKobo, bureauEnquiries30d: summary.enquiries30d,
          bureauEnquiries90d: summary.enquiries90d, bureauEnquiries180d: summary.enquiries180d, bureauFraudFlag: summary.fraudFlag, bureauElsewhereDefault: summary.elsewhereDefault,
          bureauLegalAction: summary.legalActionCount > 0,
        } satisfies Partial<EligibilityFacts>);
      }
    }

    const st = o.readOnly ? await this.statements.latest(customerId) : await this.statements.analyseForCustomer(customerId, o.applicationId).catch((e) => { this.log.warn(`statement analysis failed: ${(e as Error).message}`); return null; });
    if (st) {
      Object.assign(facts, {
        bankStatementMonths: st.periodMonths, avgMonthlyInflowKobo: st.avgMonthlyInflowKobo, inflowStability: st.inflowStability, avgBalanceKobo: st.avgBalanceKobo,
        gamblingFlag: st.gamblingFlag, overdraftFlag: st.overdraftFlag, salaryDetected: st.salaryDetected,
      } satisfies Partial<EligibilityFacts>);
    }

    if (this.portfolio) {
      const h = await this.portfolio.internalHistory(customerId).catch(() => null);
      if (h) Object.assign(facts, { internalCompletedLoans: h.completedLoans, internalLateInstalments: h.lateInstalments, internalActiveLoan: h.activeLoan, internalWrittenOff: h.writtenOff });
    }
    if (this.fraud) {
      const f = await this.fraud.unresolvedCounts(customerId).catch(() => null);
      if (f) { facts.fraudHighSignals = f.high; facts.fraudMediumSignals = f.medium; }
    }
    return { facts, bureauReportId };
  }

  /* ───────── assess (ELIGIBILITY_PORT) ───────── */
  async assess(args: { customerId: string; productId: string; amountKobo: number; tenorMonths: number; applicationId?: string | null; createdById?: string | null; noPull?: boolean }): Promise<EligibilityResultDto> {
    const now = new Date();
    const product = await this.prisma.loanProduct.findUnique({ where: { id: args.productId } });
    if (!product) throw new NotFoundException('Product not found');
    const { facts, bureauReportId } = await this.gatherFacts(args.customerId, now, { pull: !args.noPull, readOnly: false, applicationId: args.applicationId, createdById: args.createdById });

    const scorecard = (await this.scorecards.activeFor(product.scorecardKey)) ?? (await this.scorecards.activeFor('default'));
    if (!scorecard) throw new ConflictException({ message: 'No active scorecard is configured', code: 'NO_ACTIVE_SCORECARD' });

    const caps = await this.tierCaps();
    const others = (await this.prisma.loanProduct.findMany({ where: { isActive: true, id: { not: product.id } } })).map(toEngineProduct);
    const out = runEligibilityEngine({
      facts, definition: scorecard.definition, scorecard: { id: scorecard.id, key: scorecard.key, version: scorecard.version, name: scorecard.name },
      product: toEngineProduct(product), requested: { amountKobo: args.amountKobo, tenorMonths: args.tenorMonths }, kycCapKobo: caps[String(facts.kycTier)] ?? 0, tierCapsKobo: caps, otherProducts: others, now,
    });

    const row = await this.prisma.eligibilityAssessment.create({
      data: {
        customerId: args.customerId, applicationId: args.applicationId ?? null, productId: product.id, scorecardId: scorecard.id,
        requestedAmountKobo: BigInt(args.amountKobo), tenorMonths: args.tenorMonths, outcome: out.outcome, score: out.score, scoreBand: out.scoreBand,
        maxAmountKobo: BigInt(out.maxAmountKobo), maxRepaymentKobo: BigInt(out.maxMonthlyRepaymentKobo), requestedRepaymentKobo: BigInt(out.requestedMonthlyRepaymentKobo),
        dtiBps: out.dtiBps, recognisedIncomeKobo: BigInt(out.recognisedIncomeKobo), externalObligationsKobo: BigInt(out.externalObligationsKobo), kycTier: out.kycTier, kycCapKobo: BigInt(out.kycCapKobo),
        reasons: out.reasons as unknown as Prisma.InputJsonValue, suggestions: out.suggestions as unknown as Prisma.InputJsonValue, alternatives: out.alternatives as unknown as Prisma.InputJsonValue,
        factors: out.factors as unknown as Prisma.InputJsonValue, firedRules: out.firedRules as unknown as Prisma.InputJsonValue, facts: facts as unknown as Prisma.InputJsonValue,
        bureauReportId, simulated: false, createdById: args.createdById ?? null,
      },
    });
    await this.audit.record({
      action: 'eligibility.assessed', resourceType: 'EligibilityAssessment', resourceId: row.id,
      after: { outcome: out.outcome, score: out.score, applicationId: args.applicationId ?? null, productId: product.id, customerId: args.customerId, scorecard: `${scorecard.key} v${scorecard.version}` },
    });
    return this.rowToDto(row, scorecard);
  }

  /* ───────── simulate (what-if; never persisted as a real assessment) ───────── */
  async simulate(user: AuthUser, b: z.infer<typeof simulateSchema>): Promise<SimulateResponse> {
    const now = new Date();
    const product = await this.prisma.loanProduct.findUnique({ where: { id: b.productId } });
    if (!product) throw new NotFoundException('Product not found');

    let facts = blankFacts();
    if (b.baseCustomerId) {
      const c = await this.prisma.customer.findUnique({ where: { id: b.baseCustomerId }, select: { branchId: true } });
      if (!c || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
      facts = (await this.gatherFacts(b.baseCustomerId, now, { pull: false, readOnly: true })).facts;
    }
    facts = { ...facts, ...(b.facts as Partial<EligibilityFacts> | undefined) };

    let definition: ScorecardDefinition; let meta: { id: string; key: string; version: number; name: string };
    if (b.definition !== undefined) { definition = validateDefinition(b.definition); meta = { id: 'draft', key: 'draft', version: 0, name: 'Unsaved draft' }; }
    else if (b.scorecardId) { const s = await this.scorecards.byId(b.scorecardId); definition = s.definition; meta = { id: s.id, key: s.key, version: s.version, name: s.name }; }
    else {
      const s = (await this.scorecards.activeFor(product.scorecardKey)) ?? (await this.scorecards.activeFor('default'));
      if (!s) throw new ConflictException({ message: 'No active scorecard is configured', code: 'NO_ACTIVE_SCORECARD' });
      definition = s.definition; meta = { id: s.id, key: s.key, version: s.version, name: s.name };
    }

    const caps = await this.tierCaps();
    const others = (await this.prisma.loanProduct.findMany({ where: { isActive: true, id: { not: product.id } } })).map(toEngineProduct);
    const out = runEligibilityEngine({
      facts, definition, scorecard: meta, product: toEngineProduct(product), requested: { amountKobo: b.amountKobo, tenorMonths: b.tenorMonths },
      kycCapKobo: caps[String(facts.kycTier)] ?? 0, tierCapsKobo: caps, otherProducts: others, now,
    });
    await this.audit.record({
      action: 'eligibility.simulated', resourceType: 'LoanProduct', resourceId: product.id,
      after: { outcome: out.outcome, score: out.score, scorecard: meta.id === 'draft' ? 'unsaved draft' : `${meta.key} v${meta.version}`, baseCustomerId: b.baseCustomerId ?? null, overriddenFacts: Object.keys(b.facts ?? {}) },
    });
    return { result: this.withMeta(out, { id: 'simulated', bureauReportId: null, simulated: true, createdAt: now }), facts };
  }

  /* ───────── history ───────── */
  async listForCustomer(user: AuthUser, customerId: string, limit: number): Promise<EligibilityResultDto[]> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { branchId: true } });
    if (!c || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
    const rows = await this.prisma.eligibilityAssessment.findMany({ where: { customerId, simulated: false }, orderBy: { createdAt: 'desc' }, take: limit });
    const sc = new Map((await this.prisma.scorecard.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.scorecardId))] } } })).map((s) => [s.id, s]));
    return rows.map((r) => {
      const s = sc.get(r.scorecardId);
      return this.rowToDto(r, { id: r.scorecardId, key: s?.key ?? 'unknown', version: s?.version ?? 0, name: s?.name ?? 'Unknown scorecard' });
    });
  }

  private withMeta(out: EngineResult, m: { id: string; bureauReportId: string | null; simulated: boolean; createdAt: Date }): EligibilityResultDto {
    return { ...out, id: m.id, bureauReportId: m.bureauReportId, simulated: m.simulated, createdAt: m.createdAt.toISOString() };
  }

  private rowToDto(r: AssessmentRow, sc: { id: string; key: string; version: number; name: string }): EligibilityResultDto {
    return {
      id: r.id, outcome: r.outcome as EligibilityResultDto['outcome'], score: r.score, scoreBand: r.scoreBand as EligibilityResultDto['scoreBand'],
      requested: { productId: r.productId, amountKobo: Number(r.requestedAmountKobo), tenorMonths: r.tenorMonths },
      maxAmountKobo: Number(r.maxAmountKobo), maxMonthlyRepaymentKobo: Number(r.maxRepaymentKobo), requestedMonthlyRepaymentKobo: Number(r.requestedRepaymentKobo),
      dtiBps: r.dtiBps, recognisedIncomeKobo: Number(r.recognisedIncomeKobo), externalObligationsKobo: Number(r.externalObligationsKobo), kycTier: r.kycTier, kycCapKobo: Number(r.kycCapKobo),
      scorecard: { id: sc.id, key: sc.key, version: sc.version, name: sc.name },
      reasons: r.reasons as unknown as EligibilityResultDto['reasons'], suggestions: r.suggestions as unknown as EligibilityResultDto['suggestions'],
      alternatives: r.alternatives as unknown as EligibilityResultDto['alternatives'], factors: r.factors as unknown as EligibilityResultDto['factors'],
      firedRules: r.firedRules as unknown as EligibilityResultDto['firedRules'], bureauReportId: r.bureauReportId, simulated: r.simulated, createdAt: r.createdAt.toISOString(),
    };
  }
}
