import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { runsBackgroundWorkers } from '../service-role';
import { PgBossService } from '../scheduler/pg-boss.service';
import { PrismaClientManager } from '../prisma/prisma-client-manager';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { RunnerCleanupService } from '../scheduler/runner-cleanup.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import { CorrelationWorker } from '../correlation/correlation.worker';
import { AutopilotWorker } from '../autopilot/autopilot.worker';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { ChatGatewayService } from '../chat-gateway/chat-gateway.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
  type NamespaceContext,
} from './namespace.constants';
import type { NamespaceLifecycleEvent } from '../registry/namespace.types';

/**
 * Runs one set of background workers per namespace inside the single shared
 * worker process (SERVICE_ROLE=worker|all). On boot it enumerates namespaces
 * and starts a pg-boss instance + worker set for each; it starts/stops them
 * dynamically as namespaces are created/deleted. Every worker registration and
 * job handler runs inside the namespace's CLS context so injected services and
 * PrismaService resolve the right tenant schema.
 */
@Injectable()
export class NamespaceWorkerManager
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NamespaceWorkerManager.name);
  private readonly active = new Set<string>();
  private configWatchTimer?: NodeJS.Timeout;

  constructor(
    private readonly registry: NamespaceRegistryService,
    private readonly pgBoss: PgBossService,
    private readonly prismaManager: PrismaClientManager,
    private readonly cls: ClsService,
    private readonly scheduler: SchedulerService,
    private readonly cleanup: RunnerCleanupService,
    private readonly matching: InquiryMatchingService,
    private readonly correlation: CorrelationWorker,
    private readonly autopilot: AutopilotWorker,
    private readonly embedding: EmbeddingQueueService,
    private readonly chat: ChatGatewayService,
    private readonly cliRunner: CliRunnerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!runsBackgroundWorkers()) {
      this.logger.log('SERVICE_ROLE=api: namespace workers not started here');
      return;
    }

    for (const ns of await this.registry.list()) {
      if (ns.type !== 'local') continue;
      await this.start({
        namespaceId: ns.id,
        slug: ns.slug,
        schemaName: ns.schemaName,
      }).catch((error) =>
        this.logger.error(
          `Failed to start workers for namespace '${ns.slug}': ${String(error)}`,
        ),
      );
    }

    this.registry.onCreated((e) => void this.start(e).catch(() => undefined));
    this.registry.onDeleting((e) => void this.stop(e).catch(() => undefined));

    // Single loop that picks up per-namespace chat-bot config changes made via
    // API pods (the connectors run only here on the worker).
    this.configWatchTimer = setInterval(() => {
      void this.watchConfigs();
    }, ChatGatewayService.CONFIG_WATCH_INTERVAL_MS);
    this.configWatchTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.configWatchTimer) clearInterval(this.configWatchTimer);
    for (const schema of [...this.active]) {
      const slug = schema; // best-effort; stop() only needs the schema for teardown
      await this.stop({
        namespaceId: '',
        slug,
        schemaName: schema,
      }).catch(() => undefined);
    }
  }

  private store(e: NamespaceLifecycleEvent): NamespaceContext {
    return {
      namespaceId: e.namespaceId,
      slug: e.slug,
      schemaName: e.schemaName,
    };
  }

  private runInNamespace<T>(ctx: NamespaceContext, fn: () => T): T {
    return this.cls.run(() => {
      this.cls.set(CLS_SCHEMA, ctx.schemaName);
      this.cls.set(CLS_NAMESPACE_ID, ctx.namespaceId);
      this.cls.set(CLS_SLUG, ctx.slug);
      return fn();
    });
  }

  private async start(e: NamespaceLifecycleEvent): Promise<void> {
    if (this.active.has(e.schemaName)) return;
    this.active.add(e.schemaName);

    // Keep this namespace's Prisma client resident while its workers run.
    this.prismaManager.pin(e.schemaName);
    await this.pgBoss.startForNamespace(e.schemaName, e.slug);

    const ctx = this.store(e);
    await this.runInNamespace(ctx, async () => {
      await this.scheduler.registerForNamespace();
      await this.cleanup.registerForNamespace();
      await this.matching.registerForNamespace();
      await this.correlation.registerForNamespace();
      await this.autopilot.registerForNamespace();
      await this.embedding.registerForNamespace();
      // Long-poll chat connectors + orphaned-runner recovery (non-pg-boss).
      await this.chat
        .refresh()
        .catch((error) =>
          this.logger.warn(
            `Chat gateway refresh failed for '${e.slug}': ${String(error)}`,
          ),
        );
      await this.cliRunner
        .reconcileOnStartup()
        .catch((error) =>
          this.logger.warn(
            `Runner reconcile failed for '${e.slug}': ${String(error)}`,
          ),
        );
    });
    this.logger.log(`Started workers for namespace '${e.slug}'`);
  }

  private async stop(e: NamespaceLifecycleEvent): Promise<void> {
    if (!this.active.delete(e.schemaName)) return;
    await this.chat.stopForSchema(e.schemaName).catch(() => undefined);
    await this.pgBoss.stopForNamespace(e.schemaName).catch(() => undefined);
    this.prismaManager.unpin(e.schemaName);
    await this.prismaManager.drop(e.schemaName).catch(() => undefined);
    this.logger.log(`Stopped workers for namespace schema '${e.schemaName}'`);
  }

  private async watchConfigs(): Promise<void> {
    for (const ns of await this.registry.list().catch(() => [])) {
      if (!this.active.has(ns.schemaName)) continue;
      await this.runInNamespace(
        { namespaceId: ns.id, slug: ns.slug, schemaName: ns.schemaName },
        () => this.chat.refreshIfConfigChanged().catch(() => undefined),
      );
    }
  }
}
