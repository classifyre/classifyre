import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_NAMESPACE_ID } from '../namespace/namespace.constants';
import { WorkerQueueRegistryService } from '../scheduler/worker-queue-registry.service';
import { CorrelationSwitchService } from '../correlation/correlation-switch.service';
import { CorrelationJobScheduler } from '../correlation/correlation-job-scheduler.service';
import { CorrelationWorker } from '../correlation/correlation.worker';
import { CORRELATION_QUEUE } from '../correlation/correlation.constants';
import { EntitySwitchService } from '../entities/entity-switch.service';
import { EntityResolutionService } from '../entities/entity-resolution.service';
import {
  ENTITIES_RECOUNT_QUEUE,
  ENTITIES_RESOLVE_QUEUE,
} from '../entities/entities.constants';
import { EmbeddingSettingsService } from '../embedding/embedding-settings.service';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { MaintenanceService } from './maintenance.service';
import type { CleanupKey } from './maintenance.datasets';
import {
  WORKSPACE_FEATURE_KEYS,
  WORKSPACE_FEATURE_LABELS,
  isWorkspaceFeatureKey,
  type FeatureDisabledMode,
  type WorkspaceFeatureKey,
} from './workspace-features.constants';

/** One feature switch as the Cleanup tab renders it. */
export interface WorkspaceFeatureState {
  key: WorkspaceFeatureKey;
  enabled: boolean;
  /** How it was turned off: data kept (a pause) or deleted. Null while on. */
  disabledMode: FeatureDisabledMode | null;
  /** When the switch last moved; null if it never did. */
  changedAt: string | null;
  /**
   * The deployment's default where one exists (embeddings follow
   * `EMBEDDING_ENABLED` until a workspace chooses); null otherwise.
   */
  deploymentDefault: boolean | null;
  /** The Cleanup dataset this feature produces, measured live. */
  dataset: CleanupKey;
  dataRows: number;
  dataBytes: number;
  tables: string[];
  /** Queues held paused because the feature is off (see the Workers tab). */
  heldQueues: string[];
  /** A cleanup of this feature's data running right now, if any. */
  cleanupRunId: string | null;
}

export interface WorkspaceFeaturesOverview {
  features: WorkspaceFeatureState[];
}

export interface SetWorkspaceFeatureResult {
  feature: WorkspaceFeatureState;
  /** The run deleting the feature's data; poll GET /maintenance/cleanup/runs/:id. */
  cleanupRunId: string | null;
  /**
   * The catch-up was queued: a full recompute for duplicates, a resolution
   * pass (after a value-index rebuild, if needed) for entities.
   */
  recomputeScheduled: boolean;
  /** One sentence describing what happened, for API and MCP callers. */
  note: string;
}

const FEATURE_DATASET: Record<WorkspaceFeatureKey, CleanupKey> = {
  embeddings: 'embeddings',
  duplicates: 'duplicates',
  entities: 'entities',
};

/**
 * Workspace feature switches: embeddings, duplicate detection and entities.
 *
 * Turning a feature off is three things, in this order:
 *  1. the switch itself, which every producer and worker of the feature reads
 *     (at most a few seconds stale in any process);
 *  2. a hold on the feature's queues in `public.worker_queue_pauses`, which
 *     stops every worker replica within one flush and is what the Workers tab
 *     shows — a held queue cannot be resumed there;
 *  3. optionally, a background cleanup of the feature's data.
 *
 * Off with the data kept is a pause: turning back on resumes where it stopped
 * (duplicates by one full recompute, embeddings by a catch-up backfill). Off
 * with the data deleted frees the storage; turning back on rebuilds from
 * scratch.
 *
 * Duplicates and entities share the value index (G5 R9). Each keeps it fresh
 * while it is on; when one is switched off the other takes over the indexing
 * (scans move between `correlation.scan` and `values.index`), and the index is
 * deleted only by a switch-off with data when the other feature is off too.
 */
@Injectable()
export class WorkspaceFeaturesService {
  private readonly logger = new Logger(WorkspaceFeaturesService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly maintenance: MaintenanceService,
    private readonly queues: WorkerQueueRegistryService,
    private readonly correlationSwitch: CorrelationSwitchService,
    private readonly correlationJobs: CorrelationJobScheduler,
    private readonly correlationWorker: CorrelationWorker,
    private readonly embeddingSettings: EmbeddingSettingsService,
    private readonly embeddingQueue: EmbeddingQueueService,
    private readonly entitySwitch: EntitySwitchService,
    private readonly entityResolution: EntityResolutionService,
  ) {}

  async list(): Promise<WorkspaceFeaturesOverview> {
    const namespaceId = this.namespaceId();
    const [overview, holds, duplicates, embeddings, entities] =
      await Promise.all([
        this.maintenance.overview(),
        this.queues.listPauseHolds(namespaceId),
        this.correlationSwitch.state(0),
        this.embeddingSettings.switchState(),
        this.entitySwitch.state(0),
      ]);
    const heldBy = (feature: WorkspaceFeatureKey) =>
      [...holds.entries()]
        .filter(([, holder]) => holder === feature)
        .map(([queue]) => queue)
        .sort();
    const measured = (feature: WorkspaceFeatureKey) => {
      const dataset = overview.datasets.find(
        (d) => d.cleanupKey === FEATURE_DATASET[feature],
      );
      return {
        dataset: FEATURE_DATASET[feature],
        dataRows: Math.max(0, dataset?.rowsEstimate ?? 0),
        dataBytes: Math.max(0, dataset?.sizeBytes ?? 0),
        tables: dataset?.tables ?? [],
        heldQueues: heldBy(feature),
        cleanupRunId:
          this.maintenance.runningCleanup(FEATURE_DATASET[feature])?.runId ??
          null,
      };
    };
    const features: WorkspaceFeatureState[] = WORKSPACE_FEATURE_KEYS.map(
      (key) =>
        key === 'embeddings'
          ? {
              key,
              enabled: embeddings.enabled,
              disabledMode: embeddings.disabledMode,
              changedAt: embeddings.changedAt?.toISOString() ?? null,
              deploymentDefault: embeddings.deploymentDefault,
              ...measured(key),
            }
          : key === 'entities'
            ? {
                key,
                enabled: entities.enabled,
                disabledMode: entities.disabledMode,
                changedAt: entities.changedAt?.toISOString() ?? null,
                deploymentDefault: null,
                ...measured(key),
              }
            : {
                key,
                enabled: duplicates.enabled,
                disabledMode: duplicates.disabledMode,
                changedAt: duplicates.changedAt?.toISOString() ?? null,
                deploymentDefault: null,
                ...measured(key),
              },
    );
    return { features };
  }

  /**
   * Turn a feature on or off. `deleteData` (only with `enabled: false`) also
   * wipes the feature's data in the background; sent for a feature that is
   * already off it deletes the data it kept.
   */
  async set(
    key: string,
    input: { enabled?: unknown; deleteData?: unknown },
  ): Promise<SetWorkspaceFeatureResult> {
    if (!isWorkspaceFeatureKey(key)) {
      throw new NotFoundException(`Unknown feature '${key}'`);
    }
    // No global ValidationPipe: coerce what a form or a script may send.
    const enabled = toBoolean(input?.enabled);
    if (enabled === null) {
      throw new BadRequestException('enabled must be true or false');
    }
    const deleteData = toBoolean(input?.deleteData) === true;
    if (enabled && deleteData) {
      throw new BadRequestException(
        'deleteData only applies when turning a feature off',
      );
    }
    const running = this.maintenance.runningCleanup(FEATURE_DATASET[key]);
    if (running) {
      // Turning on mid-wipe would start rebuilding into tables being emptied;
      // a second wipe would race the first.
      throw new ConflictException(
        `${WORKSPACE_FEATURE_LABELS[key]} data is being deleted right now ` +
          `(run ${running.runId}). Wait for it to finish.`,
      );
    }

    const result = enabled
      ? await this.turnOn(key)
      : await this.turnOff(key, deleteData);
    const feature = (await this.list()).features.find((f) => f.key === key);
    if (!feature) throw new NotFoundException(`Unknown feature '${key}'`);
    return { ...result, feature };
  }

  private async turnOn(
    key: WorkspaceFeatureKey,
  ): Promise<Omit<SetWorkspaceFeatureResult, 'feature'>> {
    const namespaceId = this.namespaceId();
    if (key === 'duplicates') {
      const before = await this.correlationSwitch.state(0);
      await this.correlationSwitch.set(true, null);
      const released = await this.queues.releaseFeature(namespaceId, key);
      // One full recompute covers every scan, edit and tuning change made
      // while it was off — they were deliberately not queued one by one.
      const recomputeScheduled = before.enabled
        ? false
        : await this.correlationJobs.scheduleFull(
            'Duplicate detection turned on',
            true,
          );
      this.logger.log(
        `Duplicate detection turned on (released ${released.length} queue(s), ` +
          `recompute ${recomputeScheduled ? 'queued' : 'not needed'})`,
      );
      return {
        cleanupRunId: null,
        recomputeScheduled,
        note: recomputeScheduled
          ? 'Duplicate detection is on. A full recompute was queued to catch up with everything scanned while it was off.'
          : 'Duplicate detection is on.',
      };
    }

    if (key === 'entities') {
      const before = await this.entitySwitch.state(0);
      await this.entitySwitch.set(true, null);
      const released = await this.queues.releaseFeature(namespaceId, key);
      // Mentions are a join against the value index. With duplicate detection
      // on it is already fresh; with it off nothing has indexed since it was
      // switched off (or ever), so the index is rebuilt first and the
      // resolution pass follows it.
      let scheduled = false;
      if (!before.enabled) {
        if (await this.correlationSwitch.isEnabled()) {
          await this.entityResolution.scheduleResolveAll('Entities turned on');
          scheduled = true;
        } else {
          scheduled =
            await this.correlationJobs.scheduleReindex('Entities turned on');
        }
      }
      this.logger.log(
        `Entities turned on (released ${released.length} queue(s), ` +
          `catch-up ${scheduled ? 'queued' : 'not needed'})`,
      );
      return {
        cleanupRunId: null,
        recomputeScheduled: scheduled,
        note: scheduled
          ? 'Entities are on. Values of the existing entities are being matched against everything already scanned; counters and candidates appear as that finishes.'
          : 'Entities are on.',
      };
    }

    await this.embeddingSettings.setEnabled(true, null);
    const released = await this.queues.releaseFeature(namespaceId, key);
    // In a process that runs workers (desktop, all-in-one) this binds and
    // catches up right away; on Kubernetes the worker pod does the same on its
    // next check.
    await this.embeddingQueue.reconcileWorker({ catchUp: true });
    this.logger.log(
      `Embeddings turned on (released ${released.length} queue(s))`,
    );
    return {
      cleanupRunId: null,
      recomputeScheduled: false,
      note: 'Embeddings are on. Content scanned while they were off is being embedded in the background.',
    };
  }

  private async turnOff(
    key: WorkspaceFeatureKey,
    deleteData: boolean,
  ): Promise<Omit<SetWorkspaceFeatureResult, 'feature'>> {
    const namespaceId = this.namespaceId();
    const mode: FeatureDisabledMode = deleteData ? 'deleted' : 'kept';

    if (key === 'duplicates') {
      const before = await this.correlationSwitch.state(0);
      // Already off with its data kept, and only asked to stay off: nothing
      // to change (and "deleted" must not be downgraded back to "kept").
      if (!before.enabled && !deleteData) {
        return {
          cleanupRunId: null,
          recomputeScheduled: false,
          note: 'Duplicate detection is already off.',
        };
      }
      await this.correlationSwitch.set(false, mode);
      await this.queues.holdForFeature(namespaceId, key, [CORRELATION_QUEUE]);
      // Waiting scan jobs carry the autopilot hand-off; move them to the
      // hand-off queue so the agents keep hearing about every scan.
      const drained = await this.correlationWorker
        .drainToHandoff()
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not move queued duplicate checks to the hand-off queue: ${String(error)}`,
          );
          return { handedOff: 0, dropped: 0 };
        });
      const cleanupRunId = deleteData
        ? this.maintenance.startCleanup('duplicates').runId
        : null;
      this.logger.log(
        `Duplicate detection turned off (${mode}); ${drained.handedOff} ` +
          `scan hand-off(s) re-routed, ${drained.dropped} recompute(s) dropped`,
      );
      return {
        cleanupRunId,
        recomputeScheduled: false,
        note: deleteData
          ? 'Duplicate detection is off and its results are being deleted.'
          : 'Duplicate detection is off. Its results are kept and stay as they are until it is turned back on.',
      };
    }

    if (key === 'entities') {
      const before = await this.entitySwitch.state(0);
      if (!before.enabled && !deleteData) {
        return {
          cleanupRunId: null,
          recomputeScheduled: false,
          note: 'Entities are already off.',
        };
      }
      await this.entitySwitch.set(false, mode);
      // `values.index` is deliberately not held: its scan jobs carry the
      // autopilot hand-off, and its worker skips the indexing by itself once
      // entities are off (a held hand-off would stop every autopilot cycle).
      await this.queues.holdForFeature(namespaceId, key, [
        ENTITIES_RESOLVE_QUEUE,
        ENTITIES_RECOUNT_QUEUE,
      ]);
      const cleanupRunId = deleteData
        ? this.maintenance.startCleanup('entities').runId
        : null;
      this.logger.log(`Entities turned off (${mode})`);
      return {
        cleanupRunId,
        recomputeScheduled: false,
        note: deleteData
          ? 'Entities are off. Pending candidates, mention links and counters are being deleted; the entities themselves and every confirmed or rejected value are kept.'
          : 'Entities are off. Mentions, counters and candidates are kept and stay as they are until they are turned back on.',
      };
    }

    const before = await this.embeddingSettings.switchState();
    if (!before.enabled && !deleteData) {
      return {
        cleanupRunId: null,
        recomputeScheduled: false,
        note: 'Embeddings are already off.',
      };
    }
    await this.embeddingSettings.setEnabled(false, mode);
    await this.queues.holdForFeature(
      namespaceId,
      key,
      await this.embeddingQueue.queueNamesForHold(),
    );
    const cleanupRunId = deleteData
      ? this.maintenance.startCleanup('embeddings').runId
      : null;
    this.logger.log(`Embeddings turned off (${mode})`);
    return {
      cleanupRunId,
      recomputeScheduled: false,
      note: deleteData
        ? 'Embeddings are off and the semantic corpus is being deleted. New scans no longer save text chunks.'
        : 'Embeddings are off. Vectors, rankings and text chunks are kept, and scans keep saving chunks so turning back on catches up without rescanning.',
    };
  }

  private namespaceId(): string {
    const id = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!id) {
      throw new BadRequestException(
        'Feature switches are only available inside a workspace context.',
      );
    }
    return id;
  }
}

function toBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}
