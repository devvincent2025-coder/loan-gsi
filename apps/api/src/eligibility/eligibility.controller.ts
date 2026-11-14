import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { eligibilityListQuery, EligibilityService, simulateSchema } from './eligibility.service';

@Controller()
export class EligibilityController {
  constructor(private svc: EligibilityService) {}

  @Post('eligibility/simulate') @HttpCode(200) @RequirePermission('eligibility:run', 'scorecard:read')
  simulate(@Body(new ZodPipe(simulateSchema)) b: z.infer<typeof simulateSchema>, @CurrentUser() u: AuthUser) { return this.svc.simulate(u, b); }

  @Get('customers/:id/eligibility') @RequireAnyPermission('eligibility:run', 'application:read')
  forCustomer(@Param('id') id: string, @Query(new ZodPipe(eligibilityListQuery)) q: z.infer<typeof eligibilityListQuery>, @CurrentUser() u: AuthUser) {
    return this.svc.listForCustomer(u, id, q.limit);
  }
}
