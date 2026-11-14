import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, UnprocessableEntityException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { Observable, from, mergeMap, of, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IDEMPOTENT } from './decorators';

/**
 * `Idempotency-Key` support for POST handlers marked @Idempotent(). Same key + same body replays the first
 * response; same key + different body is 422; a concurrent in-flight duplicate is 409. Keys live 24h.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key) return next.handle();
    return from(this.run(req, res, key, next)).pipe(mergeMap((o) => o));
  }

  private async run(req: Request & { user?: { id: string } }, res: Response, key: string, next: CallHandler): Promise<Observable<unknown>> {
    const scope = `${req.user?.id ?? 'anon'}:${req.method}:${req.route?.path ?? req.path}`;
    const id = createHash('sha256').update(`${scope}:${key}`).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { id } });
    if (existing && existing.expiresAt > new Date()) {
      if (existing.requestHash !== requestHash) throw new UnprocessableEntityException({ message: 'Idempotency-Key reused with a different request body', code: 'IDEMPOTENCY_MISMATCH' });
      if (existing.responseBody === null) throw new ConflictException({ message: 'A request with this Idempotency-Key is still in progress', code: 'IDEMPOTENCY_IN_PROGRESS' });
      res.setHeader('Idempotent-Replay', 'true');
      res.status(existing.responseStatus ?? 200);
      return of(existing.responseBody);
    }
    try {
      if (existing) await this.prisma.idempotencyKey.delete({ where: { id } });
      await this.prisma.idempotencyKey.create({ data: { id, scope, requestHash, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
    } catch {
      throw new ConflictException({ message: 'A request with this Idempotency-Key is still in progress', code: 'IDEMPOTENCY_IN_PROGRESS' });
    }
    return next.handle().pipe(
      // persist the response BEFORE replying so an immediate retry replays instead of seeing "in progress"
      mergeMap(async (body) => {
        await this.prisma.idempotencyKey
          .update({ where: { id }, data: { responseStatus: res.statusCode, responseBody: JSON.parse(JSON.stringify(body ?? {})) as Prisma.InputJsonValue } })
          .catch(() => undefined);
        return body;
      }),
      tap({ error: () => { void this.prisma.idempotencyKey.delete({ where: { id } }).catch(() => undefined); } }),
    );
  }
}
