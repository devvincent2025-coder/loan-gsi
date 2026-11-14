import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmGatewayModule } from '../llm-gateway/llm-gateway.module';
import { ConfigModule } from '../config/config.module';
import { AuditModule } from '../audit/audit.module';
import { PiiVaultModule } from '../pii-vault/pii-vault.module';
import { MetricsAggregationService } from './metrics-aggregation.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ExecutiveToolsService } from './executive-tools.service';
import { BriefingService } from './briefing.service';
import { ExecChatService } from './exec-chat.service';
import { ExecutiveController } from './executive.controller';

@Module({
  imports: [PrismaModule, LlmGatewayModule, ConfigModule, AuditModule, PiiVaultModule],
  providers: [
    MetricsAggregationService,
    AnomalyDetectionService,
    ExecutiveToolsService,
    BriefingService,
    ExecChatService,
  ],
  controllers: [ExecutiveController],
  exports: [MetricsAggregationService, AnomalyDetectionService, BriefingService],
})
export class ExecutiveModule {}
