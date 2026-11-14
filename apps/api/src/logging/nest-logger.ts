import { LoggerService } from '@nestjs/common';
import { Logger } from 'pino';

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, ...rest: unknown[]) { this.logger.info({ ctx: rest[0] }, String(message)); }
  error(message: unknown, ...rest: unknown[]) { this.logger.error({ ctx: rest[1] ?? rest[0], trace: rest[0] }, String(message)); }
  warn(message: unknown, ...rest: unknown[]) { this.logger.warn({ ctx: rest[0] }, String(message)); }
  debug(message: unknown, ...rest: unknown[]) { this.logger.debug({ ctx: rest[0] }, String(message)); }
  verbose(message: unknown, ...rest: unknown[]) { this.logger.trace({ ctx: rest[0] }, String(message)); }
}
