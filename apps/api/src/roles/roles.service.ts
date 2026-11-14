import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ALL_PERMISSION_KEYS, PERMISSION_GROUPS, PermissionCatalogDto, RoleDto, roleApprovalLimitsSchema, roleCreateSchema, SUPER_ADMIN_ROLE_KEY } from '@damez/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { n } from '../common/bigint';
import { PrismaService } from '../prisma/prisma.service';

const include = { permissions: { include: { permission: true } }, approvalLimits: true, _count: { select: { users: true } } } satisfies Prisma.RoleInclude;
type Row = Prisma.RoleGetPayload<{ include: typeof include }>;

const toDto = (r: Row): RoleDto => ({
  id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, branchScoped: r.branchScoped, userCount: r._count.users,
  permissions: r.permissions.map((p) => p.permission.key).sort(),
  approvalLimits: r.approvalLimits.map((l) => ({ actionType: l.actionType as RoleDto['approvalLimits'][number]['actionType'], maxAmountKobo: n(l.maxAmountKobo) })),
});

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  catalog(): PermissionCatalogDto { return { groups: PERMISSION_GROUPS }; }

  async list(): Promise<RoleDto[]> {
    return (await this.prisma.role.findMany({ include, orderBy: { createdAt: 'asc' } })).map(toDto);
  }

  private async one(id: string): Promise<Row> {
    const r = await this.prisma.role.findUnique({ where: { id }, include });
    if (!r) throw new NotFoundException('Role not found');
    return r;
  }

  async create(input: z.infer<typeof roleCreateSchema>): Promise<RoleDto> {
    if (await this.prisma.role.findUnique({ where: { key: input.key } })) throw new ConflictException('A role with this key already exists');
    const r = await this.prisma.role.create({ data: { ...input, isSystem: false }, include });
    await this.audit.record({ action: 'role.created', resourceType: 'Role', resourceId: r.id, after: { key: r.key, name: r.name, branchScoped: r.branchScoped } });
    return toDto(r);
  }

  /** Replace a role's permission set. Super Admin is locked (lock-out protection). Fully audited with a diff. */
  async setPermissions(id: string, keys: string[]): Promise<RoleDto> {
    const role = await this.one(id);
    if (role.key === SUPER_ADMIN_ROLE_KEY) throw new BadRequestException({ message: 'Super Admin permissions are locked', code: 'ROLE_LOCKED' });
    const unknown = keys.filter((k) => !ALL_PERMISSION_KEYS.includes(k));
    if (unknown.length) throw new BadRequestException({ message: `Unknown permissions: ${unknown.join(', ')}`, code: 'VALIDATION_FAILED' });
    const next = new Set(keys);
    const before = new Set(role.permissions.map((p) => p.permission.key));
    const added = [...next].filter((k) => !before.has(k));
    const removed = [...before].filter((k) => !next.has(k));
    if (!added.length && !removed.length) return toDto(role);

    const perms = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      await this.audit.record({ action: 'role.permissions_changed', resourceType: 'Role', resourceId: id, before: { permissions: [...before].sort() }, after: { permissions: [...next].sort() }, metadata: { role: role.key, added, removed } }, tx);
    });
    return toDto(await this.one(id));
  }

  async setApprovalLimits(id: string, limits: z.infer<typeof roleApprovalLimitsSchema>['limits']): Promise<RoleDto> {
    const role = await this.one(id);
    await this.prisma.$transaction(async (tx) => {
      for (const l of limits) {
        await tx.roleApprovalLimit.upsert({
          where: { roleId_actionType: { roleId: id, actionType: l.actionType } },
          create: { roleId: id, actionType: l.actionType, maxAmountKobo: l.maxAmountKobo === null ? null : BigInt(l.maxAmountKobo) },
          update: { maxAmountKobo: l.maxAmountKobo === null ? null : BigInt(l.maxAmountKobo) },
        });
      }
      await this.audit.record({
        action: 'role.approval_limits_changed', resourceType: 'Role', resourceId: id,
        before: { limits: role.approvalLimits.map((x) => ({ actionType: x.actionType, maxAmountKobo: n(x.maxAmountKobo) })) }, after: { limits }, metadata: { role: role.key },
      }, tx);
    });
    return toDto(await this.one(id));
  }

  /** Remove the limit for an action type entirely (role can no longer decide that type). */
  async clearApprovalLimit(id: string, actionType: string): Promise<RoleDto> {
    await this.one(id);
    await this.prisma.roleApprovalLimit.deleteMany({ where: { roleId: id, actionType } });
    await this.audit.record({ action: 'role.approval_limit_removed', resourceType: 'Role', resourceId: id, metadata: { actionType } });
    return toDto(await this.one(id));
  }
}
