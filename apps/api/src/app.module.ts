import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApplicationsModule } from './applications/applications.module';
import { AutodebitModule } from './autodebit/autodebit.module';
import { BureauModule } from './bureau/bureau.module';
import { DisbursementModule } from './disbursement/disbursement.module';
import { LedgerModule } from './ledger/ledger.module';
import { LoanServicingModule } from './loan-servicing/loan-servicing.module';
import { BehaviourModule } from './behaviour/behaviour.module';
import { ExecutiveModule } from './executive/executive.module';
import { CollectionsModule } from './collections/collections.module';
import { Customer360Module } from './customer360/customer360.module';
import { LlmGatewayModule } from './llm-gateway/llm-gateway.module';
import { PiiVaultModule } from './pii-vault/pii-vault.module';
import { OffersModule } from './offers/offers.module';
import { UnderwritingModule } from './underwriting/underwriting.module';
import { DocumentsModule } from './documents/documents.module';
import { EligibilityModule } from './eligibility/eligibility.module';
import { FraudModule } from './fraud/fraud.module';
import { KycModule } from './kyc/kyc.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PortalAuthModule } from './portal-auth/portal-auth.module';
import { ProductsModule } from './products/products.module';
import { ScorecardsModule } from './scorecards/scorecards.module';
import { ScreeningModule } from './screening/screening.module';
import { StatementsModule } from './statements/statements.module';
import { StorageModule } from './storage/storage.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { AccessGuard } from './auth/access.guard';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { requestContext } from './common/request-context';
import { ConfigModule } from './config/config.module';
import { ConsentModule } from './consent/consent.module';
import { CryptoModule } from './crypto/crypto.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { LoggingModule } from './logging/logging.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PortalCoreModule } from './portal/portal-core.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RolesModule } from './roles/roles.module';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: Number(process.env.THROTTLE_TTL_SECONDS ?? 60) * 1000, limit: Number(process.env.THROTTLE_LIMIT ?? 300) }]),
    PrismaModule, CryptoModule, PortalCoreModule, LoggingModule, QueueModule, AuditModule, AuthModule, NotificationsModule, ApprovalsModule, ConsentModule,
    UsersModule, RolesModule, BranchesModule, SettingsModule, CustomersModule, SearchModule, DashboardModule, HealthModule, JobsModule,
    // Phase 2
    StorageModule, KycModule, FraudModule, ScreeningModule, DocumentsModule, OnboardingModule, PortalAuthModule,
    BureauModule, StatementsModule, ScorecardsModule, ProductsModule, EligibilityModule, ApplicationsModule,
    // Phase 3: ledger/disbursement/autodebit have no approval-handler ordering requirement; underwriting + loan-servicing
    // must come after ApprovalsModule and ApplicationsModule (their onModuleInit overwrites the stub approval handlers).
    LedgerModule, DisbursementModule, AutodebitModule, OffersModule, UnderwritingModule, LoanServicingModule,
    // Phase 4: PII vault and LlmGateway must come before modules that use them
    PiiVaultModule, LlmGatewayModule,
    BehaviourModule, Customer360Module, CollectionsModule,
    // Phase 5: supervisory intelligence
    ExecutiveModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', requestId);
        requestContext.run({ requestId, ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null, deviceFingerprint: (req.headers['x-device-fingerprint'] as string | undefined)?.slice(0, 128) ?? null }, next);
      })
      .forRoutes('*');
  }
}
