import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { FastifyReply } from 'fastify';

// Prisma error codes that signal transient overload rather than a client bug.
// The CLI uses urllib3 Retry with status_forcelist={429, 502, 503, 504}, so
// returning 503 here lets it back off and retry automatically.
//
// P2028 — Transaction API error (query/transaction timeout, or connection
//          pool maxWait exceeded while waiting for a transaction slot)
// P2034 — Transaction failed due to a write conflict or deadlock
// P2024 — Timed out fetching a new connection from the connection pool
const OVERLOAD_CODES = new Set(['P2028', 'P2034', 'P2024']);

@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter
  implements ExceptionFilter<PrismaClientKnownRequestError>
{
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    if (OVERLOAD_CODES.has(exception.code)) {
      this.logger.warn(
        `Database backpressure [${exception.code}]: ${exception.message}`,
      );
      void reply
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .header('Retry-After', '5')
        .send({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'Service Unavailable',
          message:
            'Database is temporarily overloaded — please retry in a moment.',
          code: exception.code,
        });
      return;
    }

    this.logger.error(
      `Unhandled Prisma error [${exception.code}]: ${exception.message}`,
    );
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected database error occurred.',
      code: exception.code,
    });
  }
}
