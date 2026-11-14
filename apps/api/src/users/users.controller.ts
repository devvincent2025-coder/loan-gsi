import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { pageQuerySchema, resetPasswordSchema, roleChangeSchema, userCreateSchema, userUpdateSchema } from '@damez/shared';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Idempotent, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

const listQuery = pageQuerySchema.extend({
  roleId: z.string().optional(), branchId: z.string().optional(), status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']).optional(),
});

@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}

  @Get() @RequirePermission('user:read')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) { return this.svc.list(u, q); }

  @Get(':id') @RequirePermission('user:read')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u, id); }

  @Post() @Idempotent() @RequirePermission('user:create')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(userCreateSchema)) b: z.infer<typeof userCreateSchema>) { return this.svc.create(u, b); }

  @Patch(':id') @RequirePermission('user:update')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(userUpdateSchema)) b: z.infer<typeof userUpdateSchema>) { return this.svc.update(u, id, b); }

  @Post(':id/lock') @HttpCode(200) @RequirePermission('user:deactivate')
  lock(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setLock(u, id, true); }

  @Post(':id/unlock') @HttpCode(200) @RequirePermission('user:unlock')
  unlock(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setLock(u, id, false); }

  @Post(':id/deactivate') @HttpCode(200) @RequirePermission('user:deactivate')
  deactivate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setActive(u, id, false); }

  @Post(':id/activate') @HttpCode(200) @RequirePermission('user:deactivate')
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setActive(u, id, true); }

  @Post(':id/reset-totp') @HttpCode(200) @RequirePermission('user:unlock')
  resetTotp(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.resetTotp(u, id); }

  @Post(':id/reset-password') @HttpCode(200) @RequirePermission('user:update')
  resetPassword(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(resetPasswordSchema)) b: z.infer<typeof resetPasswordSchema>) { return this.svc.resetPassword(u, id, b.password); }

  @Post(':id/role-change') @HttpCode(200) @RequirePermission('user:role_change')
  roleChange(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(roleChangeSchema)) b: z.infer<typeof roleChangeSchema>) { return this.svc.requestRoleChange(u, id, b); }
}
