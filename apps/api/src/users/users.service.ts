import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApprovalDto, maskPhone, Page, StaffDirectoryEntryDto, UserDto, UserStatus } from '@damez/shared';
import { z } from 'zod';
import { userCreateSchema, userUpdateSchema, roleChangeSchema } from '@damez/shared';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser, branchWhere, canSeeBranch } from '../common/auth-user';
import { paged, skipTake } from '../common/pagination';
import { PasswordService } from '../crypto/password.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const include = { role: true, branch: true } satisfies Prisma.StaffUserInclude;
type Row = Prisma.StaffUserGetPayload<{ include: typeof include }>;
const FAR_FUTURE = new Date('2999-01-01T00:00:00Z');

export function toUserDto(u: Row): UserDto {
  const locked = !!u.lockedUntil && u.lockedUntil > new Date();
  const status: UserStatus = u.status === 'DISABLED' ? 'DISABLED' : locked ? 'LOCKED' : 'ACTIVE';
  return {
    id: u.id, email: u.email, fullName: u.fullName, phone: u.phone ? maskPhone(u.phone) : null,
    role: { id: u.role.id, key: u.role.key, name: u.role.name },
    branch: u.branch ? { id: u.branch.id, code: u.branch.code, name: u.branch.name } : null,
    allBranches: u.allBranches, status, totpEnabled: u.totpEnabled, lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    failedLoginCount: u.failedLoginCount, lockedUntil: locked ? u.lockedUntil!.toISOString() : null, createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private passwords: PasswordService, private auth: AuthService,
    private approvals: ApprovalsService, private notify: NotificationsService,
  ) {}

  async list(user: AuthUser, q: { page: number; pageSize: number; q?: string; roleId?: string; branchId?: string; status?: string }): Promise<Page<UserDto>> {
    const and: Prisma.StaffUserWhereInput[] = [branchWhere(user) as Prisma.StaffUserWhereInput];
    if (q.q) and.push({ OR: [{ fullName: { contains: q.q } }, { email: { contains: q.q } }] });
    if (q.roleId) and.push({ roleId: q.roleId });
    if (q.branchId) and.push({ branchId: q.branchId });
    if (q.status === 'DISABLED') and.push({ status: 'DISABLED' });
    if (q.status === 'LOCKED') and.push({ status: 'ACTIVE', lockedUntil: { gt: new Date() } });
    if (q.status === 'ACTIVE') and.push({ status: 'ACTIVE', OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.staffUser.findMany({ where, include, orderBy: [{ fullName: 'asc' }], ...skipTake(q.page, q.pageSize) }),
      this.prisma.staffUser.count({ where }),
    ]);
    return paged(rows.map(toUserDto), total, q.page, q.pageSize);
  }

  async directory(user: AuthUser, q: string): Promise<StaffDirectoryEntryDto[]> {
    const term = q.trim();
    if (!term) return [];
    const and: Prisma.StaffUserWhereInput[] = [
      branchWhere(user) as Prisma.StaffUserWhereInput,
      { status: 'ACTIVE' },
      { OR: [{ fullName: { contains: term } }, { email: { contains: term } }] },
    ];
    const rows = await this.prisma.staffUser.findMany({ where: { AND: and }, include, orderBy: [{ fullName: 'asc' }], take: 8 });
    return rows.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, roleName: u.role.name, branchName: u.branch?.name ?? null }));
  }

  private async load(actor: AuthUser, id: string): Promise<Row> {
    const u = await this.prisma.staffUser.findUnique({ where: { id }, include });
    if (!u || !canSeeBranch(actor, u.branchId)) throw new NotFoundException('User not found');
    return u;
  }

  async get(actor: AuthUser, id: string): Promise<UserDto> {
    return toUserDto(await this.load(actor, id));
  }

  async create(actor: AuthUser, input: z.infer<typeof userCreateSchema>): Promise<UserDto> {
    if (await this.prisma.staffUser.findUnique({ where: { email: input.email } })) throw new ConflictException({ message: 'A user with this email already exists', code: 'DUPLICATE' });
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new BadRequestException('Unknown role');
    if (role.key === 'super_admin' && actor.roleKey !== 'super_admin') throw new ForbiddenException('Only a Super Admin can create Super Admins');
    if (input.branchId && !(await this.prisma.branch.findUnique({ where: { id: input.branchId } }))) throw new BadRequestException('Unknown branch');
    const created = await this.prisma.staffUser.create({
      data: {
        email: input.email, fullName: input.fullName, phone: input.phone ?? null, roleId: role.id, branchId: input.branchId ?? null,
        allBranches: input.allBranches ?? false, passwordHash: await this.passwords.hash(input.password), mustChangePassword: true, createdById: actor.id,
      },
      include,
    });
    await this.audit.record({ action: 'user.created', resourceType: 'StaffUser', resourceId: created.id, after: { email: created.email, role: role.key, branchId: created.branchId, allBranches: created.allBranches } });
    return toUserDto(created);
  }

  async update(actor: AuthUser, id: string, input: z.infer<typeof userUpdateSchema>): Promise<UserDto> {
    const before = await this.load(actor, id);
    const u = await this.prisma.staffUser.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}), ...(input.allBranches !== undefined ? { allBranches: input.allBranches } : {}),
      },
      include,
    });
    await this.audit.record({
      action: 'user.updated', resourceType: 'StaffUser', resourceId: id,
      before: { fullName: before.fullName, phone: before.phone, branchId: before.branchId, allBranches: before.allBranches },
      after: { fullName: u.fullName, phone: u.phone, branchId: u.branchId, allBranches: u.allBranches },
    });
    return toUserDto(u);
  }

  async setLock(actor: AuthUser, id: string, lock: boolean): Promise<UserDto> {
    if (lock && id === actor.id) throw new BadRequestException('You cannot lock yourself');
    const before = await this.load(actor, id);
    const u = await this.prisma.staffUser.update({ where: { id }, data: lock ? { lockedUntil: FAR_FUTURE } : { lockedUntil: null, failedLoginCount: 0 }, include });
    if (lock) await this.auth.revokeAllForUser(id, 'locked_by_admin');
    await this.audit.record({ action: lock ? 'user.locked' : 'user.unlocked', resourceType: 'StaffUser', resourceId: id, before: { lockedUntil: before.lockedUntil }, after: { lockedUntil: u.lockedUntil } });
    return toUserDto(u);
  }

  async setActive(actor: AuthUser, id: string, active: boolean): Promise<UserDto> {
    if (!active && id === actor.id) throw new BadRequestException('You cannot deactivate yourself');
    const before = await this.load(actor, id);
    if (!active && before.role.key === 'super_admin') {
      const others = await this.prisma.staffUser.count({ where: { role: { key: 'super_admin' }, status: 'ACTIVE', id: { not: id } } });
      if (others === 0) throw new BadRequestException('Cannot deactivate the last active Super Admin');
    }
    const u = await this.prisma.staffUser.update({ where: { id }, data: { status: active ? 'ACTIVE' : 'DISABLED' }, include });
    if (!active) await this.auth.revokeAllForUser(id, 'deactivated');
    await this.audit.record({ action: active ? 'user.activated' : 'user.deactivated', resourceType: 'StaffUser', resourceId: id, before: { status: before.status }, after: { status: u.status } });
    return toUserDto(u);
  }

  async resetTotp(actor: AuthUser, id: string): Promise<UserDto> {
    await this.load(actor, id);
    const u = await this.prisma.staffUser.update({ where: { id }, data: { totpSecretEnc: null, totpEnabled: false, lastTotpStep: null }, include });
    await this.auth.revokeAllForUser(id, '2fa_reset');
    await this.audit.record({ action: 'user.totp_reset', resourceType: 'StaffUser', resourceId: id });
    return toUserDto(u);
  }

  async resetPassword(actor: AuthUser, id: string, password: string): Promise<{ ok: true }> {
    await this.load(actor, id);
    await this.prisma.staffUser.update({ where: { id }, data: { passwordHash: await this.passwords.hash(password), mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await this.auth.revokeAllForUser(id, 'password_reset');
    await this.audit.record({ action: 'user.password_reset', resourceType: 'StaffUser', resourceId: id });
    return { ok: true };
  }

  /** Role changes are maker-checker controlled: this only creates the request. */
  async requestRoleChange(actor: AuthUser, id: string, input: z.infer<typeof roleChangeSchema>): Promise<ApprovalDto> {
    if (id === actor.id) throw new BadRequestException('You cannot request a role change for yourself');
    const [u, role] = await Promise.all([this.load(actor, id), this.prisma.role.findUnique({ where: { id: input.roleId } })]);
    if (!role) throw new BadRequestException('Unknown role');
    if (role.id === u.roleId) throw new BadRequestException('User already has this role');
    return this.approvals.submit(actor, {
      type: 'ROLE_CHANGE', summary: `Change ${u.fullName} from ${u.role.name} to ${role.name}`, reason: input.reason,
      payload: { userId: u.id, userName: u.fullName, fromRoleId: u.roleId, fromRoleName: u.role.name, toRoleId: role.id, toRoleName: role.name },
    });
  }
}
