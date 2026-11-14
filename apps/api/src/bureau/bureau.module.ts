import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { BUREAU_PORT } from '../contracts/ports';
import { QUEUES, QueueService } from '../queue/queue.service';
import { BureauAggregator } from './bureau-aggregator';
import { BureauAnalyticsService } from './bureau-analytics';
import { BureauFurnishingService, BureauSubmissionAdapters } from './bureau-furnishing';
import { BureauMonitoringService } from './bureau-monitoring';
import { BureauSettingsService } from './bureau-settings';
import { BureauController } from './bureau.controller';
import { BureauService } from './bureau.service';
import { BureauProviders } from './providers';

/** Monthly jobs on their own `bureau` queue (BullMQ repeatable schedulers, cron in Africa/Lagos). */
@Injectable()
export class BureauJobs implements OnModuleInit {
  private log = new Logger('BureauJobs');
  constructor(private queue: QueueService, private monitoring: BureauMonitoringService, private furnishing: BureauFurnishingService) {}

  onModuleInit(): void {
    this.queue.register(QUEUES.bureau, async (name) => {
      if (name === 'monitoring') return this.monitoring.run({ scheduled: true });
      if (name === 'furnishing') return this.furnishing.run({ scheduled: true });
      return undefined;
    });
    // 1st of the month 02:00: refresh active borrowers; 3rd 03:00: report the previous month's performance
    const t = setTimeout(() => {
      void this.queue.schedule(QUEUES.bureau, 'bureau-monitoring', { pattern: '0 2 1 * *', tz: 'Africa/Lagos' }, 'monitoring').catch((e: Error) => this.log.warn(e.message));
      void this.queue.schedule(QUEUES.bureau, 'bureau-furnishing', { pattern: '0 3 3 * *', tz: 'Africa/Lagos' }, 'furnishing').catch((e: Error) => this.log.warn(e.message));
    }, 4000);
    t.unref();
  }
}

/** Provides BUREAU_PORT (global). Consumes LOAN_PORTFOLIO_PORT optionally, so it also boots before the applications module exists. */
@Global()
@Module({
  controllers: [BureauController],
  providers: [
    BureauProviders, BureauAggregator, BureauSettingsService, BureauService, BureauAnalyticsService, BureauMonitoringService, BureauSubmissionAdapters, BureauFurnishingService, BureauJobs,
    { provide: BUREAU_PORT, useExisting: BureauService },
  ],
  exports: [BUREAU_PORT, BureauService, BureauAnalyticsService, BureauProviders],
})
export class BureauModule {}
