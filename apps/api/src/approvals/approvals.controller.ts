import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { APPROVAL_ACTION_TYPES, APPROVAL_STATUSES, approvalDecisionSchema, approvalPolicySchema, approvalSubmitSchema, pageQuerySchema } from '@damez/shared';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Idempotent, NoTouch, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ApprovalsService } from './approvals.service';

const listQuery = pageQuerySchema.extend({
  scope: z.enum(['pending_mine', 'submitted_by_me', 'all']).default('all'),
  // accepts a single status or a comma-separated list, e.g. "PENDING,ESCALATED"
  status: z
    .string()
    .optional()
    .refine((s) => !s || s.split(',').every((x) => (APPROVAL_STATUSES as readonly string[]).includes(x.trim())), {
      message: `Invalid status. Expected one or more of ${APPROVAL_STATUSES.join(', ')}, comma-separated`,
    })
    .transform((s) => s?.split(',').map((x) => x.trim()) as typeof APPROVAL_STATUSES[number][] | undefined),
  type: z.enum(APPROVAL_ACTION_TYPES).optional(),
});

@Controller('approvals')
export class ApprovalsController {
  constructor(private svc: ApprovalsService) {}

  @NoTouch()
  @Get()
  @RequirePermission('approval:read')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(u, q);
  }

  @Get('types')
  @RequirePermission('approval:read')
  types() {
    return this.svc.types();
  }

  @Put('policies/:type')
  @RequirePermission('approval:policy_manage')
  policy(@Param('type') type: string, @Body(new ZodPipe(approvalPolicySchema)) b: z.infer<typeof approvalPolicySchema>) {
    return this.svc.setPolicy(z.enum(APPROVAL_ACTION_TYPES).parse(type), b.thresholdKobo, b.enabled);
  }

  @Get(':id')
  @RequirePermission('approval:read')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.get(u, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('approval:submit')
  submit(@CurrentUser() u: AuthUser, @Body(new ZodPipe(approvalSubmitSchema)) b: z.infer<typeof approvalSubmitSchema>) {
    return this.svc.submit(u, b);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('approval:decide')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approvalDecisionSchema)) b: z.infer<typeof approvalDecisionSchema>) {
    return this.svc.approve(u, id, b.comment);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('approval:decide')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approvalDecisionSchema)) b: z.infer<typeof approvalDecisionSchema>) {
    return this.svc.reject(u, id, b.comment);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('approval:submit')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.cancel(u, id);
  }
}
