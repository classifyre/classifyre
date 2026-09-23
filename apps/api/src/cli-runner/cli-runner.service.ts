import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
  Inject,
} from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { PrismaService } from '../prisma.service';
import { RunnerEventsGateway } from '../websocket/runner-events.gateway';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  INQUIRY_MATCH_COALESCE_SECONDS,
  INQUIRY_MATCH_QUEUE,
} from '../matching/matching.constants';
import {
  CORRELATION_QUEUE,
  CORRELATION_SCAN_COALESCE_SECONDS,
  SCAN_HANDOFF_QUEUE,
  scanHandoffJobOptions,
} from '../correlation/correlation.constants';
import { AUTO_SCHEDULE_QUEUE } from '../scheduler/auto-schedule.constants';
import { ClsService } from 'nestjs-cls';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { NamespacePauseService } from '../namespace/namespace-pause.service';
import { CohortWeightsService } from '../cohort/cohort-weights.service';
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../namespace/namespace.constants';
import {
  buildNamespaceApiBaseUrl,
  resolveInternalApiBaseUrl,
} from '../internal-api-url';
import {
  AssetType,
  Prisma,
  RunnerExecutionMode,
  RunnerAssetChangeType,
  RunnerAssetStatus,
  RunnerStatus,
  Source,
  TriggerType,
  Severity,
  FindingStatus,
  TextExtractionStatus,
} from '@prisma/client';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { NotificationsService } from '../notifications.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { randomUUID } from 'crypto';
import {
  KubernetesCliJobService,
  type NotebookInputFile,
} from './kubernetes-cli-job.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { RunnerLogStorageService } from './runner-log-storage.service';
import { buildNotebookEnvironment } from './notebook-env';
import { parseNotebookResult } from './notebook-result';
import { CustomDetectorsService } from '../custom-detectors.service';
import {
  computeDetectionFingerprint,
  computeScopeFingerprint,
} from '../utils/scope-fingerprint';
import {
  SearchRunnersRequestDto,
  SearchRunnersSortBy,
} from '../dto/search-runners-request.dto';
import { SearchRunnersChartsRequestDto } from '../dto/search-runners-charts-request.dto';
import { SearchRunnersChartsResponseDto } from '../dto/search-runners-charts-response.dto';
import {
  SearchRunnersAssetsRequestDto,
  SearchRunnersAssetsSortBy,
  SearchRunnersAssetsSortOrder,
} from '../dto/search-runners-assets-request.dto';
import { SearchRunnersAssetsResponseDto } from '../dto/search-runners-assets-response.dto';
import { PayloadCursorEntryDto, ScanCacheEntryDto } from './dto';
import {
  BoundedOutput,
  type BoundedOutputOptions,
} from '../utils/bounded-output';
import { parseCliTestOutput } from '../utils/cli-test-output';
import { MANUAL_STOP_MESSAGE } from './manual-stop';
import {
  describeDegradation,
  summarizeOutcomeFailures,
  type OutcomeFailureSummary,
} from './detector-degradation';
import {
  boundLongDetailStrings,
  redactDeepStrings,
  redactDeepWithSecrets,
  sanitizeStoredErrorMessage,
  sanitizeWithSecrets,
} from './runner-error-safety';

/** Narrow a JSONB column to a plain object, or null when it is anything else. */
function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type SourceRunSnapshot = {
  runnerStatus: RunnerStatus | null;
  currentRunnerId: string | null;
};

type TextCoverageStats = {
  extracted: number;
  empty: number;
  engineUnavailable: number;
  zeroFrames: number;
  failed: number;
  notApplicable: number;
  unknown: number;
};

type ActiveExecutionRecord = {
  id: string;
  sourceId: string;
  status: RunnerStatus;
  executionMode: RunnerExecutionMode | null;
  jobName: string | null;
  jobNamespace: string | null;
};

const TERMINAL_RUNNER_STATUSES = new Set<RunnerStatus>([
  RunnerStatus.COMPLETED,
  RunnerStatus.WARNING,
  RunnerStatus.ERROR,
  RunnerStatus.STOPPED,
]);

/**
 * Scans this machine may run at once when MAX_CONCURRENT_RUNNERS is unset.
 *
 * Two rather than one: scans are CPU-heavy but spend real time waiting on I/O
 * and the model pool, so a second keeps the machine busy without saturating
 * it — and it halves the time a multi-source workspace needs for a full sweep.
 */
const DEFAULT_MAX_CONCURRENT_RUNNERS = 2;

/**
 * After this long with no answer, a RUNNING connection test is reported as
 * lost rather than left spinning. Generous because the wait it covers is a
 * Kubernetes pod queueing behind a scan, not the test itself.
 */
const CONNECTION_TEST_STALE_MS = 15 * 60 * 1000;

/**
 * How long after a stop the "an operator did this" marker is kept.
 *
 * Long enough to outlast a watch loop that was mid-poll when the execution was
 * torn down, short enough that a re-run of the same id could never inherit it.
 */
const STOP_GRACE_MS = 60_000;

/** The stored outcome of a connection test, as `Source.connectionTest` holds it. */
export interface ConnectionTestRecord {
  status: 'RUNNING' | 'SUCCESS' | 'FAILURE';
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  result: Record<string, unknown> | null;
  triggeredBy: string | null;
}

/**
 * How long a RUNNING runner may have no execution before it counts as orphaned.
 *
 * Covers the gap between claiming a runner and its Kubernetes Job existing:
 * a Job create plus the write-back of its name, which an image pull or a busy
 * API server can stretch well past a second.
 */
const RUNNER_LAUNCH_GRACE_MS = 2 * 60 * 1000;

/**
 * How long a run may wait in the queue before a restart gives up on it.
 *
 * A queued run survives a restart intact -- it has no Job or child process yet,
 * only a row -- so startup reconciliation leaves it for promotion to start. That
 * removes the one thing that ever cleared a queue entry nothing would start:
 * failing the whole queue on every boot. This bound puts a limit back, on the
 * abandoned entries only.
 *
 * Generous on purpose, because a legitimate wait is long: a Job may run for 24
 * hours (the chart's activeDeadlineSeconds), and under a cap of one runner the
 * next run queues behind all of it. Applied by the startup sweep only; while a
 * process is up, completions and the scheduler's tick keep draining the queue.
 */
const QUEUED_RUNNER_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * When this process started, used as the upper bound of the startup sweep.
 *
 * Derived from `process.uptime()` rather than from module-load time on purpose:
 * `reconcileOnStartup` runs when a namespace is first *resolved*, which can be
 * minutes or hours after boot, and the question it asks is "did this row
 * survive a restart of this process?" That is answered against the process, not
 * against whenever this file happened to be imported.
 */
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000);

@Injectable()
export class CliRunnerService {
  private readonly logger = new Logger(CliRunnerService.name);
  /** Runners whose Kubernetes log stream this process re-attached to after a restart. */
  private readonly resumedLogStreams = new Set<string>();
  private runningProcessesByRunnerId = new Map<string, ChildProcess>();
  private readonly activeExecutions = new Map<
    string,
    { schema?: string; done: Promise<void> }
  >();
  private readonly stoppingSchemas = new Set<string>();

  /**
   * Runners an operator has asked to stop, from the moment the request is
   * accepted until the stop is recorded.
   *
   * The DB status alone is not enough: `stopRunner` tears the execution down
   * before it can write STOPPED, and the teardown's own "the Job is gone"
   * lands on `failRunner` in between. This marker closes that window. It is
   * in-memory because the execution it guards lives in this process too — the
   * same replica that launched the run watches it.
   */
  private readonly stoppingRunners = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private maskedConfigCryptoService: MaskedConfigCryptoService,
    private customDetectorsService: CustomDetectorsService,
    private runnerLogStorage: RunnerLogStorageService,
    @Optional()
    private kubernetesCliJobService?: KubernetesCliJobService,
    @Optional()
    @Inject(RunnerEventsGateway)
    private runnerEventsGateway?: RunnerEventsGateway,
    @Optional()
    private pgBossService?: PgBossService,
    @Optional()
    private cls?: ClsService,
    // Must stay a value import (see the import above): a `import type` here
    // makes Nest inject undefined and the concurrency cap quietly reverts to
    // per-namespace, which is the bug this dependency exists to fix.
    @Optional()
    private namespaceRegistry?: NamespaceRegistryService,
    @Optional()
    private cohortWeights?: CohortWeightsService,
    @Optional()
    private pause?: NamespacePauseService,
  ) {}

  /** Current namespace UUID from CLS, if running within a namespace context. */
  private currentNamespaceId(): string | undefined {
    return this.cls?.get<string>(CLS_NAMESPACE_ID);
  }

  /**
   * `DATABASE_URL` scoped to the current namespace schema, for the spawned CLI
   * (local subprocess) so any direct DB access it does lands in the tenant schema.
   */
  private namespacedDatabaseUrl(): string | undefined {
    const schema = this.cls?.get<string>(CLS_SCHEMA);
    if (!schema || !process.env.DATABASE_URL) return undefined;
    try {
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.set('schema', schema);
      return url.toString();
    } catch {
      return undefined;
    }
  }

  /** Allow work again when a namespace with this schema is (re)provisioned. */
  activateForSchema(schema: string): void {
    this.stoppingSchemas.delete(schema);
  }

  /**
   * Stop scan processes/jobs owned by the current tenant before its schema is
   * dropped. This prevents detached CLI callbacks from querying a deleted (or
   * later re-created) schema.
   */
  async stopForSchema(schema: string): Promise<void> {
    this.stoppingSchemas.add(schema);
    const runners = await this.prisma.runner.findMany({
      where: { status: RunnerStatus.RUNNING },
      select: {
        id: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
      },
    });

    for (const runner of runners) {
      if (runner.executionMode === RunnerExecutionMode.KUBERNETES) {
        await this.stopKubernetesJobSafely(runner.id, runner);
      } else if (runner.executionMode !== RunnerExecutionMode.EXTERNAL) {
        const child = this.runningProcessesByRunnerId.get(runner.id);
        if (child) this.stopLocalRunnerProcess(runner.id);
      }
    }

    const completions = [...this.activeExecutions.values()]
      .filter((execution) => execution.schema === schema)
      .map((execution) => execution.done);
    if (completions.length === 0) return;

    await Promise.race([
      Promise.allSettled(completions).then(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        timer.unref?.();
      }),
    ]);
  }

  private startTrackedExecution(
    runnerId: string,
    source: unknown,
    hasSuccessfulRuns: boolean,
  ): void {
    const schema = this.cls?.get<string>(CLS_SCHEMA);
    if (schema && this.stoppingSchemas.has(schema)) return;
    // Capture the namespace UUID now, while CLS is guaranteed live. The CLI
    // executes as a detached fire-and-forget where the ambient context can be
    // lost, so we thread the id explicitly into the output URL rather than
    // re-reading CLS deep inside the execution.
    const namespaceId = this.currentNamespaceId();
    const done = this.executeCliAsync(
      runnerId,
      source,
      hasSuccessfulRuns,
      namespaceId,
    ).catch((error) => {
      this.logger.error(
        `Unhandled runner execution failure for ${runnerId}: ${String(error)}`,
      );
    });
    this.activeExecutions.set(runnerId, { schema, done });
    void done.finally(() => {
      if (this.activeExecutions.get(runnerId)?.done === done) {
        this.activeExecutions.delete(runnerId);
      }
    });
  }

  /**
   * Tell the question-matching engine a source finished ingesting. Decoupled from
   * ingestion: we only drop a pg-boss message (debounced per source, see below).
   * Never let a matching failure break run completion.
   *
   * Both sends here debounce with `singletonKey` + `singletonSeconds` +
   * `singletonNextSlot`. All three are required, and only the first was here:
   * pg-boss 12 computes `singleton_on` solely from `singletonSeconds`, and its
   * dedupe index `job_i4 (name, singleton_on, singleton_key)` is partial on
   * `singleton_on IS NOT NULL`, so a bare `singletonKey` is inert on a
   * `standard`-policy queue — which both of these queues are. Every completed
   * scan was enqueueing its own job. `singletonNextSlot` then makes a collision
   * DEFER to the following slot instead of vanishing, so a rescan pair still
   * gets both passes rather than silently losing the second.
   *
   * Dropping only becomes possible from the third completion inside two
   * consecutive windows, and it is safe there: the surviving job's
   * `handOffToAutopilot` runs in a `finally` and marks the source
   * `autopilotDirtyAt`, so the source is still enrolled in the next cycle even
   * when a redundant recompute is coalesced away.
   */
  private async enqueueQuestionMatching(
    sourceId: string,
    runnerId: string,
  ): Promise<void> {
    if (!this.pgBossService) return;
    try {
      const boss = await this.pgBossService.getBossAsync();
      await boss.send(
        INQUIRY_MATCH_QUEUE,
        { sourceId, runnerId },
        {
          singletonKey: sourceId,
          singletonSeconds: INQUIRY_MATCH_COALESCE_SECONDS,
          singletonNextSlot: true,
        },
      );
      // Correlation (DUPLICATES FINDER AGENT) for the same scan — runs the
      // deterministic duplicate detection and then hands off to the autopilot
      // cycle, so inquiry/case agents can consider the duplicate/cluster
      // results. With duplicate detection turned off its queue is held
      // paused, so the scan goes straight to the hand-off instead — the agents
      // must not stop hearing about scans because duplicates did.
      if (await this.duplicateDetectionEnabled()) {
        await boss.send(
          CORRELATION_QUEUE,
          { sourceId, runnerId },
          {
            singletonKey: `correlation:${sourceId}`,
            singletonSeconds: CORRELATION_SCAN_COALESCE_SECONDS,
            singletonNextSlot: true,
            retryLimit: 2,
            retryDelay: 60,
            retryBackoff: true,
            expireInSeconds: 3 * 3600,
          },
        );
      } else {
        await boss.send(
          SCAN_HANDOFF_QUEUE,
          { sourceId, runnerId },
          scanHandoffJobOptions(sourceId),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue question matching for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Read straight from the config row, once per finished scan: this service
   * sits below the correlation module, and a scan completion is rare enough
   * that a cached switch would buy nothing. Unreadable means on — the
   * behaviour every workspace had before the switch existed.
   */
  private async duplicateDetectionEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.correlationConfig.findUnique({
        where: { id: 1 },
        select: { enabled: true },
      });
      return row?.enabled ?? true;
    } catch {
      return true;
    }
  }

  /**
   * Tell the adaptive scheduler a run reached a terminal state, so it can decide
   * when this source should run next.
   *
   * Sent for EVERY terminal run regardless of what triggered it — a manual run,
   * a cron run and an autopilot re-scan all count as "the source was just
   * scanned", which is what stops the scheduler from queuing a redundant one
   * behind them. Best-effort by design: the scheduler's own one-minute tick
   * re-derives the due set from the database, so a dropped message costs
   * latency, never correctness.
   */
  private async enqueueAutoScheduleKick(
    sourceId: string,
    runnerId: string,
  ): Promise<void> {
    if (!this.pgBossService) return;
    try {
      const boss = await this.pgBossService.getBossAsync();
      await boss.send(
        AUTO_SCHEDULE_QUEUE,
        { sourceId, runnerId },
        {
          singletonKey: `auto-schedule:${sourceId}`,
          expireInSeconds: 600,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue auto-schedule kick for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Recover orphaned runners and resume pending work for the CURRENT namespace.
   * Invoked by the NamespaceWorkerManager inside the namespace's CLS context
   * (was onApplicationBootstrap, which ran without a tenant schema).
   */
  /**
   * Drop in-flight runners whose execution is gone, at any time — not only at
   * startup.
   *
   * `reconcileOnStartup` does exactly the right check and does it exactly
   * once. A Kubernetes Job can disappear long after boot (TTL cleanup, an
   * evicted node, or the job finishing while this process was being
   * redeployed), and nothing looked again. The runner row stayed `RUNNING`
   * forever, and because the adaptive scheduler budgets on
   * `source.runnerStatus`, each orphan permanently consumed a slot.
   *
   * Observed live: four sources marked RUNNING against **one** surviving Job,
   * every slot taken, no source able to start, and no error anywhere — the
   * namespace simply went quiet. Returns how many it retired so the caller can
   * decide whether that was worth logging.
   */
  async reconcileStaleInFlight(): Promise<number> {
    const inFlight = await this.prisma.runner.findMany({
      // RUNNING only. PENDING is excluded on purpose: a queued runner has no
      // execution *by design* -- that is what PENDING means -- so "is its
      // execution still there?" is not a question that applies to it.
      //
      // Including it made the queue unusable. Both callers reconcile at
      // precisely the moment runners are queued (auto-schedule only when
      // `budget <= 0`, and startRun before admitting another), every PENDING
      // row has a null jobName, and isRunnerExecutionActive() reads a null
      // jobName as "gone" -- so a runner that had correctly waited its turn was
      // failed within a minute with "its execution no longer exists". Observed
      // in classifyre-dev: five runs killed 30-95s after trigger, all with a
      // null job_name and a null started_at, i.e. none of them had ever run.
      where: { status: RunnerStatus.RUNNING },
      select: {
        id: true,
        sourceId: true,
        status: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
        triggeredAt: true,
        startedAt: true,
      },
    });

    let retired = 0;
    for (const runner of inFlight) {
      if (await this.isRunnerExecutionActive(runner)) continue;
      // A managed runner is flipped to RUNNING before its Job exists, so there
      // is a window where "no jobName" means "still launching" rather than
      // "vanished". Retiring it there would be the same bug one status along.
      if (!runner.jobName && this.isWithinLaunchGrace(runner)) continue;
      retired += 1;
      // Whether an execution ever existed is recorded differently per mode: a
      // Kubernetes run by its Job name, a local run only by startedAt, since it
      // never has a Job name at all. Keyed on jobName alone, every lost local
      // scan was reported as never having started, however long it had run.
      const launched =
        runner.executionMode === RunnerExecutionMode.KUBERNETES
          ? !!runner.jobName
          : !!runner.startedAt;
      await this.markRunnerAsOrphaned(
        runner.id,
        runner.sourceId,
        launched
          ? 'Runner was orphaned (its execution no longer exists)'
          : 'Runner was orphaned (it never started an execution)',
      );
    }
    if (retired > 0) {
      await this.reconcileRunningSources();
      this.logger.warn(
        `Retired ${retired} in-flight runner(s) whose execution had vanished; ` +
          'they were holding scheduler capacity.',
      );
    }
    return retired;
  }

  async reconcileOnStartup(): Promise<void> {
    const inFlightRunners = await this.prisma.runner.findMany({
      where: {
        status: {
          in: [RunnerStatus.PENDING, RunnerStatus.RUNNING],
        },
        // Only rows that predate this process.
        //
        // This pass recovers work stranded by a RESTART, but it does not run at
        // boot -- it runs when a namespace is first resolved, which is the same
        // request that a client's very first scan arrives on. Unbounded, it
        // therefore selected the runner that had just been created a few
        // milliseconds earlier, found no execution for it yet, and failed it
        // with "application restarted while running". A runner this process
        // created cannot have been orphaned by a restart of this process, so
        // the sweep has no business looking at it: seen against the all-in-one
        // image as `Starting manual run <id>` and `Recovered 1 orphaned
        // runner(s)` logged in the same second, the scan ending in ERROR with
        // an empty log. Not reachable by hand -- only a client that creates a
        // source and starts a run back-to-back is fast enough.
        //
        // Anything newer belongs to `reconcileStaleInFlight`, which verifies
        // rather than assumes and runs on every startRun.
        triggeredAt: { lt: PROCESS_STARTED_AT },
      },
      select: {
        id: true,
        sourceId: true,
        status: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
        triggeredAt: true,
        startedAt: true,
      },
    });

    let recoveredRunners = 0;
    let preservedActiveRunners = 0;
    let queuedRunners = 0;

    for (const runner of inFlightRunners) {
      // A queued run loses nothing in a restart: it has no Job or child process
      // that could have died with the old process, only a row waiting for a
      // slot. It used to be failed here with "Runner was left pending during
      // application restart", which dropped the entire queue on every deploy.
      // On classifyre-dev a `bun --watch` reload is a restart, so saving any API
      // file killed every run queued behind a long scan (seen repeatedly on
      // 2026-09-14). It stays queued for the promotion below, unless it has
      // waited so long that nobody is expecting it any more.
      if (this.isQueuedRunner(runner)) {
        if (!this.hasExpiredInQueue(runner)) {
          queuedRunners += 1;
        } else if (await this.expireQueuedRunner(runner)) {
          recoveredRunners += 1;
        }
        continue;
      }

      if (await this.isRunnerExecutionActive(runner)) {
        preservedActiveRunners += 1;
        // The Job survived the restart, but the process that was streaming its
        // output did not: without this the run finishes with no stored log at
        // all (observed on 2026-09-20 — a 29-minute catalogue walk that spanned
        // a reload has no log file, while its Job printed 16,996 lines).
        this.resumeLogStreaming(runner);
        continue;
      }

      // Second guard, for the same race under a skewed clock. `triggered_at` is
      // filled by the DATABASE (`DEFAULT CURRENT_TIMESTAMP`), so on Kubernetes
      // it comes from a different machine than `PROCESS_STARTED_AT` above; a
      // Postgres clock a second behind the API pod's would put a brand-new
      // runner back inside the window. Same rule as reconcileStaleInFlight: a
      // runner is flipped in-flight before its execution exists, so "no
      // jobName" this soon means "still launching", not "vanished". LOCAL
      // runners never carry a jobName, which is exactly the mode the all-in-one
      // image runs in.
      if (!runner.jobName && this.isWithinLaunchGrace(runner)) {
        preservedActiveRunners += 1;
        continue;
      }

      recoveredRunners += 1;
      await this.markRunnerAsOrphaned(
        runner.id,
        runner.sourceId,
        runner.status === RunnerStatus.PENDING
          ? 'Runner was orphaned (application restarted while it was starting)'
          : 'Runner was orphaned (application restarted while running)',
      );
    }

    const repairedSources = await this.reconcileRunningSources();

    if (recoveredRunners > 0 || repairedSources > 0) {
      this.logger.warn(
        `Recovered ${recoveredRunners} orphaned runner(s) and repaired ${repairedSources} source state(s) on startup`,
      );
    }

    if (preservedActiveRunners > 0) {
      this.logger.log(
        `Preserved ${preservedActiveRunners} active runner(s) across startup reconciliation`,
      );
    }

    if (queuedRunners > 0) {
      this.logger.log(
        `Kept ${queuedRunners} queued runner(s) across startup reconciliation; they start as runner slots free up`,
      );
    }

    void this.promotePendingRunners().catch((error: unknown) =>
      this.logger.warn(
        `Pending runner promotion after startup failed: ${String(error)}`,
      ),
    );
  }

  /**
   * Re-attach to a Kubernetes Job this process did not start, so the rest of
   * its output is stored. The follow re-reads the Job's log from the start, so
   * what the dead process had already written is restored too, not just the
   * tail. Fire-and-forget: a run whose logs cannot be followed still completes.
   */
  private resumeLogStreaming(runner: {
    id: string;
    sourceId: string;
    executionMode: RunnerExecutionMode | null;
    jobName: string | null;
    jobNamespace: string | null;
  }): void {
    if (
      !this.kubernetesCliJobService ||
      runner.executionMode !== RunnerExecutionMode.KUBERNETES ||
      !runner.jobName ||
      this.resumedLogStreams.has(runner.id)
    ) {
      return;
    }
    this.resumedLogStreams.add(runner.id);
    const jobName = runner.jobName;
    void (async () => {
      try {
        await this.runnerLogStorage.initializeRunner(
          runner.sourceId,
          runner.id,
        );
        await this.kubernetesCliJobService!.followExistingJob(
          jobName,
          (chunk) => this.appendLog(runner.id, chunk, 'combined'),
          runner.jobNamespace ?? undefined,
        );
        await this.runnerLogStorage.flushLateChunks(runner.sourceId, runner.id);
        await this.runnerLogStorage.finalizeRunner(runner.sourceId, runner.id);
        this.logger.log(
          `Re-attached to Job ${jobName} after a restart; its log is stored.`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not follow Job ${jobName} after a restart: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.resumedLogStreams.delete(runner.id);
      }
    })();
  }

  private isTerminalRunnerStatus(status: RunnerStatus): boolean {
    return TERMINAL_RUNNER_STATUSES.has(status);
  }

  private resolveManagedExecutionMode(): RunnerExecutionMode {
    const environment = process.env.ENVIRONMENT || 'development';
    return this.isKubernetesExecutionEnabled(environment)
      ? RunnerExecutionMode.KUBERNETES
      : RunnerExecutionMode.LOCAL;
  }

  private async claimSourceForRunnerCreation(
    tx: Prisma.TransactionClient,
    sourceId: string,
  ): Promise<{
    source: Source;
    previousSourceState: SourceRunSnapshot;
    hasSuccessfulRuns: boolean;
  }> {
    const source = await tx.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }

    const previousSourceState = await this.normalizeSourceRunStateBeforeClaim(
      tx,
      source,
    );
    if (previousSourceState.runnerStatus === RunnerStatus.RUNNING) {
      throw new ConflictException(
        `Source ${sourceId} already has a running scan`,
      );
    }

    const claim = await tx.source.updateMany({
      where: {
        id: sourceId,
        runnerStatus: { not: RunnerStatus.RUNNING },
      },
      data: {
        runnerStatus: RunnerStatus.RUNNING,
      },
    });
    if (claim.count !== 1) {
      throw new ConflictException(
        `Source ${sourceId} already has a running scan`,
      );
    }

    const previousSuccessfulRun = await tx.runner.findFirst({
      where: {
        sourceId,
        status: RunnerStatus.COMPLETED,
      },
      select: { id: true },
    });

    return {
      source: {
        ...source,
        runnerStatus: RunnerStatus.RUNNING,
      },
      previousSourceState,
      hasSuccessfulRuns: Boolean(previousSuccessfulRun),
    };
  }

  private async normalizeSourceRunStateBeforeClaim(
    tx: Prisma.TransactionClient,
    source: Source,
  ): Promise<SourceRunSnapshot> {
    const state: SourceRunSnapshot = {
      runnerStatus: source.runnerStatus,
      currentRunnerId: source.currentRunnerId,
    };

    if (!source.currentRunnerId) {
      if (source.runnerStatus === RunnerStatus.RUNNING) {
        await tx.source.update({
          where: { id: source.id },
          data: {
            runnerStatus: RunnerStatus.ERROR,
            currentRunnerId: null,
          },
        });
        this.logger.warn(
          `Repairing source ${source.id}: runnerStatus was RUNNING without a current runner`,
        );
        return {
          runnerStatus: RunnerStatus.ERROR,
          currentRunnerId: null,
        };
      }

      return state;
    }

    const currentRunner = await tx.runner.findUnique({
      where: { id: source.currentRunnerId },
      select: { status: true },
    });

    if (!currentRunner) {
      const runnerStatus =
        source.runnerStatus === RunnerStatus.RUNNING
          ? RunnerStatus.ERROR
          : source.runnerStatus;
      await tx.source.update({
        where: { id: source.id },
        data: {
          runnerStatus,
          currentRunnerId: null,
        },
      });
      this.logger.warn(
        `Repairing source ${source.id}: currentRunnerId ${source.currentRunnerId} has no runner record`,
      );
      return {
        runnerStatus,
        currentRunnerId: null,
      };
    }

    if (source.runnerStatus !== RunnerStatus.RUNNING) {
      await tx.source.update({
        where: { id: source.id },
        data: { currentRunnerId: null },
      });
      this.logger.warn(
        `Repairing source ${source.id}: cleared stale currentRunnerId ${source.currentRunnerId} while source was ${source.runnerStatus ?? 'UNKNOWN'}`,
      );
      return {
        runnerStatus: source.runnerStatus,
        currentRunnerId: null,
      };
    }

    if (this.isTerminalRunnerStatus(currentRunner.status)) {
      await tx.source.update({
        where: { id: source.id },
        data: {
          runnerStatus: currentRunner.status,
          currentRunnerId: null,
        },
      });
      this.logger.warn(
        `Repairing source ${source.id}: current runner ${source.currentRunnerId} is already ${currentRunner.status}`,
      );
      return {
        runnerStatus: currentRunner.status,
        currentRunnerId: null,
      };
    }

    return state;
  }

  /**
   * Is this runner still inside the window where having no execution is normal?
   *
   * `dequeueNextPendingRunner` marks a runner RUNNING and only then creates the
   * Job and writes `jobName` back, so between those two points a perfectly
   * healthy run looks exactly like a vanished one. The gap is normally
   * milliseconds, but a slow API server or a contended node stretches it, and
   * the reconcile tick is not synchronised with it. Genuine launch failures
   * take the normal error path with a real message, so this only delays
   * retiring a runner whose process died mid-launch -- until the next tick.
   *
   * It measures from startedAt, which is why the dequeue claim stamps it: left
   * null, the fallback is triggeredAt, and a run that had queued for longer
   * than the grace was outside the window before its launch had begun. For a
   * local run the window only matters until startTrackedExecution registers
   * it; from then on `activeExecutions` answers directly.
   */
  private isWithinLaunchGrace(runner: {
    triggeredAt?: Date | null;
    startedAt?: Date | null;
  }): boolean {
    const launchedAt = runner.startedAt ?? runner.triggeredAt;
    if (!launchedAt) return true;
    return Date.now() - launchedAt.getTime() < RUNNER_LAUNCH_GRACE_MS;
  }

  /**
   * Is this runner waiting for a slot, with nothing launched for it yet?
   *
   * The rows promotion picks from (PENDING, never started) that also carry no
   * Job name. Such a runner has no execution by design, so no reconcile pass
   * may read its missing execution as a vanished one: it is not stranded, it is
   * queued, and promotion is what starts it.
   */
  private isQueuedRunner(runner: {
    status: RunnerStatus;
    jobName: string | null;
    startedAt: Date | null;
  }): boolean {
    return (
      runner.status === RunnerStatus.PENDING &&
      !runner.jobName &&
      !runner.startedAt
    );
  }

  private hasExpiredInQueue(runner: { triggeredAt: Date | null }): boolean {
    if (!runner.triggeredAt) return false;
    return Date.now() - runner.triggeredAt.getTime() > QUEUED_RUNNER_MAX_AGE_MS;
  }

  /**
   * Fail a queued runner that waited past QUEUED_RUNNER_MAX_AGE_MS. Resolves
   * whether it did.
   *
   * Conditional on the runner still being queued, unlike markRunnerAsOrphaned:
   * promotion is instance-wide and nobody awaits it, so another namespace's
   * startup can claim this very runner between the sweep's read and this write.
   * An unconditional update would mark ERROR a scan whose Job is being created.
   */
  private async expireQueuedRunner(runner: {
    id: string;
    sourceId: string;
  }): Promise<boolean> {
    const hours = QUEUED_RUNNER_MAX_AGE_MS / (60 * 60 * 1000);
    const expired = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.runner.updateMany({
        where: { id: runner.id, status: RunnerStatus.PENDING, startedAt: null },
        data: {
          status: RunnerStatus.ERROR,
          completedAt: new Date(),
          errorMessage: `Runner expired in the queue (waited more than ${hours} hours for a free runner slot)`,
        },
      });
      if (count !== 1) return false;
      await this.transitionSourceToTerminalState(
        tx,
        runner.sourceId,
        runner.id,
        RunnerStatus.ERROR,
      );
      return true;
    });
    if (expired) {
      await Promise.resolve(
        this.runnerLogStorage.finalizeRunner(runner.sourceId, runner.id),
      ).catch(() => undefined);
    }
    return expired;
  }

  private async isRunnerExecutionActive(
    runner: ActiveExecutionRecord,
  ): Promise<boolean> {
    switch (runner.executionMode) {
      case RunnerExecutionMode.KUBERNETES: {
        if (
          !runner.jobName ||
          !this.kubernetesCliJobService ||
          !this.kubernetesCliJobService.isEnabled()
        ) {
          return false;
        }

        try {
          return await this.kubernetesCliJobService.isJobActive(
            runner.jobName,
            runner.jobNamespace || undefined,
          );
        } catch (error) {
          // Assume alive. `isJobActive` already answers "not found" as a clean
          // false, so reaching here means the *question* failed, not that the
          // Job is gone -- an API server timeout, a throttle, a dropped
          // connection. Answering false there turns a blip in the control plane
          // into a failed scan, and the caller acts on it destructively. The
          // next tick asks again; a genuinely dead Job is retired then.
          this.logger.warn(
            `Failed to reconcile Kubernetes runner ${runner.id}, assuming it is ` +
              `still active until the next check: ${String(error)}`,
          );
          return true;
        }
      }
      case RunnerExecutionMode.EXTERNAL:
        this.logger.warn(
          `Leaving external runner ${runner.id} in-flight on startup; no heartbeat is available for reconciliation`,
        );
        return true;
      case RunnerExecutionMode.LOCAL:
      default:
        // A local scan is a child of the API process that launched it, so that
        // process's own registry is the whole answer -- there is no Job to ask.
        //
        // This was an unconditional `false`, which was right for the only
        // caller it had when written: at boot a brand-new process owns nothing,
        // so every LOCAL row is by definition a restart's leftover.
        // reconcileStaleInFlight then reused the check on a LIVE process, where
        // it read every healthy local scan as dead the moment it outlived the
        // launch grace. startRun reconciles before admitting a new scan, so the
        // next scan anyone started failed the one already running -- whose child
        // process carried on, no longer counted against MAX_CONCURRENT_RUNNERS.
        // The all-in-one image and the desktop app run nothing but LOCAL.
        //
        // Sound only because a local scan always runs in the one process that
        // can see it: the split api/worker pods ship no Python CLI, so they run
        // every scan as a Kubernetes Job. Give them one and this needs an owner
        // recorded on the runner row.
        return this.activeExecutions.has(runner.id);
    }
  }

  private async markRunnerAsOrphaned(
    runnerId: string,
    sourceId: string,
    errorMessage: string,
  ): Promise<void> {
    await Promise.resolve(
      this.runnerLogStorage.finalizeRunner(sourceId, runnerId),
    ).catch(() => undefined);

    await this.prisma.$transaction(async (tx) => {
      await tx.runner.update({
        where: { id: runnerId },
        data: {
          status: RunnerStatus.ERROR,
          completedAt: new Date(),
          errorMessage,
        },
      });

      await this.transitionSourceToTerminalState(
        tx,
        sourceId,
        runnerId,
        RunnerStatus.ERROR,
      );
    });
  }

  private async reconcileRunningSources(): Promise<number> {
    const runningSources = await this.prisma.source.findMany({
      where: { runnerStatus: RunnerStatus.RUNNING },
      select: {
        id: true,
        name: true,
        currentRunnerId: true,
      },
    });

    let repairedSources = 0;

    for (const source of runningSources) {
      if (!source.currentRunnerId) {
        repairedSources += 1;
        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            runnerStatus: RunnerStatus.ERROR,
            currentRunnerId: null,
          },
        });
        this.logger.warn(
          `Recovered source ${source.id}: RUNNING source had no current runner`,
        );
        continue;
      }

      const runner = await this.prisma.runner.findUnique({
        where: { id: source.currentRunnerId },
        select: {
          id: true,
          sourceId: true,
          status: true,
          executionMode: true,
          jobName: true,
          jobNamespace: true,
          triggeredAt: true,
          startedAt: true,
        },
      });

      if (!runner) {
        repairedSources += 1;
        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            runnerStatus: RunnerStatus.ERROR,
            currentRunnerId: null,
          },
        });
        this.logger.warn(
          `Recovered source ${source.id}: missing current runner ${source.currentRunnerId}`,
        );
        continue;
      }

      if (this.isTerminalRunnerStatus(runner.status)) {
        repairedSources += 1;
        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            runnerStatus: runner.status,
            currentRunnerId: null,
          },
        });
        this.logger.warn(
          `Recovered source ${source.id}: current runner ${runner.id} was already ${runner.status}`,
        );
        continue;
      }

      // startRun marks the source RUNNING before it knows whether a slot is
      // free, so this is also exactly what a source with a queued run looks
      // like. Its runner has no execution yet by design. This pass used to fail
      // it for lacking one, and not only at startup: reconcileStaleInFlight runs
      // it live whenever it retires anything, so losing one Job also failed
      // every run that had been queued for longer than the launch grace.
      if (this.isQueuedRunner(runner)) {
        continue;
      }

      if (await this.isRunnerExecutionActive(runner)) {
        continue;
      }
      // Same launch window as reconcileStaleInFlight: RUNNING is set before the
      // Job exists, so a run that is merely still starting must not be read as
      // one that has died. At startup a genuinely stranded runner is older than
      // the grace period anyway, and anything newer is retired on the next pass.
      if (!runner.jobName && this.isWithinLaunchGrace(runner)) {
        continue;
      }

      repairedSources += 1;
      await this.markRunnerAsOrphaned(
        runner.id,
        source.id,
        runner.status === RunnerStatus.PENDING
          ? 'Runner was orphaned (application restarted while it was starting)'
          : 'Runner execution could not be reconciled after restart',
      );
    }

    return repairedSources;
  }

  async startRun(
    sourceId: string,
    triggerType: TriggerType = TriggerType.MANUAL,
    triggeredBy?: string,
    forceFullRescan = false,
  ) {
    // Non-HTTP triggers (schedulers, supervisor) bypass the pause guard, so
    // the service refuses itself. Throws ConflictException, which the cron
    // scheduler already treats as "skip quietly" (see handleIngestJob).
    await this.pause?.assertNotPaused();
    // Before refusing with "already has a running scan", make sure the scan it
    // is talking about still exists. A runner whose Job has vanished keeps the
    // source pinned to RUNNING for good, and the operator sees a conflict on a
    // source that is provably idle — which is indistinguishable from the source
    // genuinely being busy. `reconcileStaleInFlight` verifies rather than
    // trusts, and no-ops when everything really is running, so this costs one
    // lookup on the path where a human is already waiting.
    await this.reconcileStaleInFlight().catch((error: unknown) => {
      // Never block a legitimate start because the check itself failed.
      this.logger.warn(
        `Pre-start reconciliation failed for source ${sourceId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });

    const executionMode = this.resolveManagedExecutionMode();
    const { source, runner, hasSuccessfulRuns, previousSourceState } =
      await this.prisma.$transaction(async (tx) => {
        const { source, previousSourceState, hasSuccessfulRuns } =
          await this.claimSourceForRunnerCreation(tx, sourceId);

        if (source.type === AssetType.SANDBOX) {
          const uploadedFileCount = await tx.uploadedSourceFile.count({
            where: { sourceId },
          });
          if (uploadedFileCount === 0) {
            throw new BadRequestException(
              'A sandbox source must contain at least one uploaded file before it can run',
            );
          }
        }

        const runner = await tx.runner.create({
          data: {
            sourceId,
            triggerType,
            triggeredBy,
            status: RunnerStatus.PENDING,
            executionMode,
            scopeFingerprint: computeScopeFingerprint(
              source.type,
              source.config,
            ),
            // What this run was configured to LOOK FOR, as opposed to where it
            // looked. The autopilot compares it to decide whether a re-scan it
            // is about to request would actually test anything new.
            detectionFingerprint: computeDetectionFingerprint(
              source.type,
              source.config,
            ),
          },
        });

        await tx.source.update({
          where: { id: sourceId },
          data: {
            currentRunnerId: runner.id,
          },
        });

        return {
          source,
          runner,
          hasSuccessfulRuns,
          previousSourceState,
        };
      });

    let sourceWithDecryptedConfig: typeof source;
    try {
      const decryptedConfig = this.toDecryptedRecipeConfig(source.config);
      const recipeWithFeedback = await this.hydrateCustomDetectorsForRun(
        sourceId,
        decryptedConfig,
      );
      sourceWithDecryptedConfig = {
        ...source,
        // A forced full rescan is expressed as a recipe override rather than a
        // flag threaded through the execution chain: the recipe already reaches
        // both the local and the Kubernetes path, and disabling the cache there
        // is exactly what "ignore the cache for this run" means. The source's
        // stored config is untouched, so the next run caches again.
        config: forceFullRescan
          ? { ...recipeWithFeedback, scan_cache: { enabled: false } }
          : recipeWithFeedback,
      };
      await this.runnerLogStorage.initializeRunner(sourceId, runner.id);
    } catch (error) {
      this.logger.error(
        `Failed to initialize run setup for runner ${runner.id}: ${String(error)}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.runner.delete({ where: { id: runner.id } });
        await tx.source.update({
          where: { id: sourceId },
          data: {
            runnerStatus: previousSourceState.runnerStatus,
            currentRunnerId: previousSourceState.currentRunnerId,
          },
        });
      });
      throw error;
    }

    const canStart = await this.canStartNewRunner();
    if (!canStart) {
      this.logger.log(
        `Runner ${runner.id} queued as PENDING — concurrency limit reached`,
      );
      const runnerDto = await this.getRunnerStatus(runner.id);
      if (runnerDto && this.runnerEventsGateway) {
        this.runnerEventsGateway.emitRunnerCreated(runnerDto as any);
      }
      return runner;
    }

    this.logger.log(
      `Starting ${triggerType.toLowerCase()} run ${runner.id} for source ${sourceId} in ${executionMode.toLowerCase()} mode`,
    );

    this.startTrackedExecution(
      runner.id,
      sourceWithDecryptedConfig,
      hasSuccessfulRuns,
    );

    void this.pruneOldRunners(sourceId);

    const runnerDto = await this.getRunnerStatus(runner.id);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerCreated(runnerDto as any);
    }

    return runner;
  }

  private feedbackLabelFromFindingType(findingType: unknown): string | null {
    if (typeof findingType !== 'string') {
      return null;
    }
    const normalized = findingType.trim();
    if (!normalized.toLowerCase().startsWith('class:')) {
      return null;
    }
    const label = normalized.slice('class:'.length).trim();
    return label.length > 0 ? label : null;
  }

  private buildTrainingExampleSignature(example: {
    text: string;
    label: string;
    accepted: boolean;
  }): string {
    return `${example.text.trim().toLowerCase()}::${example.label.trim()}::${example.accepted ? '1' : '0'}`;
  }

  private async hydrateCustomDetectorsForRun(
    sourceId: string,
    recipe: Record<string, any>,
  ): Promise<Record<string, any>> {
    const configuredDetectors = Array.isArray(recipe.detectors)
      ? recipe.detectors
      : [];
    const builtInDetectors = configuredDetectors.filter((detector) => {
      const type = String(detector?.type || '')
        .trim()
        .toUpperCase();
      return type !== 'CUSTOM';
    });

    // Legacy path: recipe.custom_detectors is an array of custom detector IDs.
    const runtimeByIds =
      await this.customDetectorsService.buildRuntimeCustomDetectors(
        recipe.custom_detectors,
      );

    // New path: CUSTOM entries in recipe.detectors carry custom_detector_key at
    // the top level (e.g. { type: 'CUSTOM', enabled: true, custom_detector_key: '...' }).
    // Extract those keys and look up the full detector config from the database.
    const customKeysFromDetectors = configuredDetectors
      .filter((d) => {
        const type = String(d?.type || '')
          .trim()
          .toUpperCase();
        const key =
          typeof d?.custom_detector_key === 'string'
            ? d.custom_detector_key.trim()
            : '';
        return type === 'CUSTOM' && key.length > 0 && d?.enabled !== false;
      })
      .map((d) => String(d.custom_detector_key).trim());

    const runtimeByKeys =
      customKeysFromDetectors.length > 0
        ? await this.customDetectorsService.buildRuntimeCustomDetectorsByKeys(
            customKeysFromDetectors,
          )
        : [];

    // TAG detectors are never selectable on a source, so nothing in the stored
    // config can name them. A CUSTOM connector applies one by writing its key in
    // a notebook — Asset(tags={"<key>": "<value>"}) — and that key has to resolve
    // at scan time or the tag is dropped with a warning. Sending every active
    // one costs nothing: a tag detector loads no model and never reads content.
    //
    // Augmentation asserts tags on any source type, so the condition is CUSTOM
    // *or* augmentation enabled. Without this the tag path is dead on both ends
    // for a known source and every tag silently becomes a "matches no Tag
    // detector" warning.
    const isCustomSource =
      String(recipe?.type || '')
        .trim()
        .toUpperCase() === 'CUSTOM';
    const augmentation = (recipe as Record<string, any> | null | undefined)?.[
      'augmentation'
    ];
    const isAugmentationEnabled =
      typeof augmentation === 'object' &&
      augmentation !== null &&
      (augmentation as Record<string, unknown>)['enabled'] === true;
    const runtimeTagDetectors =
      isCustomSource || isAugmentationEnabled
        ? await this.customDetectorsService.buildRuntimeTagDetectors()
        : [];

    // Merge all three sets, deduplicating by key (key-based wins over id-based).
    const seenKeys = new Set<string>();
    const allRuntimeCustomDetectors = [
      ...runtimeByKeys,
      ...runtimeByIds,
      ...runtimeTagDetectors,
    ].filter((entry) => {
      if (seenKeys.has(entry.key)) return false;
      seenKeys.add(entry.key);
      return true;
    });

    const runtimeMap = new Map(
      allRuntimeCustomDetectors.map((entry) => [entry.key, entry.id]),
    );

    const mergedRecipe = {
      ...recipe,
      detectors: [
        ...builtInDetectors,
        ...allRuntimeCustomDetectors.map((entry) => entry.detector),
      ],
    };

    return this.injectCustomDetectorFeedbackExamples(
      sourceId,
      mergedRecipe,
      runtimeMap,
    );
  }

  private async injectCustomDetectorFeedbackExamples(
    sourceId: string,
    recipe: Record<string, any>,
    customDetectorIdByKey?: Map<string, string>,
  ): Promise<Record<string, any>> {
    const detectors = Array.isArray(recipe.detectors) ? recipe.detectors : [];
    if (detectors.length === 0) {
      return recipe;
    }

    const customClassifierKeys = detectors
      .filter(
        (detector) =>
          detector &&
          typeof detector === 'object' &&
          String(detector.type || '')
            .trim()
            .toUpperCase() === 'CUSTOM' &&
          detector.config &&
          typeof detector.config === 'object' &&
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          String((detector.config as Record<string, unknown>).method || '')
            .trim()
            .toUpperCase() === 'CLASSIFIER' &&
          typeof (detector.config as Record<string, unknown>)
            .custom_detector_key === 'string',
      )
      .map((detector) =>
        String(
          (detector.config as Record<string, unknown>).custom_detector_key,
        ).trim(),
      )
      .filter((key) => key.length > 0);

    if (customClassifierKeys.length === 0) {
      return recipe;
    }
    const uniqueKeys = Array.from(new Set(customClassifierKeys));
    const customDetectorKeyById = new Map<string, string>(
      uniqueKeys
        .map((key) => {
          const id = customDetectorIdByKey?.get(key);
          return id ? ([id, key] as const) : null;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null),
    );
    const customDetectorIds = uniqueKeys
      .map((key) => customDetectorIdByKey?.get(key))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    const feedbackRows = await this.prisma.customDetectorFeedback.findMany({
      where: {
        sourceId,
        OR: [
          { customDetectorKey: { in: uniqueKeys } },
          ...(customDetectorIds.length > 0
            ? [{ customDetectorId: { in: customDetectorIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    if (feedbackRows.length === 0) {
      return recipe;
    }

    const feedbackByKey = new Map<string, typeof feedbackRows>();
    for (const row of feedbackRows) {
      const key =
        (row.customDetectorId
          ? (customDetectorKeyById.get(row.customDetectorId) ?? '')
          : '') || row.customDetectorKey.trim();
      if (!key) {
        continue;
      }
      const bucket = feedbackByKey.get(key);
      if (!bucket) {
        feedbackByKey.set(key, [row]);
      } else {
        bucket.push(row);
      }
    }

    const mergedDetectors = detectors.map((detector) => {
      const detectorType = String(detector?.type || '')
        .trim()
        .toUpperCase();
      if (detectorType !== 'CUSTOM') {
        return detector;
      }

      const config =
        detector && typeof detector.config === 'object'
          ? detector.config
          : null;
      if (!config) {
        return detector;
      }

      const method = String(config.method || '')
        .trim()
        .toUpperCase();
      const customDetectorKey = String(config.custom_detector_key || '').trim();
      if (method !== 'CLASSIFIER' || !customDetectorKey) {
        return detector;
      }

      const feedback = feedbackByKey.get(customDetectorKey) ?? [];
      if (feedback.length === 0) {
        return detector;
      }

      const classifier =
        config.classifier && typeof config.classifier === 'object'
          ? { ...(config.classifier as Record<string, unknown>) }
          : {};
      const labels = Array.isArray(classifier.labels) ? classifier.labels : [];
      const validLabelIds = new Set(
        labels
          .map((label) =>
            label && typeof label === 'object' ? label.id : null,
          )
          .filter(
            (labelId): labelId is string =>
              typeof labelId === 'string' && labelId.trim().length > 0,
          ),
      );

      const existingExamples = Array.isArray(classifier.training_examples)
        ? classifier.training_examples.filter(
            (example) =>
              example &&
              typeof example === 'object' &&
              typeof example.text === 'string' &&
              typeof example.label === 'string',
          )
        : [];

      const mergedExamples = [...existingExamples];
      const seen = new Set<string>();
      for (const example of mergedExamples) {
        seen.add(
          this.buildTrainingExampleSignature({
            text: String(example.text),
            label: String(example.label),
            accepted: example.accepted !== false,
          }),
        );
      }

      for (const row of feedback) {
        const status = row.status;
        if (
          status !== 'RESOLVED' &&
          status !== 'FALSE_POSITIVE' &&
          status !== 'IGNORED'
        ) {
          continue;
        }

        const text = row.matchedContent.trim();
        const label =
          (row.label && row.label.trim().length > 0
            ? row.label.trim()
            : this.feedbackLabelFromFindingType(row.findingType)) ?? '';
        if (!text || !label) {
          continue;
        }
        if (validLabelIds.size > 0 && !validLabelIds.has(label)) {
          continue;
        }

        const accepted = status === 'RESOLVED';
        const example = {
          text,
          label,
          accepted,
          source: 'feedback',
        };
        const signature = this.buildTrainingExampleSignature(example);
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        mergedExamples.push(example);
      }

      return {
        ...detector,
        config: {
          ...config,
          classifier: {
            ...classifier,
            training_examples: mergedExamples,
          },
        },
      };
    });

    return {
      ...recipe,
      detectors: mergedDetectors,
    };
  }

  async createExternalRunner(sourceId: string, triggeredBy?: string) {
    await this.pause?.assertNotPaused();
    const { runner, previousSourceState } = await this.prisma.$transaction(
      async (tx) => {
        const { source, previousSourceState } =
          await this.claimSourceForRunnerCreation(tx, sourceId);

        const runner = await tx.runner.create({
          data: {
            sourceId,
            triggerType: TriggerType.MANUAL,
            triggeredBy,
            status: RunnerStatus.RUNNING,
            startedAt: new Date(),
            executionMode: RunnerExecutionMode.EXTERNAL,
            scopeFingerprint: computeScopeFingerprint(
              source.type,
              source.config,
            ),
          },
        });

        await tx.source.update({
          where: { id: sourceId },
          data: {
            currentRunnerId: runner.id,
          },
        });

        return { runner, previousSourceState };
      },
    );

    try {
      await this.runnerLogStorage.initializeRunner(sourceId, runner.id);
    } catch (error) {
      this.logger.error(
        `Failed to initialize logs for external runner ${runner.id}: ${String(error)}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.runner.delete({ where: { id: runner.id } });
        await tx.source.update({
          where: { id: sourceId },
          data: {
            runnerStatus: previousSourceState.runnerStatus,
            currentRunnerId: previousSourceState.currentRunnerId,
          },
        });
      });
      throw error;
    }

    const runnerDto = await this.getRunnerStatus(runner.id);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerCreated(runnerDto as any);
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    return runner;
  }

  private async executeCliAsync(
    runnerId: string,
    source: any,
    hasSuccessfulRuns: boolean,
    namespaceId?: string,
  ) {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
    });

    if (!runner) {
      this.logger.error(`Runner ${runnerId} not found`);
      return;
    }

    try {
      // Mark as started
      await this.prisma.runner.update({
        where: { id: runnerId },
        data: {
          status: RunnerStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      // Emit WebSocket event for runner started
      const runnerDto = await this.getRunnerStatus(runnerId);
      if (runnerDto && this.runnerEventsGateway) {
        this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
      }

      // The split each ctx.cohort() of this source should use, measured from
      // earlier runs, travels in the recipe; the stored config is not changed.
      const recipeSource = this.cohortWeights
        ? await this.cohortWeights.withEffectiveWeights(source)
        : source;

      const environment = process.env.ENVIRONMENT || 'development';
      if (this.isKubernetesExecutionEnabled(environment)) {
        await this.executeCliInKubernetes(
          runnerId,
          recipeSource,
          hasSuccessfulRuns,
          namespaceId,
        );
      } else {
        await this.executeCliLocally(
          runnerId,
          recipeSource,
          environment,
          hasSuccessfulRuns,
          namespaceId,
        );
      }
    } catch (error) {
      this.logger.error(`Runner ${runnerId} failed:`, error);
      await this.failRunner(runnerId, error.message, {
        stack: error.stack,
        name: error.name,
      });
    }
  }

  private isKubernetesExecutionEnabled(environment: string): boolean {
    return (
      environment === 'kubernetes' &&
      this.kubernetesCliJobService?.isEnabled() === true
    );
  }

  private async executeCliLocally(
    runnerId: string,
    source: any,
    environment: string,
    hasSuccessfulRuns: boolean,
    namespaceId?: string,
  ): Promise<void> {
    const cliPath = this.getCliPath(environment);
    const venvPath = this.getVenvPath(environment);
    const recipeFile = await this.createTempRecipeFile(source.config);

    try {
      const outputRestUrl = this.resolveOutputRestUrl(environment, namespaceId);
      const command = this.buildCliCommand(
        cliPath,
        venvPath,
        recipeFile,
        source.id,
        runnerId,
        outputRestUrl,
        hasSuccessfulRuns,
        this.encodeSamplingCursor(source),
      );
      const { stdout, stderr, exitCode } = await this.executeCli(
        command,
        (chunk) => void this.appendLog(runnerId, chunk, 'stderr'),
        (chunk) => void this.appendLog(runnerId, chunk, 'stdout'),
        runnerId,
        // A scan streams everything to the run log; all this needs to keep is
        // enough of the end to explain a non-zero exit.
        { mode: 'tail' },
      );

      if (await this.shouldSkipRunnerFinalTransition(runnerId, exitCode)) {
        return;
      }

      if (exitCode === 0) {
        await this.completeRunner(runnerId);
      } else {
        await this.failRunner(runnerId, stderr, { exitCode, stdout, stderr });
      }
    } finally {
      await fs.unlink(recipeFile).catch(() => undefined);
    }
  }

  private async executeCliInKubernetes(
    runnerId: string,
    source: any,
    hasSuccessfulRuns: boolean,
    namespaceId?: string,
  ): Promise<void> {
    if (!this.kubernetesCliJobService) {
      throw new Error('Kubernetes CLI Job service is not available');
    }

    const result = await this.kubernetesCliJobService.runExtractJob(
      runnerId,
      source.id,
      source.config,
      this.resolveOutputRestUrl('kubernetes', namespaceId),
      hasSuccessfulRuns,
      (chunk) => this.appendLog(runnerId, chunk, 'combined'),
      ({ jobName, namespace }) =>
        this.persistKubernetesExecutionIdentity(runnerId, jobName, namespace),
      this.encodeSamplingCursor(source),
    );
    const output = result.output || '';
    // The CLI reports its own completion over REST while this loop is still
    // reading the Job's output, so the run is often finalised before the last
    // log read. Whatever arrived after that is held, not stored — fold it in
    // now, or the tail of every Kubernetes run is silently missing.
    await this.runnerLogStorage.flushLateChunks(source.id, runnerId);
    if (await this.shouldSkipRunnerFinalTransition(runnerId, result.exitCode)) {
      return;
    }
    if (result.exitCode === 0) {
      await this.completeRunner(runnerId);
      return;
    }

    const baseMessage = this.kubernetesExitMessage(result.exitCode);
    const cliError = this.extractLastCliError(output);
    const contextParts = [result.failureContext, cliError].filter(Boolean);
    const errorMessage =
      contextParts.length > 0
        ? `${baseMessage}\n\n${contextParts.join('\n\n')}`
        : baseMessage;

    await this.failRunner(runnerId, errorMessage, {
      exitCode: result.exitCode,
      output,
      jobName: result.jobName,
      namespace: result.namespace,
    });
  }

  private async shouldSkipRunnerFinalTransition(
    runnerId: string,
    exitCode: number,
  ): Promise<boolean> {
    const latestRunner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { status: true },
    });

    if (!latestRunner || latestRunner.status !== RunnerStatus.RUNNING) {
      this.logger.log(
        `Runner ${runnerId} exited with code ${exitCode} after status changed to ${latestRunner?.status ?? 'MISSING'}; skipping final transition.`,
      );
      return true;
    }

    return false;
  }

  private kubernetesExitMessage(exitCode: number): string {
    if (exitCode === 137) {
      return 'Job was killed by the system (OOMKilled: process exceeded the memory limit).';
    }
    if (exitCode === 143) {
      return 'Job was terminated (SIGTERM: deadline or manual stop exceeded).';
    }
    if (exitCode === 1) {
      return 'Job exited with an error.';
    }
    return `Job failed with exit code ${exitCode}.`;
  }

  private extractLastCliError(output: string): string | undefined {
    if (!output) return undefined;

    const lines = output.split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;

      const errorMatch = line.match(
        /^(?:ERROR|CRITICAL|FATAL):[^\s]*\s+(.+)$/i,
      );
      if (errorMatch) {
        return errorMatch[1].slice(0, 1000);
      }

      if (/^Traceback \(most recent call last\)/i.test(line)) {
        const traceLines = lines.slice(i).join('\n').slice(0, 1500);
        return traceLines;
      }
    }

    const lastNonEmpty = lines
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-3)
      .join('\n');

    if (
      lastNonEmpty &&
      !/^INFO:/i.test(lastNonEmpty) &&
      lastNonEmpty.length > 5
    ) {
      return lastNonEmpty.slice(0, 1000);
    }

    return undefined;
  }

  private async persistKubernetesExecutionIdentity(
    runnerId: string,
    jobName: string,
    jobNamespace: string,
  ): Promise<void> {
    await this.prisma.runner.update({
      where: { id: runnerId },
      data: {
        executionMode: RunnerExecutionMode.KUBERNETES,
        jobName,
        jobNamespace,
      },
    });
  }

  private getCliPath(environment: string): string {
    const configuredPath = process.env.CLI_PATH;
    const defaultDevelopmentCliPath = path.join(__dirname, '../../../cli');

    const resolveCliPath = (rawPath: string): string => {
      if (path.isAbsolute(rawPath)) {
        return path.normalize(rawPath);
      }

      // Support CLI_PATH like "../cli" from apps/api/.env regardless of process cwd.
      const apiAppRoot = path.resolve(__dirname, '../..');
      const apiRelative = path.resolve(apiAppRoot, rawPath);
      const cwdRelative = path.resolve(process.cwd(), rawPath);

      if (fsSync.existsSync(apiRelative)) {
        return apiRelative;
      }
      if (fsSync.existsSync(cwdRelative)) {
        return cwdRelative;
      }

      // Preserve previous behavior if target does not exist yet.
      return apiRelative;
    };

    switch (environment) {
      case 'development':
      case 'docker':
        return resolveCliPath(configuredPath || defaultDevelopmentCliPath);
      case 'kubernetes':
        throw new Error('Kubernetes CLI execution must use a Kubernetes Job');
      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }

  private getVenvPath(environment: string): string {
    // A deployment may keep the virtualenv somewhere other than <cli>/.venv and
    // says so with VENV_PATH.
    if (process.env.VENV_PATH) {
      return path.normalize(process.env.VENV_PATH);
    }
    const cliPath = this.getCliPath(environment);
    return path.join(cliPath, '.venv');
  }

  private getVenvPython(venvPath: string): string {
    return process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');
  }

  private async createTempRecipeFile(recipe: any): Promise<string> {
    const tmpDir = process.env.TEMP_DIR || '/tmp';
    const filename = `recipe-${Date.now()}-${randomUUID()}.json`;
    const filepath = path.join(tmpDir, filename);

    await fs.writeFile(filepath, JSON.stringify(recipe, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return filepath;
  }

  private toDecryptedRecipeConfig(rawConfig: unknown): Record<string, any> {
    if (
      !rawConfig ||
      typeof rawConfig !== 'object' ||
      Array.isArray(rawConfig)
    ) {
      throw new BadRequestException(`Source config has invalid shape for CLI`);
    }

    return this.maskedConfigCryptoService.decryptMaskedConfig(
      rawConfig as Record<string, unknown>,
    ) as Record<string, any>;
  }

  private buildCliCommand(
    cliPath: string,
    venvPath: string,
    recipeFile: string,
    sourceId: string,
    runnerId: string,
    outputRestUrl: string,
    hasSuccessfulRuns: boolean,
    samplingCursorB64?: string,
  ): string {
    const escapedCliPath = this.shellEscape(cliPath);
    const escapedVenvPython = this.shellEscape(this.getVenvPython(venvPath));
    // Inject the AUTOMATIC sampling cursor (base64-encoded JSON) so extraction
    // resumes where the previous run stopped. Absent on the first run / for
    // non-AUTOMATIC sampling.
    const samplingCursorEnv = samplingCursorB64
      ? `CLASSIFYRE_SAMPLING_CURSOR=${this.shellEscape(samplingCursorB64)} `
      : '';
    // Keep startup lightweight: core deps are preinstalled in the image, and optional
    // detector groups are installed lazily by the CLI on first use.
    return (
      `cd ${escapedCliPath} && ` +
      `CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN=${hasSuccessfulRuns ? '1' : '0'} ` +
      samplingCursorEnv +
      `uv run --locked --no-dev --python ${escapedVenvPython} ` +
      `python -m src.main extract ${this.shellEscape(recipeFile)} ` +
      `--output-type rest ` +
      `--output-rest-url ${this.shellEscape(outputRestUrl)} ` +
      `--output-batch-size 20 ` +
      `--source-id ${this.shellEscape(sourceId)} ` +
      `--runner-id ${this.shellEscape(runnerId)} ` +
      `--managed-runner`
    );
  }

  /**
   * Base64-encode a source's persisted AUTOMATIC sampling cursor for transport
   * to the CLI via the CLASSIFYRE_SAMPLING_CURSOR env var. Returns undefined
   * when there is no cursor to pass (first run / non-AUTOMATIC sampling).
   */
  private encodeSamplingCursor(source: any): string | undefined {
    const cursor = source?.samplingCursor;
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    if (Object.keys(cursor).length === 0) {
      return undefined;
    }
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
  }

  private buildCliTestCommand(
    cliPath: string,
    venvPath: string,
    recipeFile: string,
    sourceId: string,
    outputRestUrl?: string,
  ): string {
    const escapedCliPath = this.shellEscape(cliPath);
    const escapedVenvPython = this.shellEscape(this.getVenvPython(venvPath));
    return (
      `cd ${escapedCliPath} && ` +
      `uv run --locked --no-dev --python ${escapedVenvPython} ` +
      `python -m src.main test ${this.shellEscape(recipeFile)} ` +
      `--source-id ${this.shellEscape(sourceId)}` +
      (outputRestUrl
        ? ` --output-rest-url ${this.shellEscape(outputRestUrl)}`
        : '')
    );
  }

  private resolveOutputRestUrl(
    environment: string,
    namespaceId?: string,
  ): string {
    const base = resolveInternalApiBaseUrl(environment);
    // Pass one complete callback base to the CLI. It remains namespace-blind:
    // every output/input endpoint is joined beneath this URL. Prefer the id
    // captured before detached execution; synchronous callers can use CLS.
    const id = namespaceId ?? this.currentNamespaceId();
    return buildNamespaceApiBaseUrl(base, id);
  }

  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Run one notebook execution and return the CLI's JSON result.
   *
   * Deliberately the same shape as testConnection: a short-lived process, a
   * 0600 request file that is deleted in `finally`, and a bounded capture of
   * the front of the stream -- the result line is printed and the process
   * exits, so the interesting part is never at the end.
   *
   * Unlike testConnection this is not called straight from an HTTP handler:
   * a Run All that replays a slow load would blow the request timeout, so the
   * caller records an execution row and polls.
   */
  async runNotebookExecution(params: {
    sourceId: string;
    request: Record<string, any>;
    onJobCreated?: (job: {
      jobName: string;
      namespace: string;
    }) => void | Promise<void>;
  }): Promise<{
    payload: Record<string, any> | null;
    stderr: string;
    exitCode: number;
  }> {
    const source = await this.prisma.source.findUnique({
      where: { id: params.sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${params.sourceId} not found`);
    }

    const decryptedConfig = this.toDecryptedRecipeConfig(source.config);
    // preview_augment reports whether each asserted tag matches a live Tag
    // detector, so it needs the same hydrated recipe a scan gets. Other
    // notebook modes never read detectors, and stay on the stored recipe.
    const recipe =
      String(params.request.mode || '') === 'preview_augment'
        ? await this.hydrateCustomDetectorsForRun(
            params.sourceId,
            decryptedConfig,
          )
        : decryptedConfig;
    const request = { ...params.request, recipe };
    const environment = process.env.ENVIRONMENT || 'development';

    // `validate` parses and contract-checks without running a cell, so nothing
    // can read ctx.files -- and the editor calls it on a debounce while someone
    // types. Materializing the source's uploads for that would be pure cost.
    const needsFiles = String(params.request.mode || '') !== 'validate';

    if (this.isKubernetesExecutionEnabled(environment)) {
      return this.runNotebookInKubernetes(
        params.sourceId,
        request,
        params.onJobCreated,
        needsFiles ? await this.notebookInputFiles(params.sourceId) : [],
      );
    }

    const cliPath = this.getCliPath(environment);
    const venvPath = this.getVenvPath(environment);
    const requestFile = await this.createTempJsonFile('notebook', request);
    const filesDir = needsFiles
      ? await this.writeNotebookFiles(params.sourceId)
      : null;

    try {
      const command =
        `cd ${this.shellEscape(cliPath)} && ` +
        `uv run --locked --no-dev --python ${this.shellEscape(this.getVenvPython(venvPath))} ` +
        `python -m src.main notebook ${this.shellEscape(requestFile)}`;

      const { stdout, stderr, exitCode } = await this.executeCli(
        command,
        (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            this.logger.debug(`[notebook] ${trimmed.slice(0, 500)}`);
          }
        },
        undefined,
        undefined,
        { mode: 'head', maxBytes: 8 * 1024 * 1024, maxLines: 50_000 },
        buildNotebookEnvironment(
          process.env,
          filesDir ? { CLASSIFYRE_NOTEBOOK_FILES_DIR: filesDir } : {},
        ),
      );

      return { payload: parseNotebookResult(stdout), stderr, exitCode };
    } finally {
      await fs.unlink(requestFile).catch(() => undefined);
      if (filesDir) {
        await fs
          .rm(filesDir, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }

  /**
   * URLs an init container can stream this source's uploaded files from.
   *
   * The notebook job holds neither the callback key nor an API URL by design,
   * so it is handed finished files rather than the means to fetch them.
   */
  private async notebookInputFiles(
    sourceId: string,
  ): Promise<NotebookInputFile[]> {
    const files = await this.prisma.uploadedSourceFile.findMany({
      where: { sourceId },
      select: { id: true, fileName: true },
      orderBy: [{ fileName: 'asc' }, { id: 'asc' }],
    });
    if (files.length === 0) return [];

    const base = this.resolveOutputRestUrl(
      process.env.ENVIRONMENT || 'development',
    );
    return files.map((file) => ({
      url: `${base}/sources/${encodeURIComponent(sourceId)}/files/${encodeURIComponent(file.id)}/content`,
      name: file.fileName,
    }));
  }

  /**
   * The same files, on local disk, for a notebook run outside Kubernetes.
   *
   * Read straight from the database rather than over HTTP: the API is this
   * process, and a loopback request to itself to fetch its own rows would be a
   * detour with its own failure modes.
   */
  private async writeNotebookFiles(sourceId: string): Promise<string | null> {
    const files = await this.prisma.uploadedSourceFile.findMany({
      where: { sourceId },
      select: { id: true, fileName: true, data: true },
      orderBy: [{ fileName: 'asc' }, { id: 'asc' }],
    });
    if (files.length === 0) return null;

    const directory = path.join(
      process.env.TEMP_DIR || '/tmp',
      `notebook-files-${randomUUID()}`,
    );
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const used = new Set<string>();
    for (const file of files) {
      // Two uploads can share a name (dedupe is by content hash), and the
      // second silently replacing the first would hand the notebook fewer
      // files than the source has.
      let name = path.basename(file.fileName || 'upload') || 'upload';
      if (used.has(name)) {
        const extension = path.extname(name);
        name = `${path.basename(name, extension)}-${file.id.slice(0, 8)}${extension}`;
      }
      used.add(name);
      await fs.writeFile(path.join(directory, name), Buffer.from(file.data));
    }
    return directory;
  }

  private async runNotebookInKubernetes(
    sourceId: string,
    request: Record<string, any>,
    onJobCreated?: (job: {
      jobName: string;
      namespace: string;
    }) => void | Promise<void>,
    files: NotebookInputFile[] = [],
  ): Promise<{
    payload: Record<string, any> | null;
    stderr: string;
    exitCode: number;
  }> {
    if (!this.kubernetesCliJobService) {
      throw new Error(
        'Kubernetes execution is enabled but the Kubernetes CLI job service is unavailable',
      );
    }
    const result = await this.kubernetesCliJobService.runNotebookJob(
      sourceId,
      request,
      onJobCreated,
      files,
    );
    return {
      // A pod log interleaves everything that wrote to the stream, so the
      // result is found by its marker rather than by assuming it is the
      // last line.
      payload: parseNotebookResult(result.output),
      stderr: result.output,
      exitCode: result.exitCode,
    };
  }

  /** Delete the Kubernetes Job backing a notebook execution, if there is one. */
  async cancelNotebookJob(executionId: string): Promise<boolean> {
    if (!this.kubernetesCliJobService) return false;
    return this.kubernetesCliJobService.cancelNotebookJob(executionId);
  }

  private async createTempJsonFile(
    prefix: string,
    payload: unknown,
  ): Promise<string> {
    const tmpDir = process.env.TEMP_DIR || '/tmp';
    const filepath = path.join(
      tmpDir,
      `${prefix}-${Date.now()}-${randomUUID()}.json`,
    );
    await fs.writeFile(filepath, JSON.stringify(payload), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return filepath;
  }

  /**
   * Start a connection test in the background and answer immediately.
   *
   * The synchronous endpoint holds the HTTP request open for the whole test.
   * That is fine for a connector that answers in three seconds and useless on
   * Kubernetes, where the test pod first has to be scheduled: one measured run
   * returned after 422.5 s, of which the test itself was 3 s and the rest was
   * `Pending` behind a running scan. Any ingress with a 60 s timeout turns that
   * into a failed request while the job is still running (field report P2).
   *
   * The answer is written to `Source.connectionTest`, not held in memory, so a
   * poll landing on another API replica — or after a restart — still finds it.
   * One record per source: a second test of the same source while one is in
   * flight is the same question, so it joins the one already running.
   */
  async startConnectionTest(
    sourceId: string,
    triggeredBy?: string,
  ): Promise<ConnectionTestRecord> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, connectionTest: true },
    });
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);

    const existing = this.readConnectionTest(source.connectionTest);
    if (existing?.status === 'RUNNING' && !this.testHasGoneStale(existing)) {
      return existing;
    }

    const record: ConnectionTestRecord = {
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      message: null,
      result: null,
      triggeredBy: triggeredBy ?? null,
    };
    await this.writeConnectionTest(sourceId, record);

    // Deliberately not awaited: the point of this endpoint is to return now.
    // Every failure path below ends in a stored FAILURE, so a poll always
    // reaches a terminal state rather than hanging on RUNNING forever.
    void (async () => {
      try {
        const result = await this.testConnection(sourceId);
        await this.writeConnectionTest(sourceId, {
          ...record,
          status: result?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
          finishedAt: new Date().toISOString(),
          message: typeof result?.message === 'string' ? result.message : null,
          result,
        });
      } catch (error) {
        await this.writeConnectionTest(sourceId, {
          ...record,
          status: 'FAILURE',
          finishedAt: new Date().toISOString(),
          message: String((error as Error)?.message ?? error),
          result: null,
        }).catch(() => undefined);
      }
    })();

    return record;
  }

  /** The stored result of the last connection test, or null when never tested. */
  async getConnectionTest(
    sourceId: string,
  ): Promise<ConnectionTestRecord | null> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, connectionTest: true },
    });
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);

    const record = this.readConnectionTest(source.connectionTest);
    if (!record) return null;
    if (record.status === 'RUNNING' && this.testHasGoneStale(record)) {
      // The replica that started it is gone. Saying so beats a spinner that
      // never resolves, which is the failure mode this endpoint replaced.
      return {
        ...record,
        status: 'FAILURE',
        finishedAt: new Date().toISOString(),
        message: `No result after ${Math.round(CONNECTION_TEST_STALE_MS / 60_000)} minutes; the test was lost (an API restart, or a job that never started).`,
      };
    }
    return record;
  }

  private readConnectionTest(value: unknown): ConnectionTestRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const status = raw.status;
    if (status !== 'RUNNING' && status !== 'SUCCESS' && status !== 'FAILURE') {
      return null;
    }
    return {
      status,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      finishedAt: typeof raw.finishedAt === 'string' ? raw.finishedAt : null,
      message: typeof raw.message === 'string' ? raw.message : null,
      result:
        raw.result &&
        typeof raw.result === 'object' &&
        !Array.isArray(raw.result)
          ? (raw.result as Record<string, unknown>)
          : null,
      triggeredBy: typeof raw.triggeredBy === 'string' ? raw.triggeredBy : null,
    };
  }

  private testHasGoneStale(record: ConnectionTestRecord): boolean {
    const started = record.startedAt ? Date.parse(record.startedAt) : NaN;
    if (!Number.isFinite(started)) return true;
    return Date.now() - started > CONNECTION_TEST_STALE_MS;
  }

  private async writeConnectionTest(
    sourceId: string,
    record: ConnectionTestRecord,
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { connectionTest: record as unknown as Prisma.InputJsonValue },
    });
  }

  async testConnection(sourceId: string): Promise<Record<string, any>> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }
    if (source.type === AssetType.SANDBOX) {
      const uploadedFileCount = await this.prisma.uploadedSourceFile.count({
        where: { sourceId },
      });
      if (uploadedFileCount === 0) {
        throw new BadRequestException(
          'A sandbox source must contain at least one uploaded file before it can be tested',
        );
      }
    }
    const decryptedConfig = this.toDecryptedRecipeConfig(source.config);

    const environment = process.env.ENVIRONMENT || 'development';
    if (this.isKubernetesExecutionEnabled(environment)) {
      return this.testConnectionInKubernetes(decryptedConfig, sourceId);
    }

    const cliPath = this.getCliPath(environment);
    const venvPath = this.getVenvPath(environment);
    const recipeFile = await this.createTempRecipeFile(decryptedConfig);

    try {
      const command = this.buildCliTestCommand(
        cliPath,
        venvPath,
        recipeFile,
        sourceId,
        this.resolveOutputRestUrl(environment),
      );
      const { stdout, stderr, exitCode } = await this.executeCli(
        command,
        (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            this.logger.log(`[CLI test] ${trimmed}`);
          }
        },
        undefined,
        undefined,
        // A connection test prints its JSON result early and exits, so this one
        // does need the front of the stream — bounded so that a source which
        // streams instead of answering cannot fill the heap.
        { mode: 'head', maxBytes: 4 * 1024 * 1024, maxLines: 20_000 },
      );

      if (stderr?.trim()) {
        this.logger.debug(`[CLI test stderr] ${stderr.trim().slice(0, 500)}`);
      }

      let payload: Record<string, any> = {
        status: exitCode === 0 ? 'SUCCESS' : 'FAILURE',
        message:
          exitCode === 0
            ? 'Connection test completed.'
            : 'Connection test failed.',
      };

      const trimmedOutput = stdout.trim();
      if (trimmedOutput) {
        try {
          payload = JSON.parse(trimmedOutput);
        } catch (error: any) {
          this.logger.warn(`Failed to parse CLI test output: ${error.message}`);
          payload = {
            status: 'FAILURE',
            message: `Failed to parse CLI test output: ${trimmedOutput.substring(0, 1000)}${trimmedOutput.length > 1000 ? '...' : ''}`,
          };
        }
      }

      if (exitCode !== 0) {
        if (payload.status !== 'FAILURE') {
          payload.status = 'FAILURE';
        }
        if (
          (payload.message === 'Connection test failed.' || !payload.message) &&
          stderr?.trim()
        ) {
          payload.message = stderr.trim();
        }
      }

      return payload;
    } finally {
      await fs.unlink(recipeFile).catch(() => undefined);
    }
  }

  private async testConnectionInKubernetes(
    config: Record<string, any>,
    sourceId: string,
  ): Promise<Record<string, any>> {
    if (!this.kubernetesCliJobService) {
      throw new Error('Kubernetes CLI Job service is not available');
    }

    const result = await this.kubernetesCliJobService.runTestJob(
      sourceId,
      config,
      this.resolveOutputRestUrl('kubernetes'),
    );
    // The result is a multi-line JSON document among log lines; see
    // parseCliTestOutput for why line-by-line parsing never found it.
    const { result: parsed, otherLines: nonJsonLines } = parseCliTestOutput(
      result.output || '',
    );
    const payload: Record<string, any> = parsed ?? {
      status: result.exitCode === 0 ? 'SUCCESS' : 'FAILURE',
      message:
        result.exitCode === 0
          ? 'Connection test completed.'
          : 'Connection test failed.',
    };

    if (result.exitCode !== 0) {
      if (payload.status !== 'FAILURE') {
        payload.status = 'FAILURE';
      }
      if (
        (payload.message === 'Connection test failed.' || !payload.message) &&
        nonJsonLines.length > 0
      ) {
        // Use last 20 non-JSON lines as error message
        payload.message = nonJsonLines.slice(-20).join('\n');
      }
    }

    if (!payload.message) {
      payload.message =
        result.exitCode === 0
          ? 'Connection test completed.'
          : 'Connection test failed.';
    }
    return payload;
  }

  /**
   * Runs a CLI command, streaming its output to the callbacks and retaining a
   * bounded excerpt of it.
   *
   * The retained excerpt used to be the entire stream. A scan run writes a line
   * per asset and per finding, so on a large corpus that was tens of MB of
   * strings held for hours, duplicating what RunnerLogStorageService had
   * already written to disk, to serve a failure path that only ever quotes the
   * end of it. `capture` picks which end each caller keeps; both are O(cap).
   */
  private executeCli(
    command: string,
    onStderr: (chunk: string) => void,
    onStdout?: (chunk: string) => void,
    runnerId?: string,
    capture: BoundedOutputOptions = {},
    // Replaces the inherited environment entirely. Used by notebook
    // executions, which have no reason to hold the tenant database URL or the
    // callback key -- see notebook-env.ts. A scan does need those to write its
    // results back, so it keeps the default.
    envOverride?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const namespacedDbUrl = this.namespacedDatabaseUrl();
      const child = spawn(command, {
        shell: true,
        detached: process.platform !== 'win32',
        env: envOverride ?? {
          ...process.env,
          // Point any direct DB access from the CLI at the tenant schema.
          ...(namespacedDbUrl ? { DATABASE_URL: namespacedDbUrl } : {}),
        },
      });

      const stdout = new BoundedOutput(capture);
      const stderr = new BoundedOutput(capture);

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout.append(chunk);
        onStdout?.(chunk);

        // Log to API console for monitoring (not to database)
        const trimmed = chunk.trim();
        if (trimmed) {
          this.logger.log(
            `[CLI stdout] ${trimmed.substring(0, 200)}${trimmed.length > 200 ? '...' : ''}`,
          );
        }
      });

      // stderr contains CLI logs; persist all lines for runner log pagination.
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr.append(chunk);

        // Log all stderr to API console for monitoring
        this.logger.log(`[CLI] ${chunk.trim()}`);

        onStderr(chunk);
      });

      child.on('close', (code) => {
        if (runnerId) {
          this.runningProcessesByRunnerId.delete(runnerId);
        }
        // A CLI that dies mid-line still has its last (unterminated) line in
        // the carry-over buffer, and that line is often the error itself.
        stdout.finish();
        stderr.finish();
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: code || 0,
        });
      });

      child.on('error', (error) => {
        if (runnerId) {
          this.runningProcessesByRunnerId.delete(runnerId);
        }
        reject(error);
      });

      // Store process for potential cancellation
      if (runnerId) {
        this.runningProcessesByRunnerId.set(runnerId, child);
      }
    });
  }

  private terminateProcessTree(
    child: ChildProcess,
    signal: NodeJS.Signals = 'SIGTERM',
  ): boolean {
    if (!child.pid) {
      return false;
    }

    const pid = child.pid;
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, signal);
        return true;
      } catch {
        // Fall back to killing direct child when process-group signaling fails.
      }
    }

    try {
      if (child.kill(signal)) {
        return true;
      }
      if (process.platform !== 'win32') {
        child.kill(signal);
      }
      return true;
    } catch {
      // Process might have exited between lookup and kill.
      return false;
    }
  }

  private async stopKubernetesJobSafely(
    runnerId: string,
    runner: { jobName: string | null; jobNamespace: string | null },
  ): Promise<void> {
    try {
      await this.kubernetesCliJobService?.stopRunnerJob(runnerId, {
        jobName: runner.jobName || undefined,
        namespace: runner.jobNamespace || undefined,
      });
    } catch (error) {
      // Job may have already finished, been evicted, or never started (e.g.
      // ImagePullBackOff). Log and continue — the DB record still needs to be
      // marked stopped so the source is unblocked.
      this.logger.warn(
        `Could not stop Kubernetes job for runner ${runnerId} (proceeding with DB stop): ${String(error)}`,
      );
    }
  }

  private stopLocalRunnerProcess(runnerId: string): void {
    const child = this.runningProcessesByRunnerId.get(runnerId);
    if (!child) {
      this.logger.warn(
        `Runner ${runnerId} has no tracked local process; marking as stopped by status only.`,
      );
      return;
    }

    const terminated = this.terminateProcessTree(child, 'SIGTERM');
    if (!terminated) {
      this.logger.warn(
        `Runner ${runnerId} process could not be signaled with SIGTERM; it may have already exited.`,
      );
      return;
    }

    const killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        this.terminateProcessTree(child, 'SIGKILL');
      }
    }, 5000);
    killTimer.unref?.();
  }

  private appendLog(
    runnerId: string,
    chunk: string,
    stream: 'stderr' | 'stdout' | 'combined' = 'stderr',
  ): void {
    try {
      const entries = this.runnerLogStorage.appendChunk(
        runnerId,
        chunk,
        stream,
      );
      if (entries.length && this.runnerEventsGateway) {
        this.runnerEventsGateway.emitRunnerLogs(runnerId, entries);
      }
    } catch (error) {
      this.logger.error(`Failed to append log for runner ${runnerId}:`, error);
    }
  }

  /**
   * Counters for a finished run, read from per-run facts.
   *
   * These used to be counted from `assets.status`, which is the asset's
   * *current* state and is overwritten by every later run — so assetsCreated
   * really meant "assets whose status happens to be NEW right now and were last
   * touched by this runner". Combined with the CLI's two-pass ingest (a stub
   * pass creates the asset, then the pass carrying findings sees the same
   * checksum and marks it unchanged), a ten-asset first run reported
   * "assetsCreated: 0, assetsUnchanged: 10". runner_assets.change_type records
   * what this run actually did and no later run rewrites it.
   */
  private async computeRunnerStats(
    runnerId: string,
    findingsCreated: number,
  ): Promise<{
    assetsCreated: number;
    assetsUpdated: number;
    assetsUnchanged: number;
    assetsDeleted: number;
    assetsWithoutText: number;
    totalFindings: number;
    findingsCreated: number;
    findingsResolved: number;
    findingsRetained: number;
    textCoverage: TextCoverageStats;
  }> {
    const [
      assetsCreated,
      assetsUpdated,
      assetsUnchanged,
      assetsDeleted,
      assetsWithoutText,
      totalFindings,
      textCoverageRows,
    ] = await Promise.all([
      this.prisma.runnerAsset.count({
        where: { runnerId, changeType: RunnerAssetChangeType.CREATED },
      }),
      this.prisma.runnerAsset.count({
        where: { runnerId, changeType: RunnerAssetChangeType.UPDATED },
      }),
      this.prisma.runnerAsset.count({
        where: { runnerId, changeType: RunnerAssetChangeType.UNCHANGED },
      }),
      this.prisma.runnerAsset.count({
        where: { runnerId, changeType: RunnerAssetChangeType.DELETED },
      }),
      // Coverage, not errors: these assets ingested fine, but OCR or
      // transcription returned nothing so their content was never scanned.
      this.prisma.runnerAsset.count({ where: { runnerId, emptyText: true } }),
      // Deliberately every finding stamped by this run, matching what
      // totalFindings has always been. It is NOT a discovery count — see
      // Runner.findingsCreated, which bulkIngest accumulates as batches land.
      this.prisma.finding.count({ where: { runnerId } }),
      this.prisma.runnerAsset.groupBy({
        by: ['textExtractionStatus'],
        where: { runnerId },
        _count: { _all: true },
      }),
    ]);

    const textCoverage: TextCoverageStats = {
      extracted: 0,
      empty: 0,
      engineUnavailable: 0,
      zeroFrames: 0,
      failed: 0,
      notApplicable: 0,
      unknown: 0,
    };
    for (const row of textCoverageRows) {
      const count = row._count._all;
      switch (row.textExtractionStatus) {
        case TextExtractionStatus.EXTRACTED:
          textCoverage.extracted += count;
          break;
        case TextExtractionStatus.EMPTY:
          textCoverage.empty += count;
          break;
        case TextExtractionStatus.ENGINE_UNAVAILABLE:
          textCoverage.engineUnavailable += count;
          break;
        case TextExtractionStatus.ZERO_FRAMES:
          textCoverage.zeroFrames += count;
          break;
        case TextExtractionStatus.FAILED:
          textCoverage.failed += count;
          break;
        case TextExtractionStatus.NOT_APPLICABLE:
          textCoverage.notApplicable += count;
          break;
        default:
          textCoverage.unknown += count;
      }
    }

    const findingsResolved = await this.prisma.finding.count({
      where: { runnerId, status: FindingStatus.RESOLVED },
    });
    const findingsRetained = Math.max(
      0,
      totalFindings - findingsCreated - findingsResolved,
    );

    return {
      assetsCreated,
      assetsUpdated,
      assetsUnchanged,
      assetsDeleted,
      assetsWithoutText,
      totalFindings,
      findingsCreated,
      findingsResolved,
      findingsRetained,
      textCoverage,
    };
  }

  /**
   * Count assets on which at least one detector failed, and name the detectors.
   *
   * Reads the per-detector outcomes the CLI reports for each asset. A detector
   * that raised produced no findings, which is invisible to every other signal
   * in the run: the asset ingests fine, no asset error is recorded, and the
   * absence of findings looks exactly like a clean scan.
   */
  private async summarizeDetectorFailures(
    tx: Prisma.TransactionClient,
    runnerId: string,
  ): Promise<OutcomeFailureSummary> {
    const rows = await tx.runnerAsset.findMany({
      where: { runnerId, detectorOutcomes: { not: Prisma.DbNull } },
      select: { assetHash: true, detectorOutcomes: true },
    });
    return summarizeOutcomeFailures(rows);
  }

  private async transitionSourceToTerminalState(
    tx: Prisma.TransactionClient,
    sourceId: string,
    runnerId: string,
    runnerStatus: RunnerStatus,
  ): Promise<void> {
    const claimed = await tx.source.updateMany({
      where: {
        id: sourceId,
        currentRunnerId: runnerId,
      },
      data: {
        runnerStatus,
        currentRunnerId: null,
      },
    });

    if (claimed.count > 0) {
      return;
    }

    await tx.source.updateMany({
      where: {
        id: sourceId,
        runnerStatus: RunnerStatus.RUNNING,
        currentRunnerId: null,
      },
      data: {
        runnerStatus,
      },
    });
  }

  private async transitionRunnerToTerminalState(params: {
    runnerId: string;
    sourceId: string;
    runnerData: Prisma.RunnerUpdateInput;
    sourceStatus: RunnerStatus;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.runnerAsset.updateMany({
        where: {
          runnerId: params.runnerId,
          status: {
            in: [RunnerAssetStatus.PENDING, RunnerAssetStatus.PROCESSING],
          },
        },
        data: {
          status: RunnerAssetStatus.ERROR,
          completedAt: new Date(),
          errorMessage: 'Runner terminated before asset processing completed',
        },
      });

      await tx.runner.update({
        where: { id: params.runnerId },
        data: params.runnerData,
      });

      await this.transitionSourceToTerminalState(
        tx,
        params.sourceId,
        params.runnerId,
        params.sourceStatus,
      );
    });
  }

  private async completeRunner(runnerId: string) {
    const completedAt = new Date();
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      include: {
        source: {
          select: { id: true, name: true, consecutiveFailures: true },
        },
      },
    });

    await this.runnerLogStorage
      .finalizeRunner(
        runner?.source?.id ??
          runner?.sourceId ??
          this.runnerLogStorage.getRunnerSourceId(runnerId) ??
          '',
        runnerId,
      )
      .catch((err) => {
        this.logger.warn(
          `Failed to finalize logs for runner ${runnerId}: ${String(err)}`,
        );
      });

    if (!runner?.startedAt) {
      this.logger.warn(`Runner ${runnerId} has no startedAt`);
      return;
    }

    const durationMs = completedAt.getTime() - runner.startedAt.getTime();
    const {
      assetsCreated,
      assetsUpdated,
      assetsUnchanged,
      assetsDeleted,
      assetsWithoutText,
      totalFindings,
      findingsResolved,
      findingsRetained,
      textCoverage,
    } = await this.computeRunnerStats(runnerId, runner.findingsCreated ?? 0);

    const { finalStatus, warningMessage } = await this.prisma.$transaction(
      async (tx) => {
        await tx.runnerAsset.updateMany({
          where: {
            runnerId,
            status: {
              in: [RunnerAssetStatus.PENDING, RunnerAssetStatus.PROCESSING],
            },
          },
          data: {
            status: RunnerAssetStatus.ERROR,
            completedAt,
            errorMessage: 'Runner completed before asset processing finished',
          },
        });

        const [errorCount, totalCount, detectorFailures] = await Promise.all([
          tx.runnerAsset.count({
            where: { runnerId, status: RunnerAssetStatus.ERROR },
          }),
          tx.runnerAsset.count({ where: { runnerId } }),
          // An asset can be fetched and ingested perfectly while a detector
          // crashes on every page of it: the asset never reaches status ERROR,
          // so asset errors alone cannot see a wholly failed detector. That is
          // how a run with zero PII output reported "COMPLETED, 0 errors".
          this.summarizeDetectorFailures(tx, runnerId),
        ]);

        const hasAssetErrors = errorCount > 0;
        const hasDetectorFailures = detectorFailures.assetCount > 0;
        const hasDegradedDetectors = detectorFailures.degraded.length > 0;
        const extractionFailureCount =
          textCoverage.engineUnavailable +
          textCoverage.zeroFrames +
          textCoverage.failed;
        const hasExtractionFailures = extractionFailureCount > 0;
        // Lineage is output, not a side effect. A connector's relationships()
        // can raise, or its edges can fail to send, while every asset lands
        // perfectly — invisible to asset errors and to detector outcomes alike.
        // That is how a run shipped 920 assets, ZERO edges, and a COMPLETED
        // status whose cause was only ever in a job log. Dropped edges are NOT
        // counted here: an unresolved endpoint is routinely the other half of a
        // cross-source edge that has not been ingested yet.
        const relationshipsFailed = runner.relationshipsFailed ?? 0;
        const relationshipsLost = runner.relationshipsLost ?? 0;
        const hasLineageFailures =
          relationshipsFailed > 0 || relationshipsLost > 0;
        const status =
          hasAssetErrors ||
          hasDetectorFailures ||
          hasDegradedDetectors ||
          hasExtractionFailures ||
          hasLineageFailures
            ? RunnerStatus.WARNING
            : RunnerStatus.COMPLETED;

        const messageParts: string[] = [];
        if (hasAssetErrors) {
          messageParts.push(
            `${errorCount} of ${totalCount} assets failed processing`,
          );
        }
        if (hasDetectorFailures) {
          const detectors = detectorFailures.detectorLabels.join(', ');
          messageParts.push(
            `${detectors} failed on ${detectorFailures.assetCount} of ${totalCount} assets`,
          );
        }
        if (hasDegradedDetectors) {
          messageParts.push(
            ...describeDegradation(detectorFailures.degraded, totalCount),
          );
        }
        if (hasExtractionFailures) {
          messageParts.push(
            `${extractionFailureCount} assets had incomplete text extraction ` +
              `(${textCoverage.engineUnavailable} engine unavailable, ` +
              `${textCoverage.zeroFrames} zero-frame video, ${textCoverage.failed} other failures)`,
          );
        }
        if (hasLineageFailures) {
          const lineageParts: string[] = [];
          if (relationshipsFailed > 0) {
            lineageParts.push(
              `${relationshipsFailed} relationship pass(es) failed`,
            );
          }
          if (relationshipsLost > 0) {
            lineageParts.push(`${relationshipsLost} edge(s) could not be sent`);
          }
          messageParts.push(
            `lineage incomplete: ${lineageParts.join(' and ')} ` +
              `(${runner.relationshipsEmitted ?? 0} edge(s) emitted)`,
          );
        }
        const message =
          messageParts.length > 0 ? messageParts.join('; ') : undefined;
        // Counts and detector labels, but scrubbed like every stored error:
        // labels are connector-controlled text.
        const safeMessage =
          message === undefined
            ? undefined
            : sanitizeStoredErrorMessage(message);

        await tx.runner.update({
          where: { id: runnerId },
          data: {
            status,
            completedAt,
            durationMs,
            assetsCreated,
            assetsUpdated,
            assetsUnchanged,
            assetsDeleted,
            assetsWithoutText,
            totalFindings,
            findingsResolved,
            findingsRetained,
            textCoverage,
            ...(safeMessage && { errorMessage: safeMessage }),
            // Structured beside the sentence, so the scan page and the harness
            // read which detector stopped and why without parsing prose.
            // Scrubbed: degradation reasons are connector-controlled text.
            ...(hasDegradedDetectors && {
              errorDetails: redactDeepStrings({
                detectorsDegraded: detectorFailures.degraded,
              }) as Prisma.InputJsonValue,
            }),
          },
        });

        await this.transitionSourceToTerminalState(
          tx,
          runner.sourceId,
          runnerId,
          status,
        );

        return { finalStatus: status, warningMessage: message };
      },
    );

    await this.prisma.source.update({
      where: { id: runner.sourceId },
      data: {
        consecutiveFailures: 0,
        lastRunStatus: finalStatus,
        lastRunAt: completedAt,
        lastErrorMessage:
          warningMessage === undefined || warningMessage === null
            ? null
            : sanitizeStoredErrorMessage(warningMessage, 2000),
      },
    });

    // Emit WebSocket event for runner completed
    const runnerDto = await this.getRunnerStatus(runnerId);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    // Kick the question-matching engine for this source (fire-and-forget).
    await this.enqueueQuestionMatching(runner.sourceId, runnerId);
    await this.enqueueAutoScheduleKick(runner.sourceId, runnerId);

    if (runner?.source) {
      const sourceName = runner.source.name;
      const sourceId = runner.sourceId;
      const prevFailures = runner.source.consecutiveFailures;

      // Notify on recovery (first success after consecutive failures)
      if (prevFailures > 0) {
        try {
          const failLabel =
            prevFailures === 1
              ? '1 failed scan'
              : `${prevFailures} failed scans`;
          await this.notificationsService.create({
            type: NotificationType.SCAN,
            event: NotificationEvent.SCAN_RECOVERED,
            severity: Severity.INFO,
            title: `${sourceName} is back online`,
            message: `Recovered after ${failLabel}.`,
            sourceId,
            runnerId,
            triggeredBy: runner.triggeredBy || undefined,
            actionUrl: `/scans/${runnerId}`,
            isImportant: false,
          });
        } catch {
          this.logger.warn(
            `Failed to create recovery notification for runner ${runnerId}`,
          );
        }
      }

      // Notify on first-ever successful scan for this source
      const completedCount = await this.prisma.runner.count({
        where: { sourceId, status: RunnerStatus.COMPLETED },
      });
      if (completedCount === 1) {
        try {
          const assetLabel =
            assetsCreated === 1 ? '1 asset' : `${assetsCreated} assets`;
          await this.notificationsService.create({
            type: NotificationType.SOURCE,
            event: NotificationEvent.SOURCE_FIRST_SCAN,
            severity: Severity.INFO,
            title: `First scan complete for ${sourceName}`,
            message: `${assetLabel} indexed.`,
            sourceId,
            runnerId,
            triggeredBy: runner.triggeredBy || undefined,
            actionUrl: `/sources/${sourceId}`,
            isImportant: false,
          });
        } catch {
          this.logger.warn(
            `Failed to create first-scan notification for runner ${runnerId}`,
          );
        }
      }

      // Anomaly: significant spike in findings vs. rolling baseline
      const baseline = await this.getBaselineFindings(sourceId, runnerId);
      if (
        baseline > 0 &&
        totalFindings > baseline * 3 &&
        totalFindings - baseline > 20
      ) {
        try {
          const multiplier = (totalFindings / baseline).toFixed(1);
          await this.notificationsService.create({
            type: NotificationType.FINDING,
            event: NotificationEvent.FINDINGS_SPIKE,
            severity: Severity.HIGH,
            title: `Unusual spike in findings for ${sourceName}`,
            message: `${totalFindings} findings detected — ${multiplier}× more than usual (avg: ${Math.round(baseline)}).`,
            sourceId,
            runnerId,
            triggeredBy: runner.triggeredBy || undefined,
            actionUrl: `/scans/${runnerId}`,
            isImportant: true,
            metadata: { totalFindings, baseline, multiplier },
          });
        } catch {
          this.logger.warn(
            `Failed to create findings-spike notification for runner ${runnerId}`,
          );
        }
      }

      // Anomaly: suspicious mass resolution (large drop vs. prior run)
      const previousFindings = await this.getPreviousRunFindings(
        sourceId,
        runnerId,
      );
      if (
        previousFindings > 0 &&
        previousFindings > totalFindings * 3 &&
        previousFindings - totalFindings > 20
      ) {
        try {
          const dropped = previousFindings - totalFindings;
          await this.notificationsService.create({
            type: NotificationType.FINDING,
            event: NotificationEvent.FINDINGS_MASS_RESOLVED,
            severity: Severity.MEDIUM,
            title: `Large drop in findings for ${sourceName}`,
            message: `${dropped} fewer findings than last scan — verify this is expected.`,
            sourceId,
            runnerId,
            triggeredBy: runner.triggeredBy || undefined,
            actionUrl: `/findings?source=${sourceId}&status=RESOLVED`,
            isImportant: true,
            metadata: { totalFindings, previousFindings, dropped },
          });
        } catch {
          this.logger.warn(
            `Failed to create mass-resolved notification for runner ${runnerId}`,
          );
        }
      }
    }

    void this.dequeueNextPendingRunner();
  }

  /**
   * The source's masked secret values, decrypted for exact-value redaction
   * of stored error text. Best-effort by design: a failure must still be
   * recorded when the config cannot be read, and credential-shaped patterns
   * still apply downstream without the exact values.
   */
  private async sourceSecretValues(sourceId: string): Promise<string[]> {
    try {
      const row = await this.prisma.source.findUnique({
        where: { id: sourceId },
        select: { config: true },
      });
      const config = asJsonRecord(row?.config);
      const leaves = [
        ...this.secretLeaves(config?.['masked']),
        ...this.secretLeaves(
          asJsonRecord(config?.['augmentation'])?.['secrets'],
        ),
      ];
      const values: string[] = [];
      for (const leaf of leaves) {
        try {
          values.push(this.maskedConfigCryptoService.decryptString(leaf));
        } catch {
          values.push(leaf);
        }
      }
      return values;
    } catch {
      return [];
    }
  }

  private secretLeaves(node: unknown): string[] {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) {
      return node.flatMap((item) => this.secretLeaves(item));
    }
    if (node && typeof node === 'object') {
      return Object.values(node).flatMap((item) => this.secretLeaves(item));
    }
    return [];
  }

  private async failRunner(
    runnerId: string,
    errorMessage: string,
    errorDetails: any,
  ) {
    const runnerRef = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { sourceId: true, status: true },
    });
    if (!runnerRef) {
      this.logger.warn(`Runner ${runnerId} disappeared before it could fail`);
      return;
    }
    // A stop tears the execution down, and the teardown then reports what it
    // always reports: the process is gone, the Kubernetes Job is not found.
    // That is the stop's own consequence, not a second, independent failure,
    // and acting on it overwrote STOPPED with ERROR and charged the source a
    // consecutive failure for a decision its operator made (field report P8).
    if (
      runnerRef.status === RunnerStatus.STOPPED ||
      this.stoppingRunners.has(runnerId)
    ) {
      this.logger.log(
        `Runner ${runnerId} was stopped by an operator; not recording "${errorMessage}" as a failure`,
      );
      return;
    }

    // Exact secret values first (the source's own masked bag, decrypted),
    // credential shapes second. Stored error text must stay actionable --
    // kind, codes, paths -- without ever carrying a live credential.
    const secretValues = await this.sourceSecretValues(runnerRef.sourceId);
    const normalizedMessage =
      typeof errorMessage === 'string' && errorMessage.trim().length > 0
        ? sanitizeStoredErrorMessage(
            sanitizeWithSecrets(errorMessage, secretValues),
          )
        : 'Unknown error';
    // Bound before redact: one unbounded string (a full multi-MB job log
    // embedded as `output`) must not reach the JSONB column or the UI.
    const normalizedDetails = redactDeepWithSecrets(
      boundLongDetailStrings(this.toSerializableErrorDetails(errorDetails)),
      secretValues,
    ) as Record<string, unknown> | string | null;

    const errorDetailsForDb:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput =
      normalizedDetails === null
        ? Prisma.JsonNull
        : (normalizedDetails as Prisma.InputJsonValue);

    await this.runnerLogStorage
      .finalizeRunner(runnerRef.sourceId, runnerId)
      .catch((err) => {
        this.logger.warn(
          `Failed to finalize logs for runner ${runnerId}: ${String(err)}`,
        );
      });

    try {
      await this.transitionRunnerToTerminalState({
        runnerId,
        sourceId: runnerRef.sourceId,
        sourceStatus: RunnerStatus.ERROR,
        runnerData: {
          status: RunnerStatus.ERROR,
          completedAt: new Date(),
          errorMessage: normalizedMessage,
          errorDetails: errorDetailsForDb,
        },
      });
    } catch (updateError) {
      this.logger.error(
        `Failed to persist error details for runner ${runnerId}: ${String(updateError)}`,
      );
      try {
        await this.transitionRunnerToTerminalState({
          runnerId,
          sourceId: runnerRef.sourceId,
          sourceStatus: RunnerStatus.ERROR,
          runnerData: {
            status: RunnerStatus.ERROR,
            completedAt: new Date(),
            errorMessage: normalizedMessage,
          },
        });
      } catch (fallbackError) {
        this.logger.error(
          `Failed to mark runner ${runnerId} as ERROR: ${String(fallbackError)}`,
        );
        return;
      }
    }

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      include: {
        source: {
          select: { id: true, name: true, consecutiveFailures: true },
        },
      },
    });
    if (runner) {
      // Emit WebSocket event for runner failed
      const runnerDto = await this.getRunnerStatus(runnerId);
      if (runnerDto && this.runnerEventsGateway) {
        this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
      }
    }

    if (runner?.source) {
      const now = new Date();

      // Increment consecutive failure tracking on the source
      const updatedSource = await this.prisma.source.update({
        where: { id: runner.sourceId },
        data: {
          consecutiveFailures: { increment: 1 },
          lastRunStatus: RunnerStatus.ERROR,
          lastRunAt: now,
          lastErrorMessage: normalizedMessage.slice(0, 2000),
        },
        select: { consecutiveFailures: true },
      });

      const failCount = updatedSource.consecutiveFailures;
      const sourceName = runner.source.name;
      const friendlyError = this.getFriendlyErrorMessage(normalizedMessage);
      const countLabel =
        failCount > 1
          ? ` (${this.ordinal(failCount)} consecutive failure)`
          : '';

      try {
        await this.notificationsService.create({
          type: NotificationType.SCAN,
          event: NotificationEvent.SCAN_FAILED,
          severity: Severity.HIGH,
          title: `${sourceName} scan failed${countLabel}`,
          message: friendlyError,
          sourceId: runner.sourceId,
          runnerId: runnerId,
          triggeredBy: runner.triggeredBy || undefined,
          actionUrl: `/scans/${runnerId}`,
          isImportant: true,
          metadata: {
            consecutiveFailures: failCount,
            errorMessage: normalizedMessage,
            errorDetails: normalizedDetails,
          },
        });
      } catch {
        this.logger.warn(
          `Failed to create failure notification for runner ${runnerId}`,
        );
      }

      // Sent after consecutiveFailures has been incremented: the adaptive
      // scheduler sizes its backoff from that counter, so kicking it earlier
      // would back off one step short every time.
      await this.enqueueAutoScheduleKick(runner.sourceId, runnerId);
    }

    void this.dequeueNextPendingRunner();
  }

  private getFriendlyErrorMessage(raw: string): string {
    const lower = raw.toLowerCase();
    if (
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('connect etimedout') ||
      lower.includes('network')
    ) {
      return 'Could not reach the source — check network connectivity.';
    }
    if (
      lower.includes('401') ||
      lower.includes('unauthorized') ||
      lower.includes('invalid_token') ||
      lower.includes('invalid token') ||
      lower.includes('authentication failed') ||
      lower.includes('invalid credentials')
    ) {
      return 'Authentication failed — check the source credentials.';
    }
    if (lower.includes('403') || lower.includes('forbidden')) {
      return 'Access denied — the configured account lacks permission.';
    }
    if (lower.includes('429') || lower.includes('rate limit')) {
      return 'Rate limited by the source API — will retry on next scheduled run.';
    }
    if (lower.includes('timeout') || lower.includes('etimedout')) {
      return 'Scan timed out — the source may be slow or unresponsive.';
    }
    if (lower.includes('ssl') || lower.includes('certificate')) {
      return 'SSL/TLS error — check the source URL and certificate configuration.';
    }
    // Fallback: truncate raw message to a readable length
    return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  }

  private ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  }

  private resolveMaxRunnersPerSource(): number {
    const raw = process.env.MAX_RUNNERS_PER_SOURCE;
    if (!raw) return 5;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5;
  }

  private async pruneOldRunners(sourceId: string): Promise<void> {
    const limit = this.resolveMaxRunnersPerSource();
    if (limit === 0) return;

    const terminated = await this.prisma.runner.findMany({
      where: {
        sourceId,
        status: { in: [RunnerStatus.COMPLETED, RunnerStatus.ERROR] },
      },
      orderBy: { triggeredAt: 'desc' },
      select: { id: true },
    });

    const toDelete = terminated.slice(limit);
    if (toDelete.length === 0) return;

    for (const { id } of toDelete) {
      try {
        await this.runnerLogStorage.deleteRunnerLogs(sourceId, id);
        await this.prisma.runner.delete({ where: { id } });
      } catch (error) {
        this.logger.warn(
          `Failed to prune old runner ${id} for source ${sourceId}: ${String(error)}`,
        );
      }
    }

    this.logger.log(
      `Pruned ${toDelete.length} old runner(s) for source ${sourceId} (limit: ${limit})`,
    );
  }

  private async getBaselineFindings(
    sourceId: string,
    excludeRunnerId: string,
  ): Promise<number> {
    const runs = await this.prisma.runner.findMany({
      where: {
        sourceId,
        status: RunnerStatus.COMPLETED,
        id: { not: excludeRunnerId },
      },
      orderBy: { completedAt: 'desc' },
      take: 5,
      select: { totalFindings: true },
    });
    if (runs.length === 0) return 0;
    return runs.reduce((sum, r) => sum + r.totalFindings, 0) / runs.length;
  }

  private async getPreviousRunFindings(
    sourceId: string,
    excludeRunnerId: string,
  ): Promise<number> {
    const prev = await this.prisma.runner.findFirst({
      where: {
        sourceId,
        status: RunnerStatus.COMPLETED,
        id: { not: excludeRunnerId },
      },
      orderBy: { completedAt: 'desc' },
      select: { totalFindings: true },
    });
    return prev?.totalFindings ?? 0;
  }

  private toSerializableErrorDetails(
    errorDetails: unknown,
  ): Record<string, unknown> | string | null {
    if (errorDetails === null || errorDetails === undefined) {
      return null;
    }

    if (typeof errorDetails === 'string') {
      return errorDetails.slice(0, 8000);
    }

    if (typeof errorDetails === 'number' || typeof errorDetails === 'boolean') {
      return String(errorDetails);
    }

    const seen = new WeakSet<object>();
    try {
      return JSON.parse(
        JSON.stringify(errorDetails, (_key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular]';
            }
            seen.add(value);
          }
          return value;
        }),
      ) as Record<string, unknown>;
    } catch {
      try {
        return JSON.stringify(errorDetails).slice(0, 8000);
      } catch {
        return '[Unserializable error details]';
      }
    }
  }

  async updateRunnerStatus(
    runnerId: string,
    status: RunnerStatus,
    errorMessage?: string,
  ) {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: {
        id: true,
        sourceId: true,
        status: true,
      },
    });

    if (!runner) {
      throw new NotFoundException(`Runner with ID ${runnerId} not found`);
    }

    // Only allow updating to COMPLETED or ERROR
    if (status !== RunnerStatus.COMPLETED && status !== RunnerStatus.ERROR) {
      throw new BadRequestException(
        `Cannot update runner status to ${status}. Only COMPLETED and ERROR are allowed.`,
      );
    }

    if (status === RunnerStatus.COMPLETED) {
      await this.completeRunner(runnerId);
      return this.getRunnerStatus(runnerId);
    }

    await this.failRunner(
      runnerId,
      errorMessage ?? 'Runner marked as ERROR by upstream executor',
      { source: 'upstream_executor' },
    );

    const runnerDto = await this.getRunnerStatus(runnerId);

    // Emit WebSocket event for runner status update
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    return runnerDto;
  }

  async registerDiscoveredAssets(
    runnerId: string,
    assetHashes: string[],
    includeScanCache = false,
    includePayloadCursor = false,
  ): Promise<{
    registered: number;
    cache?: ScanCacheEntryDto[];
    payloadCursors?: PayloadCursorEntryDto[];
  }> {
    if (!assetHashes.length) return { registered: 0 };

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true, sourceId: true, scopeFingerprint: true },
    });
    if (!runner) {
      throw new NotFoundException(`Runner ${runnerId} not found`);
    }

    // Read prior state before registering, not after. This endpoint is the only
    // point in the run where the stored checksum still describes the *previous*
    // scan: the discovery ingest that immediately follows overwrites it with the
    // incoming value, after which every asset would compare equal to itself.
    const cache = includeScanCache
      ? await this.collectScanCacheState(
          runner.sourceId,
          assetHashes,
          runner.scopeFingerprint,
        )
      : undefined;

    // Read alongside the scan cache and for the same reason: this is the last
    // moment the stored row offset still describes the *previous* run.
    const payloadCursors = includePayloadCursor
      ? await this.collectPayloadCursors(runner.sourceId, assetHashes)
      : undefined;

    const result = await this.prisma.runnerAsset.createMany({
      data: assetHashes.map((hash) => ({
        runnerId,
        assetHash: hash,
        status: RunnerAssetStatus.PENDING,
      })),
      skipDuplicates: true,
    });

    return {
      registered: result.count,
      ...(cache ? { cache } : {}),
      ...(payloadCursors ? { payloadCursors } : {}),
    };
  }

  /**
   * Stored payload positions for the given hashes.
   *
   * Unlike scan-cache state this is returned unconditionally: a cursor records
   * where a sweep stopped, not that anything completed, so withholding it from a
   * run whose last attempt died would silently restart that asset at row 0 and
   * re-scan rows already covered. The CLI is the one that decides a cursor no
   * longer applies — it compares the checksum and strategy stored inside it.
   */
  private async collectPayloadCursors(
    sourceId: string,
    assetHashes: string[],
  ): Promise<PayloadCursorEntryDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        sourceId,
        hash: { in: assetHashes },
        payloadCursor: { not: Prisma.DbNull },
      },
      select: { hash: true, payloadCursor: true },
    });

    const entries: PayloadCursorEntryDto[] = [];
    for (const asset of assets) {
      const cursor = asJsonRecord(asset.payloadCursor);
      if (cursor) entries.push({ hash: asset.hash, cursor });
    }
    return entries;
  }

  /**
   * Prior scan-cache state for the given hashes, as the CLI needs to read it.
   *
   * Only complete state bound to this runner's scope is returned. The checksum
   * and scope inside the JSON were stored atomically with that completed payload;
   * the mutable Asset columns may already describe a later failed discovery pass.
   */
  private async collectScanCacheState(
    sourceId: string,
    assetHashes: string[],
    currentScopeFingerprint: string | null,
  ): Promise<ScanCacheEntryDto[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        sourceId,
        hash: { in: assetHashes },
        scanCache: { not: Prisma.DbNull },
      },
      select: {
        hash: true,
        scanCache: true,
      },
    });

    const entries: ScanCacheEntryDto[] = [];
    for (const asset of assets) {
      const state = asJsonRecord(asset.scanCache);
      if (!state || state.complete !== true) continue;

      const completedChecksum =
        typeof state.completed_checksum === 'string'
          ? state.completed_checksum
          : null;
      const completedScopeFingerprint =
        typeof state.scope_fingerprint === 'string'
          ? state.scope_fingerprint
          : null;
      // The mutable Asset columns may describe a later discovery pass that
      // failed before phase 2. Only facts stored atomically with complete=true
      // prove which content and scope actually finished.
      if (
        !completedChecksum ||
        !currentScopeFingerprint ||
        completedScopeFingerprint !== currentScopeFingerprint
      ) {
        continue;
      }

      const detectors: Record<string, string> = {};
      const rawDetectors = asJsonRecord(state.detectors);
      for (const [key, value] of Object.entries(rawDetectors ?? {})) {
        if (typeof value === 'string') detectors[key] = value;
      }

      entries.push({
        hash: asset.hash,
        checksum: completedChecksum,
        contentHash:
          typeof state.content_hash === 'string' ? state.content_hash : null,
        scopeFingerprint: completedScopeFingerprint,
        detectors,
        findingsTotal:
          typeof state.findings_total === 'number'
            ? state.findings_total
            : null,
        findingsBySeverity:
          (asJsonRecord(state.findings_by_severity) as Record<
            string,
            number
          > | null) ?? null,
        findingsByDetector:
          (asJsonRecord(state.findings_by_detector) as Record<
            string,
            Record<string, number>
          > | null) ?? null,
        emptyText:
          typeof state.empty_text === 'boolean' ? state.empty_text : null,
        textExtractionStatus:
          typeof state.text_extraction_status === 'string'
            ? state.text_extraction_status
            : null,
      });
    }

    return entries;
  }

  async updateRunnerAssetStatuses(
    runnerId: string,
    updates: Array<{
      assetHash: string;
      status: 'PROCESSING' | 'PROCESSED' | 'ERROR';
      errorMessage?: string;
      findingsTotal?: number;
      findingsBySeverity?: object;
      findingsByDetector?: object;
      cacheHit?: boolean;
    }>,
  ): Promise<void> {
    if (!updates.length) return;

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true },
    });
    if (!runner) {
      throw new NotFoundException(`Runner ${runnerId} not found`);
    }

    const now = new Date();
    await this.prisma.$transaction(
      updates.map((update) => {
        const isProcessing = update.status === 'PROCESSING';
        const isProcessed = update.status === 'PROCESSED';
        const status = isProcessing
          ? RunnerAssetStatus.PROCESSING
          : isProcessed
            ? RunnerAssetStatus.PROCESSED
            : RunnerAssetStatus.ERROR;

        return this.prisma.runnerAsset.update({
          where: {
            runnerId_assetHash: { runnerId, assetHash: update.assetHash },
          },
          data: {
            status,
            ...(isProcessing ? { startedAt: now } : { completedAt: now }),
            // Scrubbed like every stored error: asset failures carry
            // driver/notebook text verbatim.
            errorMessage: isProcessing
              ? undefined
              : update.errorMessage === undefined
                ? undefined
                : sanitizeStoredErrorMessage(update.errorMessage),
            ...(update.findingsTotal !== undefined && {
              findingsTotal: update.findingsTotal,
            }),
            ...(update.findingsBySeverity !== undefined && {
              findingsBySeverity: update.findingsBySeverity,
            }),
            ...(update.findingsByDetector !== undefined && {
              findingsByDetector: update.findingsByDetector,
            }),
            // Left alone unless the CLI asserts a hit, so an asset that reports
            // PROCESSING then PROCESSED cannot clear its own flag mid-run.
            ...(update.cacheHit === true && { cacheHit: true }),
          },
        });
      }),
    );
  }

  async markRunnerAssetProcessing(
    runnerId: string,
    assetHash: string,
  ): Promise<void> {
    await this.prisma.runnerAsset.update({
      where: {
        runnerId_assetHash: { runnerId, assetHash },
      },
      data: {
        status: RunnerAssetStatus.PROCESSING,
        startedAt: new Date(),
      },
    });
  }

  async getRunnerAssetProgress(runnerId: string): Promise<{
    pending: number;
    processing: number;
    processed: number;
    error: number;
    total: number;
  }> {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true },
    });
    if (!runner) {
      throw new NotFoundException(`Runner ${runnerId} not found`);
    }

    const counts = await this.prisma.runnerAsset.groupBy({
      by: ['status'],
      where: { runnerId },
      _count: true,
    });

    const result = {
      pending: 0,
      processing: 0,
      processed: 0,
      error: 0,
      total: 0,
    };
    for (const row of counts) {
      const count = row._count;
      switch (row.status) {
        case RunnerAssetStatus.PENDING:
          result.pending = count;
          break;
        case RunnerAssetStatus.PROCESSING:
          result.processing = count;
          break;
        case RunnerAssetStatus.PROCESSED:
          result.processed = count;
          break;
        case RunnerAssetStatus.ERROR:
          result.error = count;
          break;
      }
      result.total += count;
    }

    return result;
  }

  async stopRunner(runnerId: string) {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: {
        id: true,
        sourceId: true,
        status: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
      },
    });

    if (!runner) {
      throw new Error(`Runner ${runnerId} not found`);
    }

    if (
      runner.status !== RunnerStatus.RUNNING &&
      runner.status !== RunnerStatus.PENDING
    ) {
      throw new Error(
        `Runner ${runnerId} is not running (status: ${runner.status})`,
      );
    }

    // Claimed before anything is torn down: from here on, the teardown's own
    // "the process is gone" must not be read as a failure (see failRunner).
    this.stoppingRunners.add(runnerId);
    try {
      return await this.performStop(runnerId, runner);
    } finally {
      // Held a little past the transition: a watch loop mid-poll when the Job
      // vanished still resolves after the row says STOPPED, and would
      // otherwise arrive just too late to be recognised.
      const timer = setTimeout(
        () => this.stoppingRunners.delete(runnerId),
        STOP_GRACE_MS,
      );
      timer.unref?.();
    }
  }

  private async performStop(
    runnerId: string,
    runner: {
      sourceId: string;
      status: RunnerStatus;
      executionMode: RunnerExecutionMode | null;
      jobName: string | null;
      jobNamespace: string | null;
    },
  ) {
    // Whether the run ever started an execution. A queued run never consumed
    // its window, so stopping it must not advance the source's last-run clock
    // (the cron catch-up would otherwise read the window as served).
    let started = runner.status === RunnerStatus.RUNNING;
    if (started) {
      await this.tearDownRunnerExecution(runnerId, runner);
      await this.transitionRunnerToTerminalState({
        runnerId,
        sourceId: runner.sourceId,
        sourceStatus: RunnerStatus.STOPPED,
        runnerData: {
          status: RunnerStatus.STOPPED,
          completedAt: new Date(),
          errorMessage: MANUAL_STOP_MESSAGE,
        },
      });
    } else {
      // A PENDING runner is still waiting in the queue: there is no process or
      // Kubernetes Job to tear down, so cancelling it is only the terminal
      // transition below — guarded, because the queue can promote the row
      // between the stop's read and this write.
      const claimed = await this.stopQueuedRunner(runnerId, runner.sourceId);
      if (!claimed) {
        const current = await this.prisma.runner.findUnique({
          where: { id: runnerId },
          select: {
            id: true,
            sourceId: true,
            status: true,
            executionMode: true,
            jobName: true,
            jobNamespace: true,
          },
        });
        if (current && current.status === RunnerStatus.RUNNING) {
          // Lost the race: the queued run launched after all, so stop the
          // execution it actually started.
          started = true;
          await this.tearDownRunnerExecution(runnerId, current);
          await this.transitionRunnerToTerminalState({
            runnerId,
            sourceId: runner.sourceId,
            sourceStatus: RunnerStatus.STOPPED,
            runnerData: {
              status: RunnerStatus.STOPPED,
              completedAt: new Date(),
              errorMessage: MANUAL_STOP_MESSAGE,
            },
          });
        }
        // Otherwise the run already reached a terminal state on its own (or
        // vanished): the bookkeeping, scheduler kick and queue drain below
        // are idempotent, so fall through rather than failing the stop.
      }
    }

    await this.runnerLogStorage
      .finalizeRunner(runner.sourceId, runnerId)
      .catch((err) => {
        this.logger.warn(
          `Failed to finalize logs for runner ${runnerId}: ${String(err)}`,
        );
      });

    // STOPPED, not ERROR: an operator's decision is not a failed scan. As
    // ERROR it backed the source off, counted against its failure streak and
    // showed up on every dashboard that counts errors — one namespace had a
    // source paused "after 11 consecutive failed scans" partly this way
    // (GENESIS field report P8). consecutiveFailures is therefore deliberately
    // left untouched; lastRunStatus records the decision so the source row
    // does not keep advertising an older outcome.
    try {
      await this.prisma.source.update({
        where: { id: runner.sourceId },
        data: {
          lastRunStatus: RunnerStatus.STOPPED,
          lastErrorMessage: MANUAL_STOP_MESSAGE,
          ...(started ? { lastRunAt: new Date() } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record stop bookkeeping for runner ${runnerId}: ${String(error)}`,
      );
    }

    // Emit WebSocket event for runner stopped
    const runnerDto = await this.getRunnerStatus(runnerId);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    // A stop is a terminal outcome like any other: the adaptive scheduler
    // folds it in (STOPPED reads as "no progress", never as a failure) and
    // re-arms the source's cadence via pg-boss, instead of waiting for the
    // one-minute tick to notice the source went idle.
    await this.enqueueAutoScheduleKick(runner.sourceId, runnerId);

    // Stopping a run frees its concurrency slot, so the queue has to be
    // drained here exactly as `completeRunner` and `failRunner` do it.
    //
    // Without this the instance deadlocks, and silently. `startRun` queues a
    // runner as PENDING when the cap is reached, and the only things that ever
    // promote a PENDING runner are these three call sites plus boot. But the
    // budget in AutoScheduleService counts PENDING *and* RUNNING — so a queued
    // runner that nothing will start still consumes the slot it is waiting
    // for, against itself, forever.
    //
    // Observed: one stopped scan left a PENDING runner idle for 25+ minutes on
    // a completely empty cluster, with `Auto-schedule yielding: 1 scan(s)
    // already in flight (cap 1)` on repeat — the one scan in flight being the
    // queued runner itself. It clears only on restart, which is what
    // "Runner was left pending during application restart" in the run history
    // actually is.
    void this.dequeueNextPendingRunner();

    return { message: 'Runner stopped' };
  }

  /**
   * Terminal transition for a run that never started, conditional on it still
   * being queued.
   *
   * The queue promotes PENDING rows to RUNNING concurrently
   * (`dequeuePendingRunnerInCurrentNamespace` claims with
   * `updateMany where status = PENDING`), so an unconditional update here
   * could mark STOPPED a run whose execution launched a moment earlier —
   * which would then run to completion and overwrite the stop. Resolves
   * whether this call won the claim; the caller stops the launched execution
   * when it did not.
   */
  private async stopQueuedRunner(
    runnerId: string,
    sourceId: string,
  ): Promise<boolean> {
    let claimed = false;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.runner.updateMany({
        where: { id: runnerId, status: RunnerStatus.PENDING },
        data: {
          status: RunnerStatus.STOPPED,
          completedAt: new Date(),
          errorMessage: MANUAL_STOP_MESSAGE,
        },
      });
      if (updated.count !== 1) return;
      claimed = true;

      await tx.runnerAsset.updateMany({
        where: {
          runnerId,
          status: {
            in: [RunnerAssetStatus.PENDING, RunnerAssetStatus.PROCESSING],
          },
        },
        data: {
          status: RunnerAssetStatus.ERROR,
          completedAt: new Date(),
          errorMessage: 'Runner terminated before asset processing completed',
        },
      });

      await this.transitionSourceToTerminalState(
        tx,
        sourceId,
        runnerId,
        RunnerStatus.STOPPED,
      );
    });
    return claimed;
  }

  /**
   * Tear down a RUNNING execution without touching any database state.
   *
   * Split out of `performStop` so a queued run that lost the promotion race
   * stops the execution it actually started through the same path.
   */
  private async tearDownRunnerExecution(
    runnerId: string,
    runner: {
      executionMode: RunnerExecutionMode | null;
      jobName: string | null;
      jobNamespace: string | null;
    },
  ): Promise<void> {
    switch (runner.executionMode) {
      case RunnerExecutionMode.KUBERNETES:
        await this.stopKubernetesJobSafely(runnerId, runner);
        break;
      case RunnerExecutionMode.EXTERNAL:
        throw new BadRequestException(
          `Runner ${runnerId} is managed externally and cannot be stopped from the API`,
        );
      case RunnerExecutionMode.LOCAL:
      default: {
        const environment = process.env.ENVIRONMENT || 'development';
        if (this.isKubernetesExecutionEnabled(environment)) {
          await this.stopKubernetesJobSafely(runnerId, runner);
          break;
        }

        this.stopLocalRunnerProcess(runnerId);
        break;
      }
    }
  }

  async deleteRunner(runnerId: string) {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true, sourceId: true, status: true },
    });

    if (!runner) {
      throw new NotFoundException(`Runner with ID ${runnerId} not found`);
    }

    if (runner.status === RunnerStatus.RUNNING) {
      throw new BadRequestException(
        `Runner ${runnerId} is running. Stop it before deleting.`,
      );
    }

    await this.runnerLogStorage.deleteRunnerLogs(runner.sourceId, runnerId);

    await this.prisma.$transaction(async (tx) => {
      await tx.runner.delete({ where: { id: runnerId } });

      const source = await tx.source.findUnique({
        where: { id: runner.sourceId },
        select: { currentRunnerId: true },
      });

      if (source?.currentRunnerId === runnerId) {
        await tx.source.update({
          where: { id: runner.sourceId },
          data: {
            currentRunnerId: null,
            runnerStatus: RunnerStatus.PENDING,
          },
        });
      }
    });

    return { message: 'Runner deleted' };
  }

  /**
   * Stop many runs at once, by explicit IDs or a search filter snapshot.
   *
   * Sequential on purpose: each stop tears down an execution, writes the
   * terminal transition and drains the queue, and per-run failures are
   * reported as skipped rather than failing the whole call.
   */
  async bulkStopRunners(selection: {
    ids?: string[];
    filters?: SearchRunnersRequestDto['filters'];
  }): Promise<{
    stoppedCount: number;
    ids: string[];
    skipped: Array<{ id: string; name: string; reason: string }>;
  }> {
    const runners = await this.resolveRunnerSelection(selection);

    const ids: string[] = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];
    for (const runner of runners) {
      try {
        await this.stopRunner(runner.id);
        ids.push(runner.id);
      } catch (error) {
        skipped.push({
          id: runner.id,
          name: runner.sourceName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { stoppedCount: ids.length, ids, skipped };
  }

  /**
   * Delete many scan records at once. In-flight (RUNNING) runs are never
   * deleted — stop them first — and are reported as skipped.
   */
  async bulkDeleteRunners(selection: {
    ids?: string[];
    filters?: SearchRunnersRequestDto['filters'];
  }): Promise<{
    deletedCount: number;
    ids: string[];
    skipped: Array<{ id: string; name: string; reason: string }>;
  }> {
    const runners = await this.resolveRunnerSelection(selection);

    const ids: string[] = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];
    for (const runner of runners) {
      try {
        await this.deleteRunner(runner.id);
        ids.push(runner.id);
      } catch (error) {
        skipped.push({
          id: runner.id,
          name: runner.sourceName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { deletedCount: ids.length, ids, skipped };
  }

  /**
   * Start a fresh run for the source of each selected scan. The old run is
   * history — a rerun never resumes it — so the new runs simply appear as
   * PENDING/RUNNING rows on the next table refresh.
   */
  async bulkRerunScans(
    selection: {
      ids?: string[];
      filters?: SearchRunnersRequestDto['filters'];
    },
    options?: { forceFullRescan?: boolean; triggeredBy?: string },
  ): Promise<{
    startedCount: number;
    ids: string[];
    skipped: Array<{ id: string; name: string; reason: string }>;
  }> {
    const runners = await this.resolveRunnerSelection(selection);

    const ids: string[] = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];
    // Sequential on purpose, mirroring bulkRunSources: startRun claims the
    // source and initialises log storage, and the queue absorbs the backlog.
    for (const runner of runners) {
      try {
        const started = await this.startRun(
          runner.sourceId,
          TriggerType.MANUAL,
          options?.triggeredBy?.trim() || 'bulk-rerun',
          options?.forceFullRescan === true,
        );
        ids.push(started.id);
      } catch (error) {
        skipped.push({
          id: runner.id,
          name: runner.sourceName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { startedCount: ids.length, ids, skipped };
  }

  /**
   * Resolve a bulk selection to the runs it names. Exactly one of `ids` or
   * `filters` must be given, mirroring the sources bulk endpoints.
   */
  private async resolveRunnerSelection(selection: {
    ids?: string[];
    filters?: SearchRunnersRequestDto['filters'];
  }): Promise<Array<{ id: string; sourceId: string; sourceName: string }>> {
    const hasIds = Boolean(selection.ids?.length);
    const hasFilters = selection.filters !== undefined;
    if (hasIds === hasFilters) {
      throw new BadRequestException(
        'Provide either runner ids or filters, but not both.',
      );
    }

    const runners = await this.prisma.runner.findMany({
      where: hasIds
        ? { id: { in: selection.ids } }
        : this.buildSearchRunnersWhere(selection.filters),
      select: {
        id: true,
        sourceId: true,
        source: { select: { name: true } },
      },
    });

    return runners.map((runner) => ({
      id: runner.id,
      sourceId: runner.sourceId,
      sourceName: runner.source?.name ?? runner.sourceId,
    }));
  }

  /**
   * Why a queued run has not started, in the terms the queue actually uses.
   *
   * The UI showed a PENDING run with no position and no reason, which is how a
   * run waiting behind another tenant's 13.9-hour sweep looked identical to one
   * about to start (field report P1). Deliberately a separate call rather than
   * a field on `getRunnerStatus`: that one is re-read on every websocket
   * update, and this counts rows in every namespace.
   */
  async getRunnerQueuePosition(runnerId: string): Promise<{
    runnerId: string;
    status: RunnerStatus;
    /** 1-based place in this workspace's own queue; null when not queued. */
    positionInNamespace: number | null;
    /** True when this run is in the lane that goes ahead of scheduled sweeps. */
    priority: boolean;
    runningNow: number;
    /** Concurrent scans this deployment allows. 0 means unlimited. */
    concurrencyLimit: number;
    reason: string | null;
  }> {
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: {
        id: true,
        status: true,
        sourceId: true,
        triggeredAt: true,
        triggerType: true,
      },
    });
    if (!runner) {
      throw new NotFoundException(`Runner with ID ${runnerId} not found`);
    }

    const concurrencyLimit = this.resolveMaxConcurrentRunners();
    if (runner.status !== RunnerStatus.PENDING) {
      return {
        runnerId,
        status: runner.status,
        positionInNamespace: null,
        priority: false,
        runningNow: 0,
        concurrencyLimit,
        reason: null,
      };
    }

    // Lane 0 is "someone is waiting at a screen": an operator-triggered run,
    // or a source that has never completed one. Same rule the queue applies.
    const hasCompleted = await this.prisma.runner.findFirst({
      where: { sourceId: runner.sourceId, status: RunnerStatus.COMPLETED },
      select: { id: true },
    });
    const priority =
      runner.triggerType === TriggerType.MANUAL ||
      runner.triggerType === TriggerType.API ||
      !hasCompleted;

    const [ahead, runningNow] = await Promise.all([
      this.prisma.runner.count({
        where: {
          status: RunnerStatus.PENDING,
          startedAt: null,
          triggeredAt: { lt: runner.triggeredAt },
        },
      }),
      this.countRunningRunners(),
    ]);

    // countRunningRunners answers MAX_SAFE_INTEGER when the cross-namespace
    // count fails, which is its way of saying "hold everything". Reporting
    // that number to a user would be worse than admitting it is unknown.
    const countKnown = runningNow < Number.MAX_SAFE_INTEGER;

    const parts: string[] = [];
    if (!countKnown) {
      parts.push('the instance-wide scan count is temporarily unreadable');
    } else if (concurrencyLimit > 0 && runningNow >= concurrencyLimit) {
      parts.push(
        `${runningNow} scan(s) running across the instance (limit ${concurrencyLimit})`,
      );
    }
    if (ahead > 0) {
      parts.push(`${ahead} run(s) queued ahead of it in this workspace`);
    }
    parts.push(
      priority
        ? 'it is in the priority lane, ahead of scheduled sweeps'
        : 'scheduled sweeps wait behind manual and first runs',
    );

    return {
      runnerId,
      status: runner.status,
      positionInNamespace: ahead + 1,
      priority,
      runningNow: countKnown ? runningNow : -1,
      concurrencyLimit,
      reason: parts.join('; '),
    };
  }

  getRunnerStatus(runnerId: string) {
    return this.prisma.runner.findUnique({
      where: { id: runnerId },
      include: {
        source: {
          select: { id: true, name: true, type: true },
        },
      },
    });
  }

  async getRunnerLogs(params: {
    runnerId: string;
    cursor?: string;
    take?: number | string;
    search?: string;
    levels?: string[];
    sortOrder?: 'asc' | 'desc';
    streams?: string[];
  }) {
    const runner = await this.prisma.runner.findUnique({
      where: { id: params.runnerId },
      select: { id: true, sourceId: true },
    });

    if (!runner) {
      throw new NotFoundException(
        `Runner with ID ${params.runnerId} not found`,
      );
    }

    return this.runnerLogStorage.listLogs({
      ...params,
      sourceId: runner.sourceId,
    });
  }

  private normalizeStringArray(value: unknown): string[] | undefined {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    const normalized = raw.map((entry) => String(entry).trim()).filter(Boolean);

    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  private normalizeEnumArray<T extends string>(
    value: unknown,
    allowed: readonly T[],
  ): T[] | undefined {
    const normalized = this.normalizeStringArray(value)
      ?.map((entry) => entry.toUpperCase())
      .filter((entry): entry is T => allowed.includes(entry as T));

    return normalized && normalized.length > 0
      ? Array.from(new Set(normalized))
      : undefined;
  }

  private normalizeDate(value: unknown): Date | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }

    const candidate = new Date(value);
    return Number.isNaN(candidate.getTime()) ? undefined : candidate;
  }

  private normalizeSortOrder(value: unknown): Prisma.SortOrder {
    if (typeof value === 'string' && value.toUpperCase() === 'ASC') {
      return 'asc';
    }

    return 'desc';
  }

  private normalizeSearchRunnersSortBy(
    value: unknown,
  ): SearchRunnersSortBy | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      return undefined;
    }

    const allowed = new Set<string>(Object.values(SearchRunnersSortBy));
    if (!allowed.has(normalized)) {
      return undefined;
    }

    return normalized as SearchRunnersSortBy;
  }

  private buildSearchRunnersOrderBy(params: {
    sortBy?: unknown;
    sortOrder?: unknown;
  }): Prisma.RunnerOrderByWithRelationInput[] {
    const normalizedSortBy = this.normalizeSearchRunnersSortBy(params.sortBy);
    if (!normalizedSortBy) {
      return [{ triggeredAt: 'desc' }, { id: 'asc' }];
    }

    const direction = this.normalizeSortOrder(params.sortOrder);

    let primary: Prisma.RunnerOrderByWithRelationInput;
    switch (normalizedSortBy) {
      case SearchRunnersSortBy.STATUS:
        primary = { status: direction };
        break;
      case SearchRunnersSortBy.SOURCE_NAME:
        primary = { source: { name: direction } };
        break;
      case SearchRunnersSortBy.DURATION_MS:
        primary = { durationMs: direction };
        break;
      case SearchRunnersSortBy.TOTAL_FINDINGS:
        primary = { totalFindings: direction };
        break;
      case SearchRunnersSortBy.TRIGGERED_AT:
      default:
        primary = { triggeredAt: direction };
        break;
    }

    const withStableFallback: Prisma.RunnerOrderByWithRelationInput[] = [
      primary,
    ];

    if (!('triggeredAt' in primary)) {
      withStableFallback.push({ triggeredAt: 'desc' });
    }

    withStableFallback.push({ id: 'asc' });

    return withStableFallback;
  }

  private buildSearchRunnersWhere(
    filters?: SearchRunnersRequestDto['filters'],
  ): Prisma.RunnerWhereInput {
    if (!filters) {
      return {};
    }

    const where: Prisma.RunnerWhereInput = {};

    const sourceIds = this.normalizeStringArray(filters.sourceId);
    if (sourceIds?.length) {
      where.sourceId = { in: sourceIds };
    }

    const sourceTypes = this.normalizeEnumArray(
      filters.sourceType,
      Object.values(AssetType),
    );
    if (sourceTypes?.length) {
      where.source = {
        is: {
          type: { in: sourceTypes },
        },
      };
    }

    const statuses = this.normalizeEnumArray(
      filters.status,
      Object.values(RunnerStatus),
    );
    if (statuses?.length) {
      where.status = { in: statuses };
    }

    const triggerTypes = this.normalizeEnumArray(
      filters.triggerType,
      Object.values(TriggerType),
    );
    if (triggerTypes?.length) {
      where.triggerType = { in: triggerTypes };
    }

    const triggeredBy = this.normalizeStringArray(filters.triggeredBy);
    if (triggeredBy?.length) {
      where.triggeredBy = { in: triggeredBy };
    }

    const triggeredAfter = this.normalizeDate(filters.triggeredAfter);
    const triggeredBefore = this.normalizeDate(filters.triggeredBefore);
    if (triggeredAfter || triggeredBefore) {
      where.triggeredAt = {};
      if (triggeredAfter) {
        where.triggeredAt.gte = triggeredAfter;
      }
      if (triggeredBefore) {
        where.triggeredAt.lte = triggeredBefore;
      }
    }

    const rawSearch = filters.search?.trim();
    if (rawSearch) {
      const upperSearch = rawSearch.toUpperCase();
      const orFilters: Prisma.RunnerWhereInput[] = [
        { id: { contains: rawSearch, mode: 'insensitive' } },
        { triggeredBy: { contains: rawSearch, mode: 'insensitive' } },
        { errorMessage: { contains: rawSearch, mode: 'insensitive' } },
        {
          source: {
            name: { contains: rawSearch, mode: 'insensitive' },
          },
        },
      ];

      if (Object.values(RunnerStatus).includes(upperSearch as RunnerStatus)) {
        orFilters.push({ status: upperSearch as RunnerStatus });
      }

      if (Object.values(TriggerType).includes(upperSearch as TriggerType)) {
        orFilters.push({ triggerType: upperSearch as TriggerType });
      }

      if (Object.values(AssetType).includes(upperSearch as AssetType)) {
        orFilters.push({ source: { type: upperSearch as AssetType } });
      }

      where.OR = orFilters;
    }

    return where;
  }

  private buildSearchRunnerSqlConditions(
    filters?: SearchRunnersRequestDto['filters'],
  ): Prisma.Sql[] {
    if (!filters) {
      return [];
    }

    const conditions: Prisma.Sql[] = [];

    const sourceIds = this.normalizeStringArray(filters.sourceId);
    if (sourceIds?.length) {
      conditions.push(Prisma.sql`r.source_id IN (${Prisma.join(sourceIds)})`);
    }

    const sourceTypes = this.normalizeEnumArray(
      filters.sourceType,
      Object.values(AssetType),
    );
    if (sourceTypes?.length) {
      conditions.push(Prisma.sql`s.type IN (${Prisma.join(sourceTypes)})`);
    }

    const statuses = this.normalizeEnumArray(
      filters.status,
      Object.values(RunnerStatus),
    );
    if (statuses?.length) {
      conditions.push(Prisma.sql`r.status IN (${Prisma.join(statuses)})`);
    }

    const triggerTypes = this.normalizeEnumArray(
      filters.triggerType,
      Object.values(TriggerType),
    );
    if (triggerTypes?.length) {
      conditions.push(
        Prisma.sql`r.trigger_type IN (${Prisma.join(triggerTypes)})`,
      );
    }

    const triggeredBy = this.normalizeStringArray(filters.triggeredBy);
    if (triggeredBy?.length) {
      conditions.push(
        Prisma.sql`r.triggered_by IN (${Prisma.join(triggeredBy)})`,
      );
    }

    const triggeredAfter = this.normalizeDate(filters.triggeredAfter);
    if (triggeredAfter) {
      conditions.push(Prisma.sql`r.triggered_at >= ${triggeredAfter}`);
    }

    const triggeredBefore = this.normalizeDate(filters.triggeredBefore);
    if (triggeredBefore) {
      conditions.push(Prisma.sql`r.triggered_at <= ${triggeredBefore}`);
    }

    const search = filters.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        Prisma.sql`(
          r.id::text ILIKE ${pattern}
          OR COALESCE(r.triggered_by, '') ILIKE ${pattern}
          OR COALESCE(r.error_message, '') ILIKE ${pattern}
          OR COALESCE(s.name, '') ILIKE ${pattern}
          OR COALESCE(s.type::text, '') ILIKE ${pattern}
        )`,
      );
    }

    return conditions;
  }

  private normalizeChartLimit(
    value: unknown,
    defaultValue: number,
    maxValue: number,
  ): number {
    const numericValue =
      typeof value === 'number' ? value : Number(value ?? defaultValue);
    if (!Number.isFinite(numericValue)) {
      return defaultValue;
    }

    return Math.min(maxValue, Math.max(1, Math.trunc(numericValue)));
  }

  private toInt(value: unknown): number {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'bigint'
          ? Number(value)
          : Number(value ?? 0);

    if (!Number.isFinite(numericValue)) {
      return 0;
    }

    return Math.trunc(numericValue);
  }

  private normalizeTextCoverage(value: unknown): TextCoverageStats | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const source = value as Record<string, unknown>;
    return {
      extracted: this.toInt(source.extracted),
      empty: this.toInt(source.empty),
      engineUnavailable: this.toInt(source.engineUnavailable),
      zeroFrames: this.toInt(source.zeroFrames),
      failed: this.toInt(source.failed),
      notApplicable: this.toInt(source.notApplicable),
      unknown: this.toInt(source.unknown),
    };
  }

  private formatDateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async searchRunners(request: SearchRunnersRequestDto) {
    const page = request?.page ?? {};
    const skip = Number(page.skip ?? 0);
    const limit = Number(page.limit ?? 50);
    const safeSkip = Number.isFinite(skip) ? Math.max(0, skip) : 0;
    const safeLimit = Number.isFinite(limit)
      ? Math.min(200, Math.max(1, limit))
      : 50;

    const where = this.buildSearchRunnersWhere(request?.filters);
    const orderBy = this.buildSearchRunnersOrderBy({
      sortBy: page.sortBy,
      sortOrder: page.sortOrder,
    });

    // Promise.all, not $transaction: a paginated list + its count need no
    // snapshot isolation, and the transaction wrapper made the pair fail as one
    // unit with P2028 whenever the pool was momentarily busy.
    const [items, total] = await Promise.all([
      this.prisma.runner.findMany({
        where,
        include: {
          source: {
            select: { id: true, name: true, type: true },
          },
        },
        orderBy,
        skip: safeSkip,
        take: safeLimit,
      }),
      this.prisma.runner.count({ where }),
    ]);

    const normalizedItems = items.map((item) => ({
      ...item,
      textCoverage: this.normalizeTextCoverage(item.textCoverage),
      errorDetails:
        item.errorDetails &&
        typeof item.errorDetails === 'object' &&
        !Array.isArray(item.errorDetails)
          ? (item.errorDetails as Record<string, unknown>)
          : null,
      cohortYield:
        item.cohortYield &&
        typeof item.cohortYield === 'object' &&
        !Array.isArray(item.cohortYield)
          ? (item.cohortYield as Record<string, unknown>)
          : null,
    }));

    return {
      items: normalizedItems,
      total,
      skip: safeSkip,
      limit: safeLimit,
    };
  }

  async searchRunnersCharts(
    request: SearchRunnersChartsRequestDto,
  ): Promise<SearchRunnersChartsResponseDto> {
    const windowDays = request.windowDays ?? 30;
    const topSourcesLimit = this.normalizeChartLimit(
      request?.options?.topSourcesLimit,
      10,
      50,
    );

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));
    windowStart.setUTCHours(0, 0, 0, 0);

    const conditions = this.buildSearchRunnerSqlConditions(request.filters);
    const whereClause =
      conditions.length > 0
        ? Prisma.sql`${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql`TRUE`;

    const [totalsRows, timelineRows, topSourceRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          totalRuns: number | string;
          running: number | string;
          queued: number | string;
          completed: number | string;
          warning: number | string;
          failed: number | string;
        }>
      >(Prisma.sql`
        SELECT
          COUNT(*)::int AS "totalRuns",
          COUNT(*) FILTER (WHERE r.status = 'RUNNING')::int AS "running",
          COUNT(*) FILTER (WHERE r.status = 'PENDING')::int AS "queued",
          COUNT(*) FILTER (WHERE r.status = 'COMPLETED')::int AS "completed",
          COUNT(*) FILTER (WHERE r.status = 'WARNING')::int AS "warning",
          COUNT(*) FILTER (WHERE r.status = 'ERROR')::int AS "failed"
        FROM runners r
        INNER JOIN sources s ON s.id = r.source_id
        WHERE ${whereClause}
      `),
      this.prisma.$queryRaw<
        Array<{
          date: string;
          total: number | string;
          running: number | string;
          queued: number | string;
          completed: number | string;
          warning: number | string;
          failed: number | string;
        }>
      >(Prisma.sql`
        SELECT
          TO_CHAR(DATE_TRUNC('day', r.triggered_at), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE r.status = 'RUNNING')::int AS running,
          COUNT(*) FILTER (WHERE r.status = 'PENDING')::int AS queued,
          COUNT(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE r.status = 'WARNING')::int AS warning,
          COUNT(*) FILTER (WHERE r.status = 'ERROR')::int AS failed
        FROM runners r
        INNER JOIN sources s ON s.id = r.source_id
        WHERE ${whereClause} AND r.triggered_at >= ${windowStart}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      this.prisma.$queryRaw<
        Array<{
          sourceId: string;
          sourceName: string | null;
          runs: number | string;
          findings: number | string;
          assets: number | string;
        }>
      >(Prisma.sql`
        SELECT
          r.source_id AS "sourceId",
          COALESCE(s.name, 'Unknown source') AS "sourceName",
          COUNT(*)::int AS runs,
          COALESCE(SUM(r.total_findings), 0)::int AS findings,
          COALESCE(SUM(
            r.assets_created
            + r.assets_updated
            + r.assets_unchanged
          ), 0)::int AS assets
        FROM runners r
        INNER JOIN sources s ON s.id = r.source_id
        WHERE ${whereClause}
        GROUP BY r.source_id, s.name
        ORDER BY runs DESC, findings DESC, assets DESC
        LIMIT ${topSourcesLimit}
      `),
    ]);

    const totalsRow = totalsRows[0];
    const totals = {
      totalRuns: this.toInt(totalsRow?.totalRuns),
      running: this.toInt(totalsRow?.running),
      queued: this.toInt(totalsRow?.queued),
      completed: this.toInt(totalsRow?.completed),
      warning: this.toInt(totalsRow?.warning),
      failed: this.toInt(totalsRow?.failed),
    };

    const timelineMap = new Map<
      string,
      {
        total: number;
        running: number;
        queued: number;
        completed: number;
        warning: number;
        failed: number;
      }
    >();

    for (let i = 0; i < windowDays; i++) {
      const day = new Date(windowStart);
      day.setUTCDate(day.getUTCDate() + i);
      timelineMap.set(this.formatDateKey(day), {
        total: 0,
        running: 0,
        queued: 0,
        completed: 0,
        warning: 0,
        failed: 0,
      });
    }

    for (const row of timelineRows) {
      const existing = timelineMap.get(row.date);
      if (!existing) {
        continue;
      }
      existing.total = this.toInt(row.total);
      existing.running = this.toInt(row.running);
      existing.queued = this.toInt(row.queued);
      existing.completed = this.toInt(row.completed);
      existing.warning = this.toInt(row.warning);
      existing.failed = this.toInt(row.failed);
    }

    const timeline = Array.from(timelineMap.entries()).map(
      ([date, values]) => ({
        date,
        ...values,
      }),
    );

    const topSources = topSourceRows.map((row) => ({
      sourceId: row.sourceId,
      sourceName: row.sourceName ?? 'Unknown source',
      runs: this.toInt(row.runs),
      findings: this.toInt(row.findings),
      assets: this.toInt(row.assets),
    }));

    return {
      totals,
      timeline,
      topSources,
    };
  }

  async listRunners(params: {
    sourceId?: string;
    status?: RunnerStatus;
    skip?: number;
    take?: number;
  }) {
    // Ensure skip and take are integers (query params come as strings)
    const skip =
      typeof params.skip === 'string'
        ? parseInt(params.skip, 10)
        : (params.skip ?? 0);
    const take =
      typeof params.take === 'string'
        ? parseInt(params.take, 10)
        : (params.take ?? 20);
    const { sourceId, status } = params;

    const where: any = {};
    if (sourceId) where.sourceId = sourceId;
    if (status) where.status = status;

    const [runners, total] = await Promise.all([
      this.prisma.runner.findMany({
        where,
        include: {
          source: {
            select: { id: true, name: true, type: true },
          },
        },
        orderBy: { triggeredAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.runner.count({ where }),
    ]);

    return { runners, total, skip, take };
  }

  /**
   * How many scans this machine may run at once. 0 means unlimited.
   *
   * Deployment-wide rather than per-workspace: two scans contend for the same
   * cores whichever workspace started them, so the budget belongs to whoever
   * owns the machine. `MAX_CONCURRENT_RUNNERS` is set by the Helm chart on
   * Kubernetes, and derived from the container's CPU and memory limits by the
   * all-in-one image (docker/entrypoint.sh) — it used to also be a
   * per-workspace row in instance_settings, but that control was inert on
   * every real deployment because the environment variable always won.
   */
  private resolveMaxConcurrentRunners(): number {
    const raw = process.env.MAX_CONCURRENT_RUNNERS;
    if (raw && raw.trim() !== '') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return DEFAULT_MAX_CONCURRENT_RUNNERS;
  }

  private async canStartNewRunner(): Promise<boolean> {
    const limit = this.resolveMaxConcurrentRunners();
    if (limit === 0) return true;
    return (await this.countRunningRunners()) < limit;
  }

  /**
   * Running scans across the whole deployment, not just the calling namespace.
   *
   * `this.prisma` is a CLS-resolving proxy onto the current tenant's schema, so
   * counting through it answered "runners running in THIS workspace" while the
   * limit it was compared against was documented as instance-wide. Four
   * workspaces turned MAX_CONCURRENT_RUNNERS=2 into eight concurrent scans on
   * one node -- the cap read as enforced right up until the node died.
   *
   * Falls back to the scoped count when the registry is absent (single-host, unit
   * tests), where there is exactly one schema and the two agree by construction.
   */
  private async countRunningRunners(): Promise<number> {
    if (this.namespaceRegistry) {
      try {
        return await this.namespaceRegistry.countRowsAcrossNamespaces(
          'runners',
          `status = '${RunnerStatus.RUNNING}'`,
        );
      } catch (error) {
        // Deliberately not falling through to the scoped count: that would
        // under-report and let the cap be exceeded exactly when the database is
        // already struggling. Refusing to start more work is the safe answer.
        this.logger.warn(
          `Cross-namespace runner count failed, holding new runners: ${String(error)}`,
        );
        return Number.MAX_SAFE_INTEGER;
      }
    }
    return this.prisma.runner.count({
      where: { status: RunnerStatus.RUNNING },
    });
  }

  /**
   * Start queued runs while there is capacity. Public for the adaptive
   * scheduler's tick, which is where a queue that lost its promotion — a
   * restart, a crash between completion and dequeue — gets noticed.
   *
   * Promotes until the slots are full or the queue is empty. This used to
   * promote one run per call, which is enough where one slot frees at a time
   * (a completion, a failure, a stop), but a restart frees several at once --
   * every local scan dies with the process -- and one promotion left the other
   * slots idle while runs waited. Each claim counts against the cap as soon as
   * it is made, so the loop ends on its own; the bound only matters when the
   * cross-namespace count under-reports, as it does for a schema whose count
   * query fails.
   */
  async promotePendingRunners(): Promise<void> {
    const limit = this.resolveMaxConcurrentRunners();
    for (let promoted = 0; limit === 0 || promoted < limit; promoted += 1) {
      if (!(await this.dequeueNextPendingRunner())) return;
    }
  }

  /**
   * Promote the next runner from ANY namespace. Resolves whether one was
   * claimed.
   *
   * The cap is instance-wide, so the queue must be too: promoting only from the
   * namespace whose run just finished stranded every other namespace's queue.
   * Which run comes next is the registry's fairness policy — lane first, then
   * the namespace served longest ago (see `preferQueued`) — not whichever
   * ticket happens to be oldest, which let one tenant's re-enqueuing sweep
   * hold every slot (field report P1).
   *
   * The claim and launch then run inside the queued runner's own namespace
   * context, exactly as a same-namespace dequeue always did.
   */
  private async dequeueNextPendingRunner(): Promise<boolean> {
    if (!this.namespaceRegistry || !this.cls) {
      return this.dequeuePendingRunnerInCurrentNamespace();
    }
    if (!(await this.canStartNewRunner())) return false;

    let next: Awaited<
      ReturnType<NamespaceRegistryService['findNextPendingRunner']>
    >;
    try {
      next = await this.namespaceRegistry.findNextPendingRunner();
    } catch (error) {
      this.logger.warn(
        `Cross-namespace pending lookup failed, dequeuing locally: ${String(error)}`,
      );
      return this.dequeuePendingRunnerInCurrentNamespace();
    }
    if (!next) return false;

    const target = next;
    if (this.cls.get<string>(CLS_SCHEMA) === target.namespace.schemaName) {
      return this.dequeuePendingRunnerInCurrentNamespace(target.runnerId);
    }
    const cls = this.cls;
    return cls.run(() => {
      cls.set(CLS_SCHEMA, target.namespace.schemaName);
      cls.set(CLS_NAMESPACE_ID, target.namespace.id);
      cls.set(CLS_SLUG, target.namespace.slug);
      cls.set(CLS_DATABASE_LANE, 'background');
      return this.dequeuePendingRunnerInCurrentNamespace(target.runnerId);
    });
  }

  private async dequeuePendingRunnerInCurrentNamespace(
    runnerId?: string,
  ): Promise<boolean> {
    const schema = this.cls?.get<string>(CLS_SCHEMA);
    if (schema && this.stoppingSchemas.has(schema)) return false;
    if (!(await this.canStartNewRunner())) return false;

    const pending = await this.prisma.runner.findFirst({
      where: {
        status: RunnerStatus.PENDING,
        startedAt: null,
        ...(runnerId ? { id: runnerId } : {}),
      },
      orderBy: { triggeredAt: 'asc' },
      include: { source: true },
    });
    if (!pending) return false;

    const claimed = await this.prisma.runner.updateMany({
      where: { id: pending.id, status: RunnerStatus.PENDING },
      // startedAt is stamped by the claim rather than left to executeCliAsync,
      // which rewrites it once the execution really begins. The claim makes the
      // row RUNNING several awaits before any execution exists to vouch for it,
      // and the launch grace that covers that gap measures from startedAt --
      // falling back to triggeredAt, which for a queued run is however long it
      // sat in the queue. A reconcile landing mid-launch therefore failed any
      // run that had waited more than two minutes, before it ever started.
      data: { status: RunnerStatus.RUNNING, startedAt: new Date() },
    });
    if (claimed.count !== 1) return false;

    try {
      const source = pending.source;
      const decryptedConfig = this.toDecryptedRecipeConfig(source.config);
      const recipeWithFeedback = await this.hydrateCustomDetectorsForRun(
        source.id,
        decryptedConfig,
      );
      const sourceWithDecryptedConfig = {
        ...source,
        config: recipeWithFeedback,
      };
      await this.runnerLogStorage.initializeRunner(source.id, pending.id);

      const hasSuccessfulRuns = !!(await this.prisma.runner.findFirst({
        where: { sourceId: source.id, status: RunnerStatus.COMPLETED },
        select: { id: true },
      }));

      this.logger.log(
        `Dequeued pending runner ${pending.id} for source ${source.id}`,
      );

      this.startTrackedExecution(
        pending.id,
        sourceWithDecryptedConfig,
        hasSuccessfulRuns,
      );
    } catch (error) {
      this.logger.error(
        `Failed to dequeue runner ${pending.id}: ${String(error)}`,
      );
      await this.failRunner(pending.id, String(error), { source: 'dequeue' });
    }
    // Claimed either way: a failed launch has still taken the runner out of
    // the queue, and its slot is free again for the next one.
    return true;
  }

  async searchRunnerAssets(
    request: SearchRunnersAssetsRequestDto,
  ): Promise<SearchRunnersAssetsResponseDto> {
    const { filters, page } = request;
    const skip = Math.max(0, Number(page?.skip ?? 0));
    const limit = Math.min(200, Math.max(1, Number(page?.limit ?? 50)));
    const sortBy = page?.sortBy ?? SearchRunnersAssetsSortBy.STATUS_PRIORITY;
    const sortOrder = page?.sortOrder ?? SearchRunnersAssetsSortOrder.ASC;

    const where: Prisma.RunnerAssetWhereInput = {
      runnerId: filters.runnerId,
      ...(filters.status?.length ? { status: { in: filters.status } } : {}),
      ...(filters.search?.trim()
        ? {
            assetHash: { contains: filters.search.trim(), mode: 'insensitive' },
          }
        : {}),
    };

    let runnerAssets: Awaited<
      ReturnType<typeof this.prisma.runnerAsset.findMany>
    >;
    let total = 0;

    if (sortBy === SearchRunnersAssetsSortBy.STATUS_PRIORITY) {
      const statusPriorityOrder = `CASE status
        WHEN 'PROCESSING' THEN 1
        WHEN 'ERROR' THEN 2
        WHEN 'PENDING' THEN 3
        WHEN 'PROCESSED' THEN 4
        ELSE 5
      END`;
      const secondaryDir =
        sortOrder === SearchRunnersAssetsSortOrder.DESC ? 'DESC' : 'ASC';

      const conditions: string[] = [];
      const params: unknown[] = [];

      conditions.push(`runner_id = $${params.length + 1}`);
      params.push(filters.runnerId);

      if (filters.status?.length) {
        const placeholders = filters.status.map(
          (_, i) => `$${params.length + i + 1}::"RunnerAssetStatus"`,
        );
        conditions.push(`status IN (${placeholders.join(', ')})`);
        params.push(...filters.status);
      }

      if (filters.search?.trim()) {
        conditions.push(`asset_hash ILIKE $${params.length + 1}`);
        params.push(`%${filters.search.trim()}%`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await this.prisma.$queryRawUnsafe<
        [{ count: bigint }]
      >(
        `SELECT COUNT(*) AS count FROM runner_assets WHERE ${whereClause}`,
        ...params,
      );
      total = Number(countResult[0]?.count ?? 0);

      params.push(limit, skip);
      const rawRows = await this.prisma.$queryRawUnsafe<
        Array<{
          runner_id: string;
          asset_hash: string;
          status: string;
          started_at: Date | null;
          completed_at: Date | null;
          error_message: string | null;
          findings_total: number | null;
          findings_by_severity: Record<string, number> | null;
          findings_by_detector: Record<string, number> | null;
          metadata: Prisma.JsonValue;
          detector_outcomes: Prisma.JsonValue;
          change_type: RunnerAssetChangeType | null;
          empty_text: boolean | null;
          text_extraction_status: TextExtractionStatus | null;
          cache_hit: boolean;
          created_at: Date;
        }>
      >(
        `SELECT * FROM runner_assets
         WHERE ${whereClause}
         ORDER BY ${statusPriorityOrder}, created_at ${secondaryDir}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      );
      runnerAssets = rawRows.map((row) => ({
        runnerId: row.runner_id,
        assetHash: row.asset_hash,
        status: row.status as any,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
        findingsTotal: row.findings_total,
        findingsBySeverity: row.findings_by_severity,
        findingsByDetector: row.findings_by_detector,
        metadata: row.metadata,
        detectorOutcomes: row.detector_outcomes,
        changeType: row.change_type,
        emptyText: row.empty_text,
        textExtractionStatus: row.text_extraction_status,
        cacheHit: row.cache_hit,
        createdAt: row.created_at,
      }));
    } else {
      const orderDir =
        sortOrder === SearchRunnersAssetsSortOrder.DESC ? 'desc' : 'asc';
      const orderBy: Prisma.RunnerAssetOrderByWithRelationInput =
        sortBy === SearchRunnersAssetsSortBy.STATUS
          ? { status: orderDir }
          : sortBy === SearchRunnersAssetsSortBy.ASSET_HASH
            ? { assetHash: orderDir }
            : sortBy === SearchRunnersAssetsSortBy.COMPLETED_AT
              ? { completedAt: orderDir }
              : sortBy === SearchRunnersAssetsSortBy.FINDINGS_TOTAL
                ? { findingsTotal: orderDir }
                : { createdAt: orderDir };

      const [rows, count] = await Promise.all([
        this.prisma.runnerAsset.findMany({ where, orderBy, skip, take: limit }),
        this.prisma.runnerAsset.count({ where }),
      ]);
      runnerAssets = rows;
      total = count;
    }

    if (runnerAssets.length === 0) {
      return { items: [], total: total ?? 0, skip, limit };
    }

    const hashes = [...new Set(runnerAssets.map((ra) => ra.assetHash))];
    const assets = await this.prisma.asset.findMany({
      where: { hash: { in: hashes } },
      select: {
        id: true,
        hash: true,
        name: true,
        externalUrl: true,
        links: true,
        checksum: true,
        assetType: true,
        sourceType: true,
        sourceId: true,
        runnerId: true,
        lastScannedAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    });

    const assetByHash = new Map(assets.map((a) => [a.hash, a]));

    const asMetadata = (value: unknown): Record<string, unknown> | null =>
      value != null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

    const items = runnerAssets.map((ra) => {
      const asset = assetByHash.get(ra.assetHash) ?? null;

      return {
        runnerId: ra.runnerId,
        assetHash: ra.assetHash,
        status: ra.status,
        startedAt: ra.startedAt,
        completedAt: ra.completedAt,
        errorMessage: ra.errorMessage,
        textExtractionStatus: ra.textExtractionStatus,
        createdAt: ra.createdAt,
        findingsTotal: ra.findingsTotal ?? null,
        findingsBySeverity:
          ra.findingsBySeverity != null &&
          typeof ra.findingsBySeverity === 'object' &&
          !Array.isArray(ra.findingsBySeverity)
            ? (ra.findingsBySeverity as Record<string, number>)
            : null,
        findingsByDetector:
          ra.findingsByDetector != null &&
          typeof ra.findingsByDetector === 'object' &&
          !Array.isArray(ra.findingsByDetector)
            ? (ra.findingsByDetector as Record<string, Record<string, number>>)
            : null,
        metadata: asMetadata(ra.metadata) ?? asMetadata(asset?.metadata),
        asset: asset
          ? {
              id: asset.id,
              hash: asset.hash,
              checksum: asset.checksum,
              name: asset.name ?? '',
              externalUrl: asset.externalUrl ?? '',
              links: asset.links as string[],
              assetType: asset.assetType,
              sourceType: asset.sourceType,
              sourceId: asset.sourceId,
              runnerId: asset.runnerId ?? null,
              lastScannedAt: asset.lastScannedAt ?? null,
              status: asset.status,
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt,
              metadata: asMetadata(asset.metadata) ?? undefined,
            }
          : null,
      };
    });

    return { items, total, skip, limit };
  }
}
