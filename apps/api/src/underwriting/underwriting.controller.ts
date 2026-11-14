import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { APPLICATION_STATUSES, DECISION_ACTIONS, type ApplicationDetailDto, type UnderwritingNoteDto, type UnderwritingQueueItemDto } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { UnderwritingService } from './underwriting.service';

const kobo = z.number().int().positive();
const decisionSchema = z.object({
  action: z.enum(DECISION_ACTIONS), reason: z.string().trim().max(1000).optional(), amountKobo: kobo.optional(),
  tenorMonths: z.number().int().min(1).max(120).optional(), note: z.string().trim().max(1000).optional(),
  assigneeIds: z.array(z.string().min(1)).min(1).max(2).optional(),
}).superRefine((v, ctx) => {
  if (v.action === 'REFER' && (!v.assigneeIds || v.assigneeIds.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assigneeIds'], message: 'Pick 1 or 2 staff members to refer this application to' });
  }
});
const addNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const queueQuerySchema = z.object({ status: z.enum(APPLICATION_STATUSES).optional(), branchId: z.string().optional(), assignedToId: z.string().optional() });

@Controller()
export class UnderwritingController {
  constructor(private svc: UnderwritingService) {}

  @Get('underwriting/queue') @RequirePermission('underwriting:read')
  queue(@CurrentUser() u: AuthUser, @Query(new ZodPipe(queueQuerySchema)) q: z.infer<typeof queueQuerySchema>): Promise<UnderwritingQueueItemDto[]> {
    return this.svc.queue(u, q);
  }

  @Post('applications/:id/decision') @HttpCode(200) @RequirePermission('underwriting:decide')
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(decisionSchema)) b: z.infer<typeof decisionSchema>): Promise<ApplicationDetailDto> {
    return this.svc.decide(u, id, b);
  }

  @Get('applications/:id/notes') @RequirePermission('underwriting:read')
  notes(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<UnderwritingNoteDto[]> { return this.svc.listNotes(u, id); }

  @Post('applications/:id/notes') @HttpCode(201) @RequirePermission('underwriting:decide')
  addNote(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(addNoteSchema)) b: z.infer<typeof addNoteSchema>): Promise<UnderwritingNoteDto> {
    return this.svc.addFreeNote(u, id, b.body);
  }
}
