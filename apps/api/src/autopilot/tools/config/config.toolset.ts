import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { ValidationService } from '../../../validation.service';
import { MaskedConfigCryptoService } from '../../../masked-config-crypto.service';
import { DecisionApplierService } from '../../decision-applier.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: ValidationService,
    private readonly masked: MaskedConfigCryptoService,
    private readonly applier: DecisionApplierService,
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
          'Read a source’s EDITABLE config (detectors, custom_detectors, sampling, optional, resources). Base connection (required/masked) is never returned.',
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
          };
        },
      },
      {
        name: 'config.tune_source',
        description:
          'Change a source’s editable config. `patch` may only contain detectors, custom_detectors, sampling, optional, resources. The merged config is validated against the source schema; base connection is left untouched.',
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
            select: { type: true, config: true },
          });
          if (!source) throw new Error('Unknown sourceId');

          // 2. Decrypt → allow-list merge.
          const current = this.masked.decryptMaskedConfig(
            (source.config ?? {}) as Record<string, unknown>,
          );
          const merged: Record<string, unknown> = { ...current };
          for (const key of EDITABLE_KEYS) {
            if (key in patch) merged[key] = patch[key];
          }

          // 3. Schema gate — invalid config never gets written.
          const validated = this.validation.validate(
            String(source.type),
            merged,
          );

          // 4. Defensive assertion: base connection unchanged.
          for (const key of PROTECTED_KEYS) {
            if (
              JSON.stringify(validated[key]) !== JSON.stringify(current[key])
            ) {
              throw new Error(
                `Base connection "${key}" would change — refusing.`,
              );
            }
          }

          // 5. Persist — re-encrypt the masked section and write.
          const encrypted = this.masked.encryptMaskedConfig(validated);
          await this.prisma.source.update({
            where: { id: sourceId },
            data: { config: encrypted as Prisma.InputJsonValue },
          });
          return { ok: true, changedKeys: Object.keys(patch) };
        },
      },
    ];
  }
}
