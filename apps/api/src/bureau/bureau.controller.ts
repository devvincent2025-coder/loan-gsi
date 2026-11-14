import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { BureauReportDto } from '@damez/shared';
import { AuditService } from '../audit/audit.service';
import { AuthUser, canSeeBranch } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BureauAnalyticsService, pageOnlySchema, pullsQuerySchema, rangeQuerySchema } from './bureau-analytics';
import { BureauFurnishingService } from './bureau-furnishing';
import { BureauMonitoringService } from './bureau-monitoring';
import { BureauService } from './bureau.service';

const pullBody = z.object({ force: z.boolean().optional() }).default({});
const furnishBody = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use yyyy-mm').optional() }).default({});

@Controller()
export class BureauController {
  constructor(
    private svc: BureauService, private analytics: BureauAnalyticsService, private monitoring: BureauMonitoringService,
    private furnishing: BureauFurnishingService, private prisma: PrismaService, private audit: AuditService,
  ) {}

  /** Branch-scoped existence check (404 rather than 403 so ids of other branches are not confirmed). */
  private async customerFor(user: AuthUser, id: string): Promise<{ id: string; branchId: string | null }> {
    const c = await this.prisma.customer.findUnique({ where: { id }, select: { id: true, branchId: true, erasedAt: true } });
    if (!c || c.erasedAt || !canSeeBranch(user, c.branchId)) throw new NotFoundException('Customer not found');
    return c;
  }
  private async viewed(user: AuthUser, c: { id: string; branchId: string | null }, r: BureauReportDto): Promise<void> {
    await this.audit.record({ action: 'bureau.report_viewed', resourceType: 'Customer', resourceId: c.id, branchId: c.branchId, metadata: { reportId: r.id, viewerId: user.id } });
  }

  @Get('customers/:id/bureau') @RequirePermission('bureau:read')
  async latest(@CurrentUser() u: AuthUser, @Param('id') id: string): Promise<BureauReportDto | null> {
    const c = await this.customerFor(u, id);
    const r = await this.svc.latestReport(c.id);
    if (r) await this.viewed(u, c, r);
    return r;
  }

  @Get('customers/:id/bureau/history') @RequirePermission('bureau:read')
  async history(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.history((await this.customerFor(u, id)).id); }

  @Get('customers/:id/bureau/reports/:reportId') @RequirePermission('bureau:read')
  async report(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('reportId') reportId: string): Promise<BureauReportDto> {
    const c = await this.customerFor(u, id);
    const r = await this.svc.getReport(reportId);
    if (r.customerId !== c.id) throw new NotFoundException('Bureau report not found');
    await this.viewed(u, c, r);
    return r;
  }

  @Post('customers/:id/bureau/pull') @HttpCode(200) @RequirePermission('bureau:pull')
  async pull(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(pullBody)) b: z.infer<typeof pullBody>): Promise<BureauReportDto> {
    const c = await this.customerFor(u, id);
    return this.svc.ensureReport(c.id, { reason: 'ON_DEMAND', force: b.force, requestedById: u.id });
  }

  @Get('customers/:id/bureau/pulls') @RequirePermission('bureau:read')
  async customerPulls(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.analytics.pullsForCustomer((await this.customerFor(u, id)).id); }

  @Get('bureau/pulls') @RequirePermission('bureau:usage')
  pulls(@Query(new ZodPipe(pullsQuerySchema)) q: z.infer<typeof pullsQuerySchema>) { return this.analytics.pulls(q); }

  @Get('bureau/usage') @RequirePermission('bureau:usage')
  usage(@Query(new ZodPipe(rangeQuerySchema)) q: z.infer<typeof rangeQuerySchema>) { return this.analytics.usage(q); }

  @Get('bureau/submissions') @RequirePermission('bureau:usage')
  submissions(@Query(new ZodPipe(pageOnlySchema)) q: z.infer<typeof pageOnlySchema>) { return this.analytics.submissions(q); }

  @Post('bureau/furnishing/run') @HttpCode(200) @RequirePermission('bureau:manage')
  furnish(@Body(new ZodPipe(furnishBody)) b: z.infer<typeof furnishBody>) { return this.furnishing.run({ period: b.period }); }

  @Get('bureau/distribution') @RequirePermission('bureau:usage')
  distribution() { return this.analytics.distribution(); }

  @Get('bureau/monitoring/alerts') @RequirePermission('bureau:usage')
  alerts(@Query(new ZodPipe(pageOnlySchema)) q: z.infer<typeof pageOnlySchema>) { return this.analytics.monitoringAlerts(q); }

  @Post('bureau/monitoring/run') @HttpCode(200) @RequirePermission('bureau:manage')
  runMonitoring(@CurrentUser() u: AuthUser) { return this.monitoring.run({ requestedById: u.id }); }
}
