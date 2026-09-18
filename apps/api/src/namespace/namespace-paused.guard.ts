import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  NamespacePauseService,
  NamespacePausedException,
} from './namespace-pause.service';
import { InternalApiKeyService } from '../internal-api-key.service';
import { ALLOW_WHEN_PAUSED_KEY } from './allow-when-paused.decorator';
import { BLOCK_WHEN_PAUSED_KEY } from './block-when-paused.decorator';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Freeze activity-starting API calls while their workspace is paused.
 *
 * A paused workspace stays fully workable: reads of any HTTP method (search,
 * findings and charts queries are POSTs), direct CRUD, synchronous
 * request-scoped recomputation and diagnostics all pass through, as do the
 * wind-down endpoints marked with {@link AllowWhenPaused} and the registry
 * routes themselves (unscoped — the resume toggle lives there). Only
 * handlers marked {@link BlockWhenPaused} — the ones whose call starts
 * something: a scan, a job, a schedule, an AI run — get a 409 naming the
 * resume path, so a manual start fails fast instead of queueing work nobody
 * runs.
 *
 * CLI result callbacks (internal key) keep flowing so runs that were in
 * flight when the pause landed can report their terminal state instead of
 * wedging as RUNNING forever — except runner *creation*, which is new work
 * no matter who asks for it. Non-HTTP triggers (schedulers, pg-boss
 * handlers, supervisor) are frozen separately at the service level via
 * {@link NamespacePauseService.assertNotPaused} and by stopping the
 * namespace's workers outright.
 */
@Injectable()
export class NamespacePausedGuard implements CanActivate {
  constructor(
    private readonly pause: NamespacePauseService,
    private readonly internalApiKey: InternalApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url?: string;
      headers?: Record<string, unknown>;
    }>();
    if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) return true;
    // Outside any namespace: registry CRUD (including pause/resume itself),
    // health checks, docs. Nothing here is workspace activity.
    if (!this.pause.namespaceId()) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHEN_PAUSED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;

    if (this.internalApiKey.isInternalRequest(request.headers)) {
      // Runner creation starts a scan even when it arrives with the key.
      if (isRunnerCreation(request.method, request.url)) {
        throw new NamespacePausedException();
      }
      return true;
    }

    // Default-allow: only activity starters are frozen. Reads (whatever the
    // method), CRUD, sync recomputation and diagnostics pass; schedulers and
    // workers are stopped out-of-band so nothing runs behind them.
    const blocked = this.reflector.getAllAndOverride<boolean>(
      BLOCK_WHEN_PAUSED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (blocked && (await this.pause.isPaused())) {
      throw new NamespacePausedException();
    }
    return true;
  }
}

/**
 * Whether this request creates a runner record. Matched on the rewritten
 * (namespace-stripped) URL, so both `/sources/:id/runners/external` shapes
 * are covered regardless of the slug that was stripped.
 */
function isRunnerCreation(method: string, url: string | undefined): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const path = (url ?? '').split('?')[0];
  return /\/sources\/[^/]+\/runners\/external\/?$/.test(path);
}
