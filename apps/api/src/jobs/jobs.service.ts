import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queue/queue.service';
import { APP_ENV, AppEnv } from '../config/config.module';
import { MetricsAggregationService } from '../executive/metrics-aggregation.service';
import { AnomalyDetectionService } from '../executive/anomaly-detection.service';
import { BriefingService } from '../executive/briefing.service';

/** Scheduled maintenance jobs (BullMQ repeatable schedulers). Later prompts register their own (autodebit, reminders). */
@Injectable()
export class JobsService implements OnModuleInit {
  private log = new Logger('Jobs');
  constructor(
    private queue: QueueService,
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private metricsAggregation: MetricsAggregationService,
    private anomalyDetection: AnomalyDetectionService,
    private briefing: BriefingService,
    @Inject(APP_ENV) private env: AppEnv,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue.register(QUEUES.maintenance, async (name) => {
      if (name === 'cleanup-sessions') return this.cleanupSessions();
      if (name === 'expire-approvals') return this.approvals.expireStale(7);
      if (name === 'metrics-aggregation') return this.metricsAggregation.runAll();
      if (name === 'anomaly-detection') return this.anomalyDetection.runAll();
      if (name === 'briefing-daily') return this.briefing.generateDailyBrief('system');
      if (name === 'briefing-weekly') return this.briefing.generateWeeklyBrief('system');
      return undefined;
    });
    // give the redis connection a moment before scheduling
    setTimeout(() => {
      void this.queue.schedule(QUEUES.maintenance, 'cleanup-sessions', 60 * 60_000, 'cleanup-sessions').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.maintenance, 'expire-approvals', 60 * 60_000, 'expire-approvals').catch((e: Error) => this.log.warn(e.message));
      // Phase 5: executive intelligence cron jobs
      void this.queue.schedule(QUEUES.maintenance, 'metrics-aggregation', { pattern: this.env.METRICS_AGGREGATION_CRON, tz: 'Africa/Lagos' }, 'metrics-aggregation').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.maintenance, 'anomaly-detection', { pattern: this.env.ANOMALY_DETECTION_CRON, tz: 'Africa/Lagos' }, 'anomaly-detection').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.maintenance, 'briefing-daily', { pattern: this.env.BRIEFING_CRON_DAILY, tz: 'Africa/Lagos' }, 'briefing-daily').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.maintenance, 'briefing-weekly', { pattern: this.env.BRIEFING_CRON_WEEKLY, tz: 'Africa/Lagos' }, 'briefing-weekly').catch((e: Error) => this.log.warn(e.message));
    }, 3500);
  }

  async cleanupSessions(): Promise<{ sessions: number; idempotency: number; loginEvents: number }> {
    const sessions = await this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 30 * 86400_000) } }] } });
    const idempotency = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const loginEvents = await this.prisma.loginEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * 86400_000) } } });
    return { sessions: sessions.count, idempotency: idempotency.count, loginEvents: loginEvents.count };
  }
}
