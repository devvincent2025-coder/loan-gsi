import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Optional, Param, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  ApplicationSummaryDto, ApplicationStatus, bvnLookupSchema, customerCreateSchema, CustomerDetailDto, CustomerDto, EligibilityOutcome, KycTier, maskDigits, maskEmail, maskName, maskPhone, Page, pageQuerySchema,
  piiRevealSchema, PiiRevealResponse, RiskFlagDto,
} from '@damez/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, branchWhere, canSeeBranch } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { paged, skipTake } from '../common/pagination';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import { BUREAU_PORT, BureauPort, KYC_TIER_PORT, KycTierPort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { normalizePhone } from '../kyc/customer-pii';
import { consentDto, fraudDto, screeningDto, staffDocumentDto, verificationDto } from '../kyc/mappers';
import { PrismaService } from '../prisma/prisma.service';
import { BVN_PREFILL_PROVIDER, BvnPrefillNotConfiguredError, BvnPrefillProvider, InterswitchBvnPrefillProvider } from './bvn-prefill.provider';

const include = { branch: true } satisfies Prisma.CustomerInclude;
type Row = Prisma.CustomerGetPayload<{ include: typeof include }>;
const aad = (id: string, field: string) => `customer:${id}:${field}`;

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService, private cipher: FieldCipher, private audit: AuditService,
    // ports are optional so this module keeps working when the KYC / bureau modules are not wired (e.g. in isolated tests)
    @Optional() @Inject(BUREAU_PORT) private bureau?: BureauPort,
    @Optional() @Inject(KYC_TIER_PORT) private tiers?: KycTierPort,
    @Optional() @Inject(BVN_PREFILL_PROVIDER) private bvnPrefill?: BvnPrefillProvider,
  ) {}

  /** Pure lookup, no persistence: lets the Add Customer form fill itself in from the BVN instead of the officer typing it. */
  async bvnLookup(user: AuthUser, bvn: string): Promise<{ found: boolean; firstName?: string; lastName?: string; phone?: string; dateOfBirth?: string; gender?: 'MALE' | 'FEMALE' }> {
    if (!this.bvnPrefill) return { found: false };
    let result;
    try {
      result = await this.bvnPrefill.lookup(bvn);
    } catch (e) {
      if (e instanceof BvnPrefillNotConfiguredError) throw new ServiceUnavailableException({ message: 'BVN lookup is not available right now', code: 'NOT_CONFIGURED' });
      throw new ServiceUnavailableException({ message: 'BVN lookup failed. Enter the details manually.', code: 'BVN_LOOKUP_UNAVAILABLE' });
    }
    await this.audit.record({ action: 'customer.bvn_prelookup', resourceType: 'Customer', resourceId: `bvn:***${bvn.slice(-3)}`, metadata: { found: result.found, actorId: user.id } });
    return result;
  }

  /** Encrypt + blind-index helper that later onboarding code reuses. */
  encryptFields(id: string, f: { phone: string; bvn: string; email?: string | null; nin?: string | null; accountNumber?: string | null }) {
    return {
      phoneEnc: this.cipher.encrypt(f.phone, aad(id, 'phone')), phoneHash: this.cipher.blindIndex(f.phone, 'phone'),
      bvnEnc: this.cipher.encrypt(f.bvn, aad(id, 'bvn')), bvnHash: this.cipher.blindIndex(f.bvn, 'bvn'),
      emailEnc: f.email ? this.cipher.encrypt(f.email, aad(id, 'email')) : null, emailHash: f.email ? this.cipher.blindIndex(f.email, 'email') : null,
      ninEnc: f.nin ? this.cipher.encrypt(f.nin, aad(id, 'nin')) : null, ninHash: f.nin ? this.cipher.blindIndex(f.nin, 'nin') : null,
      accountNumberEnc: f.accountNumber ? this.cipher.encrypt(f.accountNumber, aad(id, 'accountNumber')) : null,
      accountNumberHash: f.accountNumber ? this.cipher.blindIndex(f.accountNumber, 'account') : null,
    };
  }

  /** Masked by default, always. */
  private toDto(c: Row): CustomerDto {
    const dec = (v: string | null, f: string) => (v ? this.cipher.decrypt(v, aad(c.id, f)) : null);
    return {
      id: c.id, fullName: maskName(`${c.firstName} ${c.lastName}`), phone: maskPhone(dec(c.phoneEnc, 'phone')), email: c.emailEnc ? maskEmail(dec(c.emailEnc, 'email')) : null,
      bvn: maskDigits(dec(c.bvnEnc, 'bvn'), 3), state: c.state, branch: c.branch ? { id: c.branch.id, code: c.branch.code, name: c.branch.name } : null,
      kycStatus: c.kycStatus, createdAt: c.createdAt.toISOString(),
    };
  }

  /** Branch staff create a customer directly (no portal self-registration involved). Branch defaults to the actor's own branch. */
  async create(user: AuthUser, input: z.infer<typeof customerCreateSchema>): Promise<CustomerDto> {
    const branchId = input.branchId ?? user.branchId;
    if (!branchId) throw new BadRequestException({ message: 'A branch is required', code: 'BRANCH_REQUIRED' });
    if (!canSeeBranch(user, branchId)) throw new ForbiddenException('You cannot create customers for that branch');

    const phone = normalizePhone(input.phone);
    const phoneHash = this.cipher.blindIndex(phone, 'phone');
    const bvnHash = this.cipher.blindIndex(input.bvn, 'bvn');
    const [dupPhone, dupBvn] = await Promise.all([
      this.prisma.customer.findUnique({ where: { phoneHash } }),
      this.prisma.customer.findUnique({ where: { bvnHash } }),
    ]);
    if (dupPhone && !dupPhone.erasedAt) throw new ConflictException({ message: 'A customer with this phone number already exists', code: 'DUPLICATE_PHONE' });
    if (dupBvn && !dupBvn.erasedAt) throw new ConflictException({ message: 'A customer with this BVN already exists', code: 'DUPLICATE_BVN' });

    const id = randomUUID();
    const fields = this.encryptFields(id, { phone, bvn: input.bvn, email: input.email ?? null });
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.customer.create({
          data: { id, firstName: input.firstName, lastName: input.lastName, branchId, state: input.state ?? null, ...fields },
          include,
        });
        await this.audit.record({ action: 'customer.created', resourceType: 'Customer', resourceId: id, branchId, after: { firstName: input.firstName, lastName: input.lastName } }, tx);
        return created;
      });
      return this.toDto(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException({ message: 'A customer with this phone number or BVN already exists', code: 'DUPLICATE_CUSTOMER' });
      throw e;
    }
  }

  async list(user: AuthUser, q: { page: number; pageSize: number; q?: string; kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED'; branchId?: string }): Promise<Page<CustomerDto>> {
    const and: Prisma.CustomerWhereInput[] = [branchWhere(user) as Prisma.CustomerWhereInput, { erasedAt: null }];
    if (q.kycStatus) and.push({ kycStatus: q.kycStatus });
    if (q.branchId) and.push({ branchId: q.branchId });
    if (q.q) and.push(this.searchWhere(q.q));
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({ where, include, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.pageSize) }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(rows.map((r) => this.toDto(r)), total, q.page, q.pageSize);
  }

  /** Name prefix, or exact match on phone / BVN / email / NIN / account via blind index (no decryption). */
  searchWhere(term: string): Prisma.CustomerWhereInput {
    const t = term.trim();
    const ors: Prisma.CustomerWhereInput[] = [{ firstName: { startsWith: t } }, { lastName: { startsWith: t } }];
    const parts = t.split(/\s+/);
    if (parts.length > 1) ors.push({ AND: [{ firstName: { startsWith: parts[0] } }, { lastName: { startsWith: parts[parts.length - 1] } }] });
    const digits = t.replace(/[\s-]/g, '');
    if (/^(\+?234|0)[789][01]\d{8}$/.test(digits)) ors.push({ phoneHash: this.cipher.blindIndex(digits, 'phone') });
    if (/^\d{11}$/.test(digits)) ors.push({ bvnHash: this.cipher.blindIndex(digits, 'bvn') }, { ninHash: this.cipher.blindIndex(digits, 'nin') });
    if (/^\d{10}$/.test(digits)) ors.push({ accountNumberHash: this.cipher.blindIndex(digits, 'account') });
    if (t.includes('@')) ors.push({ emailHash: this.cipher.blindIndex(t, 'email') });
    return { OR: ors };
  }

  /** Staff 360-lite view (prompt 2). Everything PII is masked; branch scoped; read-only queries over other modules' tables. */
  async detail(user: AuthUser, id: string): Promise<CustomerDetailDto> {
    const c = await this.prisma.customer.findUnique({ where: { id }, include });
    if (!c || c.erasedAt || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
    const dec = (v: string | null, f: string) => { try { return v ? this.cipher.decrypt(v, aad(c.id, f)) : null; } catch { return null; } };
    const [vers, docs, consents, screening, signals, flags, apps, bureau] = await Promise.all([
      this.prisma.kycVerification.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.kycDocument.findMany({ where: { customerId: id, deletedAt: null }, orderBy: { uploadedAt: 'desc' } }),
      this.prisma.consent.findMany({ where: { subjectType: 'CUSTOMER', subjectId: id }, orderBy: { grantedAt: 'desc' } }),
      this.prisma.screeningResult.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.fraudSignal.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.customerRiskFlag.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.loanApplication.findMany({ where: { customerId: id }, include: { product: { select: { id: true, name: true } }, assessments: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.bureau ? this.bureau.latestSummary(id).catch(() => null) : Promise.resolve(null),
    ]);
    const reviewerIds = [...new Set(docs.map((d) => d.reviewedById).filter((x): x is string => !!x))];
    const reviewers = reviewerIds.length ? await this.prisma.staffUser.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, fullName: true } }) : [];
    const branchIds = [...new Set(apps.map((a) => a.branchId).filter((x): x is string => !!x))];
    const branches = branchIds.length ? await this.prisma.branch.findMany({ where: { id: { in: branchIds } } }) : [];
    const maskedName = maskName(`${c.firstName} ${c.lastName}`);
    const tier = c.kycTier as KycTier;

    const riskFlags: RiskFlagDto[] = flags.map((f) => ({
      id: f.id, customerId: f.customerId, customerName: maskedName, type: f.type as RiskFlagDto['type'], source: f.source as RiskFlagDto['source'],
      severity: f.severity as RiskFlagDto['severity'], detail: f.detail, active: f.active, createdAt: f.createdAt.toISOString(),
    }));
    const applications: ApplicationSummaryDto[] = apps.map((a) => {
      const br = branches.find((b) => b.id === a.branchId);
      const as = a.assessments[0];
      return {
        id: a.id, reference: a.reference, customer: { id: c.id, name: maskedName }, product: { id: a.product.id, name: a.product.name }, amountKobo: Number(a.requestedAmountKobo),
        tenorMonths: a.tenorMonths, status: a.status as ApplicationStatus, statusReason: a.statusReason, eligibilityOutcome: (as?.outcome as EligibilityOutcome | undefined) ?? null,
        score: as?.score ?? null, branch: br ? { id: br.id, code: br.code, name: br.name } : null, submittedAt: a.submittedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(),
      };
    });
    return {
      id: c.id, fullName: maskedName, phone: maskPhone(dec(c.phoneEnc, 'phone')), email: c.emailEnc ? maskEmail(dec(c.emailEnc, 'email')) : null,
      bvn: c.bvnEnc ? maskDigits(dec(c.bvnEnc, 'bvn'), 3) : null, state: c.state, branch: c.branch ? { id: c.branch.id, code: c.branch.code, name: c.branch.name } : null,
      createdAt: c.createdAt.toISOString(), portalRegistered: !!c.portalRegisteredAt, phoneVerified: !!c.phoneVerifiedAt, emailVerified: !!c.emailVerifiedAt,
      employer: c.employer, employmentStatus: c.employmentStatus, monthlyIncomeKobo: c.monthlyIncomeKobo === null ? null : Number(c.monthlyIncomeKobo), salaryDay: c.salaryDay,
      kycTier: tier, kycStatus: c.kycStatus, maxLoanKobo: this.tiers ? await this.tiers.maxLoanKobo(tier) : 0,
      verifications: vers.map(verificationDto), documents: docs.map((d) => staffDocumentDto(d, reviewers.find((r) => r.id === d.reviewedById) ?? null)),
      consents: consents.map(consentDto), screening: screening.map(screeningDto), fraudSignals: signals.map(fraudDto), riskFlags, applications,
      bureau: bureau ? { reportId: bureau.reportId, pulledAt: bureau.pulledAt.toISOString(), summary: bureau.summary } : null,
    };
  }

  /** Soft-erase a customer (GDPR-style). Sets erasedAt; blocks if active loans exist. */
  async erase(user: AuthUser, id: string): Promise<void> {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c || c.erasedAt || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
    const activeLoans = await this.prisma.loan.count({
      where: { customerId: id, status: { in: ['ACTIVE', 'DISBURSED', 'Unpaid', 'RESTRUCTURED'] } },
    });
    if (activeLoans > 0) throw new BadRequestException({ message: `Cannot erase: customer has ${activeLoans} active loan(s)`, code: 'CUSTOMER_HAS_ACTIVE_LOANS' });
    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { erasedAt: new Date() } });
      await this.audit.record({ action: 'customer.erased', resourceType: 'Customer', resourceId: id, branchId: c.branchId, metadata: { erasedBy: user.id } }, tx);
    });
  }

  /** Reveal one PII field: permission + branch scope + mandatory reason + audit (value is never written to the log). */
  async reveal(user: AuthUser, input: z.infer<typeof piiRevealSchema>): Promise<PiiRevealResponse> {
    const c = await this.prisma.customer.findUnique({ where: { id: input.id } });
    if (!c || c.erasedAt || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
    const col = ({ bvn: c.bvnEnc, nin: c.ninEnc, phone: c.phoneEnc, email: c.emailEnc, accountNumber: c.accountNumberEnc } as const)[input.field];
    if (!col) throw new BadRequestException(`No ${input.field} on file`);
    const value = this.cipher.decrypt(col, aad(c.id, input.field));
    await this.audit.record({
      action: 'pii.revealed', resourceType: 'Customer', resourceId: c.id, branchId: c.branchId,
      metadata: { field: input.field, reason: input.reason },
    });
    return { value, revealedAt: new Date().toISOString() };
  }
}

const customerListQuery = pageQuerySchema.extend({ kycStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(), branchId: z.string().optional() });

@Controller()
class CustomersController {
  constructor(private svc: CustomersService) {}

  @Get('customers') @RequirePermission('customer:read')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(customerListQuery)) q: z.infer<typeof customerListQuery>) { return this.svc.list(u, q); }

  @Post('customers') @HttpCode(201) @RequirePermission('customer:create')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(customerCreateSchema)) b: z.infer<typeof customerCreateSchema>) { return this.svc.create(u, b); }

  /** Pure BVN prefill for the Add Customer form; no record is created or changed. */
  @Post('customers/bvn-lookup') @HttpCode(200) @RequirePermission('customer:create')
  bvnLookup(@CurrentUser() u: AuthUser, @Body(new ZodPipe(bvnLookupSchema)) b: z.infer<typeof bvnLookupSchema>) { return this.svc.bvnLookup(u, b.bvn); }

  @Get('customers/:id') @RequirePermission('customer:read')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(u, id); }

  @Delete('customers/:id') @RequirePermission('customer:read') @HttpCode(204)
  erase(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (u.roleKey !== 'super_admin') throw new ForbiddenException('Only super admins can erase customer records');
    return this.svc.erase(u, id);
  }

  @Post('pii/reveal') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reveal(@CurrentUser() u: AuthUser, @Body(new ZodPipe(piiRevealSchema)) b: z.infer<typeof piiRevealSchema>) {
    if (!u.permissions.has('pii:reveal')) throw new ForbiddenException({ message: 'You do not have permission to reveal personal data', code: 'FORBIDDEN', required: ['pii:reveal'] });
    return this.svc.reveal(u, b);
  }
}

@Module({
  providers: [
    CustomersService,
    { provide: BVN_PREFILL_PROVIDER, inject: [APP_ENV], useFactory: (env: AppEnv): BvnPrefillProvider => new InterswitchBvnPrefillProvider(env) },
  ],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
