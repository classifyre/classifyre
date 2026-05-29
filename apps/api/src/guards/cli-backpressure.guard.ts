import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import '@fastify/under-pressure'; // augments FastifyInstance with isUnderPressure()

/**
 * Guards the six CLI ingestion endpoints against a process under load.
 *
 * Instead of rejecting every incoming request (which blocks human users of the
 * UI as well), this guard is applied selectively via @UseGuards on the specific
 * route handlers the CLI calls:
 *
 *   POST  sources/:id/runners/external
 *   POST  sources/:id/assets/bulk
 *   POST  sources/:id/assets/finalize
 *   POST  runners/:id/assets/discover
 *   PATCH runners/:id/assets/status
 *   PATCH runners/:id/status
 *
 * The guard reads the pre-computed pressure state from @fastify/under-pressure
 * (which samples event-loop delay, heap, and RSS on a background interval).
 * When the server is above any configured threshold it returns 503 + Retry-After
 * so the CLI's urllib3 retry policy backs off instead of piling on.
 *
 * @fastify/under-pressure must be registered in main.ts with
 * pressureHandler set to a no-op so it does NOT auto-reject — this guard
 * handles that decision per-route instead.
 */
@Injectable()
export class CliBackpressureGuard implements CanActivate {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  canActivate(_context: ExecutionContext): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const fastify = this.adapterHost.httpAdapter.getInstance() as any;

    if (
      typeof fastify.isUnderPressure === 'function' &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (fastify.isUnderPressure() as boolean)
    ) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Server is under load — please retry in a moment.',
      });
    }

    return true;
  }
}
