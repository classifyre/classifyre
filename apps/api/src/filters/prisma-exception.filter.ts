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
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/client';
import { FastifyReply } from 'fastify';
import { transientDbErrorCode } from '../db/transient-db-error';

/**
 * Turns Prisma failures into HTTP responses.
 *
 * Transient conditions (pool starvation, transaction start timeout, deadlock,
 * dropped connection) become a 503 with `Retry-After`, which the CLI's
 * urllib3 `Retry(status_forcelist={503})` and the web api-client both back off
 * on. `DbRetryInterceptor` has already retried read-only handlers by the time a
 * response reaches here, so a 503 means the database stayed unavailable across
 * every attempt.
 *
 * `PrismaClientUnknownRequestError` is caught as well: with Prisma 7 driver
 * adapters, `pg` socket failures (connection terminated, ECONNRESET) arrive
 * without a Prisma code and used to be reported as a 500.
 */
@Catch(
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
  PrismaClientUnknownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter<
  | PrismaClientKnownRequestError
  | PrismaClientInitializationError
  | PrismaClientUnknownRequestError
> {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception:
      | PrismaClientKnownRequestError
      | PrismaClientInitializationError
      | PrismaClientUnknownRequestError,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    const transientCode = transientDbErrorCode(exception);

    if (transientCode) {
      this.logger.warn(
        `Database transient error [${transientCode}]: ${exception.message}`,
      );
      void reply
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .header('Retry-After', '5')
        .send({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: 'Service Unavailable',
          message:
            'Database is temporarily unavailable — please retry in a moment.',
          code: transientCode,
        });
      return;
    }

    const code =
      exception instanceof PrismaClientKnownRequestError
        ? exception.code
        : exception instanceof PrismaClientInitializationError
          ? (exception.errorCode ?? 'P1000')
          : 'P1000';

    this.logger.error(`Unhandled Prisma error [${code}]: ${exception.message}`);
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected database error occurred.',
      code,
    });
  }
}
