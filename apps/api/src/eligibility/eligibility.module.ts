import { Global, Module } from '@nestjs/common';
import { ELIGIBILITY_PORT } from '../contracts/ports';
import { ProductsModule } from '../products/products.module';
import { ScorecardsModule } from '../scorecards/scorecards.module';
import { StatementsModule } from '../statements/statements.module';
import { EligibilityController } from './eligibility.controller';
import { EligibilityService } from './eligibility.service';

/** Provides ELIGIBILITY_PORT. Consumes BUREAU_PORT / KYC_TIER_PORT / FRAUD_PORT / LOAN_PORTFOLIO_PORT optionally. */
@Global()
@Module({
  imports: [ScorecardsModule, ProductsModule, StatementsModule],
  providers: [EligibilityService, { provide: ELIGIBILITY_PORT, useExisting: EligibilityService }],
  controllers: [EligibilityController],
  exports: [ELIGIBILITY_PORT, EligibilityService, ScorecardsModule, ProductsModule, StatementsModule],
})
export class EligibilityModule {}
