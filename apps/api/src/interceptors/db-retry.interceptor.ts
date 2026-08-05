import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, retry, throwError, timer } from 'rxjs';
import { dbRetryDelayMs } from '../db/db-retry';
import { READ_ONLY_ENDPOINT } from '../db/read-only-endpoint.decorator';
import { transientDbErrorCode } from '../db/transient-db-error';

/** Methods that carry no side effects and can always be replayed. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const MAX_ATTEMPTS = Number(process.env.DB_RETRY_ATTEMPTS ?? 3);

/**
 * Retries a request handler when it fails with a transient database error
 * instead of letting the browser see a 503.
 *
 * The overview pages (scans, findings, assets) fan out several list+count
 * queries at once; a burst of those against a small connection pool used to
 * surface as `P2028 Unable to start a transaction in the given time` and a dead
 * table. A couple of jittered retries absorb that window — the pool frees a
 * connection in milliseconds, so the user never notices.
 *
 * Only replayable requests are retried: idempotent HTTP methods, plus handlers
 * explicitly marked with `@ReadOnlyEndpoint()` (the POST `search/*` endpoints).
 * Everything else still gets the 503 so the caller decides.
 */
@Injectable()
export class DbRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DbRetryInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const readOnly =
      IDEMPOTENT_METHODS.has(request.method?.toUpperCase() ?? '') ||
      this.reflector.getAllAndOverride<boolean>(READ_ONLY_ENDPOINT, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (!readOnly || MAX_ATTEMPTS <= 1) return next.handle();

    return next.handle().pipe(
      retry({
        count: MAX_ATTEMPTS - 1,
        delay: (error: unknown, retryNumber: number) => {
          const code = transientDbErrorCode(error);
          // `reply.sent` guards streaming handlers (CSV export): once bytes are
          // on the wire the response cannot be restarted.
          if (!code || reply.sent) return throwError(() => error);

          const delay = dbRetryDelayMs(retryNumber);
          this.logger.warn(
            `Transient database error [${code}] on ${request.method} ${request.url}; ` +
              `retrying in ${delay}ms (attempt ${retryNumber + 1}/${MAX_ATTEMPTS})`,
          );
          return timer(delay);
        },
      }),
    );
  }
}
