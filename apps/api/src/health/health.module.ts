import { Controller, Get, Inject, Module } from '@nestjs/common';
import { HealthDto } from '@damez/shared';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

const started = Date.now();

@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService, @Inject(QueueService) private queue: QueueService) {}

  /** Liveness: process is up. */
  @Public() @Get()
  live() { return { status: 'ok', uptimeSeconds: Math.round((Date.now() - started) / 1000) }; }

  /** Readiness: dependencies. Redis down => degraded (API still serves, jobs run inline in non-prod). */
  @Public() @Get('ready')
  async ready(): Promise<HealthDto> {
    const checks: HealthDto['checks'] = {};
    const t = Date.now();
    try { await this.prisma.$queryRaw`SELECT 1`; checks.database = { status: 'up', latencyMs: Date.now() - t }; }
    catch (e) { checks.database = { status: 'down', error: (e as Error).message.slice(0, 120) }; }
    try { checks.redis = { status: 'up', latencyMs: await this.queue.ping() }; }
    catch (e) { checks.redis = { status: 'down', error: (e as Error).message.slice(0, 120) }; }
    const status = checks.database.status === 'up' && checks.redis.status === 'up' ? 'ok' : 'degraded';
    return { status, checks, uptimeSeconds: Math.round((Date.now() - started) / 1000), version: process.env.APP_VERSION ?? '0.1.0' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
