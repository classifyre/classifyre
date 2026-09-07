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

    // A unique violation is a *client* mistake with a knowable cause, and it
    // used to come back as `500 {"code":"P2002"}` with the only useful part —
    // "Unique constraint failed on the fields: (source_id, hash)" — left behind
    // in the API log. That answer cost a caller a 1,140-asset ingest and told
    // them nothing about what to change. Report the constraint's own fields.
    if (
      code === 'P2002' &&
      exception instanceof PrismaClientKnownRequestError
    ) {
      const target = (exception.meta as { target?: unknown } | undefined)
        ?.target;
      const fields = Array.isArray(target)
        ? target.map(String)
        : typeof target === 'string'
          ? [target]
          : [];
      const on = fields.length > 0 ? ` on (${fields.join(', ')})` : '';
      this.logger.warn(
        `Unique constraint violation${on}: ${exception.message}`,
      );
      void reply.status(HttpStatus.CONFLICT).send({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message:
          `A record with the same value already exists${on}. ` +
          'Two rows in one request carrying the same identity is the usual ' +
          'cause; give each object a distinct id.',
        code,
        fields,
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
