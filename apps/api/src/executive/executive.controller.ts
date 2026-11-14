import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { pageQuerySchema } from '@damez/shared';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsAggregationService } from './metrics-aggregation.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ExecutiveToolsService } from './executive-tools.service';
import { BriefingService } from './briefing.service';
import { ExecChatService } from './exec-chat.service';

/* ─── Zod schemas ─────────────────────────────────────────────────────────── */

const chatSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

const preferencesSchema = z.object({
  briefingTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  channels: z.array(z.string()).optional(),
  verbosity: z.enum(['brief', 'standard', 'detailed']).optional(),
  timezone: z.string().optional(),
});

const anomalyListSchema = z.object({
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const briefingListSchema = pageQuerySchema.extend({
  type: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional(),
});

/* ─── ExecutiveController ─────────────────────────────────────────────────── */

@Controller('executive')
export class ExecutiveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsAggregationService,
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly executiveTools: ExecutiveToolsService,
    private readonly briefingService: BriefingService,
    private readonly chatService: ExecChatService,
  ) {}

  /* ─── Briefings ─────────────────────────────────────────────────────────── */

  @Get('briefings')
  @RequirePermission('executive:briefing:read')
  async listBriefings(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(briefingListSchema)) q: z.infer<typeof briefingListSchema>,
  ) {
    return this.briefingService.listBriefings(user.id, q.page, q.pageSize);
  }

  @Get('briefings/latest')
  @RequirePermission('executive:briefing:read')
  async getLatestBriefing(@CurrentUser() user: AuthUser) {
    const branchScope = user.branchScoped && !user.allBranches ? user.branchId : null;
    const briefing = await this.briefingService.getLatestBrief(user.id, branchScope);
    if (!briefing) throw new NotFoundException('No briefing available');
    return briefing;
  }

  @Post('briefings/generate')
  @HttpCode(202)
  @RequirePermission('executive:briefing:generate')
  async generateBriefing(@CurrentUser() user: AuthUser, @Query('type') type?: string) {
    const branchScope = user.branchScoped && !user.allBranches ? user.branchId : null;
    const briefingType = type === 'weekly' ? 'weekly' : 'daily';

    void (briefingType === 'weekly'
      ? this.briefingService.generateWeeklyBrief(user.id, branchScope)
      : this.briefingService.generateDailyBrief(user.id, branchScope)
    ).catch((err: Error) => {
      // Log but don't throw - generation is async
      void err;
    });

    await this.audit.record({
      action: 'executive.briefing_generation_requested',
      resourceType: 'ExecutiveBriefing',
      actorId: user.id,
      after: { type: briefingType, requestedBy: user.id },
    });

    return { status: 'generating', message: 'Briefing generation started in background' };
  }

  /* ─── Anomalies ─────────────────────────────────────────────────────────── */

  @Get('anomalies')
  @RequirePermission('executive:anomaly:read')
  async listAnomalies(
    @Query(new ZodPipe(anomalyListSchema)) q: z.infer<typeof anomalyListSchema>,
  ) {
    const where = {
      ...(q.severity ? { severity: q.severity as never } : {}),
      ...(q.status ? { status: q.status as never } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.anomalyRecord.count({ where }),
      this.prisma.anomalyRecord.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        metric: r.metric,
        dimension: r.dimension,
        severity: r.severity,
        status: r.status,
        zScore: r.zScore,
        baseline: r.baseline,
        actual: r.actual,
        description: r.description,
        detectedAt: r.detectedAt.toISOString(),
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  @Post('anomalies/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('executive:anomaly:acknowledge')
  async acknowledgeAnomaly(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const record = await this.prisma.anomalyRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Anomaly record not found');

    const updated = await this.prisma.anomalyRecord.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED' as never,
        acknowledgedById: user.id,
        acknowledgedAt: new Date(),
      },
    });

    await this.audit.record({
      action: 'executive.anomaly_acknowledged',
      resourceType: 'AnomalyRecord',
      resourceId: id,
      actorId: user.id,
      before: { status: record.status },
      after: { status: 'ACKNOWLEDGED', acknowledgedById: user.id },
    });

    return { id: updated.id, status: updated.status };
  }

  /* ─── Chat ──────────────────────────────────────────────────────────────── */

  @Get('chat/sessions')
  @RequirePermission('executive:chat:use')
  listSessions(@CurrentUser() user: AuthUser) {
    return this.chatService.listSessions(user.id);
  }

  @Get('chat/sessions/:id')
  @RequirePermission('executive:chat:use')
  getSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chatService.getSession(id, user.id);
  }

  @Post('chat')
  @RequirePermission('executive:chat:use')
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>,
  ) {
    const branchScope = user.branchScoped && !user.allBranches ? user.branchId : null;
    return this.chatService.chat(body.sessionId ?? null, user.id, body.message, branchScope);
  }

  @Post('chat/messages/:id/pin')
  @HttpCode(200)
  @RequirePermission('executive:chat:use')
  pinMessage(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.chatService.pinMessage(id, user.id);
  }

  /* ─── Metrics ───────────────────────────────────────────────────────────── */

  @Get('metrics/portfolio')
  @RequirePermission('executive:tool:portfolio')
  async getPortfolioMetrics(
    @CurrentUser() user: AuthUser,
    @Query('asOfDate') asOfDate?: string,
    @Query('periodDays') periodDaysRaw?: string,
  ) {
    const periodDays = periodDaysRaw ? parseInt(periodDaysRaw, 10) : 30;
    const branchScope = user.branchScoped && !user.allBranches ? user.branchId : null;
    return this.executiveTools.getPortfolioSummary({ asOfDate, periodDays }, branchScope);
  }

  @Get('metrics/branches')
  @RequirePermission('executive:tool:portfolio')
  async getBranchMetrics(
    @CurrentUser() user: AuthUser,
    @Query('asOfDate') asOfDate?: string,
    @Query('sortBy') sortBy?: 'par30' | 'par90' | 'npl',
  ) {
    const branchScope = user.branchScoped && !user.allBranches ? user.branchId : null;
    return this.executiveTools.getParByBranch({ asOfDate, sortBy }, branchScope);
  }

  /* ─── Preferences ───────────────────────────────────────────────────────── */

  @Get('preferences')
  @RequirePermission('executive:preference:manage')
  async getPreferences(@CurrentUser() user: AuthUser) {
    const prefs = await this.prisma.execPreference.findUnique({ where: { userId: user.id } });
    if (!prefs) {
      return {
        userId: user.id,
        briefingTime: '07:00',
        channels: [],
        verbosity: 'standard',
        timezone: 'Africa/Lagos',
      };
    }
    return {
      userId: prefs.userId,
      briefingTime: prefs.briefingTime,
      channels: prefs.channels,
      verbosity: prefs.verbosity,
      timezone: prefs.timezone,
    };
  }

  @Put('preferences')
  @RequirePermission('executive:preference:manage')
  async updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(preferencesSchema)) body: z.infer<typeof preferencesSchema>,
  ) {
    const existing = await this.prisma.execPreference.findUnique({ where: { userId: user.id } });

    const updated = await this.prisma.execPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        briefingTime: body.briefingTime ?? '07:00',
        channels: (body.channels ?? []) as never,
        verbosity: body.verbosity ?? 'standard',
        timezone: body.timezone ?? 'Africa/Lagos',
      },
      update: {
        ...(body.briefingTime && { briefingTime: body.briefingTime }),
        ...(body.channels && { channels: body.channels as never }),
        ...(body.verbosity && { verbosity: body.verbosity }),
        ...(body.timezone && { timezone: body.timezone }),
      },
    });

    await this.audit.record({
      action: 'executive.preferences_updated',
      resourceType: 'ExecPreference',
      resourceId: updated.id,
      actorId: user.id,
      before: existing ? { verbosity: existing.verbosity, briefingTime: existing.briefingTime } : {},
      after: { verbosity: updated.verbosity, briefingTime: updated.briefingTime },
    });

    return updated;
  }
}
