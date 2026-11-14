import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { LoanApplication, LoanProduct } from '@prisma/client';
import type { ApplicationStatus, DocumentKind, EligibilityResultDto } from '@damez/shared';
import { BUREAU_CONSENT_PURPOSE } from './constants';
import {
  DOCUMENTS_PORT, DocumentsPort, ELIGIBILITY_PORT, EligibilityPort, KYC_TIER_PORT, KycTierPort,
} from '../contracts/ports';
import { PrismaService } from '../prisma/prisma.service';
import { docLabel, requiredDocsOf, topCustomerReason } from './mappers';
import { ApplicationTransitions, SYSTEM_ACTOR } from './application-transitions';

export const MSG_WAIT_CONSENT = 'Waiting for your consent to check your credit report';
const PIPELINE_STATES: ApplicationStatus[] = ['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK'];

/**
 * Orchestrates an application from SUBMITTED to UNDER_REVIEW (or auto-REJECTED). `advance` is IDEMPOTENT and safe to call
 * again after any external event (consent granted, KYC step done, document uploaded): it re-evaluates from the current
 * state and either moves forward or stays put with an explanatory statusReason. Never leaves an application without one.
 */
@Injectable()
export class ApplicationPipeline {
  private log = new Logger('ApplicationPipeline');
  /** per-application in-process serialisation: concurrent advances must not trigger two bureau pulls */
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private transitions: ApplicationTransitions,
    @Optional() @Inject(ELIGIBILITY_PORT) private eligibility?: EligibilityPort,
    @Optional() @Inject(KYC_TIER_PORT) private kyc?: KycTierPort,
    @Optional() @Inject(DOCUMENTS_PORT) private documents?: DocumentsPort,
  ) {}

  advance(applicationId: string): Promise<LoanApplication> {
    const prev = this.chains.get(applicationId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.run(applicationId));
    this.chains.set(applicationId, next);
    void next.then(() => undefined, () => undefined).finally(() => { if (this.chains.get(applicationId) === next) this.chains.delete(applicationId); });
    return next;
  }

  private async load(id: string) {
    const app = await this.prisma.loanApplication.findUnique({ where: { id }, include: { product: true } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  private async run(id: string): Promise<LoanApplication> {
    let app = await this.load(id);
    if (!PIPELINE_STATES.includes(app.status as ApplicationStatus)) return app;
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id: app.customerId }, select: { id: true, kycTier: true, bvnEnc: true } });
      if (!customer) return this.stay(app, 'Customer record not found');

      // 1. KYC tier / identity
      const tier = this.kyc ? await this.kyc.refreshTier(customer.id) : customer.kycTier;
      if (tier < app.product.minKycTier || !customer.bvnEnc) {
        const msg = !customer.bvnEnc
          ? 'Waiting for you to verify your BVN'
          : `Waiting for identity verification: this loan needs Tier ${app.product.minKycTier} (you are on Tier ${tier})`;
        if (app.status === 'SUBMITTED') await this.transitions.apply(app.id, 'KYC_PENDING', SYSTEM_ACTOR, { statusReason: msg });
        else await this.transitions.setStatusReason(app.id, msg);
        return this.load(id);
      }
      if (app.kycTierAtSubmission !== tier) await this.prisma.loanApplication.update({ where: { id: app.id }, data: { kycTierAtSubmission: tier } });

      // 2. required documents (stay put: the customer can upload and advance again)
      const missing = await this.missingDocs(app, app.product);
      if (missing.length) {
        await this.transitions.setStatusReason(app.id, `Waiting for your documents: ${missing.map(docLabel).join(', ')}`);
        return this.load(id);
      }

      // 3. credit check
      if (app.status === 'SUBMITTED' || app.status === 'KYC_PENDING') {
        await this.transitions.apply(app.id, 'BUREAU_CHECK', SYSTEM_ACTOR, { statusReason: 'Checking your credit history' });
        app = await this.load(id);
      }
      if (!(await this.hasBureauConsent(app.customerId))) {
        await this.transitions.setStatusReason(app.id, MSG_WAIT_CONSENT);
        return this.load(id);
      }
      let result: EligibilityResultDto;
      try {
        result = await this.assess(app);
      } catch (e) {
        if (isConsentRequired(e)) { await this.transitions.setStatusReason(app.id, MSG_WAIT_CONSENT); return this.load(id); }
        this.log.warn(`assessment failed for ${app.reference}: ${(e as Error).message}`);
        await this.transitions.setStatusReason(app.id, 'Your credit check could not be completed right now. We will retry shortly.');
        return this.load(id);
      }

      // 4. decide
      const declineRule = result.firedRules.some((r) => r.action === 'DECLINE');
      if (result.outcome === 'INELIGIBLE' && declineRule && (await this.autoDeclineEnabled())) {
        await this.transitions.apply(app.id, 'REJECTED', SYSTEM_ACTOR, { statusReason: topCustomerReason(result), reason: 'Auto-declined by policy rule' });
      } else {
        await this.transitions.apply(app.id, 'UNDER_REVIEW', SYSTEM_ACTOR, { statusReason: underReviewReason(result) });
      }
      return this.load(id);
    } catch (e) {
      // another advancer won the race: return the current state rather than failing the caller
      if (e instanceof ConflictException) return this.load(id);
      throw e;
    }
  }

  /** Refresh the assessment only: never changes the status (staff "reassess"). */
  async reassess(applicationId: string, staffId: string | null): Promise<EligibilityResultDto> {
    const app = await this.load(applicationId);
    if (!this.eligibility) throw new ConflictException({ message: 'The eligibility engine is not available', code: 'ELIGIBILITY_UNAVAILABLE' });
    return this.assess(app, staffId);
  }

  private async assess(app: LoanApplication, staffId: string | null = null): Promise<EligibilityResultDto> {
    if (!this.eligibility) throw new Error('eligibility engine unavailable');
    const r = await this.eligibility.assess({
      customerId: app.customerId, productId: app.productId, amountKobo: Number(app.requestedAmountKobo), tenorMonths: app.tenorMonths,
      applicationId: app.id, createdById: staffId, noPull: false,
    });
    // make sure the assessment is linked to the application (engines may or may not set it)
    await this.prisma.eligibilityAssessment.updateMany({ where: { id: r.id, applicationId: null }, data: { applicationId: app.id } });
    return r;
  }

  async missingDocs(app: Pick<LoanApplication, 'id' | 'customerId'>, product: Pick<LoanProduct, 'requiredDocs'>): Promise<DocumentKind[]> {
    const required = requiredDocsOf(product);
    if (!required.length) return [];
    const have = await this.satisfiedKinds(app.customerId, app.id);
    return required.filter((k) => !have.has(k));
  }

  async satisfiedKinds(customerId: string, applicationId: string | null): Promise<Set<DocumentKind>> {
    if (this.documents) return this.documents.satisfiedKinds(customerId, applicationId);
    // degrade gracefully when the documents module is not wired: read the rows directly
    const rows = await this.prisma.kycDocument.findMany({
      where: { customerId, deletedAt: null, scanStatus: 'CLEAN', reviewStatus: { not: 'REJECTED' }, OR: [{ applicationId: null }, ...(applicationId ? [{ applicationId }] : [])] },
      select: { kind: true },
    });
    return new Set(rows.map((r) => r.kind as DocumentKind));
  }

  async hasBureauConsent(customerId: string): Promise<boolean> {
    const c = await this.prisma.consent.findFirst({
      where: { subjectType: 'CUSTOMER', subjectId: customerId, purpose: BUREAU_CONSENT_PURPOSE, status: 'GRANTED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return !!c;
  }

  private async autoDeclineEnabled(): Promise<boolean> {
    const s = await this.prisma.systemSetting.findUnique({ where: { key: 'application.auto_decline_enabled' } });
    return s ? s.value === true : true;
  }

  private async stay(app: LoanApplication, msg: string): Promise<LoanApplication> {
    await this.transitions.setStatusReason(app.id, msg);
    return this.load(app.id);
  }
}

const isConsentRequired = (e: unknown): boolean =>
  e instanceof ForbiddenException && (e.getResponse() as { code?: string })?.code === 'CONSENT_REQUIRED';

export function underReviewReason(r: Pick<EligibilityResultDto, 'outcome' | 'score' | 'firedRules'>): string {
  const refer = r.firedRules.some((x) => x.action === 'REFER');
  if (refer) return `Referred to a credit officer for manual review (eligibility: ${r.outcome})`;
  if (r.outcome === 'ELIGIBLE') return 'Eligibility check passed. Awaiting credit officer review';
  if (r.outcome === 'CONDITIONAL') return 'Eligibility check passed with conditions. Awaiting credit officer review';
  return 'Eligibility check flagged some concerns. Application has been referred to a credit officer for review';
}
