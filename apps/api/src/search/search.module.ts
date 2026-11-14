import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { SearchResultDto } from '@damez/shared';
import { AuthUser, branchWhere } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { CustomersModule, CustomersService } from '../customers/customers.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Global search: server-side SQL only. Results are rendered to the caller; they are NEVER forwarded to an LLM.
 * Only returns entity types the caller is permitted to read, within their branch scope.
 */
@Injectable()
class SearchService {
  constructor(private prisma: PrismaService, private customers: CustomersService) {}

  async search(user: AuthUser, raw: string): Promise<SearchResultDto> {
    const q = raw.trim().slice(0, 80);
    const groups: SearchResultDto['groups'] = [];
    if (q.length < 2) return { groups };
    const can = (p: string) => user.permissions.has(p);
    const [users, branches, customers, approvals] = await Promise.all([
      can('user:read') ? this.prisma.staffUser.findMany({ where: { AND: [branchWhere(user) as object, { OR: [{ fullName: { contains: q } }, { email: { contains: q } }] }] }, include: { role: true }, take: 5 }) : [],
      can('branch:read') ? this.prisma.branch.findMany({ where: { OR: [{ name: { contains: q } }, { code: { contains: q } }, { city: { contains: q } }] }, take: 5 }) : [],
      can('customer:read') ? this.prisma.customer.findMany({ where: { AND: [branchWhere(user) as object, { erasedAt: null }, this.customers.searchWhere(q)] }, take: 5 }) : [],
      can('approval:read') ? this.prisma.approvalRequest.findMany({ where: { AND: [{ OR: [{ makerId: user.id }, branchWhere(user) as object] }, { summary: { contains: q } }] }, orderBy: { createdAt: 'desc' }, take: 5 }) : [],
    ]);
    if (users.length) groups.push({ type: 'user', items: users.map((u) => ({ id: u.id, title: u.fullName, subtitle: `${u.role.name} · ${u.email}`, href: `/users?q=${encodeURIComponent(u.email)}` })) });
    if (branches.length) groups.push({ type: 'branch', items: branches.map((b) => ({ id: b.id, title: b.name, subtitle: `${b.code} · ${b.city}, ${b.state}`, href: '/branches' })) });
    // Customer names are shown masked in search results too.
    if (customers.length) groups.push({ type: 'customer', items: customers.map((c) => ({ id: c.id, title: `${c.firstName} ${c.lastName.slice(0, 1)}•••`, subtitle: `${c.state ?? 'Nigeria'} · KYC ${c.kycStatus.toLowerCase()}`, href: `/customers?q=${encodeURIComponent(c.firstName)}` })) });
    if (approvals.length) groups.push({ type: 'approval', items: approvals.map((a) => ({ id: a.id, title: a.summary, subtitle: `${a.type} · ${a.status}`, href: `/approvals?open=${a.id}` })) });
    return { groups };
  }
}

@Controller('search')
class SearchController {
  constructor(private svc: SearchService) {}
  @Get() search(@CurrentUser() u: AuthUser, @Query('q') q: string) { return this.svc.search(u, String(q ?? '')); }
}

@Module({ imports: [CustomersModule], providers: [SearchService], controllers: [SearchController] })
export class SearchModule {}
