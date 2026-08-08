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
import { CustomDetectorsService } from '../../../custom-detectors.service';
import { AutoScheduleService } from '../../../scheduler/auto-schedule.service';
import { computeDetectionFingerprint } from '../../../utils/scope-fingerprint';
import {
  DetectionImpactService,
  type DetectionImpact,
} from '../../detection-impact.service';
import {
  DetectionPostureService,
  type DetectionPostureReport,
} from '../../detection-posture.service';
import {
  AI_ACTOR,
  AUTOPILOT_RESCANS_PER_DAY,
  AUTOPILOT_TUNES_PER_DAY,
  MAX_COVERAGE_SOURCE_ROWS,
} from '../../autopilot.constants';
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
    private readonly autoSchedule: AutoScheduleService,
    private readonly customDetectors: CustomDetectorsService,
    private readonly impact: DetectionImpactService,
    private readonly posture: DetectionPostureService,
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
    impact: DetectionImpact,
    reason?: string,
  ): Promise<void> {
    try {
      await this.notifications.create({
        type: NotificationType.SOURCE,
        event: NotificationEvent.SOURCE_CONFIG_CHANGED,
        severity:
          // A change that resolves findings is not routine information — it
          // rewrites what the operator can see. Nothing about the day the
          // autopilot resolved 44,174 findings was visible at INFO.
          impact.resolves.total > 0 ? Severity.MEDIUM : Severity.INFO,
        title: 'Autopilot changed a source configuration',
        // The reason and the cost, not just the mechanics. "Autopilot updated
        // detectors, custom_detectors" tells an operator nothing about WHY a
        // detector they were watching stopped producing findings, nor that
        // every finding it had produced was just resolved.
        message:
          `Autopilot updated ${changedKeys.join(', ')} on "${sourceName}".` +
          (reason ? ` Reason: ${reason}` : '') +
          (impact.resolves.total > 0
            ? ` ${DetectionImpactService.describe(impact)}`
            : ''),
        sourceId,
        triggeredBy: AI_ACTOR,
        metadata: {
          changedKeys,
          resolvedFindings: impact.resolves.total,
          removedDetectors: impact.removedDetectors,
        },
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
            // Was 100, which silently truncated against a 151-source instance:
            // the agent saw a subset and had no way to know it was one.
            take: MAX_COVERAGE_SOURCE_ROWS,
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
          'Read a source’s EDITABLE config (detectors, custom_detectors, sampling, optional, resources). Base connection (required/masked) is never returned. The returned `version` is a concurrency token — pass it back as `expectedVersion` to config.tune_source so your write is rejected if an operator changed the config in the meantime. Also returns `detectionPosture` — where this source sits in its detection lifecycle and how much of its daily detection-change budget is left — because that decides how freely you should be changing what it detects.',
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
          // Bundled rather than left to a separate tool call: this is the tool
          // the agent must call before every tune, so posture arrives whether
          // or not it thought to ask.
          const posture = await this.posture.forSource(source.id);
          return {
            id: source.id,
            name: source.name,
            type: String(source.type),
            aiMode: String(source.aiMode),
            editableConfig: editable,
            version: source.updatedAt.toISOString(),
            detectionPosture: posture,
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
        handler: async (input, tc) => {
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

          // 4b. Custom-detector references are resolved to canonical IDs and
          //     stale ones are dropped — an agent naming a detector by key, or
          //     re-writing a selection whose detector was deleted meanwhile,
          //     must not persist a reference that later rejects every save.
          await this.customDetectors.sanitizeSourceConfigDetectors(validated);

          // 4c. Detection floor. Every tuning decision this agent makes is a
          //     reduction — "this pattern is noise", "this detector is a
          //     prose-noise generator" — and each one in isolation is
          //     defensible. Nothing pushed back, so on a live instance the
          //     ratchet ran to its end over two days: DATE_TIME and NRP, then
          //     CRYPTO and CREDIT_CARD, then EMAIL_ADDRESS/PERSON/LOCATION/URL,
          //     then SECRETS, then the noisiest custom detector. All five
          //     built-in detectors ended up disabled, the source swept its
          //     whole 9600-object corpus every three hours finding nothing, and
          //     with no findings there was nothing for any other agent to
          //     investigate. A source that detects nothing is not a quiet
          //     source, it is a blind one.
          assertDetectionSurvives(validated);

          // 4d. Price the change. This is the number the agent never had: the
          //      tool returned {ok: true} whether a patch touched nothing or
          //      resolved 44,174 findings, so every reduction looked free.
          const impact = await this.impact.preview(
            sourceId,
            current,
            validated,
          );

          // 4e. Detection-churn budget. Both guards are about the same thing —
          //      a source whose detector set keeps moving never accumulates an
          //      evidence base — and both scale with how settled the source is,
          //      so a new source is free to experiment.
          const posture = await this.posture.forSource(sourceId);
          assertChurnBudget(posture, impact);

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
          await this.notifyConfigChanged(
            sourceId,
            source.name,
            changedKeys,
            impact,
            tc.rationale,
          );
          // 8. A detection/sampling change invalidates "there is nothing new to
          //    read": the existing assets must be looked at again. Restart the
          //    adaptive sweep so a converged source does not wait out its slow
          //    interval before the change is tested. No-op for CRON/OFF sources.
          await this.autoSchedule.resetToCatchUp(
            sourceId,
            `Autopilot changed ${changedKeys.join(', ')} — re-sweeping so the change takes effect.`,
          );
          return {
            ok: true,
            changedKeys,
            // The receipt. It lands in the decision payload, so the next
            // cycle's own history says what the last change cost.
            impact,
            detectionPosture: posture.posture,
            tuneBudgetRemaining: Math.max(0, posture.tuneBudgetRemaining - 1),
          };
        },
      },
      {
        name: 'config.preview_impact',
        description:
          'What a config change WOULD cost, without making it. Returns the detectors the patch adds and removes, how many open findings removing them orphans (grouped by detector, with how many are high-importance), and which of those an active inquiry watches or a case cites. Removing a detector from a source resolves the findings it produced — inquiries, cases, fingerprints and glossary terms are all built on those findings — so call this before any patch that disables a detector or drops a custom_detector. Findings a case cites or an inquiry watches are never auto-resolved, but the change still stops them being re-detected.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
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
          required: ['sourceId', 'patch'],
          additionalProperties: false,
        },
        lenientInput: false,
        sideEffect: 'read',
        handler: async (input) => {
          const sourceId = String(input.sourceId);
          const patch = (input.patch ?? {}) as Record<string, unknown>;
          const source = await this.prisma.source.findUnique({
            where: { id: sourceId },
            select: { config: true },
          });
          if (!source) throw new Error('Unknown sourceId');

          const current = this.masked.decryptMaskedConfig(
            (source.config ?? {}) as Record<string, unknown>,
          );
          // Same allow-list merge tune_source performs, so the preview prices
          // exactly the config that would be written — no schema validation,
          // because an invalid patch should be priced then rejected there, not
          // silently reported as costless here.
          const candidate: Record<string, unknown> = { ...current };
          for (const key of EDITABLE_KEYS) {
            if (key in patch) candidate[key] = patch[key];
          }
          return this.impact.preview(sourceId, current, candidate);
        },
      },
      {
        name: 'sources.detection_posture',
        description:
          'Where a source is in its detection lifecycle: EXPLORING (too new or too empty to judge — experiment freely), CONVERGING (producing findings, but little of it watched or cited — change one thing and evaluate it), or STABLE (the detector set has survived several scans unchanged and its findings feed real investigation — changes need a reason beyond "this looks noisy"). Also returns the numbers behind the verdict and how much of this source\'s daily detection-change budget is left.',
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.posture.forSource(String(input.sourceId)),
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

          // The depth-1 guard above reads the runner that triggered THIS cycle
          // — and a coalesced corpus cycle has none, so on that path (which is
          // now the common one) it never fires. Without the guards below,
          // re-scan → scan completes → source marked dirty → next corpus cycle
          // → re-scan is a loop with nothing but mission prose to stop it.
          //
          // The test is "would this re-scan detect anything the last autopilot
          // re-scan did not", answered by comparing detection fingerprints. A
          // plain cooldown would have been simpler and wrong: within one cycle
          // the config agent retunes detectors and re-scans, and the
          // detector-authoring agent then ships a new detector and needs its
          // own re-scan to test it — a legitimate second re-scan that a time
          // window cannot distinguish from the loop.
          const source = await this.prisma.source.findUnique({
            where: { id: sourceId },
            select: { type: true, config: true },
          });
          if (!source) throw new Error('Unknown sourceId');
          const detectionNow = computeDetectionFingerprint(
            String(source.type),
            this.masked.decryptMaskedConfig(
              (source.config ?? {}) as Record<string, unknown>,
            ),
          );

          const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
          const [lastAutopilotRun, today] = await Promise.all([
            this.prisma.runner.findFirst({
              where: { sourceId, triggerType: TriggerType.AUTOPILOT },
              orderBy: { triggeredAt: 'desc' },
              select: { detectionFingerprint: true, triggeredAt: true },
            }),
            this.prisma.runner.count({
              where: {
                sourceId,
                triggerType: TriggerType.AUTOPILOT,
                triggeredAt: { gte: dayAgo },
              },
            }),
          ]);

          if (
            lastAutopilotRun?.detectionFingerprint &&
            lastAutopilotRun.detectionFingerprint === detectionNow
          ) {
            return {
              skipped:
                'nothing about what this source detects has changed since the autopilot last ' +
                're-scanned it, so another scan would produce the same findings. Evaluate the ' +
                'findings from that scan, or change the configuration first.',
            };
          }
          // Backstop for flapping: an agent that keeps changing detection back
          // and forth passes the fingerprint test every time.
          if (today >= AUTOPILOT_RESCANS_PER_DAY) {
            return {
              skipped:
                `this source has already been re-scanned ${today} times by the autopilot today ` +
                '(daily limit reached); record what you changed and let a later cycle verify it',
            };
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

/**
 * Refuse a config that would leave a source detecting nothing at all.
 *
 * "Nothing" means no built-in detector enabled AND no custom detector wired.
 * Deliberately the weakest possible floor: the agent stays free to disable any
 * individual detector, narrow any pattern set, and raise any threshold — it
 * only cannot take the last one away. Tuning noise down is the job; tuning
 * detection to zero is the failure it has to be stopped from reaching one
 * locally-reasonable step at a time.
 */
/**
 * Refuse a detection change the source has not earned yet.
 *
 * Two guards, one idea: a source whose detector set keeps moving never
 * accumulates an evidence base, because every removal resolves the findings the
 * removed detector produced. Neither guard applies while a source is EXPLORING
 * — there, churn is called experimentation and it is the correct behaviour.
 *
 * Both are deliberately one-sided. A patch that only ADDS detection is never
 * refused: the failure mode being corrected is a ratchet that only ever
 * subtracted, and an agent must always be able to restore detection, including
 * on a source it has already spent its budget on.
 */
export function assertChurnBudget(
  posture: DetectionPostureReport,
  impact: DetectionImpact,
): void {
  const reduces = impact.removedDetectors.length > 0;
  if (posture.posture === 'EXPLORING' || !reduces) return;

  if (posture.tuneBudgetRemaining <= 0) {
    throw new Error(
      `Refused: the autopilot has already changed this source's detection ` +
        `${posture.tunesLast24h} time(s) in the last 24 hours (limit ` +
        `${AUTOPILOT_TUNES_PER_DAY}), and this patch removes ` +
        `${impact.removedDetectors.join(', ')}. Detection that keeps moving ` +
        `never produces a stable evidence base for an investigation to be built ` +
        `on. Evaluate what you already changed — read the findings the last ` +
        `re-scan produced — or record what you would change next with ` +
        `memory.write and let a later cycle apply it. Adding detection is still ` +
        `allowed.`,
    );
  }

  if (posture.lastChangeUnevaluated) {
    throw new Error(
      `Refused: your previous change to this source has not been evaluated yet ` +
        `— no scan has completed since it was applied, so nothing is known ` +
        `about whether it helped. This patch removes ` +
        `${impact.removedDetectors.join(', ')}, which would resolve ` +
        `${impact.resolves.total} open finding(s) on top of a change whose ` +
        `effect you have not seen. Wait for the re-scan and judge the new ` +
        `finding landscape first. Source posture: ${posture.posture} — ` +
        `${posture.reason}. Adding detection is still allowed.`,
    );
  }
}

export function assertDetectionSurvives(config: Record<string, unknown>): void {
  const detectors = Array.isArray(config.detectors) ? config.detectors : [];
  const anyBuiltIn = detectors.some((entry) => {
    const d = entry as { enabled?: unknown };
    return d?.enabled !== false;
  });
  const custom = Array.isArray(config.custom_detectors)
    ? config.custom_detectors
    : [];

  if (anyBuiltIn || custom.length > 0) return;

  throw new Error(
    'Refused: this would leave the source with no detection at all — every ' +
      'built-in detector disabled and no custom detector wired. A source that ' +
      'detects nothing produces no findings, and with no findings there is ' +
      'nothing for any inquiry, case or glossary term to be built from; the ' +
      'scans keep running and return empty. Reducing noise is right, but keep ' +
      'at least one detector live: narrow its patterns or raise its confidence ' +
      'threshold instead of switching the last one off, or author a targeted ' +
      'custom detector first and wire that in the same change.',
  );
}
