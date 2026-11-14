import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { SESSION_COOKIE } from './auth/access.guard';
import { installBigIntJson } from './common/bigint';
import { loadEnv } from './config/env';
import { createLogger, rootLogger } from './logging/logger';
import { PinoNestLogger } from './logging/nest-logger';
import { QueueService } from './queue/queue.service';

export const API_PREFIX = 'api/v1';

export async function createApp(): Promise<NestExpressApplication> {
  const env = loadEnv();
  installBigIntJson();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new PinoNestLogger(createLogger(env.LOG_LEVEL)),
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-background-poll', 'x-request-id', 'x-device-fingerprint'] });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}

/** Bull Board at /api/v1/admin/queues, gated by session + system:jobs. */
export function mountBullBoard(app: NestExpressApplication): void {
  const adapter = new ExpressAdapter();
  adapter.setBasePath(`/${API_PREFIX}/admin/queues`);
  const queues = app.get(QueueService);
  createBullBoard({ queues: queues.allQueues().map((q) => new BullMQAdapter(q)), serverAdapter: adapter });
  const auth = app.get(AuthService);
  const gate = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const user = token ? await auth.resolveSession(token, false) : null;
    if (!user) return void res.status(401).send('Sign in first');
    if (!user.permissions.has('system:jobs')) return void res.status(403).send('Requires system:jobs');
    next();
  };
  app.use(`/${API_PREFIX}/admin/queues`, (req: Request, res: Response, next: NextFunction) => void gate(req, res, next), adapter.getRouter());
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  mountBullBoard(app);
  await app.listen(env.PORT, '0.0.0.0');
  rootLogger.info({ port: env.PORT, demoMode: env.DEMO_MODE }, 'API listening');
}

if (require.main === module) {
  bootstrap().catch((e) => {
    rootLogger.fatal({ err: e }, 'failed to start');
    process.exit(1);
  });
}
