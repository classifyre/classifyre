import { ConflictException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { CLS_NAMESPACE_ID } from './namespace.constants';

/**
 * Rejection for any attempt to start or change work in a paused workspace.
 * 409 (not 403/423): the request is well-formed and authorised, it just
 * conflicts with the workspace's current state — resuming clears it.
 */
export class NamespacePausedException extends ConflictException {
  constructor() {
    super(
      'This workspace is paused. Resume it in workspace settings to start new activity.',
    );
  }
}

/**
 * Reads the current request's workspace pause state.
 *
 * Thin over {@link NamespaceRegistryService.isPaused} (which caches for a few
 * seconds): services call {@link assertNotPaused} at the top of anything that
 * starts background work so non-HTTP triggers (schedulers, pg-boss handlers,
 * supervisor) are frozen the same way the HTTP guard freezes API calls.
 */
@Injectable()
export class NamespacePauseService {
  constructor(
    private readonly registry: NamespaceRegistryService,
    private readonly cls: ClsService,
  ) {}

  /** Namespace id of the current request/worker context, if any. */
  namespaceId(): string | undefined {
    return this.cls.get<string>(CLS_NAMESPACE_ID) ?? undefined;
  }

  /** False outside any namespace (registry routes, health checks). */
  async isPaused(): Promise<boolean> {
    const id = this.namespaceId();
    if (!id) return false;
    return this.registry.isPaused(id);
  }

  /** Throw {@link NamespacePausedException} when the workspace is paused. */
  async assertNotPaused(): Promise<void> {
    if (await this.isPaused()) throw new NamespacePausedException();
  }
}
