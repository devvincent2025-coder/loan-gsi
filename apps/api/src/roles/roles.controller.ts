import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { roleApprovalLimitsSchema, roleCreateSchema, rolePermissionsSchema } from '@damez/shared';
import { RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private svc: RolesService) {}

  @Get('permissions') @RequirePermission('permission:read')
  catalog() { return this.svc.catalog(); }

  @Get('roles') @RequirePermission('role:read')
  list() { return this.svc.list(); }

  @Post('roles') @RequirePermission('role:update')
  create(@Body(new ZodPipe(roleCreateSchema)) b: z.infer<typeof roleCreateSchema>) { return this.svc.create(b); }

  @Put('roles/:id/permissions') @RequirePermission('permission:matrix_edit')
  setPermissions(@Param('id') id: string, @Body(new ZodPipe(rolePermissionsSchema)) b: z.infer<typeof rolePermissionsSchema>) { return this.svc.setPermissions(id, b.permissions); }

  @Put('roles/:id/approval-limits') @RequirePermission('permission:matrix_edit')
  setLimits(@Param('id') id: string, @Body(new ZodPipe(roleApprovalLimitsSchema)) b: z.infer<typeof roleApprovalLimitsSchema>) { return this.svc.setApprovalLimits(id, b.limits); }

  @Delete('roles/:id/approval-limits/:actionType') @RequirePermission('permission:matrix_edit')
  clearLimit(@Param('id') id: string, @Param('actionType') t: string) { return this.svc.clearApprovalLimit(id, t); }
}
