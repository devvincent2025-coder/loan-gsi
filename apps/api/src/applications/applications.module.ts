import { Global, Module } from '@nestjs/common';
import { LOAN_PORTFOLIO_PORT } from '../contracts/ports';
import { LedgerLoanPortfolio } from '../loan-servicing/ledger-loan-portfolio';
import { ApplicationPipeline } from './application-pipeline';
import { ApplicationTransitions } from './application-transitions';
import { ApplicationsController, PortalApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Provides LOAN_PORTFOLIO_PORT; consumes (all @Optional) ELIGIBILITY_PORT, BUREAU_PORT, KYC_TIER_PORT, DOCUMENTS_PORT, FRAUD_PORT.
 * ApplicationPipeline is exported so other modules (consent/KYC/documents) may call `advance(applicationId)` after external events.
 * LOAN_PORTFOLIO_PORT is backed by `LedgerLoanPortfolio` (prompt 3: real Loan/LoanInstallment/Repayment tables, falling
 * back to the application-based heuristic for customers with no booked loan yet) — replaces the phase-2 placeholder
 * `ApplicationLoanPortfolio`, which is now unused.
 */
@Global()
@Module({
  controllers: [ApplicationsController, PortalApplicationsController],
  providers: [ApplicationTransitions, ApplicationPipeline, ApplicationsService, LedgerLoanPortfolio, { provide: LOAN_PORTFOLIO_PORT, useExisting: LedgerLoanPortfolio }],
  exports: [LOAN_PORTFOLIO_PORT, ApplicationPipeline, ApplicationsService, ApplicationTransitions],
})
export class ApplicationsModule {}
