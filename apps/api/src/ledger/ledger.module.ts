import { Global, Module } from '@nestjs/common';
import { LEDGER_PORT } from '../contracts/ports';
import { EclService } from './ecl.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/**
 * Double-entry ledger + IFRS 9 staging/ECL (prompt 3). Global so DISBURSEMENT/AUTODEBIT/REPAYMENT modules can
 * `@Inject(LEDGER_PORT)` without a direct module dependency. Seeds the chart of accounts and the `ifrs9.config`
 * setting on boot, and schedules the nightly staging job on the `ledger` BullMQ queue.
 */
@Global()
@Module({
  controllers: [LedgerController, FinanceController],
  providers: [LedgerService, EclService, FinanceService, { provide: LEDGER_PORT, useExisting: LedgerService }],
  exports: [LEDGER_PORT, LedgerService, EclService],
})
export class LedgerModule {}
