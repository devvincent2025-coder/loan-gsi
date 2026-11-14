import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ErrorTracker } from '../logging/error-tracker';
import { rootLogger } from '../logging/logger';
import { requestContext } from './request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(ErrorTracker) private tracker: ErrorTracker) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext.get()?.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string' ? { statusCode: status, message: body } : { statusCode: status, ...(body as object) };
      res.status(status).json(payload);
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        res.status(409).json({ statusCode: 409, message: 'A record with these details already exists', code: 'DUPLICATE' });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(404).json({ statusCode: 404, message: 'Record not found', code: 'NOT_FOUND' });
        return;
      }
      if (exception.code === 'P2003') {
        res.status(409).json({ statusCode: 409, message: 'This record is referenced by other data and cannot be deleted', code: 'REFERENCED' });
        return;
      }
    }
    rootLogger.error({ err: exception, requestId }, 'unhandled exception');
    this.tracker.captureException(exception, { requestId });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong. Quote this reference to support.',
      code: 'INTERNAL',
      requestId,
    });
  }
}
