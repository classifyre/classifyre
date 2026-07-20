import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  AgentDecisionAction,
  Prisma,
  Severity,
  TriggerType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { ValidationService } from '../../../validation.service';
import { MaskedConfigCryptoService } from '../../../masked-config-crypto.service';
import { CliRunnerService } from '../../../cli-runner/cli-runner.service';
import { NotificationsService } from '../../../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../../../types/notification.types';
import { DecisionApplierService } from '../../decision-applier.service';
import { AI_ACTOR } from '../../autopilot.constants';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/** Config sub-keys the autopilot may change. Base connection is excluded. */
const EDITABLE_KEYS = [
  'detectors',
  'custom_detectors',
  'sampling',
  'optional',
  'resources',
] as const;
/** Never editable by the autopilot — the source's identity/credentials. */
const PROTECTED_KEYS = ['required', 'masked'] as const;

/**
 * Config-tuning tools. The autopilot can read a source's editable config and
 * change detectors / sampling / optional / resources — NEVER the base
 * connection (`required` / `masked`). Every change is validated against the
 * source JSON schema before it is written, and the protected sections are
 * asserted byte-identical before/after.
 */
@Injectable()
export class ConfigToolset {
  private readonly logger = new Logger(ConfigToolset.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: ValidationService,
    private readonly masked: MaskedConfigCryptoService,
    private readonly applier: DecisionApplierService,
    private readonly cliRunner: CliRunnerService,
    private readonly notifications: NotificationsService,
  ) {}

  private sourceGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId : '';
    const mode = await this.applier.sourceGate(
      sourceId,
      tc.ctx.settings.autopilotConfigEnabled,
    );
    return { mode, entityType: 'source', entityId: sourceId };
  };

  /**
   * Gate for the re-scan tool. A re-scan applies whatever detection changes the
   * config or detector-author agent just made, so either of those switches being
   * on counts as "the relevant autopilot agent is enabled".
   */
  private rescanGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId : '';
    const enabled =
      tc.ctx.settings.autopilotConfigEnabled ||
      tc.ctx.settings.autopilotDetectorEnabled;
    const mode = await this.applier.sourceGate(sourceId, enabled);
    return { mode, entityType: 'source', entityId: sourceId };
  };

  /** Raise an operator notification for an autopilot config mutation. */
  private async notifyConfigChanged(
    sourceId: string,
    sourceName: string,
    changedKeys: string[],
  ): Promise<void> {
    try {
      await this.notifications.create({
        type: NotificationType.SOURCE,
        event: NotificationEvent.SOURCE_CONFIG_CHANGED,
        severity: Severity.INFO,
        title: 'Autopilot changed a source configuration',
        message: `Autopilot updated ${changedKeys.join(', ')} on "${sourceName}".`,
        sourceId,
        triggeredBy: AI_ACTOR,
        metadata: { changedKeys },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to raise config-change notification for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Raise an operator notification for an autopilot-triggered re-scan. */
  private async notifyRescan(
    sourceId: string,
    runnerId: string,
  ): Promise<void> {
    try {
      await this.notifications.create({
        type: NotificationType.SOURCE,
        event: NotificationEvent.SOURCE_AUTOPILOT_RESCAN,
        severity: Severity.INFO,
        title: 'Autopilot started a re-scan',
        message:
          'Autopilot triggered a re-scan of a source to apply detection changes.',
        sourceId,
        runnerId,
        triggeredBy: AI_ACTOR,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to raise rescan notification for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  list(): Tool[] {
    return [
      {
        name: 'sources.list',
        description:
          'List sources with id, name, type, autopilot mode and last run status.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const rows = await this.prisma.source.findMany({
            select: {
              id: true,
              name: true,
              type: true,
              aiMode: true,
              runnerStatus: true,
              lastRunAt: true,
              consecutiveFailures: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: 100,
          });
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            type: String(r.type),
            aiMode: String(r.aiMode),
            runnerStatus: r.runnerStatus ? String(r.runnerStatus) : null,
            lastRunAt: r.lastRunAt,
            consecutiveFailures: r.consecutiveFailures,
          }));
        },
      },
      {
        name: 'sources.get_config',
        description:
          'Read a source’s EDITABLE config (detectors, custom_detectors, sampling, optional, resources). Base connection (required/masked) is never returned. The returned `version` is a concurrency token — pass it back as `expectedVersion` to config.tune_source so your write is rejected if an operator changed the config in the meantime.',
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const source = await this.prisma.source.findUnique({
            where: { id: String(input.sourceId) },
            select: {
              id: true,
              name: true,
              type: true,
              aiMode: true,
              config: true,
              updatedAt: true,
            },
          });
          if (!source) throw new Error('Unknown sourceId');
          const decrypted = this.masked.decryptMaskedConfig(
            (source.config ?? {}) as Record<string, unknown>,
          );
          const editable: Record<string, unknown> = {};
          for (const key of EDITABLE_KEYS) {
            if (key in decrypted) editable[key] = decrypted[key];
          }
          return {
            id: source.id,
            name: source.name,
            type: String(source.type),
            aiMode: String(source.aiMode),
            editableConfig: editable,
            version: source.updatedAt.toISOString(),
          };
        },
      },
      {
        name: 'config.tune_source',
        description:
          'Change a source’s editable config. `patch` may only contain detectors, custom_detectors, sampling, optional, resources. The merged config is validated against the source schema; base connection is left untouched. You MUST first call sources.get_config and pass its `version` back as `expectedVersion`: the write is rejected if an operator (or another agent) changed the config since you read it, so you never silently clobber a newer change. On rejection, re-read and reapply your patch on the current config. An operator notification is raised for every change.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            expectedVersion: {
              type: 'string',
              description:
                'The `version` returned by sources.get_config for this source. The write is refused if the source changed since then.',
            },
            patch: {
              type: 'object',
              properties: {
                detectors: { type: 'array' },
                custom_detectors: { type: 'array', items: { type: 'string' } },
                sampling: { type: 'object' },
                optional: { type: 'object' },
                resources: { type: 'object' },
              },
              additionalProperties: false,
            },
          },
          required: ['sourceId', 'patch', 'expectedVersion'],
          additionalProperties: false,
        },
        // Preserve the nested config patch verbatim (lenient mode would strip
        // the free-form sampling/optional/resources objects).
        lenientInput: false,
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.TUNE_SOURCE,
        resolveGate: this.sourceGate,
        handler: async (input) => {
          const sourceId = String(input.sourceId);
          const patch = (input.patch ?? {}) as Record<string, unknown>;
          const expectedVersion =
            typeof input.expectedVersion === 'string'
              ? input.expectedVersion
              : undefined;

          // 1. Reject any attempt to touch protected/unknown keys.
          for (const key of Object.keys(patch)) {
            if ((PROTECTED_KEYS as readonly string[]).includes(key)) {
              throw new Error(`Cannot edit base connection key "${key}".`);
            }
            if (!(EDITABLE_KEYS as readonly string[]).includes(key)) {
              throw new Error(`Key "${key}" is not editable by the autopilot.`);
            }
          }

          const source = await this.prisma.source.findUnique({
            where: { id: sourceId },
            select: { name: true, type: true, config: true, updatedAt: true },
          });
          if (!source) throw new Error('Unknown sourceId');

          // 2. Optimistic concurrency: the agent must supply the version it read
          //    from sources.get_config. If the source has changed since (e.g. an
          //    operator saved a new detector selection seconds ago), refuse —
          //    never silently overwrite a newer write with a stale base.
          if (!expectedVersion) {
            throw new Error(
              'expectedVersion is required — call sources.get_config first and pass back its `version`.',
            );
          }
          const currentVersion = source.updatedAt.toISOString();
          if (expectedVersion !== currentVersion) {
            throw new Error(
              `Source config changed since you read it (you have version ${expectedVersion}, ` +
                `current is ${currentVersion}). Re-read sources.get_config and reapply your ` +
                `patch on the current config before writing.`,
            );
          }

          // 3. Decrypt → allow-list merge.
          const current = this.masked.decryptMaskedConfig(
            (source.config ?? {}) as Record<string, unknown>,
          );
          const merged: Record<string, unknown> = { ...current };
          for (const key of EDITABLE_KEYS) {
            if (key in patch) merged[key] = patch[key];
          }

          // 4. Schema gate — invalid config never gets written.
          const validated = this.validation.validate(
            String(source.type),
            merged,
          );

          // 5. Defensive assertion: base connection unchanged.
          for (const key of PROTECTED_KEYS) {
            if (
              JSON.stringify(validated[key]) !== JSON.stringify(current[key])
            ) {
              throw new Error(
                `Base connection "${key}" would change — refusing.`,
              );
            }
          }

          // 6. Persist with the version as a precondition, so a write that
          //    raced in between our read and this update (updatedAt advanced)
          //    matches zero rows and is refused rather than clobbering it.
          const encrypted = this.masked.encryptMaskedConfig(validated);
          const written = await this.prisma.source.updateMany({
            where: { id: sourceId, updatedAt: source.updatedAt },
            data: { config: encrypted as Prisma.InputJsonValue },
          });
          if (written.count === 0) {
            throw new Error(
              'Source config was modified concurrently while writing — refusing to ' +
                'overwrite. Re-read sources.get_config and retry.',
            );
          }

          const changedKeys = Object.keys(patch);
          // 7. Surface the change to the operator — an autopilot config mutation
          //    must never be silent (BUG F / R-12). Best-effort: a notification
          //    failure must not fail the mutation that already succeeded.
          await this.notifyConfigChanged(sourceId, source.name, changedKeys);
          return { ok: true, changedKeys };
        },
      },
      {
        name: 'sources.rescan',
        description:
          'Re-scan a source so detection changes (a new/updated custom detector, or retuned built-in detectors) actually run on its assets and produce real findings. Scans are asynchronous: a later autopilot cycle, fired automatically when the scan completes, will see the resulting findings — record what you changed as pending-verification in memory so that cycle can evaluate it. Returns immediately. Does nothing if this run is itself a verification re-scan, or if a scan is already in progress.',
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.TRIGGER_SCAN,
        resolveGate: this.rescanGate,
        handler: async (input, tc) => {
          const sourceId = String(input.sourceId);

          // Depth-1 loop guard: never re-scan from inside a cycle that was
          // itself triggered by an autopilot re-scan, or the author→rescan→
          // verify chain would never terminate.
          if (tc.ctx.runnerId) {
            const triggering = await this.prisma.runner.findUnique({
              where: { id: tc.ctx.runnerId },
              select: { triggerType: true },
            });
            if (triggering?.triggerType === TriggerType.AUTOPILOT) {
              return {
                skipped:
                  'this cycle is already a verification re-scan; not re-scanning again',
              };
            }
          }

          try {
            const runner = await this.cliRunner.startRun(
              sourceId,
              TriggerType.AUTOPILOT,
              AI_ACTOR,
            );
            // A rescan applies whatever detection changes the agent just made —
            // surface it so a config-mutation + auto-rescan is never a silent,
            // atomic pair (BUG F / R-12).
            await this.notifyRescan(sourceId, runner.id);
            return {
              ok: true,
              runnerId: runner.id,
              message:
                'Re-scan started. A follow-up autopilot cycle will evaluate the resulting findings.',
            };
          } catch (error) {
            // startRun throws ConflictException / NotFoundException when a scan
            // is already running or the source doesn't exist — surface those to
            // the model as a soft skip. Infrastructure errors (e.g. Prisma
            // validation) must propagate so the dispatcher records FAILED.
            if (error instanceof HttpException) {
              return {
                skipped:
                  error instanceof Error
                    ? error.message
                    : 're-scan could not be started',
              };
            }
            throw error;
          }
        },
      },
    ];
  }
}
