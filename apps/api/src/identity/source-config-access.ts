import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { mergeMap, type Observable } from 'rxjs';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy';
import type { Actor } from './actor';
import { ActorContextService } from './actor-context.service';

/**
 * What a source is configured with — its connection, credentials' shape,
 * sampling, detectors, a CUSTOM source's notebook code — is for the people
 * who can change it (`source.manage`). Everyone else reading sources (a
 * viewer, a visitor of a public workspace, an MCP token of either) sees that
 * the source exists, its name, type and scans, never how it is set up.
 *
 * Applied where configuration leaves the API (REST and MCP responses), never
 * inside it: scans, schedules and the autopilot keep reading the full source.
 */
@Injectable()
export class SourceConfigAccess {
  constructor(
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  /** Whether the current caller may see how sources are configured. */
  async canSeeConfig(actor: Actor = this.actors.current()): Promise<boolean> {
    // Jobs with the internal key, in-process work and the autopilot act for
    // the workspace itself.
    if (
      actor.kind === 'system' ||
      actor.via === 'internal-key' ||
      actor.via === 'autopilot'
    ) {
      return true;
    }
    return (await this.policy.check(actor, 'source.manage')).allow;
  }

  /** The value as the caller may see it: sources without configuration, runs without recipes. */
  async forCaller<T>(value: T): Promise<T> {
    if (await this.canSeeConfig()) return value;
    return withoutConfig(value);
  }
}

/**
 * A copy with every source's `config` cut down to its type and every run's
 * `recipe` dropped, wherever they sit in the value (one source, a list, a
 * search page, a run).
 */
export function withoutConfig<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutConfig(item)) as T;
  }
  // Data only: dates, binary bodies and streams pass as they are.
  if (
    !value ||
    typeof value !== 'object' ||
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    ArrayBuffer.isView(value) ||
    typeof (value as { pipe?: unknown }).pipe === 'function'
  ) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'config' && item && typeof item === 'object') {
      const type = (item as { type?: unknown }).type;
      out[key] = type === undefined ? {} : { type };
    } else if (key === 'recipe') {
      out[key] = null;
    } else {
      out[key] = withoutConfig(item);
    }
  }
  return out as T;
}

/**
 * Every response of a controller as its caller may see it: put on the
 * controllers whose answers carry sources or runs (sources, scans), so no
 * route of theirs can leak a configuration, whatever it returns.
 */
@Injectable()
export class SourceConfigInterceptor implements NestInterceptor {
  constructor(private readonly access: SourceConfigAccess) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(mergeMap((body) => this.access.forCaller(body)));
  }
}
