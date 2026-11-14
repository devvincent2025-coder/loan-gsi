import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Customer, EligibilityAssessment, Guarantor, LoanApplication, LoanProduct } from '@prisma/client';
import {
  DEFAULT_TIER_LOAN_CAPS_KOBO, maskName, maskPhone, type ApplicationDetailDto, type ApplicationEventDto, type ApplicationStatus,
  type ApplicationSummaryDto, type EligibilityCustomerDto, type EligibilityOutcome, type FraudSignalDto, type GuarantorDto, type KycTier,
  type LoanQuoteDto, type Page, type PortalApplicationDto, type PortalProductDto, type StaffDocumentDto,
} from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, branchWhere, canSeeBranch } from '../common/auth-user';
import { paged, skipTake } from '../common/pagination';
import {
  BUREAU_PORT, BureauPort, DOCUMENTS_PORT, DocumentsPort, ELIGIBILITY_PORT, EligibilityPort, FRAUD_PORT, FraudPort, KYC_TIER_PORT, KycTierPort,
} from '../contracts/ports';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationPipeline, MSG_WAIT_CONSENT } from './application-pipeline';
import { ActorRef, ApplicationTransitions } from './application-transitions';
import { BUREAU_CONSENT_PURPOSE, PREVIEW_LIMIT_PER_HOUR } from './constants';
import {
  buildQuote, CUSTOMER_STATUS_COPY, NextAction, pricingFromProduct, readPricing, requiredDocsOf, toCustomerView, toEligibilityResultDto, toPortalProductDto,
} from './mappers';
import { allowedStaffTransitions, findTransition, OPEN_PRE_BOOKING } from './state-machine';

/**
 * Prompt 3 states that must NEVER be reached through the generic `/applications/:id/transition` endpoint: each has a
 * dedicated flow (maker-checker approval, offer generation, disbursement booking, or the servicing/delinquency jobs)
 * that does more than flip a status column. Letting the generic endpoint jump straight to one of these would skip
 * that flow entirely (e.g. APPROVED with no ApprovalRequest row, or OFFER_SENT with no LoanOffer/PDF).
 */
const DEDICATED_FLOW_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  'APPROVED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'DISBURSED', 'ACTIVE', 'Unpaid', 'RESTRUCTURED', 'CLOSED', 'WRITTEN_OFF',
]);
const DEDICATED_FLOW_HINT: Partial<Record<ApplicationStatus, string>> = {
  APPROVED: 'POST /applications/:id/decision {action:"APPROVE"}',
  OFFER_SENT: 'POST /applications/:id/offers then POST /offers/:id/send',
  OFFER_ACCEPTED: 'POST /portal/offers/:id/accept (customer)',
  DISBURSED: 'POST /loans/applications/:id/disburse or /disburse-manual',
  RESTRUCTURED: 'POST /loans/:id/restructure',
  WRITTEN_OFF: 'POST /loans/:id/writeoff',
};

export interface CreateInput { customerId: string; productId: string; amountKobo: number; tenorMonths: number; purpose?: string | null }
export interface ListQuery { page: number; pageSize: number; q?: string; status?: ApplicationStatus; productId?: string; outcome?: EligibilityOutcome; branchId?: string }

const includeList = { customer: { include: { branch: true } }, product: true, assessments: { orderBy: { createdAt: 'desc' as const }, take: 1 } } satisfies Prisma.LoanApplicationInclude;
type ListRow = Prisma.LoanApplicationGetPayload<{ include: typeof includeList }>;

const staffActor = (u: AuthUser): ActorRef => ({ type: 'STAFF', id: u.id, name: u.fullName, permissions: u.permissions, branchId: u.branchId });
const customerActor = (id: string): ActorRef => ({ type: 'CUSTOMER', id, name: 'Customer' });

@Injectable()
export class ApplicationsService {
  private log = new Logger('ApplicationsService');
  /** customerId → timestamps of recent eligibility previews (per-process sliding window; bureau cache is the second line of defence) */
  private previews = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private transitions: ApplicationTransitions,
    private pipeline: ApplicationPipeline,
    @Optional() @Inject(ELIGIBILITY_PORT) private eligibility?: EligibilityPort,
    @Optional() @Inject(BUREAU_PORT) private bureau?: BureauPort,
    @Optional() @Inject(KYC_TIER_PORT) private kyc?: KycTierPort,
    @Optional() @Inject(DOCUMENTS_PORT) private documents?: DocumentsPort,
    @Optional() @Inject(FRAUD_PORT) private fraud?: FraudPort,
  ) {}

  /* ───────────── helpers ───────────── */

  async tierCap(tier: number): Promise<number> {
    if (tier <= 0) return 0;
    if (this.kyc) return this.kyc.maxLoanKobo(tier);
    const s = await this.prisma.systemSetting.findUnique({ where: { key: 'kyc.tier_loan_caps' } });
    const caps = (s?.value ?? DEFAULT_TIER_LOAN_CAPS_KOBO) as Record<string, number>;
    return Number(caps[String(Math.min(tier, 3))] ?? 0);
  }

  async product(productId: string): Promise<LoanProduct> {
    const p = await this.prisma.loanProduct.findUnique({ where: { id: productId } });
    if (!p) throw new NotFoundException('Loan product not found');
    return p;
  }

  /** Guards: product active, amount and tenor inside the product's bounds. */
  assertWithinProduct(p: LoanProduct, amountKobo: number, tenorMonths: number): void {
    const bad = (message: string, code: string) => new BadRequestException({ message, code });
    if (!p.isActive) throw bad('This loan product is not available', 'PRODUCT_INACTIVE');
    if (amountKobo < Number(p.minAmountKobo) || amountKobo > Number(p.maxAmountKobo)) throw bad('The amount is outside the limits for this product', 'AMOUNT_OUT_OF_BOUNDS');
    if (tenorMonths < p.minTenorMonths || tenorMonths > p.maxTenorMonths) throw bad(`The tenor must be between ${p.minTenorMonths} and ${p.maxTenorMonths} months`, 'TENOR_OUT_OF_BOUNDS');
  }

  private async assertNoOtherOpen(customerId: string, productId: string, exceptId?: string): Promise<void> {
    const other = await this.prisma.loanApplication.findFirst({
      where: { customerId, productId, status: { in: OPEN_PRE_BOOKING.filter((s) => s !== 'DRAFT') }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (other) throw new ConflictException({ message: `There is already an open application (${other.reference}) for this product`, code: 'OPEN_APPLICATION_EXISTS', reference: other.reference });
  }

  /** APP-<yyyy>-<6-digit sequence>; derived from the highest existing reference of the year, retried on unique conflicts. */
  private async createWithReference(data: Omit<Prisma.LoanApplicationUncheckedCreateInput, 'reference'>): Promise<LoanApplication> {
    const year = new Date().getUTCFullYear();
    const prefix = `APP-${year}-`;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.loanApplication.findFirst({ where: { reference: { startsWith: prefix } }, orderBy: { reference: 'desc' }, select: { reference: true } });
          const seq = last ? parseInt(last.reference.slice(prefix.length), 10) + 1 : 1;
          return tx.loanApplication.create({ data: { ...data, reference: `${prefix}${String(seq + attempt).padStart(6, '0')}` } });
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 7) continue;
        throw e;
      }
    }
    throw new ConflictException('Could not allocate an application reference');
  }

  /* ───────────── create / submit / cancel ───────────── */

  /** Creates a DRAFT. `by` is the staff user (branch-scoped) or the customer themself. */
  async create(input: CreateInput, by: { staff?: AuthUser; customerId?: string }): Promise<LoanApplication> {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.erasedAt || (by.staff && !canSeeBranch(by.staff, customer.branchId))) throw new NotFoundException('Customer not found');
    const product = await this.product(input.productId);
    this.assertWithinProduct(product, input.amountKobo, input.tenorMonths);
    await this.assertNoOtherOpen(customer.id, product.id);
    const app = await this.createWithReference({
      customerId: customer.id, productId: product.id, branchId: customer.branchId, channel: by.staff ? 'BRANCH' : 'PORTAL',
      requestedAmountKobo: BigInt(input.amountKobo), tenorMonths: input.tenorMonths, purpose: input.purpose?.trim() || null, status: 'DRAFT',
      pricing: pricingFromProduct(product) as unknown as Prisma.InputJsonValue, createdById: by.staff?.id ?? null,
    });
    await this.prisma.applicationEvent.create({
      data: { applicationId: app.id, fromStatus: null, toStatus: 'DRAFT', actorType: by.staff ? 'STAFF' : 'CUSTOMER', actorId: by.staff?.id ?? customer.id, actorName: by.staff?.fullName ?? 'Customer', reason: null },
    });
    await this.audit.record({
      action: 'application.created', resourceType: 'LoanApplication', resourceId: app.id, branchId: app.branchId,
      ...(by.staff ? {} : { actorId: customer.id, actorName: 'Customer', actorRole: 'Customer (portal)' }),
      after: { reference: app.reference, productId: product.id, amountKobo: input.amountKobo, tenorMonths: input.tenorMonths, channel: app.channel },
    });
    return app;
  }

  /** DRAFT → SUBMITTED, refresh pricing snapshot, attach documents, fraud hook, then run the pipeline. */
  async submit(applicationId: string, actor: ActorRef): Promise<LoanApplication> {
    const app = await this.prisma.loanApplication.findUnique({ where: { id: applicationId }, include: { product: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status === 'DRAFT') {
      this.assertWithinProduct(app.product, Number(app.requestedAmountKobo), app.tenorMonths);
      await this.assertNoOtherOpen(app.customerId, app.productId, app.id);
      // pricing is frozen at submission (the draft may be days old)
      await this.prisma.loanApplication.update({ where: { id: app.id }, data: { pricing: pricingFromProduct(app.product) as unknown as Prisma.InputJsonValue } });
      await this.transitions.apply(app.id, 'SUBMITTED', actor, { statusReason: 'Application received' });
      try { await this.documents?.attachToApplication(app.customerId, app.id); } catch (e) { this.log.warn(`attach documents failed: ${(e as Error).message}`); }
      try { await this.fraud?.onApplicationSubmitted(app.customerId, app.id); } catch (e) { this.log.warn(`fraud hook failed: ${(e as Error).message}`); }
    }
    return this.pipeline.advance(app.id);
  }

  /* ───────────── staff ───────────── */

  async list(user: AuthUser, q: ListQuery): Promise<Page<ApplicationSummaryDto>> {
    const and: Prisma.LoanApplicationWhereInput[] = [branchWhere(user) as Prisma.LoanApplicationWhereInput];
    if (q.q) and.push({ OR: [{ reference: { contains: q.q } }, { product: { name: { contains: q.q } } }] });
    if (q.status) and.push({ status: q.status });
    if (q.productId) and.push({ productId: q.productId });
    if (q.branchId) and.push({ branchId: q.branchId });
    if (q.outcome) and.push({ assessments: { some: { outcome: q.outcome } } });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.loanApplication.findMany({ where, include: includeList, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.loanApplication.count({ where }),
    ]);
    return paged(rows.map((r) => this.toSummary(r)), total, q.page, q.pageSize);
  }

  toSummary(r: ListRow): ApplicationSummaryDto {
    const a = r.assessments[0];
    return {
      id: r.id, reference: r.reference, customer: { id: r.customerId, name: maskName(`${r.customer.firstName} ${r.customer.lastName}`) },
      product: { id: r.productId, name: r.product.name }, amountKobo: Number(r.requestedAmountKobo), tenorMonths: r.tenorMonths, status: r.status as ApplicationStatus,
      statusReason: r.statusReason, eligibilityOutcome: (a?.outcome as EligibilityOutcome | undefined) ?? null, score: a?.score ?? null,
      branch: r.customer.branch ? { id: r.customer.branch.id, code: r.customer.branch.code, name: r.customer.branch.name } : null,
      submittedAt: r.submittedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    };
  }

  /** Loads for staff, enforcing branch scope (404 outside it). */
  async getForStaff(user: AuthUser, id: string): Promise<LoanApplication> {
    const a = await this.prisma.loanApplication.findUnique({ where: { id } });
    if (!a || !canSeeBranch(user, a.branchId)) throw new NotFoundException('Application not found');
    return a;
  }

  async detail(user: AuthUser, id: string): Promise<ApplicationDetailDto> {
    await this.getForStaff(user, id);
    return this.buildDetail(id, user);
  }

  private async buildDetail(id: string, user: AuthUser): Promise<ApplicationDetailDto> {
    const r = await this.prisma.loanApplication.findUniqueOrThrow({ where: { id }, include: { ...includeList, events: { orderBy: { createdAt: 'asc' } } } });
    const pricing = readPricing(r.pricing);
    const status = r.status as ApplicationStatus;
    const latest = r.assessments[0] ?? null;
    const [docs, satisfied, bureau, fraud, reviewers] = await Promise.all([
      this.prisma.kycDocument.findMany({ where: { customerId: r.customerId, deletedAt: null, OR: [{ applicationId: r.id }, { applicationId: null }] }, orderBy: { uploadedAt: 'desc' } }),
      this.pipeline.satisfiedKinds(r.customerId, r.id),
      this.bureauSummary(r.customerId),
      this.prisma.fraudSignal.findMany({ where: { customerId: r.customerId }, orderBy: { createdAt: 'desc' }, take: 25 }),
      this.prisma.staffUser.findMany({ select: { id: true, fullName: true } }),
    ]);
    const names = new Map(reviewers.map((u) => [u.id, u.fullName]));
    const documents: StaffDocumentDto[] = docs.map((d) => ({
      id: d.id, kind: d.kind as StaffDocumentDto['kind'], fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, scanStatus: d.scanStatus as StaffDocumentDto['scanStatus'],
      reviewStatus: d.reviewStatus as StaffDocumentDto['reviewStatus'], reviewNote: d.reviewNote, applicationId: d.applicationId, uploadedAt: d.uploadedAt.toISOString(),
      customerId: d.customerId, sha256: d.sha256, scanEngine: d.scanEngine, reviewedBy: d.reviewedById ? { id: d.reviewedById, name: names.get(d.reviewedById) ?? 'Staff' } : null,
    }));
    const events: ApplicationEventDto[] = r.events.map((e) => ({
      id: e.id, from: (e.fromStatus as ApplicationStatus | null), to: e.toStatus as ApplicationStatus, actor: { type: e.actorType as ApplicationEventDto['actor']['type'], name: e.actorName }, reason: e.reason, at: e.createdAt.toISOString(),
    }));
    const maxAge = await this.bureauMaxAgeDays();
    const scorecard = latest ? await this.prisma.scorecard.findUnique({ where: { id: latest.scorecardId } }) : null;
    const fraudSignals: FraudSignalDto[] = fraud.map((f) => ({
      id: f.id, type: f.type as FraudSignalDto['type'], severity: f.severity as FraudSignalDto['severity'], detail: f.detail, relatedCustomerId: f.relatedCustomerId,
      createdAt: f.createdAt.toISOString(), resolvedAt: f.resolvedAt?.toISOString() ?? null, resolutionNote: f.resolutionNote,
    }));
    const tier = Math.max(0, Math.min(3, r.customer.kycTier)) as KycTier;
    return {
      ...this.toSummary(r), purpose: r.purpose, channel: r.channel === 'BRANCH' ? 'BRANCH' : 'PORTAL', interestMethod: pricing.interestMethod, monthlyRateBps: pricing.monthlyRateBps,
      quote: this.quote(r), eligibility: latest ? toEligibilityResultDto(latest, scorecard) : null,
      bureau: bureau ? { reportId: bureau.reportId, pulledAt: bureau.pulledAt.toISOString(), summary: bureau.summary, stale: Date.now() - bureau.pulledAt.getTime() > maxAge * 86_400_000 } : null,
      documents, requiredDocs: requiredDocsOf(r.product).map((kind) => ({ kind, satisfied: satisfied.has(kind) })), events,
      allowedTransitions: allowedStaffTransitions(status, user.permissions), kyc: { tier, maxLoanKobo: await this.tierCap(tier) }, fraudSignals,
      customerDetailHref: `/customers/${r.customerId}`,
    };
  }

  private async bureauMaxAgeDays(): Promise<number> {
    const s = await this.prisma.systemSetting.findUnique({ where: { key: 'bureau.pre_disbursement_max_age_days' } });
    return typeof s?.value === 'number' ? s.value : 14;
  }

  private async bureauSummary(customerId: string) {
    try { return (await this.bureau?.latestSummary(customerId)) ?? null; } catch (e) { this.log.warn(`bureau summary failed: ${(e as Error).message}`); return null; }
  }

  private quote(r: Pick<LoanApplication, 'pricing' | 'requestedAmountKobo' | 'tenorMonths' | 'submittedAt'>): LoanQuoteDto {
    return buildQuote(readPricing(r.pricing), Number(r.requestedAmountKobo), r.tenorMonths, r.submittedAt ?? undefined);
  }

  async createStaff(user: AuthUser, input: CreateInput): Promise<ApplicationDetailDto> {
    const app = await this.create(input, { staff: user });
    return this.buildDetail(app.id, user);
  }

  async submitStaff(user: AuthUser, id: string): Promise<ApplicationDetailDto> {
    await this.getForStaff(user, id);
    await this.submit(id, staffActor(user));
    return this.buildDetail(id, user);
  }

  async transitionStaff(user: AuthUser, id: string, to: ApplicationStatus, reason?: string): Promise<ApplicationDetailDto> {
    const app = await this.getForStaff(user, id);
    const from = app.status as ApplicationStatus;
    if (DEDICATED_FLOW_STATUSES.has(to)) {
      throw new ConflictException({
        message: `${to} has its own flow and cannot be set directly. Use ${DEDICATED_FLOW_HINT[to] ?? 'the dedicated endpoint for this transition'}.`,
        code: 'USE_DEDICATED_ENDPOINT', to,
      });
    }
    const def = findTransition(from, to, 'STAFF');
    if (def?.permission && !user.permissions.has(def.permission)) {
      throw new ForbiddenException({ message: 'You do not have permission to perform this action', code: 'FORBIDDEN', required: [def.permission] });
    }
    if (from === 'DRAFT' && to === 'SUBMITTED') await this.submit(id, staffActor(user));
    else await this.transitions.apply(id, to, staffActor(user), { reason });
    return this.buildDetail(id, user);
  }

  async reassess(user: AuthUser, id: string): Promise<ApplicationDetailDto> {
    const app = await this.getForStaff(user, id);
    if (['DRAFT', 'CANCELLED'].includes(app.status)) throw new ConflictException({ message: 'This application cannot be reassessed in its current state', code: 'ILLEGAL_STATE' });
    await this.pipeline.reassess(id, user.id);
    await this.audit.record({ action: 'application.reassessed', resourceType: 'LoanApplication', resourceId: id, branchId: app.branchId, metadata: { status: app.status } });
    return this.buildDetail(id, user);
  }

  quoteFor(pricingSource: LoanProduct, amountKobo: number, tenorMonths: number): LoanQuoteDto {
    this.assertWithinProduct(pricingSource, amountKobo, tenorMonths);
    return buildQuote(pricingFromProduct(pricingSource), amountKobo, tenorMonths);
  }

  async schedulePreview(b: { productId: string; amountKobo: number; tenorMonths: number }): Promise<LoanQuoteDto> {
    return this.quoteFor(await this.product(b.productId), b.amountKobo, b.tenorMonths);
  }

  /* ───────────── portal ───────────── */

  async portalProducts(customerId: string): Promise<PortalProductDto[]> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { kycTier: true } });
    const tier = c?.kycTier ?? 0;
    const cap = await this.tierCap(tier);
    const rows = await this.prisma.loanProduct.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    return rows.map((p) => toPortalProductDto(p, tier, cap));
  }

  async portalCreate(
    customerId: string,
    b: {
      productId: string; amountKobo: number; tenorMonths: number; purpose?: string;
      selfReportedIncomeKobo?: number; selfReportedOutstandingKobo?: number;
      collateralStockDesc?: string; collateralPropertyDesc?: string;
      guarantors?: Array<{ firstName: string; lastName: string; phone: string; relationship: string; occupation?: string; dateOfBirth?: string; bvn?: string; address: { line1: string; city: string; state: string; landmark?: string }; idType?: string }>;
    },
  ): Promise<PortalApplicationDto> {
    const app = await this.create({ customerId, productId: b.productId, amountKobo: b.amountKobo, tenorMonths: b.tenorMonths, purpose: b.purpose }, { customerId });
    // Attach extras (collateral, self-reported income) before submitting
    if (b.selfReportedIncomeKobo || b.selfReportedOutstandingKobo || b.collateralStockDesc || b.collateralPropertyDesc) {
      await this.prisma.loanApplication.update({
        where: { id: app.id },
        data: {
          selfReportedIncomeKobo: b.selfReportedIncomeKobo != null ? BigInt(b.selfReportedIncomeKobo) : undefined,
          selfReportedOutstandingKobo: b.selfReportedOutstandingKobo != null ? BigInt(b.selfReportedOutstandingKobo) : undefined,
          collateralStockDesc: b.collateralStockDesc ?? undefined,
          collateralPropertyDesc: b.collateralPropertyDesc ?? undefined,
        },
      });
    }
    // Attach guarantors before submitting
    if (b.guarantors?.length) {
      for (const g of b.guarantors) {
        await this.addGuarantor(app.id, customerId, g);
      }
    }
    await this.submit(app.id, customerActor(customerId));
    return this.portalGet(customerId, app.id);
  }

  /** Best-effort: lets the customer's next poll move a waiting application forward after consent/KYC/upload. Never throws. */
  private async lazyAdvance(a: { id: string; status: string }): Promise<void> {
    if (!['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK'].includes(a.status)) return;
    try { await this.pipeline.advance(a.id); } catch (e) { this.log.warn(`lazy advance failed for ${a.id}: ${(e as Error).message}`); }
  }

  async portalList(customerId: string): Promise<PortalApplicationDto[]> {
    const rows = await this.prisma.loanApplication.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 50 });
    await Promise.all(rows.map((r) => this.lazyAdvance(r)));
    return Promise.all(rows.map((r) => this.toPortal(r.id)));
  }

  /** Own applications only: anything else is a 404 (no existence leak). */
  private async ownOrThrow(customerId: string, id: string): Promise<LoanApplication> {
    const a = await this.prisma.loanApplication.findFirst({ where: { id, customerId } });
    if (!a) throw new NotFoundException('Application not found');
    return a;
  }

  async portalGet(customerId: string, id: string): Promise<PortalApplicationDto> {
    const a = await this.ownOrThrow(customerId, id);
    await this.lazyAdvance(a);
    return this.toPortal(id);
  }

  async portalCancel(customerId: string, id: string, reason?: string): Promise<PortalApplicationDto> {
    await this.ownOrThrow(customerId, id);
    await this.transitions.apply(id, 'CANCELLED', customerActor(customerId), { reason: reason?.trim() || 'Cancelled by customer', statusReason: 'Cancelled by you' });
    return this.toPortal(id);
  }

  async portalAdvance(customerId: string, id: string): Promise<PortalApplicationDto> {
    await this.ownOrThrow(customerId, id);
    await this.pipeline.advance(id);
    return this.toPortal(id);
  }

  async toPortal(id: string): Promise<PortalApplicationDto> {
    const r = await this.prisma.loanApplication.findUniqueOrThrow({
      where: { id },
      include: { product: true, customer: true, assessments: { orderBy: { createdAt: 'desc' }, take: 1 }, guarantors: true },
    });
    const status = r.status as ApplicationStatus;
    const copy = CUSTOMER_STATUS_COPY[status];
    const satisfied = await this.pipeline.satisfiedKinds(r.customerId, r.id);
    const requiredDocs = requiredDocsOf(r.product).map((kind) => ({ kind, satisfied: satisfied.has(kind) }));
    const latest: EligibilityAssessment | undefined = r.assessments[0];
    const eligibility: EligibilityCustomerDto | null = latest ? toCustomerView(toEligibilityResultDto(latest, null)) : null;
    const reasonShown = ['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK', 'REJECTED'].includes(status) && r.statusReason;
    return {
      id: r.id, reference: r.reference, product: { id: r.productId, name: r.product.name }, amountKobo: Number(r.requestedAmountKobo), tenorMonths: r.tenorMonths,
      purpose: r.purpose, status, statusLabel: copy.label,
      statusMessage: status === 'REJECTED' ? `${copy.message}${reasonShown ? ` ${r.statusReason}` : ''}` : reasonShown ? (r.statusReason as string) : copy.message,
      nextAction: await this.nextAction(r as LoanApplication & { product: LoanProduct }, r.customer, requiredDocs), requiredDocs, eligibility, quote: this.quote(r),
      submittedAt: r.submittedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
      guarantors: r.guarantors.map((g) => ({
        id: g.id, firstName: g.firstName, lastName: g.lastName, phone: '****', relationship: g.relationship,
        occupation: g.occupation ?? null, idType: g.idType ?? null, createdAt: g.createdAt.toISOString(),
      })),
      collateralStockDesc: r.collateralStockDesc ?? null,
      collateralPropertyDesc: r.collateralPropertyDesc ?? null,
      selfReportedIncomeKobo: r.selfReportedIncomeKobo ? Number(r.selfReportedIncomeKobo) : null,
    };
  }

  /** What is the customer blocking on right now (derived live, so it clears as soon as they act). */
  private async nextAction(r: LoanApplication & { product: LoanProduct }, c: Customer, docs: { kind: string; satisfied: boolean }[]): Promise<NextAction> {
    if (!['SUBMITTED', 'KYC_PENDING', 'BUREAU_CHECK'].includes(r.status)) return null;
    if (c.kycTier < r.product.minKycTier || !c.bvnEnc) return { type: 'COMPLETE_KYC', label: 'Complete identity verification', href: '/portal/onboarding' };
    if (docs.some((d) => !d.satisfied)) return { type: 'UPLOAD_DOCUMENT', label: 'Upload your required documents', href: '/portal/documents' };
    if (r.statusReason === MSG_WAIT_CONSENT || !(await this.pipeline.hasBureauConsent(c.id))) return { type: 'GIVE_CONSENT', label: 'Allow us to check your credit report', href: '/portal/consents' };
    return null;
  }

  /** Bureau-backed preview. Consent first (403 CONSENT_REQUIRED), then a per-customer hourly cap. */
  async portalEligibilityPreview(customerId: string, b: { productId: string; amountKobo: number; tenorMonths: number }): Promise<EligibilityCustomerDto> {
    const product = await this.product(b.productId);
    this.assertWithinProduct(product, b.amountKobo, b.tenorMonths);
    if (!(await this.pipeline.hasBureauConsent(customerId))) {
      throw new ForbiddenException({ message: 'We need your consent to check your credit report', code: 'CONSENT_REQUIRED', purpose: BUREAU_CONSENT_PURPOSE });
    }
    if (!this.eligibility) throw new HttpException({ statusCode: 503, message: 'Eligibility checks are temporarily unavailable', code: 'ELIGIBILITY_UNAVAILABLE' }, 503);
    this.takePreviewSlot(customerId);
    const r = await this.eligibility.assess({ customerId, productId: b.productId, amountKobo: b.amountKobo, tenorMonths: b.tenorMonths, noPull: false });
    return toCustomerView(r);
  }

  private takePreviewSlot(customerId: string): void {
    const now = Date.now();
    const recent = (this.previews.get(customerId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PREVIEW_LIMIT_PER_HOUR) {
      this.previews.set(customerId, recent);
      throw new HttpException({ statusCode: 429, message: 'You have checked your eligibility too many times. Please try again later.', code: 'RATE_LIMITED' }, 429);
    }
    recent.push(now);
    this.previews.set(customerId, recent);
  }

  /* ───────────── application extras (collateral, self-reported income) ───────────── */

  async updateExtras(
    applicationId: string,
    customerId: string,
    data: { selfReportedIncomeKobo?: number; selfReportedOutstandingKobo?: number; collateralStockDesc?: string; collateralPropertyDesc?: string },
  ): Promise<void> {
    const a = await this.prisma.loanApplication.findFirst({ where: { id: applicationId, customerId } });
    if (!a) throw new NotFoundException('Application not found');
    if (!['DRAFT'].includes(a.status)) throw new BadRequestException({ message: 'Application extras can only be updated while in DRAFT', code: 'WRONG_STATUS' });
    await this.prisma.loanApplication.update({
      where: { id: applicationId },
      data: {
        selfReportedIncomeKobo: data.selfReportedIncomeKobo != null ? BigInt(data.selfReportedIncomeKobo) : undefined,
        selfReportedOutstandingKobo: data.selfReportedOutstandingKobo != null ? BigInt(data.selfReportedOutstandingKobo) : undefined,
        collateralStockDesc: data.collateralStockDesc ?? undefined,
        collateralPropertyDesc: data.collateralPropertyDesc ?? undefined,
      },
    });
  }

  /* ───────────── guarantors ───────────── */

  private toGuarantorDto(g: Guarantor): GuarantorDto {
    return {
      id: g.id, firstName: g.firstName, lastName: g.lastName, phone: maskPhone(null), relationship: g.relationship,
      occupation: g.occupation ?? null, idType: g.idType ?? null, createdAt: g.createdAt.toISOString(),
    };
  }

  async listGuarantors(applicationId: string, customerId: string): Promise<GuarantorDto[]> {
    const a = await this.prisma.loanApplication.findFirst({ where: { id: applicationId, customerId } });
    if (!a) throw new NotFoundException('Application not found');
    const rows = await this.prisma.guarantor.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } });
    return rows.map((g) => this.toGuarantorDto(g));
  }

  async addGuarantor(
    applicationId: string,
    customerId: string,
    input: { firstName: string; lastName: string; phone: string; relationship: string; occupation?: string; dateOfBirth?: string; bvn?: string; address: { line1: string; city: string; state: string; landmark?: string }; idType?: string },
  ): Promise<GuarantorDto> {
    const a = await this.prisma.loanApplication.findFirst({ where: { id: applicationId, customerId }, include: { product: true } });
    if (!a) throw new NotFoundException('Application not found');
    if (!['DRAFT'].includes(a.status)) throw new BadRequestException({ message: 'Guarantors can only be added while the application is in DRAFT', code: 'WRONG_STATUS' });
    if (!a.product.allowGuarantor) throw new BadRequestException({ message: 'This loan product does not require a guarantor', code: 'GUARANTOR_NOT_ALLOWED' });
    const existing = await this.prisma.guarantor.count({ where: { applicationId } });
    if (existing >= 2) throw new BadRequestException({ message: 'A maximum of 2 guarantors is allowed per application', code: 'GUARANTOR_LIMIT' });
    const g = await this.prisma.guarantor.create({
      data: {
        applicationId, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
        phoneEnc: input.phone, phoneHash: input.phone,
        relationship: input.relationship, occupation: input.occupation ?? null,
        dobEnc: input.dateOfBirth ?? null, bvnEnc: input.bvn ?? null,
        addressEnc: JSON.stringify(input.address), idType: input.idType ?? null,
      },
    });
    await this.audit.record({ action: 'application.guarantor_added', resourceType: 'LoanApplication', resourceId: applicationId, after: { guarantorId: g.id, relationship: g.relationship } });
    return this.toGuarantorDto(g);
  }

  async removeGuarantor(applicationId: string, guarantorId: string, customerId: string): Promise<void> {
    const a = await this.prisma.loanApplication.findFirst({ where: { id: applicationId, customerId } });
    if (!a) throw new NotFoundException('Application not found');
    if (!['DRAFT'].includes(a.status)) throw new BadRequestException({ message: 'Guarantors can only be removed while the application is in DRAFT', code: 'WRONG_STATUS' });
    const g = await this.prisma.guarantor.findFirst({ where: { id: guarantorId, applicationId } });
    if (!g) throw new NotFoundException('Guarantor not found');
    await this.prisma.guarantor.delete({ where: { id: guarantorId } });
    await this.audit.record({ action: 'application.guarantor_removed', resourceType: 'LoanApplication', resourceId: applicationId, after: { guarantorId } });
  }

  /** Staff: add or remove guarantors by application ID (no customer ownership check). */
  async listGuarantorsStaff(applicationId: string): Promise<GuarantorDto[]> {
    const rows = await this.prisma.guarantor.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } });
    return rows.map((g) => this.toGuarantorDto(g));
  }
}
