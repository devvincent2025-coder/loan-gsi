import { Body, Controller, Get, Global, HttpCode, Module, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FRAUD_PORT } from '../contracts/ports';
import { FraudService } from './fraud.service';

const resolveSchema = z.object({ note: z.string().trim().min(3, 'Add a short resolution note').max(500) });

@Controller()
class FraudController {
  constructor(private svc: FraudService) {}

  @Get('customers/:id/fraud-signals') @RequirePermission('fraud:read')
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.listFor(u, id); }

  @Post('customers/:id/fraud-scan') @HttpCode(200) @RequirePermission('fraud:read')
  scan(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.scan(u, id); }

  @Post('fraud-signals/:id/resolve') @HttpCode(200) @RequirePermission('fraud:resolve')
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resolveSchema)) b: z.infer<typeof resolveSchema>) { return this.svc.resolve(u, id, b.note); }
}

/** Provides FRAUD_PORT. */
@Global()
@Module({
  controllers: [FraudController],
  providers: [FraudService, { provide: FRAUD_PORT, useExisting: FraudService }],
  exports: [FraudService, FRAUD_PORT],
})
export class FraudModule {}
