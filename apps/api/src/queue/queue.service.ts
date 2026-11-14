import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectionOptions, JobsOptions, Queue, QueueEvents, Worker, Processor } from 'bullmq';
import IORedis from 'ioredis';
import { APP_ENV, AppEnv } from '../config/config.module';

export const QUEUES = { notifications: 'notifications', maintenance: 'maintenance', bureau: 'bureau', disbursement: 'disbursement', autodebit: 'autodebit', ledger: 'ledger' } as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

type InlineHandler = (name: string, data: unknown) => Promise<unknown>;

/**
 * Thin BullMQ wrapper. Redis outages never crash the API: `enqueue` falls back to inline execution
 * outside production (and reports degraded health). Add new queues to QUEUES.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Queue');
  private connection!: IORedis;
  private queues = new Map<QueueName, Queue>();
  private workers: Worker[] = [];
  private inline = new Map<QueueName, InlineHandler>();
  private ready = false;

  constructor(@Inject(APP_ENV) private env: AppEnv) {}

  async onModuleInit(): Promise<void> {
    this.connection = new IORedis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null, lazyConnect: true, enableOfflineQueue: true,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.connection.on('error', (e) => { if (this.ready) this.log.warn(`redis error: ${e.message}`); this.ready = false; });
    this.connection.on('ready', () => { this.ready = true; });
    try {
      await Promise.race([this.connection.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error('redis connect timeout')), 3000))]);
      this.ready = true;
    } catch (e) {
      this.log.warn(`Redis unavailable (${(e as Error).message}); queues degrade to inline mode`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    this.connection?.disconnect();
  }

  get isReady(): boolean { return this.ready && this.connection?.status === 'ready'; }
  get redis(): IORedis { return this.connection; }
  allQueues(): Queue[] { return Object.values(QUEUES).map((n) => this.queue(n)); }

  /**
   * BullMQ needs its OWN connection per Queue/Worker: a Worker issues blocking Redis commands, so sharing one ioredis
   * instance with producers can stall `queue.add()` forever. Pass options (not an instance) so BullMQ creates them.
   */
  private bullConnection(): ConnectionOptions {
    const u = new URL(this.env.REDIS_URL);
    return {
      host: u.hostname, port: Number(u.port || 6379), username: u.username || undefined, password: u.password ? decodeURIComponent(u.password) : undefined,
      db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0, tls: u.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null, retryStrategy: (times: number) => Math.min(times * 500, 5000),
    };
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) { q = new Queue(name, { connection: this.bullConnection() }); q.on('error', () => undefined); this.queues.set(name, q); }
    return q;
  }

  /** Register the processor. Runs in a BullMQ worker when Redis is up, and as the inline fallback otherwise. */
  register(name: QueueName, processor: (jobName: string, data: unknown) => Promise<unknown>): void {
    this.inline.set(name, processor);
    const proc: Processor = (job) => processor(job.name, job.data);
    const w = new Worker(name, proc, { connection: this.bullConnection(), concurrency: 5 });
    w.on('error', () => undefined);
    w.on('failed', (job, err) => this.log.warn(`job ${job?.name} failed: ${err.message}`));
    this.workers.push(w);
  }

  async enqueue(name: QueueName, jobName: string, data: unknown, opts: JobsOptions = {}): Promise<'queued' | 'inline'> {
    this.log.debug(`enqueue ${name}/${jobName} ready=${this.isReady} status=${this.connection?.status}`);
    if (this.isReady) {
      await this.queue(name).add(jobName, data, {
        attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000, ...opts,
      });
      return 'queued';
    }
    if (this.env.NODE_ENV === 'production') throw new Error('Queue unavailable');
    const h = this.inline.get(name);
    if (h) await h(jobName, data);
    return 'inline';
  }

  /** `every` is an interval in ms, or a cron `{ pattern, tz? }` (e.g. monthly jobs). */
  async schedule(name: QueueName, schedulerId: string, every: number | { pattern: string; tz?: string }, jobName: string, data: unknown = {}): Promise<void> {
    if (!this.isReady) return;
    await this.queue(name).upsertJobScheduler(schedulerId, typeof every === 'number' ? { every } : { pattern: every.pattern, tz: every.tz }, { name: jobName, data });
  }

  async ping(): Promise<number> {
    const t = Date.now();
    await this.connection.ping();
    return Date.now() - t;
  }
}

export { QueueEvents };
