import { createHash } from 'crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateMandateDto, MandateDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { APP_ENV, AppEnv } from '../config/config.module';
import { ConsentService } from '../consent/consent.module';
import type { MandatePort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { PrismaService } from '../prisma/prisma.service';

/** Stable 0-99 bucket from a string, used by every mock provider below for deterministic-but-varied outcomes. */
export function pseudoPercent(seed: string): number {
  const h = createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) % 100;
}

/* ───────────── NIBSS e-Mandate ───────────── */
async function requireNibssCreds(env: AppEnv): Promise<{ baseUrl: string; apiKey: string; clientId: string }> {
  const { NIBSS_BASE_URL: baseUrl, NIBSS_API_KEY: apiKey, NIBSS_CLIENT_ID: clientId } = env;
  if (!baseUrl || !apiKey || !clientId) throw new Error('NIBSS e-Mandate live provider is not configured (NIBSS_BASE_URL/API_KEY/CLIENT_ID)');
  return { baseUrl, apiKey, clientId };
}

/* ───────────── MandateService: implements MandatePort (createNibssEmandate / tokenizeCard / debit) ───────────── */
@Injectable()
export class MandateService implements MandatePort {
  constructor(
    private prisma: PrismaService,
    private cipher: FieldCipher,
    private audit: AuditService,
    private consent: ConsentService,
    @Inject(APP_ENV) private env: AppEnv,
  ) {}

  /** Always ACTIVE in mock mode (an e-Mandate registration with NIBSS/the bank). */
  async createNibssEmandate(args: { accountNumber: string; bankCode: string; bvn: string }): Promise<{ providerRef: string; status: 'ACTIVE' | 'PENDING' | 'FAILED' }> {
    if (this.env.NIBSS_EMANDATE_PROVIDER === 'live') {
      await requireNibssCreds(this.env);
      // TODO(nibss): POST {baseUrl}/emandate/create with {accountNumber, bankCode, bvn}, auth via apiKey/clientId.
      // NIBSS e-Mandate is a direct-debit mandate registered against the payer's account at their own bank; the
      // response carries a mandate reference used for subsequent debit requests.
      throw new Error('NIBSS e-Mandate live provider not implemented');
    }
    const providerRef = `NIBSS-MOCK-${createHash('sha256').update(`${args.accountNumber}:${args.bankCode}:${args.bvn}`).digest('hex').slice(0, 20)}`;
    return { providerRef, status: 'ACTIVE' };
  }

  /** Mock: deterministic fake last4/bin from the authorization ref. */
  async tokenizeCard(args: { authorizationRef: string }): Promise<{ providerRef: string; cardLast4: string; cardBin: string; status: 'ACTIVE' | 'FAILED' }> {
    if (this.env.NIBSS_EMANDATE_PROVIDER === 'live') {
      // TODO(vendor): Paystack/Flutterwave "charge authorization" pattern — the first charge returns an
      // `authorization_code`/token that can be reused for recurring debits; verify it here (e.g. Paystack
      // GET /transaction/verify/:reference) and persist the returned last4/bin alongside the token.
      throw new Error('Card tokenization live provider not implemented');
    }
    const h = createHash('sha256').update(args.authorizationRef).digest('hex');
    const providerRef = `CARD-MOCK-${h.slice(0, 20)}`;
    return { providerRef, cardLast4: h.slice(0, 4).replace(/[a-f]/g, '1'), cardBin: h.slice(4, 10).replace(/[a-f]/g, '5'), status: 'ACTIVE' };
  }

  /**
   * Mock: deterministic by hashing the idempotency key (so retries/tests are stable). 90% SUCCESS for the full
   * amount; of the remaining 10%, half PARTIAL (collects roughly half) and half FAILED (insufficient funds).
   */
  async debit(args: { providerRef: string; amountKobo: number; idempotencyKey: string }): Promise<{ status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; collectedKobo: number; failureReason?: string }> {
    if (this.env.NIBSS_EMANDATE_PROVIDER === 'live') {
      // TODO(nibss): submit a mandate-backed debit request referencing args.providerRef; NIBSS/the bank responds
      // synchronously or via webhook with the collected amount (insufficient funds => partial or zero collection).
      throw new Error('Mandate debit live provider not implemented');
    }
    const bucket = pseudoPercent(args.idempotencyKey);
    if (bucket < 90) return { status: 'SUCCESS', collectedKobo: args.amountKobo };
    if (bucket < 95) {
      const collectedKobo = Math.round(args.amountKobo * 0.4);
      return { status: 'PARTIAL', collectedKobo, failureReason: 'Insufficient funds (partial collection)' };
    }
    return { status: 'FAILED', collectedKobo: 0, failureReason: 'Insufficient funds' };
  }

  /* ───────────── mandate lifecycle (consent-gated) ───────────── */

  private toDto(m: { id: string; type: string; provider: string; status: string; linkedAccountId: string | null; cardLast4: string | null; priority: number; activatedAt: Date | null; failureReason: string | null }): MandateDto {
    return {
      id: m.id, type: m.type as MandateDto['type'], provider: m.provider, status: m.status as MandateDto['status'], linkedAccountId: m.linkedAccountId,
      cardLast4: m.cardLast4, priority: m.priority, activatedAt: m.activatedAt?.toISOString() ?? null, failureReason: m.failureReason,
    };
  }

  async createForCustomer(customerId: string, dto: CreateMandateDto): Promise<MandateDto> {
    if (!(await this.consent.hasValidConsent(customerId, 'GSI_AUTODEBIT'))) {
      throw new ForbiddenException({ message: 'Autodebit consent is required first', code: 'CONSENT_REQUIRED', purpose: 'GSI_AUTODEBIT' });
    }
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, bvnEnc: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const existingMandates = await this.prisma.mandate.count({ where: { customerId, status: 'ACTIVE' } });

    if (dto.type === 'NIBSS_EMANDATE') {
      if (!dto.linkedAccountId) throw new BadRequestException('linkedAccountId is required for a NIBSS e-Mandate');
      const la = await this.prisma.linkedAccount.findUnique({ where: { id: dto.linkedAccountId } });
      if (!la || la.customerId !== customerId) throw new NotFoundException('Linked account not found');
      if (la.status !== 'VERIFIED') throw new BadRequestException({ message: 'The linked account must be VERIFIED first', code: 'ACCOUNT_NOT_VERIFIED' });
      if (!customer.bvnEnc) throw new BadRequestException({ message: 'BVN verification is required first', code: 'BVN_REQUIRED' });
      const accountNumber = this.cipher.decrypt(la.accountNumberEnc, `linkedaccount:${customerId}:accountNumber`);
      const bvn = this.cipher.decrypt(customer.bvnEnc, `customer:${customerId}:bvn`);
      const result = await this.createNibssEmandate({ accountNumber, bankCode: la.bankCode, bvn });
      const created = await this.prisma.mandate.create({
        data: {
          customerId, type: 'NIBSS_EMANDATE', provider: this.env.NIBSS_EMANDATE_PROVIDER === 'live' ? 'nibss' : 'mock', status: result.status,
          providerRef: result.providerRef, linkedAccountId: la.id, priority: existingMandates, activatedAt: result.status === 'ACTIVE' ? new Date() : null,
          failureReason: result.status === 'FAILED' ? 'Mandate registration failed' : null,
        },
      });
      await this.audit.record({ action: 'mandate.created', resourceType: 'Mandate', resourceId: created.id, metadata: { customerId, type: 'NIBSS_EMANDATE', status: result.status } });
      return this.toDto(created);
    }

    if (dto.type === 'CARD_TOKEN') {
      if (!dto.cardAuthorizationRef) throw new BadRequestException('cardAuthorizationRef is required for card tokenization');
      const result = await this.tokenizeCard({ authorizationRef: dto.cardAuthorizationRef });
      const created = await this.prisma.mandate.create({
        data: {
          customerId, type: 'CARD_TOKEN', provider: this.env.NIBSS_EMANDATE_PROVIDER === 'live' ? 'live' : 'mock', status: result.status,
          providerRef: result.providerRef, cardLast4: result.cardLast4, cardBin: result.cardBin, priority: existingMandates,
          activatedAt: result.status === 'ACTIVE' ? new Date() : null, failureReason: result.status === 'FAILED' ? 'Card tokenization failed' : null,
        },
      });
      await this.audit.record({ action: 'mandate.created', resourceType: 'Mandate', resourceId: created.id, metadata: { customerId, type: 'CARD_TOKEN', status: result.status } });
      return this.toDto(created);
    }

    throw new BadRequestException('Unsupported mandate type');
  }

  async list(customerId: string): Promise<MandateDto[]> {
    const rows = await this.prisma.mandate.findMany({ where: { customerId, status: { not: 'REVOKED' } }, orderBy: { priority: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async revoke(customerId: string, id: string): Promise<void> {
    const m = await this.prisma.mandate.findUnique({ where: { id } });
    if (!m || m.customerId !== customerId) throw new NotFoundException('Mandate not found');
    await this.prisma.mandate.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await this.audit.record({ action: 'mandate.revoked', resourceType: 'Mandate', resourceId: id, metadata: { customerId } });
  }
}
