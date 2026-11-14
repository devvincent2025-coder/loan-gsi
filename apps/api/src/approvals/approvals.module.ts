import { Global, Module } from '@nestjs/common';
import { ApprovalRegistry } from './approval-registry';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Global()
@Module({ providers: [ApprovalRegistry, ApprovalsService], controllers: [ApprovalsController], exports: [ApprovalsService, ApprovalRegistry] })
export class ApprovalsModule {}
