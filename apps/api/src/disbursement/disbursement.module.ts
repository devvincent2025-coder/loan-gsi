import { Global, Module } from '@nestjs/common';
import { PAYMENT_PROVIDER_PORT } from '../contracts/ports';
import { DisbursementController, DisbursementWebhookController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';
import { PaymentProviders } from './payment-providers';

/**
 * Provides PAYMENT_PROVIDER_PORT (made @Global so the autodebit module can consume it for linked-account name
 * enquiry without an explicit cross-import). Depends on BUREAU_PORT, LEDGER_PORT (both @Global, provided elsewhere)
 * and on ApprovalsModule / ApplicationsModule (both @Global, so no explicit `imports` needed for their DI tokens).
 */
@Global()
@Module({
  controllers: [DisbursementController, DisbursementWebhookController],
  providers: [
    PaymentProviders,
    DisbursementService,
    { provide: PAYMENT_PROVIDER_PORT, useFactory: (p: PaymentProviders) => p.get(), inject: [PaymentProviders] },
  ],
  exports: [DisbursementService, PAYMENT_PROVIDER_PORT],
})
export class DisbursementModule {}
