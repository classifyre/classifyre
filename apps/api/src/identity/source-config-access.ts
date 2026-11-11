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
import type { Capability } from './capabilities';
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
  canSeeConfig(actor: Actor = this.actors.current()): Promise<boolean> {
    return this.canSee('source.manage', actor);
  }

  /**
   * Whether the current caller holds `capability` — or acts for the
   * workspace itself: jobs with the internal key, in-process work and the
   * autopilot always see definitions.
   */
  async canSee(
    capability: Capability,
    actor: Actor = this.actors.current(),
  ): Promise<boolean> {
    if (
      actor.kind === 'system' ||
      actor.via === 'internal-key' ||
      actor.via === 'autopilot'
    ) {
      return true;
    }
    return (await this.policy.check(actor, capability)).allow;
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

/**
 * A copy with every custom detector's definition left out: its pipeline
 * (patterns, prompts, a code detector's program), its secret names and its
 * AI provider. What a detector finds stays readable; how it finds it is for
 * people who can change detectors (`detector.manage`).
 */
export function withoutDetectorDefinition<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => withoutDetectorDefinition(item)) as T;
  }
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
    if (key === 'pipelineSchema') {
      // Its kind stays (what the page shows the detector as); nothing else.
      const type =
        item && typeof item === 'object'
          ? (item as { type?: unknown }).type
          : undefined;
      out[key] = type === undefined ? {} : { type };
    }
    // Older detectors keep their rules in `config`.
    else if (key === 'config') out[key] = {};
    else if (key === 'secretKeys') out[key] = [];
    else if (key === 'aiProviderConfigId') out[key] = null;
    else out[key] = withoutDetectorDefinition(item);
  }
  return out as T;
}

/** Custom detector answers without their definition, for callers without detector.manage. */
@Injectable()
export class DetectorDefinitionInterceptor implements NestInterceptor {
  constructor(private readonly access: SourceConfigAccess) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        mergeMap(async (body) =>
          (await this.access.canSee('detector.manage'))
            ? body
            : withoutDetectorDefinition(body),
        ),
      );
  }
}
