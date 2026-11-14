import { Global, Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ErrorTracker } from './error-tracker';

@Global()
@Module({ providers: [ErrorTracker, AnalyticsService], exports: [ErrorTracker, AnalyticsService] })
export class LoggingModule {}
