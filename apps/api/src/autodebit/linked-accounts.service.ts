import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maskDigits, maskName, NIGERIAN_BANKS, type LinkedAccountDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { APP_ENV, AppEnv } from '../config/config.module';
import { ConsentService } from '../consent/consent.module';
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from '../contracts/ports';
import { FieldCipher } from '../crypto/field-cipher';
import { matchNames } from '../kyc/name-match';
import { PrismaService } from '../prisma/prisma.service';
import { MonoConnectProviders } from './mono-connect';

export interface LinkAccountInput { accountNumber: string; bankCode: string; isPrimary?: boolean }

const AAD_NUM = (customerId: string) => `linkedaccount:${customerId}:accountNumber`;
const AAD_NAME = (customerId: string) => `linkedaccount:${customerId}:accountName`;

/**
 * Additional BVN-matched bank accounts a customer links for GSI priority order, plus the primary repayment
 * account. Ownership is double-checked: (a) the payment provider's name enquiry vs. the customer's KYC name,
 * and (b) an open-banking check (Mono Connect, mock by default).
 */
@Injectable()
export class LinkedAccountsService {
  private mono: ReturnType<MonoConnectProviders['get']>;

  constructor(
    private prisma: PrismaService,
    private cipher: FieldCipher,
    private audit: AuditService,
    private consent: ConsentService,
    @Inject(APP_ENV) private env: AppEnv,
    @Inject(PAYMENT_PROVIDER_PORT) private paymentProvider: PaymentProviderPort,
    private monoProviders: MonoConnectProviders,
  ) {
    this.mono = this.monoProviders.get();
  }

  private bankName(bankCode: string): string {
    return NIGERIAN_BANKS.find((b) => b.code === bankCode)?.name ?? bankCode;
  }

  /** Verify ownership + link a bank account. */
  async link(customerId: string, input: LinkAccountInput): Promise<LinkedAccountDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, firstName: true, lastName: true, bvnEnc: true } });
    if (!customer) throw new NotFoundException('Customer not found');

    const accountNumberHash = this.cipher.blindIndex(input.accountNumber, 'linkedaccount:accountNumber');
    const existing = await this.prisma.linkedAccount.findFirst({ where: { customerId, accountNumberHash, bankCode: input.bankCode, status: { not: 'REMOVED' } } });
    if (existing) throw new ConflictException({ message: 'This account is already linked', code: 'ALREADY_LINKED' });

    const [nameEnquiry, bvn] = await Promise.all([
      this.paymentProvider.nameEnquiry(input.accountNumber, input.bankCode),
      Promise.resolve(customer.bvnEnc ? this.cipher.decrypt(customer.bvnEnc, `customer:${customerId}:bvn`) : null),
    ]);
    const nameMatch = matchNames({ firstName: customer.firstName, lastName: customer.lastName }, { fullName: nameEnquiry.accountName });
    const mono = await this.mono.verifyAccount({ accountNumber: input.accountNumber, bankCode: input.bankCode, bvn });

    const verified = nameMatch.status !== 'FAIL' && mono.verified;
    const failureReason = verified ? null : !mono.verified ? 'Open-banking ownership check failed' : 'Account holder name does not match your KYC name';

    const priorAccounts = await this.prisma.linkedAccount.findMany({ where: { customerId, status: { not: 'REMOVED' } }, orderBy: { priority: 'asc' } });
    const isPrimary = input.isPrimary ?? priorAccounts.length === 0;
    const priority = isPrimary ? 0 : (priorAccounts.filter((a) => !a.isPrimary).reduce((max, a) => Math.max(max, a.priority), 0) + 1);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (isPrimary) await tx.linkedAccount.updateMany({ where: { customerId, isPrimary: true }, data: { isPrimary: false } });
        const created = await tx.linkedAccount.create({
          data: {
            customerId, accountNumberHash, bankCode: input.bankCode, bankName: this.bankName(input.bankCode),
            accountNumberEnc: this.cipher.encrypt(input.accountNumber, AAD_NUM(customerId)),
            accountNameEnc: this.cipher.encrypt(nameEnquiry.accountName, AAD_NAME(customerId)),
            isPrimary, priority, status: verified ? 'VERIFIED' : 'FAILED', verificationMethod: 'NAME_ENQUIRY+MONO_CONNECT',
            verificationRef: mono.reference, bvnNameMatchScore: nameMatch.score, failureReason, verifiedAt: verified ? new Date() : null,
          },
        });
        await this.audit.record({
          action: 'linkedaccount.linked', resourceType: 'LinkedAccount', resourceId: created.id, outcome: verified ? 'SUCCESS' : 'DENIED',
          metadata: { customerId, bankCode: input.bankCode, nameMatchScore: nameMatch.score, monoVerified: mono.verified, isPrimary },
        }, tx);
        return created;
      });
      return this.toDtoDecrypted(row, customerId);
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') throw new ConflictException({ message: 'This account is already linked', code: 'ALREADY_LINKED' });
      throw e;
    }
  }

  private toDtoDecrypted(row: Awaited<ReturnType<PrismaService['linkedAccount']['create']>>, customerId: string): LinkedAccountDto {
    return {
      id: row.id, bankCode: row.bankCode, bankName: row.bankName,
      accountNumberMasked: maskDigits(this.cipher.decrypt(row.accountNumberEnc, AAD_NUM(customerId))),
      accountNameMasked: maskName(this.cipher.decrypt(row.accountNameEnc, AAD_NAME(customerId))),
      isPrimary: row.isPrimary, priority: row.priority, status: row.status, verificationMethod: row.verificationMethod,
      bvnNameMatchScore: row.bvnNameMatchScore, failureReason: row.failureReason,
      verifiedAt: row.verifiedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    };
  }

  async list(customerId: string): Promise<LinkedAccountDto[]> {
    const rows = await this.prisma.linkedAccount.findMany({ where: { customerId, status: { not: 'REMOVED' } }, orderBy: [{ isPrimary: 'desc' }, { priority: 'asc' }] });
    return rows.map((r) => this.toDtoDecrypted(r, customerId));
  }

  async remove(customerId: string, id: string): Promise<void> {
    const row = await this.prisma.linkedAccount.findUnique({ where: { id } });
    if (!row || row.customerId !== customerId) throw new NotFoundException('Linked account not found');
    if (row.status === 'REMOVED') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.linkedAccount.update({ where: { id }, data: { status: 'REMOVED', removedAt: new Date(), isPrimary: false } });
      await tx.mandate.updateMany({ where: { linkedAccountId: id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date(), failureReason: 'Linked account removed' } });
      await this.audit.record({ action: 'linkedaccount.removed', resourceType: 'LinkedAccount', resourceId: id, metadata: { customerId } }, tx);
    });
  }

  /** Count of VERIFIED accounts (primary + additional). */
  async verifiedCount(customerId: string): Promise<number> {
    return this.prisma.linkedAccount.count({ where: { customerId, status: 'VERIFIED' } });
  }

  /**
   * Primary + `env.AUTODEBIT_MIN_LINKED_ACCOUNTS` additional accounts, all VERIFIED. Used by the offers module
   * as the `linkedAccountsVerified` guard before OFFER_ACCEPTED.
   */
  async meetsMinimum(customerId: string): Promise<boolean> {
    const [primary, additional] = await Promise.all([
      this.prisma.linkedAccount.count({ where: { customerId, status: 'VERIFIED', isPrimary: true } }),
      this.prisma.linkedAccount.count({ where: { customerId, status: 'VERIFIED', isPrimary: false } }),
    ]);
    return primary >= 1 && additional >= this.env.AUTODEBIT_MIN_LINKED_ACCOUNTS;
  }

  /** Throws a 403 CONSENT_REQUIRED unless the customer has an active GSI_AUTODEBIT consent. */
  async requireAutodebitConsent(customerId: string): Promise<void> {
    if (!(await this.consent.hasValidConsent(customerId, 'GSI_AUTODEBIT'))) {
      throw new ForbiddenException({ message: 'Autodebit consent is required first', code: 'CONSENT_REQUIRED', purpose: 'GSI_AUTODEBIT' });
    }
  }
}
