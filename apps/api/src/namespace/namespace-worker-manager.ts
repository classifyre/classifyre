import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { runsBackgroundWorkers } from '../service-role';
import { PgBossService } from '../scheduler/pg-boss.service';
import { WorkerLeadershipService } from '../scheduler/worker-leadership.service';
import { PrismaClientManager } from '../prisma/prisma-client-manager';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { RunnerCleanupService } from '../scheduler/runner-cleanup.service';
import { AutoScheduleService } from '../scheduler/auto-schedule.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import { CorrelationWorker } from '../correlation/correlation.worker';
import { AutopilotWorker } from '../autopilot/autopilot.worker';
import { SupervisorWorker } from '../autopilot/supervisor/supervisor.worker';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingCapabilityService } from '../embedding/embedding-capability.service';
import { ChatGatewayService } from '../chat-gateway/chat-gateway.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { McpClientService } from '../autopilot/mcp-client/mcp-client.service';
import { PgStreamService } from '../export/pg-stream.service';
import { DataTransferWorker } from '../data-transfer/data-transfer.worker';
import { FindingStatsWorker } from '../stats/finding-stats.worker';
import { SourceGraphWorker } from '../stats/source-graph.worker';
import { RunnerEventsGateway } from '../websocket/runner-events.gateway';
import { NotificationEventsGateway } from '../websocket/notification-events.gateway';
import {
  AutoSchedulePhase,
  RunnerStatus,
  SourceScheduleMode,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
  type NamespaceContext,
} from './namespace.constants';
import {
  coldModeConfigFromEnv,
  decideNamespaceIdle,
  type NamespaceActivitySnapshot,
} from './namespace-idle-policy';
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
  /**
   * Namespaces whose workers were put to sleep by cold mode, keyed by schema.
   * Sleeping namespaces keep their data and pg-boss schedules; only the
   * polling workers and pools are gone. They are excluded from the reconcile
   * auto-start and re-evaluated for activity on the idle timer.
   */
  private readonly sleeping = new Map<
    string,
    { ctx: NamespaceContext; since: Date }
  >();
  private configWatchTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private reconciling = false;
  private evaluatingIdle = false;

  constructor(
    private readonly registry: NamespaceRegistryService,
    private readonly pgBoss: PgBossService,
    private readonly prismaManager: PrismaClientManager,
    private readonly cls: ClsService,
    private readonly scheduler: SchedulerService,
    private readonly cleanup: RunnerCleanupService,
    private readonly autoSchedule: AutoScheduleService,
    private readonly matching: InquiryMatchingService,
    private readonly correlation: CorrelationWorker,
    private readonly autopilot: AutopilotWorker,
    private readonly supervisor: SupervisorWorker,
    private readonly embedding: EmbeddingQueueService,
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingCapability: EmbeddingCapabilityService,
    private readonly chat: ChatGatewayService,
    private readonly cliRunner: CliRunnerService,
    private readonly mcpClient: McpClientService,
    private readonly pgStream: PgStreamService,
    private readonly dataTransfer: DataTransferWorker,
    private readonly findingStats: FindingStatsWorker,
    private readonly sourceGraph: SourceGraphWorker,
    private readonly runnerEvents: RunnerEventsGateway,
    private readonly notificationEvents: NotificationEventsGateway,
    private readonly leadership: WorkerLeadershipService,
    private readonly prisma: PrismaService,
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

    // Chat connectors are the only piece that must not run twice, so they are
    // gated on a cross-replica election rather than on "am I the worker".
    // Everything else above is already replica-safe: pg-boss hands each job to
    // one consumer and the slot semaphore is a shared advisory lock.
    this.leadership.start({
      onAcquired: () => this.startConnectorsEverywhere(),
      onLost: () => this.chat.stopAllConnectors(),
    });

    // Single loop that picks up per-namespace chat-bot config changes made via
    // API pods (the connectors run only on the leader).
    this.configWatchTimer = setInterval(() => {
      void this.watchConfigs();
    }, ChatGatewayService.CONFIG_WATCH_INTERVAL_MS);
    this.configWatchTimer.unref();

    // Cold mode: put scan-idle namespaces to sleep and wake them when scans
    // (or schedules) reappear. Runs only here, on worker pods.
    const coldMode = coldModeConfigFromEnv();
    this.idleTimer = setInterval(() => {
      void this.evaluateIdle();
    }, coldMode.checkMs);
    this.idleTimer.unref();
  }

  /**
   * Bring up chat connectors for every namespace already running here.
   *
   * Leadership can be won long after the namespaces started — that is the
   * normal case on failover — so this cannot live in `start()` alone.
   */
  private async startConnectorsEverywhere(): Promise<void> {
    for (const ctx of [...this.active.values()]) {
      await this.runInNamespace(ctx, () =>
        this.chat
          .refresh()
          .catch((error) =>
            this.logger.warn(
              `Chat gateway refresh failed for '${ctx.slug}': ${String(error)}`,
            ),
          ),
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.configWatchTimer) clearInterval(this.configWatchTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
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
      this.cls.set(CLS_DATABASE_LANE, 'background');
      return fn();
    });
  }

  private async start(e: NamespaceLifecycleEvent): Promise<void> {
    if (this.active.has(e.schemaName)) return;
    this.active.set(e.schemaName, this.store(e));

    // Keep this namespace's Prisma client resident while its workers run.
    try {
      this.cliRunner.activateForSchema(e.schemaName);
      this.prismaManager.pin(e.schemaName, 'background');
      await this.pgBoss.startForNamespace(e.schemaName, e.namespaceId);

      const ctx = this.store(e);
      await this.runInNamespace(ctx, async () => {
        await this.scheduler.registerForNamespace();
        await this.autoSchedule.registerForNamespace();
        await this.cleanup.registerForNamespace();
        await this.matching.registerForNamespace();
        await this.correlation.registerForNamespace();
        await this.autopilot.registerForNamespace();
        await this.supervisor.registerForNamespace();
        await this.embedding.registerForNamespace();
        await this.dataTransfer.registerForNamespace();
        await this.findingStats.registerForNamespace();
        await this.sourceGraph.registerForNamespace();
        this.dataTransfer.schedulePurge(e.schemaName);
        await this.mcpClient
          .refresh()
          .catch((error) =>
            this.logger.warn(
              `MCP client refresh failed for '${e.slug}': ${String(error)}`,
            ),
          );
        // Long-poll chat connectors + orphaned-runner recovery (non-pg-boss).
        // Connectors only on the elected leader; a second poller double-polls
        // Telegram and double-replies on Slack.
        if (this.leadership.isLeader()) {
          await this.chat
            .refresh()
            .catch((error) =>
              this.logger.warn(
                `Chat gateway refresh failed for '${e.slug}': ${String(error)}`,
              ),
            );
        }
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

  /**
   * Best-effort teardown of one namespace's workers.
   *
   * Every step is isolated, because `start()` calls this from its own catch
   * block: a step that throws here does not just skip its own cleanup, it
   * REPLACES the error that caused the start to fail. `.catch(() => undefined)`
   * on each call was not enough — it handles rejections, but a synchronous
   * throw happens before there is a promise to attach to, so a provider missing
   * the method (a partial test double, a half-constructed provider) surfaced as
   * `TypeError: this.cliRunner.stopForSchema is not a function` and buried the
   * real cause. The trailing sync calls had no protection at all.
   */
  private async stop(e: NamespaceLifecycleEvent): Promise<void> {
    const wasActive = this.active.delete(e.schemaName);
    // A deleted namespace must never be woken back up by the idle evaluator.
    this.sleeping.delete(e.schemaName);
    const settle = async (label: string, fn: () => unknown): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        this.logger.warn(
          `Teardown step '${label}' failed for schema '${e.schemaName}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    // Independent resource families stop concurrently so distributed deletion
    // stays within the API pod's grace period even when pg-boss or a connector
    // needs its full shutdown timeout.
    await Promise.all([
      this.runInNamespace(this.store(e), () =>
        Promise.all([
          settle('cliRunner', () => this.cliRunner.stopForSchema(e.schemaName)),
          settle('chat', () => this.chat.stopForSchema(e.schemaName)),
          settle('embedding', () => this.embedding.stopForSchema(e.schemaName)),
          settle('mcpClient', () => this.mcpClient.stopForSchema(e.schemaName)),
          settle('dataTransfer', () =>
            this.dataTransfer.stopForSchema(e.schemaName),
          ),
        ]),
      ),
      settle('pgBoss', () => this.pgBoss.stopForNamespace(e.schemaName)),
      settle('pgStream', () => this.pgStream.dropForSchema(e.schemaName)),
    ]);
    await settle('runnerEvents', () =>
      this.runnerEvents.stopForSchema(e.schemaName),
    );
    await settle('notificationEvents', () =>
      this.notificationEvents.stopForSchema(e.schemaName),
    );
    await settle('scheduler', () =>
      this.scheduler.clearForSchema(e.schemaName),
    );
    await settle('embeddingService', () =>
      this.embeddingService.clearForSchema(e.schemaName),
    );
    await settle('embeddingCapability', () =>
      this.embeddingCapability.clearForSchema(e.schemaName),
    );
    if (wasActive) {
      await settle('prismaUnpin', () => this.prismaManager.unpin(e.schemaName));
    }
    await settle('prismaDrop', () =>
      this.prismaManager.dropWhenIdle(e.schemaName),
    );
    if (wasActive) {
      this.logger.log(`Stopped workers for namespace schema '${e.schemaName}'`);
    }
  }

  private async watchConfigs(): Promise<void> {
    if (!this.leadership.isLeader()) return;
    for (const ns of await this.registry.list().catch(() => [])) {
      if (!this.active.has(ns.schemaName)) continue;
      await this.runInNamespace(
        { namespaceId: ns.id, slug: ns.slug, schemaName: ns.schemaName },
        () => this.chat.refreshIfConfigChanged().catch(() => undefined),
      );
    }
  }

  /**
   * One cold-mode pass: sleep scan-idle namespaces, wake sleeping ones whose
   * activity reappeared.
   *
   * Fail-closed by construction: a namespace whose activity cannot be read
   * (transient database error, mid-migration schema) is left exactly as it is.
   * Sleeping requires a positive idle verdict from a fresh snapshot; waking
   * requires a positive activity verdict. An error is neither.
   */
  private async evaluateIdle(): Promise<void> {
    if (this.evaluatingIdle) return;
    const config = coldModeConfigFromEnv();
    if (!config.enabled) return;
    this.evaluatingIdle = true;
    try {
      const now = new Date();
      for (const ctx of [...this.active.values()]) {
        let snapshot: NamespaceActivitySnapshot;
        try {
          snapshot = await this.runInNamespace(ctx, () =>
            this.gatherActivitySnapshot(),
          );
        } catch (error) {
          this.logger.warn(
            `Cold-mode check skipped for namespace '${ctx.slug}': ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        const decision = decideNamespaceIdle(
          snapshot,
          now,
          config.idleAfterDays,
        );
        if (decision.idle) {
          await this.sleepNamespace(ctx, decision.reason).catch((error) =>
            this.logger.warn(
              `Cold-mode sleep failed for namespace '${ctx.slug}': ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }

      if (this.sleeping.size === 0) return;
      const namespaces = await this.registry.list().catch(() => []);
      const known = new Map(
        namespaces.map((ns) => [ns.schemaName, ns] as [string, typeof ns]),
      );
      for (const [schema, entry] of [...this.sleeping]) {
        const live = known.get(schema);
        if (!live) continue; // Deleted: reconcile owns the teardown.
        const ctx: NamespaceContext = {
          namespaceId: live.id,
          slug: live.slug,
          schemaName: live.schemaName,
        };
        let snapshot: NamespaceActivitySnapshot;
        try {
          snapshot = await this.runInNamespace(ctx, () =>
            this.gatherActivitySnapshot(),
          );
        } catch {
          continue;
        }
        const decision = decideNamespaceIdle(
          snapshot,
          now,
          config.idleAfterDays,
        );
        if (decision.idle) continue;
        this.sleeping.delete(schema);
        this.logger.log(
          `Waking workers for namespace '${ctx.slug}' after ${this.describeSleep(entry.since, now)} asleep — ${decision.reason}.`,
        );
        await this.start({
          namespaceId: ctx.namespaceId,
          slug: ctx.slug,
          schemaName: ctx.schemaName,
        }).catch((error) =>
          this.logger.error(
            `Failed to wake workers for namespace '${ctx.slug}': ${String(error)}`,
          ),
        );
      }
    } finally {
      this.evaluatingIdle = false;
    }
  }

  /**
   * What "activity" means for cold mode: scans, and only scans, plus the
   * things that lead to one. Findings, cases and inquiries deliberately do not
   * count — on a quiet namespace they are all downstream of a scan, so counting
   * them would only keep workers warm with no work to do.
   */
  private async gatherActivitySnapshot(): Promise<NamespaceActivitySnapshot> {
    const [
      inFlightRunners,
      inFlightSources,
      dirtySources,
      plannedSources,
      latestRunner,
    ] = await Promise.all([
      this.prisma.runner.count({
        where: { status: { in: [RunnerStatus.PENDING, RunnerStatus.RUNNING] } },
      }),
      this.prisma.source.count({
        where: {
          runnerStatus: { in: [RunnerStatus.PENDING, RunnerStatus.RUNNING] },
        },
      }),
      this.prisma.source.count({
        where: { autopilotDirtyAt: { not: null } },
      }),
      // A namespace with future work of its own must never sleep: the sleep
      // would silently cancel the daily STEADY re-checks and cron schedules.
      this.prisma.source.count({
        where: {
          OR: [
            { scheduleEnabled: true },
            {
              scheduleMode: SourceScheduleMode.AUTO,
              autoPhase: { not: AutoSchedulePhase.PAUSED },
            },
          ],
        },
      }),
      this.prisma.runner.findFirst({
        orderBy: { triggeredAt: 'desc' },
        select: { triggeredAt: true },
      }),
    ]);
    return {
      inFlightRunners,
      inFlightSources,
      dirtySources,
      plannedSources,
      latestRunnerAt: latestRunner?.triggeredAt ?? null,
    };
  }

  /**
   * Release a namespace's workers and pools without touching its data.
   * `stop()` only releases process-local resources (boss, pools, pollers,
   * registry entries) — the namespace row, its schema tables and its pg-boss
   * schedules all survive, so `start()` later resumes exactly where it left
   * off. pg-boss cron jobs due while asleep simply fire on wake; every one of
   * those handlers is an idempotent reconciliation.
   */
  private async sleepNamespace(
    ctx: NamespaceContext,
    reason: string,
  ): Promise<void> {
    await this.stop({
      namespaceId: ctx.namespaceId,
      slug: ctx.slug,
      schemaName: ctx.schemaName,
    });
    this.sleeping.set(ctx.schemaName, { ctx, since: new Date() });
    this.logger.log(
      `Namespace '${ctx.slug}' idle (${reason}) — background workers asleep; ` +
        `they wake automatically on the next scan or schedule change.`,
    );
  }

  private describeSleep(since: Date, now: Date): string {
    const minutes = Math.max(
      0,
      Math.round((now.getTime() - since.getTime()) / 60_000),
    );
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
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
      namespaces.map((ns) => [
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
          // Sleeping namespaces wake only through the idle evaluator, which
          // has seen their activity snapshot — not through the blind reconcile.
          if (
            !this.active.has(ctx.schemaName) &&
            !this.sleeping.has(ctx.schemaName)
          ) {
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
        ...this.sleeping.keys(),
        ...this.prismaManager.residentSchemas(),
      ]);
      for (const schema of knownSchemas) {
        if (local.has(schema)) continue;
        // A resident schema with no active entry (e.g. a lazily-created Prisma
        // client on an API-only pod). Schema names derive from the namespace
        // UUID, so the slug is not recoverable from them — teardown only needs
        // the schema, and the schema name is the honest label for logs.
        const ctx = this.active.get(schema) ?? {
          namespaceId: '',
          slug: schema,
          schemaName: schema,
        };
        await this.stop(ctx).catch(() => undefined);
      }
    } finally {
      this.reconciling = false;
    }
  }
}
