import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { NIGERIAN_BANKS, type AutodebitDashboardDto, type DebitAttemptDto, type LinkedAccountDto, type MandateDto, type OtpChallengeResponse } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentCustomer, CurrentUser, PortalAuth, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_ENV, AppEnv } from '../config/config.module';
import type { PortalUser } from '../portal/portal-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { AutodebitAnalyticsService } from './autodebit-analytics.service';
import { DebitEngineService } from './debit-engine.service';
import { GsiConsentService } from './gsi-consent.service';
import { LinkedAccountsService } from './linked-accounts.service';
import { MandateService } from './mandate.service';
import { computeRetryStage, daysPastDue, lagosHourOf, lagosToday, parseRetryLadder } from './retry-ladder';

const digits = (n: number, label: string) => z.string().trim().regex(new RegExp(`^\\d{${n}}$`), `${label} must be ${n} digits`);
const linkAccountSchema = z.object({
  accountNumber: digits(10, 'Account number'), bankCode: z.string().trim().refine((c) => NIGERIAN_BANKS.some((b) => b.code === c), 'Choose a supported bank'), isPrimary: z.boolean().optional(),
});
const createMandateSchema = z.object({
  type: z.enum(['NIBSS_EMANDATE', 'CARD_TOKEN']), linkedAccountId: z.string().min(1).optional(), cardAuthorizationRef: z.string().min(4).max(200).optional(),
});
const gsiConsentSchema = z.object({ acknowledged: z.boolean(), otpCode: digits(6, 'Code'), challengeId: z.string().min(8).max(64).optional() });
const triggerSchema = z.object({ loanId: z.string().optional(), installmentId: z.string().optional() });

/** Staff console endpoints. */
@Controller()
export class AutodebitController {
  constructor(private prisma: PrismaService, private engine: DebitEngineService, private analytics: AutodebitAnalyticsService, @Inject(APP_ENV) private env: AppEnv) {}

  @Get('loans/:id/debit-attempts') @RequirePermission('autodebit:read')
  async debitAttempts(@Param('id') loanId: string): Promise<DebitAttemptDto[]> {
    const rows = await this.prisma.debitAttempt.findMany({ where: { loanId }, orderBy: { scheduledFor: 'desc' } });
    return rows.map((r) => ({
      id: r.id, loanId: r.loanId, installmentId: r.installmentId, method: r.method, retryStage: r.retryStage, attemptNumber: r.attemptNumber,
      amountKobo: Number(r.amountKobo), collectedKobo: Number(r.collectedKobo), status: r.status, failureReason: r.failureReason,
      scheduledFor: r.scheduledFor.toISOString(), executedAt: r.executedAt?.toISOString() ?? null,
    }));
  }

  @Get('autodebit/dashboard') @RequirePermission('autodebit:read')
  dashboard(): Promise<AutodebitDashboardDto> { return this.analytics.dashboard(); }

  /** Manual run: without a target, plans the whole day's due ladder stages now; with loanId+installmentId, runs that one instalment immediately at its current stage. */
  @Post('autodebit/trigger') @HttpCode(200) @RequirePermission('autodebit:trigger')
  async trigger(@CurrentUser() _u: AuthUser, @Body(new ZodPipe(triggerSchema)) b: z.infer<typeof triggerSchema>) {
    if (b.loanId && b.installmentId) {
      const inst = await this.prisma.loanInstallment.findUniqueOrThrow({ where: { id: b.installmentId } });
      const stage = computeRetryStage(daysPastDue(inst.dueDate, lagosToday()), parseRetryLadder(this.env.AUTODEBIT_RETRY_LADDER), lagosHourOf());
      if (!stage) return { ran: false, reason: 'No retry stage is due for this instalment today' };
      const result = await this.engine.attemptDebit({ loanId: b.loanId, installmentId: b.installmentId, retryStage: stage });
      return { ran: true, result };
    }
    const result = await this.engine.planToday();
    return { ran: true, ...result };
  }
}

/** Customer portal endpoints: linked accounts, mandates, GSI consent. Callers only ever act on their own data. */
@Controller('portal')
export class PortalAutodebitController {
  constructor(
    private linkedAccounts: LinkedAccountsService, private mandates: MandateService, private gsiConsent: GsiConsentService,
  ) {}

  @Post('linked-accounts') @HttpCode(200) @PortalAuth()
  link(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(linkAccountSchema)) b: z.infer<typeof linkAccountSchema>): Promise<LinkedAccountDto> {
    return this.linkedAccounts.link(c.id, b);
  }

  @Get('linked-accounts') @PortalAuth()
  list(@CurrentCustomer() c: PortalUser): Promise<LinkedAccountDto[]> { return this.linkedAccounts.list(c.id); }

  @Delete('linked-accounts/:id') @HttpCode(200) @PortalAuth()
  async remove(@CurrentCustomer() c: PortalUser, @Param('id') id: string): Promise<{ removed: boolean }> {
    await this.linkedAccounts.remove(c.id, id);
    return { removed: true };
  }

  @Post('mandates') @HttpCode(200) @PortalAuth()
  createMandate(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(createMandateSchema)) b: z.infer<typeof createMandateSchema>): Promise<MandateDto> {
    return this.mandates.createForCustomer(c.id, b);
  }

  @Get('mandates') @PortalAuth()
  listMandates(@CurrentCustomer() c: PortalUser): Promise<MandateDto[]> { return this.mandates.list(c.id); }

  /** Issues the OTP a `POST /portal/gsi-consent` call will need (not part of the frozen DTO set: the GsiConsentDto only carries the answer). */
  @Post('gsi-consent/otp') @HttpCode(200) @PortalAuth()
  requestGsiOtp(@CurrentCustomer() c: PortalUser): Promise<OtpChallengeResponse> { return this.gsiConsent.requestOtp(c.id); }

  @Post('gsi-consent') @HttpCode(200) @PortalAuth()
  grantGsiConsent(@CurrentCustomer() c: PortalUser, @Body(new ZodPipe(gsiConsentSchema)) b: z.infer<typeof gsiConsentSchema>): Promise<{ granted: boolean }> {
    return this.gsiConsent.verifyAndGrant(c.id, b);
  }
}
