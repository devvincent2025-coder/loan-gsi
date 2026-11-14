import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOCUMENT_KINDS, DocumentKind, InterestMethod, LoanProductFullDto, PortalProductDto, ProductPatchResponse } from '@damez/shared';
import { PRODUCT_PRICING_FIELDS } from '../approvals/builtin-handlers';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { GENERAL_FIELDS, ProductCreateInput, ProductPatchInput } from './product-schemas';

type Row = Prisma.LoanProductGetPayload<object>;

const trimPct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** "1% management + 0.5% insurance deducted upfront" */
export function feesSummary(p: { processingFeeBps: number; managementFeeBps: number; insuranceFeeBps: number }): string {
  const parts = [
    p.processingFeeBps > 0 ? `${trimPct(p.processingFeeBps)} processing` : null,
    p.managementFeeBps > 0 ? `${trimPct(p.managementFeeBps)} management` : null,
    p.insuranceFeeBps > 0 ? `${trimPct(p.insuranceFeeBps)} insurance` : null,
  ].filter((x): x is string => !!x);
  return parts.length ? `${parts.join(' + ')} deducted upfront` : 'No upfront fees';
}

const docKinds = (v: Prisma.JsonValue | null): DocumentKind[] =>
  Array.isArray(v) ? (v.filter((x): x is DocumentKind => typeof x === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(x))) : [];

export function toFullDto(p: Row): LoanProductFullDto {
  return {
    id: p.id, code: p.code, name: p.name, minAmountKobo: Number(p.minAmountKobo), maxAmountKobo: Number(p.maxAmountKobo), monthlyRateBps: p.monthlyRateBps,
    minTenorMonths: p.minTenorMonths, maxTenorMonths: p.maxTenorMonths, isActive: p.isActive,
    description: p.description, interestMethod: p.interestMethod as InterestMethod, processingFeeBps: p.processingFeeBps, managementFeeBps: p.managementFeeBps,
    insuranceFeeBps: p.insuranceFeeBps, penaltyBpsPerDay: p.penaltyBpsPerDay, penaltyGraceDays: p.penaltyGraceDays, gracePeriodDays: p.gracePeriodDays,
    minKycTier: p.minKycTier, requiredDocs: docKinds(p.requiredDocs), minAge: p.minAge, maxAge: p.maxAge,
    eligibilityOverrides: (p.eligibilityOverrides as Record<string, unknown> | null) ?? {}, scorecardKey: p.scorecardKey, allowGuarantor: p.allowGuarantor, allowCollateral: p.allowCollateral,
  };
}

/** Customer-facing view. `lock` marks the product unavailable (e.g. KYC tier too low) with a friendly reason. */
export function toPortalDto(p: Row | LoanProductFullDto, lock?: { lockedReason: string } | null): PortalProductDto {
  const f = 'createdAt' in p ? toFullDto(p) : p;
  return {
    id: f.id, code: f.code, name: f.name, description: f.description, minAmountKobo: f.minAmountKobo, maxAmountKobo: f.maxAmountKobo,
    minTenorMonths: f.minTenorMonths, maxTenorMonths: f.maxTenorMonths, monthlyRateBps: f.monthlyRateBps, interestMethod: f.interestMethod, feesSummary: feesSummary(f),
    requiredDocs: f.requiredDocs, minKycTier: f.minKycTier, available: !lock && f.isActive, lockedReason: lock?.lockedReason ?? (f.isActive ? null : 'This loan is not available right now.'),
    allowGuarantor: f.allowGuarantor, allowCollateral: f.allowCollateral,
  };
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private approvals: ApprovalsService) {}

  readonly toFullDto = toFullDto;
  readonly toPortalDto = toPortalDto;

  async list(): Promise<LoanProductFullDto[]> {
    return (await this.prisma.loanProduct.findMany({ orderBy: { name: 'asc' } })).map(toFullDto);
  }
  async get(id: string): Promise<LoanProductFullDto> {
    const p = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return toFullDto(p);
  }

  private fail(errors: Record<string, string[]>): never {
    throw new BadRequestException({ statusCode: 400, message: 'Validation failed', code: 'VALIDATION_FAILED', errors });
  }
  private checkBounds(v: { minAmountKobo: number; maxAmountKobo: number; minTenorMonths: number; maxTenorMonths: number; minAge: number; maxAge: number }): void {
    const e: Record<string, string[]> = {};
    if (v.minAmountKobo > v.maxAmountKobo) e.minAmountKobo = ['Minimum amount cannot exceed the maximum'];
    if (v.minTenorMonths > v.maxTenorMonths) e.minTenorMonths = ['Minimum tenor cannot exceed the maximum'];
    if (v.minAge > v.maxAge) e.minAge = ['Minimum age cannot exceed the maximum'];
    if (Object.keys(e).length) this.fail(e);
  }
  private async checkScorecardKey(key: string): Promise<void> {
    if (!(await this.prisma.scorecard.findFirst({ where: { key } }))) this.fail({ scorecardKey: [`No scorecard exists with key "${key}"`] });
  }

  async create(user: AuthUser, b: ProductCreateInput): Promise<LoanProductFullDto> {
    this.checkBounds(b);
    await this.checkScorecardKey(b.scorecardKey);
    if (await this.prisma.loanProduct.findUnique({ where: { code: b.code } })) throw new ConflictException({ message: `Product code ${b.code} already exists`, code: 'PRODUCT_CODE_TAKEN' });
    const row = await this.prisma.$transaction(async (tx) => {
      const p = await tx.loanProduct.create({
        data: { ...b, requiredDocs: b.requiredDocs as Prisma.InputJsonValue, eligibilityOverrides: b.eligibilityOverrides as Prisma.InputJsonValue, isActive: false },
      });
      await this.audit.record({ action: 'product.created', resourceType: 'LoanProduct', resourceId: p.id, after: toFullDto(p), metadata: { by: user.id } }, tx);
      return p;
    });
    return toFullDto(row);
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    const p = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    // Loan.productId and LoanApplication.productId are FK-restricted (no cascade): any history, not just
    // currently-active loans, blocks a hard delete at the DB level. Check both before attempting it.
    const [loanCount, applicationCount] = await Promise.all([
      this.prisma.loan.count({ where: { productId: id } }),
      this.prisma.loanApplication.count({ where: { productId: id } }),
    ]);
    if (loanCount > 0 || applicationCount > 0) {
      throw new BadRequestException({
        message: `Cannot delete: ${loanCount} loan(s) and ${applicationCount} application(s) reference this product. Deactivate it instead.`,
        code: 'PRODUCT_HAS_HISTORY',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.loanProduct.delete({ where: { id } });
      await this.audit.record({ action: 'product.deleted', resourceType: 'LoanProduct', resourceId: id, before: toFullDto(p), metadata: { by: user.id } }, tx);
    });
  }

  /** Non-pricing fields apply now (audited); pricing fields become ONE PRODUCT_RATE_CHANGE request. */
  async patch(user: AuthUser, id: string, b: ProductPatchInput): Promise<ProductPatchResponse> {
    const cur = await this.prisma.loanProduct.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Product not found');
    const curDto = toFullDto(cur) as unknown as Record<string, unknown>;

    const general: Record<string, unknown> = {};
    const pricing: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) {
      if ((PRODUCT_PRICING_FIELDS as readonly string[]).includes(k)) { if (v !== curDto[k]) pricing[k] = v; }
      else if ((GENERAL_FIELDS as readonly string[]).includes(k)) general[k] = v;
    }
    const merged = { ...curDto, ...general } as unknown as Parameters<ProductsService['checkBounds']>[0];
    this.checkBounds(merged);
    if (typeof general.scorecardKey === 'string') await this.checkScorecardKey(general.scorecardKey);

    let product = toFullDto(cur);
    const changedGeneral = Object.entries(general).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(curDto[k]));
    if (changedGeneral.length) {
      const data = Object.fromEntries(changedGeneral) as Prisma.LoanProductUpdateInput;
      const row = await this.prisma.$transaction(async (tx) => {
        const u = await tx.loanProduct.update({ where: { id }, data });
        const after = toFullDto(u) as unknown as Record<string, unknown>;
        await this.audit.record({
          action: 'product.updated', resourceType: 'LoanProduct', resourceId: id,
          before: Object.fromEntries(changedGeneral.map(([k]) => [k, curDto[k]])), after: Object.fromEntries(changedGeneral.map(([k]) => [k, after[k]])),
        }, tx);
        return u;
      });
      product = toFullDto(row);
    }

    let approval = null;
    if (Object.keys(pricing).length) {
      const names = Object.keys(pricing).join(', ');
      approval = await this.approvals.submit(user, {
        type: 'PRODUCT_RATE_CHANGE',
        summary: `Change pricing of ${cur.name}: ${names}`,
        payload: { productId: id, productName: cur.name, changes: pricing, current: Object.fromEntries(Object.keys(pricing).map((k) => [k, curDto[k]])) },
      });
    }
    return { product, approval };
  }
}
