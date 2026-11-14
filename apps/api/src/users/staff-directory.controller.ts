import { Controller, Get, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { UsersService } from './users.service';

/**
 * Lightweight staff search for "To"-style pickers (referrals, assignments). Any logged-in staff
 * member may use it — kept on its own path rather than nested under /users/:id to avoid any
 * ambiguity with that permission-gated route.
 */
@Controller('staff')
export class StaffDirectoryController {
  constructor(private svc: UsersService) {}

  @Get('directory')
  directory(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.svc.directory(u, q ?? ''); }
}
