import { Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { BranchDto, branchSchema, branchUpdateSchema } from '@damez/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

type Row = Prisma.BranchGetPayload<{ include: { _count: { select: { users: true } } } }>;
const dto = (b: Row): BranchDto => ({
  id: b.id, code: b.code, name: b.name, state: b.state, city: b.city, address: b.address, isHeadOffice: b.isHeadOffice, isActive: b.isActive, userCount: b._count.users,
});
const inc = { _count: { select: { users: true } } } as const;

@Injectable()
class BranchesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(user: AuthUser): Promise<BranchDto[]> {
    const scoped = !user.allBranches && user.branchScoped;
    const rows = await this.prisma.branch.findMany({ where: scoped ? { id: user.branchId ?? '__none__' } : {}, include: inc, orderBy: [{ isHeadOffice: 'desc' }, { name: 'asc' }] });
    return rows.map(dto);
  }

  async create(input: z.infer<typeof branchSchema>): Promise<BranchDto> {
    if (await this.prisma.branch.findUnique({ where: { code: input.code } })) throw new ConflictException('Branch code already exists');
    const b = await this.prisma.branch.create({ data: input, include: inc });
    await this.audit.record({ action: 'branch.created', resourceType: 'Branch', resourceId: b.id, after: input });
    return dto(b);
  }

  async update(id: string, input: z.infer<typeof branchUpdateSchema>): Promise<BranchDto> {
    const before = await this.prisma.branch.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Branch not found');
    const b = await this.prisma.branch.update({ where: { id }, data: input, include: inc });
    await this.audit.record({ action: 'branch.updated', resourceType: 'Branch', resourceId: id, before, after: input });
    return dto(b);
  }
}

@Controller('branches')
class BranchesController {
  constructor(private svc: BranchesService) {}
  @Get() @RequirePermission('branch:read') list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }
  @Post() @RequirePermission('branch:manage') create(@Body(new ZodPipe(branchSchema)) b: z.infer<typeof branchSchema>) { return this.svc.create(b); }
  @Patch(':id') @RequirePermission('branch:manage') update(@Param('id') id: string, @Body(new ZodPipe(branchUpdateSchema)) b: z.infer<typeof branchUpdateSchema>) { return this.svc.update(id, b); }
}

@Module({ providers: [BranchesService], controllers: [BranchesController] })
export class BranchesModule {}
