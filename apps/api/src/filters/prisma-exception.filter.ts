import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
} from '@prisma/client/runtime/client';
import { FastifyReply } from 'fastify';

// Prisma error codes that signal transient conditions the caller should retry.
// The CLI uses urllib3 Retry with status_forcelist={503}, so returning 503
// lets it back off and retry automatically instead of failing the whole run.
//
// P1001 — Can't reach database server (transient network blip, I/O stall
//          during Postgres checkpoint, or brief pod restart). Safe to retry.
// P2024 — Timed out fetching a new connection from the connection pool
// P2028 — Transaction API error (query/transaction timeout, or maxWait exceeded)
// P2034 — Transaction failed due to a write conflict or deadlock
const RETRYABLE_CODES = new Set(['P1001', 'P2024', 'P2028', 'P2034']);

@Catch(PrismaClientKnownRequestError, PrismaClientInitializationError)
export class PrismaExceptionFilter
  implements
    ExceptionFilter<
      PrismaClientKnownRequestError | PrismaClientInitializationError
    >
{
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: PrismaClientKnownRequestError | PrismaClientInitializationError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    const code =
      exception instanceof PrismaClientKnownRequestError
        ? exception.code
        : exception.errorCode ?? 'P1000';

    if (RETRYABLE_CODES.has(code)) {
      this.logger.warn(`Database transient error [${code}]: ${exception.message}`);
      void reply
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .header('Retry-After', '5')
        .send({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'Service Unavailable',
          message: 'Database is temporarily unavailable — please retry in a moment.',
          code,
        });
      return;
    }

    this.logger.error(`Unhandled Prisma error [${code}]: ${exception.message}`);
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected database error occurred.',
      code,
    });
  }
}
