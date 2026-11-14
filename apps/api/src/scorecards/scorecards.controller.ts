import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { FACT_FIELDS } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { activationRequestSchema, scorecardCreateSchema, ScorecardService, scorecardUpdateSchema } from './scorecard.service';

@Controller('scorecards')
export class ScorecardsController {
  constructor(private svc: ScorecardService) {}

  @Get() @RequirePermission('scorecard:read')
  list() { return this.svc.list(); }

  // declared before ':id' so "fields" is not captured as an id
  @Get('fields') @RequirePermission('scorecard:read')
  fields() { return FACT_FIELDS; }

  @Get(':id') @RequirePermission('scorecard:read')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post() @RequirePermission('scorecard:update')
  create(@Body(new ZodPipe(scorecardCreateSchema)) b: z.infer<typeof scorecardCreateSchema>, @CurrentUser() u: AuthUser) { return this.svc.create(u, b); }

  @Put(':id') @RequirePermission('scorecard:update')
  update(@Param('id') id: string, @Body(new ZodPipe(scorecardUpdateSchema)) b: z.infer<typeof scorecardUpdateSchema>, @CurrentUser() u: AuthUser) { return this.svc.update(u, id, b); }

  @Post(':id/request-activation') @RequirePermission('scorecard:update')
  requestActivation(@Param('id') id: string, @Body(new ZodPipe(activationRequestSchema)) b: z.infer<typeof activationRequestSchema>, @CurrentUser() u: AuthUser) {
    return this.svc.requestActivation(u, id, b.reason);
  }
}
