import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { UnderwritingController } from './underwriting.controller';
import { UnderwritingService } from './underwriting.service';

/**
 * Registers the real LOAN_APPROVAL maker-checker handler (overwriting ApprovalsModule's stub) and the staff
 * underwriting console (queue, decisions, notes). Pulls in OffersModule (offer generation + portal acceptance),
 * so app.module.ts only needs to import UnderwritingModule — NOT OffersModule directly.
 *
 * IMPORTANT: must be imported AFTER ApprovalsModule in app.module.ts's `imports` array, so this module's
 * onModuleInit (which overwrites the LOAN_APPROVAL stub in the ApprovalRegistry) runs after ApprovalsModule's.
 */
@Module({ imports: [OffersModule], controllers: [UnderwritingController], providers: [UnderwritingService], exports: [UnderwritingService] })
export class UnderwritingModule {}
