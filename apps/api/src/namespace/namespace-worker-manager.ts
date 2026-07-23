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
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingCapabilityService } from '../embedding/embedding-capability.service';
import { ChatGatewayService } from '../chat-gateway/chat-gateway.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { McpClientService } from '../autopilot/mcp-client/mcp-client.service';
import { PgStreamService } from '../export/pg-stream.service';
import { RunnerEventsGateway } from '../websocket/runner-events.gateway';
import { NotificationEventsGateway } from '../websocket/notification-events.gateway';
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
  private readonly active = new Map<string, NamespaceContext>();
  private configWatchTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private reconciling = false;

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
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingCapability: EmbeddingCapabilityService,
    private readonly chat: ChatGatewayService,
    private readonly cliRunner: CliRunnerService,
    private readonly mcpClient: McpClientService,
    private readonly pgStream: PgStreamService,
    private readonly runnerEvents: RunnerEventsGateway,
    private readonly notificationEvents: NotificationEventsGateway,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Teardown is needed in every service role: API-only pods can own lazy
    // Prisma/pg-boss/export/MCP connections even though they run no workers.
    this.registry.onDeleting((e) => this.stop(e));

    this.reconcileTimer = setInterval(() => {
      void this.reconcileNamespaces();
    }, 2_000);
    this.reconcileTimer.unref();

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

    this.registry.onCreated((e) => this.start(e));

    // Single loop that picks up per-namespace chat-bot config changes made via
    // API pods (the connectors run only here on the worker).
    this.configWatchTimer = setInterval(() => {
      void this.watchConfigs();
    }, ChatGatewayService.CONFIG_WATCH_INTERVAL_MS);
    this.configWatchTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.configWatchTimer) clearInterval(this.configWatchTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const ctx of [...this.active.values()]) {
      await this.stop(ctx).catch(() => undefined);
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
    this.active.set(e.schemaName, this.store(e));

    // Keep this namespace's Prisma client resident while its workers run.
    try {
      this.cliRunner.activateForSchema(e.schemaName);
      this.prismaManager.pin(e.schemaName);
      await this.pgBoss.startForNamespace(e.schemaName, e.namespaceId);

      const ctx = this.store(e);
      await this.runInNamespace(ctx, async () => {
        await this.scheduler.registerForNamespace();
        await this.cleanup.registerForNamespace();
        await this.matching.registerForNamespace();
        await this.correlation.registerForNamespace();
        await this.autopilot.registerForNamespace();
        await this.embedding.registerForNamespace();
        await this.mcpClient
          .refresh()
          .catch((error) =>
            this.logger.warn(
              `MCP client refresh failed for '${e.slug}': ${String(error)}`,
            ),
          );
        // Long-poll chat connectors + orphaned-runner recovery (non-pg-boss).
        await this.chat
          .refresh()
          .catch((error) =>
            this.logger.warn(
              `Chat gateway refresh failed for '${e.slug}': ${String(error)}`,
            ),
          );
        if (typeof this.cliRunner.reconcileOnStartup === 'function') {
          await this.cliRunner
            .reconcileOnStartup()
            .catch((error) =>
              this.logger.warn(
                `Runner reconcile failed for '${e.slug}': ${String(error)}`,
              ),
            );
        }
      });
    } catch (error) {
      // A failed partial start must be retryable and must not leave pools/jobs
      // pinned forever.
      await this.stop(e);
      throw error;
    }
    this.logger.log(`Started workers for namespace '${e.slug}'`);
  }

  private async stop(e: NamespaceLifecycleEvent): Promise<void> {
    const wasActive = this.active.delete(e.schemaName);
    // Independent resource families stop concurrently so distributed deletion
    // stays within the API pod's grace period even when pg-boss or a connector
    // needs its full shutdown timeout.
    await Promise.all([
      this.runInNamespace(this.store(e), () =>
        Promise.all([
          this.cliRunner.stopForSchema(e.schemaName).catch(() => undefined),
          this.chat.stopForSchema(e.schemaName).catch(() => undefined),
          this.embedding.stopForSchema(e.schemaName).catch(() => undefined),
          this.mcpClient.stopForSchema(e.schemaName).catch(() => undefined),
        ]),
      ),
      this.pgBoss.stopForNamespace(e.schemaName).catch(() => undefined),
      this.pgStream.dropForSchema(e.schemaName).catch(() => undefined),
    ]);
    this.runnerEvents.stopForSchema(e.schemaName);
    this.notificationEvents.stopForSchema(e.schemaName);
    this.scheduler.clearForSchema(e.schemaName);
    this.embeddingService.clearForSchema(e.schemaName);
    this.embeddingCapability.clearForSchema(e.schemaName);
    if (wasActive) this.prismaManager.unpin(e.schemaName);
    await this.prismaManager.dropWhenIdle(e.schemaName).catch(() => undefined);
    if (wasActive) {
      this.logger.log(`Stopped workers for namespace schema '${e.schemaName}'`);
    }
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

  /**
   * Reconcile process-local state with the shared registry. Lifecycle callbacks
   * only reach the API process that handled a CRUD request; production worker
   * pods and sibling API replicas discover those changes through this poll.
   */
  private async reconcileNamespaces(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    let namespaces: Awaited<ReturnType<NamespaceRegistryService['list']>>;
    try {
      namespaces = await this.registry.list();
    } catch (error) {
      this.logger.warn(`Namespace reconciliation failed: ${String(error)}`);
      this.reconciling = false;
      return;
    }
    const local = new Map<string, NamespaceContext>(
      namespaces
        .filter((ns) => ns.type === 'local')
        .map((ns) => [
          ns.schemaName,
          this.store({
            namespaceId: ns.id,
            slug: ns.slug,
            schemaName: ns.schemaName,
          }),
        ]),
    );

    try {
      if (runsBackgroundWorkers()) {
        for (const ctx of local.values()) {
          if (!this.active.has(ctx.schemaName)) {
            await this.start(ctx).catch((error) =>
              this.logger.error(
                `Failed to start workers for namespace '${ctx.slug}': ${String(error)}`,
              ),
            );
          }
        }
      }

      const knownSchemas = new Set([
        ...this.active.keys(),
        ...this.prismaManager.residentSchemas(),
      ]);
      for (const schema of knownSchemas) {
        if (local.has(schema)) continue;
        const ctx = this.active.get(schema) ?? {
          namespaceId: '',
          slug: schema.replace(/^ns_/, '').replace(/_/g, '-'),
          schemaName: schema,
        };
        await this.stop(ctx).catch(() => undefined);
      }
    } finally {
      this.reconciling = false;
    }
  }
}
