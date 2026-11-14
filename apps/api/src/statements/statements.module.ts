import { Module } from '@nestjs/common';
import { StatementService } from './statement.service';
import { DojahStatementProvider, MonoStatementProvider } from './statement-providers';

/** Bank-statement analysis (CSV parser + Mono/Dojah providers, no mock). Consumes DOCUMENTS_PORT and BUREAU_PORT optionally. */
@Module({
  providers: [StatementService, MonoStatementProvider, DojahStatementProvider],
  exports: [StatementService],
})
export class StatementsModule {}
