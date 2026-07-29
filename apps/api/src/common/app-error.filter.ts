/**
 * Maps the typed error taxonomy to HTTP. Clients switch on `code`, never on
 * message text. Anything that is not an AppError or HttpException is a bug —
 * logged with the trace id and returned as an opaque 500.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import type { Response } from 'express';
import type pino from 'pino';
import { AppError } from '@pipefix/shared';
import { LOGGER } from '../env';

@Catch()
export class AppErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: pino.Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.logger.info({
        event: 'request.app_error',
        code: exception.code,
        details: exception.details,
      });
      res.status(exception.httpStatus).json(exception.toJSON());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res
        .status(status)
        .json({
          code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
          message: exception.message,
          details: {},
        });
      return;
    }
    this.logger.error({ event: 'request.unhandled_error', err: exception });
    res
      .status(500)
      .json({ code: 'INTERNAL', message: 'Something went wrong on our side', details: {} });
  }
}
