import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { QUEUES, QueueService } from '../queue/queue.service';
import { LedgerLoanPortfolio } from './ledger-loan-portfolio';
import { LoanServicingController } from './loan-servicing.controller';
import { LoanServicingService } from './loan-servicing.service';
import { PortalLoanServicingController } from './portal-loan-servicing.controller';

/**
 * Daily delinquency/penalty-accrual job. Reuses QUEUES.maintenance (the existing generic cross-cutting queue) since
 * this module has no dedicated queue key of its own and queue/queue.service.ts (QUEUES) is frozen for this prompt.
 */
@Injectable()
export class LoanServicingJobs implements OnModuleInit {
  private log = new Logger('LoanServicingJobs');
  constructor(private queue: QueueService, private servicing: LoanServicingService) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.maintenance, async (name) => {
      if (name === 'loan-delinquency-check') return this.servicing.runDelinquencyCheck();
      return undefined;
    });
    // Daily at 01:00 Africa/Lagos: recompute dpd/penalty accrual and flip ACTIVE<->Unpaid as arrears open/clear.
    const t = setTimeout(() => {
      void this.queue.schedule(QUEUES.maintenance, 'loan-delinquency-check', { pattern: '0 1 * * *', tz: 'Africa/Lagos' }, 'loan-delinquency-check')
        .catch((e: Error) => this.log.warn(e.message));
    }, 4000);
    t.unref();
  }
}

/**
 * Loan servicing: early/part repayment, top-ups, restructuring, write-off/recovery, statements/receipts, and the
 * delinquency lifecycle.
 *
 * `LedgerLoanPortfolio` (the real, ledger-backed LOAN_PORTFOLIO_PORT implementation) is provided here but NOT bound
 * to the LOAN_PORTFOLIO_PORT token in this module — that binding lives in the (frozen, @Global()) ApplicationsModule
 * and must be swapped there (ApplicationLoanPortfolio → LedgerLoanPortfolio) by whoever wires modules centrally, to
 * avoid two modules both claiming the same global token. See this module's handoff notes for the exact edit.
 *
 * Registers ApprovalHandlers for RESTRUCTURE and WRITE_OFF (overwriting the stubs registered by ApprovalsModule),
 * so this module must be imported AFTER ApprovalsModule and ApplicationsModule in app.module.ts.
 */
@Module({
  imports: [StorageModule],
  controllers: [LoanServicingController, PortalLoanServicingController],
  providers: [LedgerLoanPortfolio, LoanServicingService, LoanServicingJobs],
  exports: [LedgerLoanPortfolio, LoanServicingService],
})
export class LoanServicingModule {}
