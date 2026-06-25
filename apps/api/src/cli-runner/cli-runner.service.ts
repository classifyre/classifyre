import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
  Inject,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { PrismaService } from '../prisma.service';
import { RunnerEventsGateway } from '../websocket/runner-events.gateway';
import { PgBossService } from '../scheduler/pg-boss.service';
import { INQUIRY_MATCH_QUEUE } from '../matching/matching.constants';
import { CORRELATION_QUEUE } from '../correlation/correlation.constants';
import {
  AssetType,
  Prisma,
  RunnerExecutionMode,
  RunnerAssetStatus,
  RunnerStatus,
  Source,
  TriggerType,
  Severity,
  AssetStatus,
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
import { KubernetesCliJobService } from './kubernetes-cli-job.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { RunnerLogStorageService } from './runner-log-storage.service';
import { CustomDetectorsService } from '../custom-detectors.service';
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

type SourceRunSnapshot = {
  runnerStatus: RunnerStatus | null;
  currentRunnerId: string | null;
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
]);

@Injectable()
export class CliRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CliRunnerService.name);
  private runningProcessesByRunnerId = new Map<string, ChildProcess>();

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
  ) {}

  /**
   * Tell the question-matching engine a source finished ingesting. Decoupled from
   * ingestion: we only drop a pg-boss message (singletonKey dedupes rapid
   * completions). Never let a matching failure break run completion.
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
        { singletonKey: sourceId },
      );
      // Correlation (DUPLICATES FINDER AGENT) for the same scan — runs the
      // deterministic duplicate detection and then hands off to the autopilot
      // cycle, so inquiry/case agents can consider the duplicate/cluster
      // results. singletonKey debounces rapid rescans.
      await boss.send(
        CORRELATION_QUEUE,
        { sourceId, runnerId },
        {
          singletonKey: `correlation:${sourceId}`,
          retryLimit: 2,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3 * 3600,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue question matching for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const inFlightRunners = await this.prisma.runner.findMany({
      where: {
        status: {
          in: [RunnerStatus.PENDING, RunnerStatus.RUNNING],
        },
      },
      select: {
        id: true,
        sourceId: true,
        status: true,
        executionMode: true,
        jobName: true,
        jobNamespace: true,
      },
    });

    let recoveredRunners = 0;
    let preservedActiveRunners = 0;

    for (const runner of inFlightRunners) {
      if (await this.isRunnerExecutionActive(runner)) {
        preservedActiveRunners += 1;
        continue;
      }

      recoveredRunners += 1;
      await this.markRunnerAsOrphaned(
        runner.id,
        runner.sourceId,
        runner.status === RunnerStatus.PENDING
          ? 'Runner was left pending during application restart'
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

    void this.dequeueNextPendingRunner();
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
          this.logger.warn(
            `Failed to reconcile Kubernetes runner ${runner.id}: ${String(error)}`,
          );
          return false;
        }
      }
      case RunnerExecutionMode.EXTERNAL:
        this.logger.warn(
          `Leaving external runner ${runner.id} in-flight on startup; no heartbeat is available for reconciliation`,
        );
        return true;
      case RunnerExecutionMode.LOCAL:
      default:
        return false;
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

      if (await this.isRunnerExecutionActive(runner)) {
        continue;
      }

      repairedSources += 1;
      await this.markRunnerAsOrphaned(
        runner.id,
        source.id,
        runner.status === RunnerStatus.PENDING
          ? 'Runner was left pending during application restart'
          : 'Runner execution could not be reconciled after restart',
      );
    }

    return repairedSources;
  }

  async startRun(
    sourceId: string,
    triggerType: TriggerType = TriggerType.MANUAL,
    triggeredBy?: string,
  ) {
    const executionMode = this.resolveManagedExecutionMode();
    const { source, runner, hasSuccessfulRuns, previousSourceState } =
      await this.prisma.$transaction(async (tx) => {
        const { source, previousSourceState, hasSuccessfulRuns } =
          await this.claimSourceForRunnerCreation(tx, sourceId);

        const runner = await tx.runner.create({
          data: {
            sourceId,
            triggerType,
            triggeredBy,
            status: RunnerStatus.PENDING,
            executionMode,
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
        config: recipeWithFeedback,
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

    void this.executeCliAsync(
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

    // Merge both sets, deduplicating by key (key-based wins over id-based).
    const seenKeys = new Set<string>();
    const allRuntimeCustomDetectors = [
      ...runtimeByKeys,
      ...runtimeByIds,
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
    const { runner, previousSourceState } = await this.prisma.$transaction(
      async (tx) => {
        const { previousSourceState } = await this.claimSourceForRunnerCreation(
          tx,
          sourceId,
        );

        const runner = await tx.runner.create({
          data: {
            sourceId,
            triggerType: TriggerType.MANUAL,
            triggeredBy,
            status: RunnerStatus.RUNNING,
            startedAt: new Date(),
            executionMode: RunnerExecutionMode.EXTERNAL,
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

      const environment = process.env.ENVIRONMENT || 'development';
      if (this.isKubernetesExecutionEnabled(environment)) {
        await this.executeCliInKubernetes(runnerId, source, hasSuccessfulRuns);
      } else {
        await this.executeCliLocally(
          runnerId,
          source,
          environment,
          hasSuccessfulRuns,
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
  ): Promise<void> {
    const cliPath = this.getCliPath(environment);
    const venvPath = this.getVenvPath(environment);
    const recipeFile = await this.createTempRecipeFile(source.config);

    try {
      const outputRestUrl =
        this.resolveOutputRestUrl(environment) || 'http://localhost:8000';
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
  ): Promise<void> {
    if (!this.kubernetesCliJobService) {
      throw new Error('Kubernetes CLI Job service is not available');
    }

    const result = await this.kubernetesCliJobService.runExtractJob(
      runnerId,
      source.id,
      source.config,
      this.resolveOutputRestUrl('kubernetes'),
      hasSuccessfulRuns,
      (chunk) => this.appendLog(runnerId, chunk, 'combined'),
      ({ jobName, namespace }) =>
        this.persistKubernetesExecutionIdentity(runnerId, jobName, namespace),
      this.encodeSamplingCursor(source),
    );
    const output = result.output || '';
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
    const defaultDockerCliPath = '/app/cli';

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
      case 'desktop':
        return resolveCliPath(configuredPath || defaultDevelopmentCliPath);
      case 'docker':
        return resolveCliPath(configuredPath || defaultDockerCliPath);
      case 'kubernetes':
        throw new Error('Kubernetes mode not implemented yet');
      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }

  private getVenvPath(environment: string): string {
    const cliPath = this.getCliPath(environment);
    return path.join(cliPath, '.venv');
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
    const escapedVenvPython = this.shellEscape(
      path.join(venvPath, 'bin/python'),
    );
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
      `uv run --locked --python ${escapedVenvPython} ` +
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
  ): string {
    const escapedCliPath = this.shellEscape(cliPath);
    const escapedVenvPython = this.shellEscape(
      path.join(venvPath, 'bin/python'),
    );
    return (
      `cd ${escapedCliPath} && ` +
      `uv run --locked --python ${escapedVenvPython} ` +
      `python -m src.main test ${this.shellEscape(recipeFile)}`
    );
  }

  private resolveOutputRestUrl(environment: string): string | undefined {
    const explicit =
      process.env.CLI_OUTPUT_REST_URL ||
      process.env.CLASSIFYRE_OUTPUT_REST_URL ||
      process.env.CLASSIFYRE_INTERNAL_API_URL;
    if (explicit) {
      return explicit;
    }

    if (environment === 'docker') {
      return 'http://127.0.0.1:8000';
    }
    if (environment === 'desktop') {
      const port = process.env.PORT || '8000';
      return `http://127.0.0.1:${port}`;
    }
    if (environment === 'development') {
      return 'http://localhost:8000';
    }
    return undefined;
  }

  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  async testConnection(sourceId: string): Promise<Record<string, any>> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
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
      const command = this.buildCliTestCommand(cliPath, venvPath, recipeFile);
      const { stdout, stderr, exitCode } = await this.executeCli(
        command,
        (chunk) => {
          const trimmed = chunk.trim();
          if (trimmed) {
            this.logger.log(`[CLI test] ${trimmed}`);
          }
        },
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
    );
    const output = result.output || '';
    const lines = output.split(/\r?\n/);

    let payload: Record<string, any> = {
      status: result.exitCode === 0 ? 'SUCCESS' : 'FAILURE',
      message:
        result.exitCode === 0
          ? 'Connection test completed.'
          : 'Connection test failed.',
    };

    const nonJsonLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as Record<string, any>;
        }
      } catch {
        nonJsonLines.push(trimmed);
      }
    }

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

  private executeCli(
    command: string,
    onStderr: (chunk: string) => void,
    onStdout?: (chunk: string) => void,
    runnerId?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        detached: process.platform !== 'win32',
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
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
        stderr += chunk;

        // Log all stderr to API console for monitoring
        this.logger.log(`[CLI] ${chunk.trim()}`);

        onStderr(chunk);
      });

      child.on('close', (code) => {
        if (runnerId) {
          this.runningProcessesByRunnerId.delete(runnerId);
        }
        resolve({ stdout, stderr, exitCode: code || 0 });
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

  private async computeRunnerStats(runnerId: string): Promise<{
    assetsCreated: number;
    assetsUpdated: number;
    assetsUnchanged: number;
    totalFindings: number;
  }> {
    const [assetsCreated, assetsUpdated, assetsUnchanged, totalFindings] =
      await Promise.all([
        this.prisma.asset.count({
          where: { runnerId, status: AssetStatus.NEW },
        }),
        this.prisma.asset.count({
          where: { runnerId, status: AssetStatus.UPDATED },
        }),
        this.prisma.asset.count({
          where: { runnerId, status: AssetStatus.UNCHANGED },
        }),
        this.prisma.finding.count({ where: { runnerId } }),
      ]);

    return {
      assetsCreated,
      assetsUpdated,
      assetsUnchanged,
      totalFindings,
    };
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
    const { assetsCreated, assetsUpdated, assetsUnchanged, totalFindings } =
      await this.computeRunnerStats(runnerId);

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

        const [errorCount, totalCount] = await Promise.all([
          tx.runnerAsset.count({
            where: { runnerId, status: RunnerAssetStatus.ERROR },
          }),
          tx.runnerAsset.count({ where: { runnerId } }),
        ]);

        const hasErrors = errorCount > 0;
        const status = hasErrors
          ? RunnerStatus.WARNING
          : RunnerStatus.COMPLETED;
        const message = hasErrors
          ? `${errorCount} of ${totalCount} assets failed processing`
          : undefined;

        await tx.runner.update({
          where: { id: runnerId },
          data: {
            status,
            completedAt,
            durationMs,
            assetsCreated,
            assetsUpdated,
            assetsUnchanged,
            totalFindings,
            ...(message && { errorMessage: message }),
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
        lastErrorMessage: warningMessage ?? null,
      },
    });

    // Emit WebSocket event for runner completed
    const runnerDto = await this.getRunnerStatus(runnerId);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    // Kick the question-matching engine for this source (fire-and-forget).
    await this.enqueueQuestionMatching(runner.sourceId, runnerId);

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

  private async failRunner(
    runnerId: string,
    errorMessage: string,
    errorDetails: any,
  ) {
    const normalizedMessage =
      typeof errorMessage === 'string' && errorMessage.trim().length > 0
        ? errorMessage.slice(0, 4000)
        : 'Unknown error';
    const normalizedDetails = this.toSerializableErrorDetails(errorDetails);

    const errorDetailsForDb:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput =
      normalizedDetails === null
        ? Prisma.JsonNull
        : (normalizedDetails as Prisma.InputJsonValue);

    const runnerRef = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { sourceId: true },
    });
    if (!runnerRef) {
      this.logger.warn(`Runner ${runnerId} disappeared before it could fail`);
      return;
    }

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
  ): Promise<{ registered: number }> {
    if (!assetHashes.length) return { registered: 0 };

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { id: true },
    });
    if (!runner) {
      throw new NotFoundException(`Runner ${runnerId} not found`);
    }

    const result = await this.prisma.runnerAsset.createMany({
      data: assetHashes.map((hash) => ({
        runnerId,
        assetHash: hash,
        status: RunnerAssetStatus.PENDING,
      })),
      skipDuplicates: true,
    });

    return { registered: result.count };
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
            errorMessage: isProcessing
              ? undefined
              : update.errorMessage?.slice(0, 4000),
            ...(update.findingsTotal !== undefined && {
              findingsTotal: update.findingsTotal,
            }),
            ...(update.findingsBySeverity !== undefined && {
              findingsBySeverity: update.findingsBySeverity,
            }),
            ...(update.findingsByDetector !== undefined && {
              findingsByDetector: update.findingsByDetector,
            }),
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

    if (runner.status !== RunnerStatus.RUNNING) {
      throw new Error(
        `Runner ${runnerId} is not running (status: ${runner.status})`,
      );
    }

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

    await this.runnerLogStorage
      .finalizeRunner(runner.sourceId, runnerId)
      .catch((err) => {
        this.logger.warn(
          `Failed to finalize logs for runner ${runnerId}: ${String(err)}`,
        );
      });
    await this.transitionRunnerToTerminalState({
      runnerId,
      sourceId: runner.sourceId,
      sourceStatus: RunnerStatus.ERROR,
      runnerData: {
        status: RunnerStatus.ERROR,
        completedAt: new Date(),
        errorMessage: 'Manually stopped',
      },
    });

    // Emit WebSocket event for runner stopped
    const runnerDto = await this.getRunnerStatus(runnerId);
    if (runnerDto && this.runnerEventsGateway) {
      this.runnerEventsGateway.emitRunnerUpdate(runnerDto as any);
    }

    return { message: 'Runner stopped' };
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

    const [items, total] = await this.prisma.$transaction([
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
      errorDetails:
        item.errorDetails &&
        typeof item.errorDetails === 'object' &&
        !Array.isArray(item.errorDetails)
          ? (item.errorDetails as Record<string, unknown>)
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

  private resolveMaxConcurrentRunners(): number {
    const raw = process.env.MAX_CONCURRENT_RUNNERS;
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private async canStartNewRunner(): Promise<boolean> {
    const limit = this.resolveMaxConcurrentRunners();
    if (limit === 0) return true;
    const running = await this.prisma.runner.count({
      where: { status: RunnerStatus.RUNNING },
    });
    return running < limit;
  }

  private async dequeueNextPendingRunner(): Promise<void> {
    if (!(await this.canStartNewRunner())) return;

    const pending = await this.prisma.runner.findFirst({
      where: { status: RunnerStatus.PENDING, startedAt: null },
      orderBy: { triggeredAt: 'asc' },
      include: { source: true },
    });
    if (!pending) return;

    const claimed = await this.prisma.runner.updateMany({
      where: { id: pending.id, status: RunnerStatus.PENDING },
      data: { status: RunnerStatus.RUNNING },
    });
    if (claimed.count !== 1) return;

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

      void this.executeCliAsync(
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

      const [rows, count] = await this.prisma.$transaction([
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
