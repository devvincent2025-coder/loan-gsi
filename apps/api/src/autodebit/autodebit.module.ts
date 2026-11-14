import { Global, Module } from '@nestjs/common';
import { GSI_PORT, MANDATE_PORT } from '../contracts/ports';
import { AutodebitAnalyticsService } from './autodebit-analytics.service';
import { AutodebitController, PortalAutodebitController } from './autodebit.controller';
import { DebitEngineService } from './debit-engine.service';
import { GsiConsentService } from './gsi-consent.service';
import { GsiService } from './gsi.service';
import { LinkedAccountsService } from './linked-accounts.service';
import { MandateService } from './mandate.service';
import { MonoConnectProviders } from './mono-connect';

/**
 * Provides MANDATE_PORT + GSI_PORT (global, like the other Phase 2/3 port-providing modules). Depends on
 * PAYMENT_PROVIDER_PORT (disbursement module) and LEDGER_PORT (ledger module) by token only, so this module
 * boots fine even before those modules exist in `app.module.ts`.
 */
@Global()
@Module({
  controllers: [AutodebitController, PortalAutodebitController],
  providers: [
    MonoConnectProviders, LinkedAccountsService, MandateService, GsiService, GsiConsentService, DebitEngineService, AutodebitAnalyticsService,
    { provide: MANDATE_PORT, useExisting: MandateService },
    { provide: GSI_PORT, useExisting: GsiService },
  ],
  exports: [LinkedAccountsService, MandateService, GsiService, AutodebitAnalyticsService, MANDATE_PORT, GSI_PORT],
})
export class AutodebitModule {}
