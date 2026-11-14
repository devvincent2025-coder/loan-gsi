import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { LlmGatewayService } from '../llm-gateway/llm-gateway.module';
import { AuditService } from '../audit/audit.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { ExecutiveToolsService } from './executive-tools.service';

type BriefingType = 'DAILY_MORNING' | 'WEEKLY_SUMMARY' | 'MONTHLY_BOARD';

@Injectable()
export class BriefingService {
  private readonly log = new Logger('BriefingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmGatewayService,
    private readonly audit: AuditService,
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly tools: ExecutiveToolsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Generate the daily executive briefing. */
  async generateDailyBrief(
    targetUserId: string,
    branchScope?: string | null,
  ): Promise<{ id: string; headline: string; bodyMd: string }> {
    return this.generateBrief('DAILY_MORNING', targetUserId, 1, branchScope);
  }

  /** Generate the weekly executive briefing. */
  async generateWeeklyBrief(
    targetUserId: string,
    branchScope?: string | null,
  ): Promise<{ id: string; headline: string; bodyMd: string }> {
    return this.generateBrief('WEEKLY_SUMMARY', targetUserId, 7, branchScope);
  }

  private async generateBrief(
    type: BriefingType,
    userId: string,
    periodDays: number,
    branchScope?: string | null,
  ): Promise<{ id: string; headline: string; bodyMd: string }> {
    const now = new Date();

    // Run anomaly detection if no recent anomalies in last 6 hours
    const recentAnomalyCount = await this.prisma.anomalyRecord.count({
      where: { detectedAt: { gte: new Date(now.getTime() - 6 * 3600_000) } },
    });
    let anomalyIds: string[] = [];
    if (recentAnomalyCount === 0) {
      anomalyIds = await this.anomalyDetection.runAll();
    } else {
      const recent = await this.prisma.anomalyRecord.findMany({
        where: { status: 'OPEN' },
        select: { id: true },
        orderBy: { detectedAt: 'desc' },
        take: 20,
      });
      anomalyIds = recent.map((r) => r.id);
    }

    // Build metrics snapshot
    const [portfolio, parByBranch, collectionsEff, pendingApprovals, anomalies] = await Promise.all([
      this.tools.getPortfolioSummary({ periodDays }, branchScope),
      this.tools.getParByBranch({}, branchScope),
      this.tools.getCollectionsEfficiency({ periodDays }, branchScope),
      this.tools.getPendingApprovals({}, branchScope),
      this.tools.getAnomalies({ limit: 10 }, branchScope),
    ]);

    const metricsSnapshot = { portfolio, parByBranch, collectionsEff, pendingApprovals, anomalies };

    const periodStart = new Date(now.getTime() - periodDays * 86400_000);

    // Create briefing record in DRAFT state
    const briefing = await this.prisma.executiveBriefing.create({
      data: {
        briefingType: type as never,
        status: 'DRAFT' as never,
        periodStart,
        periodEnd: now,
        targetBranchId: branchScope ?? null,
        headline: `${type} briefing generating...`,
        metricsSnapshot: metricsSnapshot as never,
        anomalyIds: anomalyIds as never,
        promptVersion: this.env.EXEC_PROMPT_VERSION,
        modelUsed: this.env.LLM_MODEL_REASONING,
      },
    });

    let headline = '';
    let bodyMd = '';

    if (!this.env.BRIEFING_ENABLED || !this.env.LLM_ENABLED) {
      // Fallback: template-based brief
      const p = portfolio as Record<string, unknown>;
      const typeLabel = type === 'DAILY_MORNING' ? 'Daily' : type === 'WEEKLY_SUMMARY' ? 'Weekly' : 'Monthly';
      headline = `${typeLabel} Portfolio Briefing — ${now.toISOString().split('T')[0]}`;
      bodyMd = this.buildTemplateBrief(typeLabel, p, collectionsEff as Record<string, unknown>, anomalies as Record<string, unknown>[]);
    } else {
      const systemPrompt = this.buildSystemPrompt(metricsSnapshot);
      const userPrompt = this.buildUserPrompt(type, now, periodDays);

      try {
        const llmResponse = await this.llm.complete(
          `executive.briefing.${type.toLowerCase().replace('_', '.')}`,
          systemPrompt,
          userPrompt,
          { userId },
        );

        // Extract headline from first line
        const lines = llmResponse.split('\n').filter((l) => l.trim());
        headline = lines[0]?.replace(/^#+\s*/, '').trim() ?? `${type} Briefing`;
        bodyMd = llmResponse;
      } catch (err) {
        this.log.error(`LLM briefing generation failed: ${(err as Error).message}`);
        const p = portfolio as Record<string, unknown>;
        const typeLabel2 = type === 'DAILY_MORNING' ? 'Daily' : type === 'WEEKLY_SUMMARY' ? 'Weekly' : 'Monthly';
        headline = `${typeLabel2} Portfolio Briefing — ${now.toISOString().split('T')[0]}`;
        bodyMd = this.buildTemplateBrief(typeLabel2, p, collectionsEff as Record<string, unknown>, anomalies as Record<string, unknown>[]);
      }
    }

    // Update to READY state
    await this.prisma.executiveBriefing.update({
      where: { id: briefing.id },
      data: {
        status: 'READY' as never,
        headline,
        bodyMd,
      },
    });

    await this.audit.record({
      action: 'executive.briefing_generated',
      resourceType: 'ExecutiveBriefing',
      resourceId: briefing.id,
      actorId: userId,
      after: { type, status: 'READY', anomalyCount: anomalyIds.length },
    });

    return { id: briefing.id, headline, bodyMd };
  }

  private buildSystemPrompt(metricsSnapshot: Record<string, unknown>): string {
    return `You are the executive intelligence system for a Nigerian microfinance bank.
Your role is to produce concise, insightful executive briefings for the CEO and senior leadership.

RULES:
1. Always cite specific numbers from the provided metrics.
2. Flag anomalies prominently.
3. Use markdown headings. Start with a one-line headline (H1).
4. Include sections: Portfolio Health, Collections, Disbursements, Risk Alerts, Action Items.
5. Use Naira amounts (convert from kobo by dividing by 100).
6. Keep the briefing under 600 words.
7. Never fabricate data — only use the metrics provided.

CURRENT METRICS:
${JSON.stringify(metricsSnapshot, null, 2)}

METRIC DEFINITIONS:
- par30Ratio: Proportion of active loans with ≥30 days past due
- par90Ratio: Proportion of active loans with ≥90 days past due
- nplRatio: Non-performing loan ratio (≥90 DPD)
- collectionEfficiency: Ratio of amount collected to amount due
- eclTotalKobo: Expected credit loss estimate in kobo`;
  }

  private buildUserPrompt(type: BriefingType, now: Date, periodDays: number): string {
    const dateStr = now.toISOString().split('T')[0];
    const typeLabel = type === 'DAILY_MORNING' ? 'daily' : type === 'WEEKLY_SUMMARY' ? 'weekly' : 'monthly';
    return `Generate a ${typeLabel} executive briefing for ${dateStr}.
The period covers the last ${periodDays} days.
Follow the system prompt format. Begin with the headline as H1.`;
  }

  private buildTemplateBrief(
    type: string,
    portfolio: Record<string, unknown>,
    collections: Record<string, unknown>,
    anomalies: Record<string, unknown>[],
  ): string {
    const date = new Date().toISOString().split('T')[0];
    const par30 = typeof portfolio.par30Ratio === 'number' ? (portfolio.par30Ratio * 100).toFixed(2) : 'N/A';
    const npl = typeof portfolio.nplRatio === 'number' ? (portfolio.nplRatio * 100).toFixed(2) : 'N/A';
    const efficiency = typeof collections.efficiency30d === 'number'
      ? (collections.efficiency30d * 100).toFixed(1)
      : 'N/A';
    const outstanding = typeof portfolio.totalOutstandingKobo === 'number'
      ? `₦${(portfolio.totalOutstandingKobo / 100).toLocaleString()}`
      : 'N/A';

    return `# ${type} Portfolio Briefing — ${date}

## Portfolio Health
- Outstanding balance: ${outstanding}
- PAR-30: ${par30}%
- NPL (PAR-90+): ${npl}%
- Active loans: ${portfolio.activeLoansCount ?? 'N/A'}

## Collections
- Collection efficiency (30d): ${efficiency}%
- PTP kept rate: ${typeof collections.ptpKeptRate === 'number' ? (collections.ptpKeptRate * 100).toFixed(1) : 'N/A'}%

## Risk Alerts
${anomalies.length === 0 ? '_No open anomalies._' : anomalies.map((a) => `- **${a.severity}** — ${a.description}`).join('\n')}

## Action Items
${anomalies.filter((a) => a.severity === 'CRITICAL').length > 0 ? '- Review CRITICAL anomalies immediately.' : '- Continue monitoring portfolio metrics.'}
`;
  }

  /** Get the most recent READY briefing. */
  async getLatestBrief(
    userId: string,
    branchScope?: string | null,
  ): Promise<Record<string, unknown> | null> {
    const briefing = await this.prisma.executiveBriefing.findFirst({
      where: {
        status: 'READY' as never,
        ...(branchScope ? { targetBranchId: branchScope } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!briefing) return null;
    return this.toBriefingDto(briefing);
  }

  /** Paginated list of briefings. */
  async listBriefings(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    const [total, rows] = await Promise.all([
      this.prisma.executiveBriefing.count({ where: { status: 'READY' as never } }),
      this.prisma.executiveBriefing.findMany({
        where: { status: 'READY' as never },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((r) => this.toBriefingDto(r)),
      total,
      page,
      pageSize: limit,
    };
  }

  private toBriefingDto(r: {
    id: string;
    briefingType: string;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    headline: string;
    bodyMd: string | null;
    metricsSnapshot: unknown;
    anomalyIds: unknown;
    modelUsed: string | null;
    promptTokens: number;
    completionTokens: number;
    createdAt: Date;
  }): Record<string, unknown> {
    return {
      id: r.id,
      briefingType: r.briefingType,
      status: r.status,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      headline: r.headline,
      bodyMd: r.bodyMd,
      modelUsed: r.modelUsed,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
