import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import type { EclConfigDto, ProvisioningReportDto, SettlementReconciliationSummaryDto, TreasuryCashPositionDto } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { EclService } from './ecl.service';
import { FinanceService } from './finance.service';
import { EclConfigInput, eclConfigSchema, ProvisioningReportQuery, provisioningReportQuerySchema, ReconciliationSummaryQuery, reconciliationSummaryQuerySchema } from './ledger-schemas';

@Controller('finance')
export class FinanceController {
  constructor(private finance: FinanceService, private ecl: EclService) {}

  @Get('treasury/cash-position')
  @RequirePermission('treasury:read')
  cashPosition(): Promise<TreasuryCashPositionDto> {
    return this.finance.cashPosition();
  }

  @Get('treasury/reconciliation-summary')
  @RequirePermission('reconciliation:read')
  reconciliationSummary(@Query(new ZodPipe(reconciliationSummaryQuerySchema)) q: ReconciliationSummaryQuery): Promise<SettlementReconciliationSummaryDto> {
    return this.finance.reconciliationSummary(q.period);
  }

  @Get('ifrs9/provisioning-report')
  @RequirePermission('report:read')
  provisioningReport(@Query(new ZodPipe(provisioningReportQuerySchema)) q: ProvisioningReportQuery): Promise<ProvisioningReportDto> {
    return this.ecl.provisioningReport(q.asOfDate);
  }

  @Get('ifrs9/config')
  @RequirePermission('ledger:read')
  getConfig(): Promise<EclConfigDto> {
    return this.ecl.getConfig();
  }

  @Put('ifrs9/config')
  @RequirePermission('settings:update')
  setConfig(@Body(new ZodPipe(eclConfigSchema)) b: EclConfigInput, @CurrentUser() user: AuthUser): Promise<EclConfigDto> {
    return this.ecl.setConfig(b, user.id);
  }
}
