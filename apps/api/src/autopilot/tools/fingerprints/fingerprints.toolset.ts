import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AiManagementMode,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { CorrelationService } from '../../../correlation/correlation.service';
import { DuplicatesFinderAgentService } from '../../../correlation/duplicates-finder-agent.service';
import { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolGate } from '../tool.types';

const RELATION_TYPES = ['related', 'likely_duplicate'];

/**
 * Fingerprints (asset correlation/similarity) tools. The similarity COMPUTE
 * stays deterministic (the DUPLICATES pre-step) — these tools let the harness
 * read it, recompute on demand, promote a similarity cluster into a case, and
 * tune the correlation config. Used mainly by the CASE mission (act) and the
 * CONFIG mission (tune).
 */
@Injectable()
export class FingerprintsToolset {
  constructor(
    private readonly prisma: PrismaService,
    private readonly correlation: CorrelationService,
    private readonly duplicates: DuplicatesFinderAgentService,
    private readonly applier: DecisionApplierService,
  ) {}

  list(): Tool[] {
    return [
      {
        name: 'fingerprints.similar_assets',
        description:
          'For one asset, return its identity cluster members and top correlated assets (similarity % + shared-value reasons) — the data behind the fingerprints card.',
        inputSchema: {
          type: 'object',
          properties: { assetId: { type: 'string' } },
          required: ['assetId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const assetId = String(input.assetId);
          const memberships = await this.prisma.assetClusterMember.findMany({
            where: { assetId },
            select: { clusterId: true },
          });
          const clusterIds = memberships.map((m) => m.clusterId);
          const clusterMembers = clusterIds.length
            ? await this.prisma.assetClusterMember.findMany({
                where: { clusterId: { in: clusterIds } },
                select: { assetId: true, clusterId: true },
                take: 200,
              })
            : [];
          const edges = await this.prisma.edge.findMany({
            where: {
              fromType: 'asset',
              toType: 'asset',
              relationType: { in: RELATION_TYPES },
              OR: [{ fromId: assetId }, { toId: assetId }],
            },
            orderBy: { confidence: 'desc' },
            take: 50,
          });
          return {
            assetId,
            clusterIds,
            clusterMembers: clusterMembers
              .filter((m) => m.assetId !== assetId)
              .map((m) => ({ assetId: m.assetId, clusterId: m.clusterId })),
            related: edges.map((e) => {
              const meta = (e.metadata ?? {}) as {
                weighted?: number;
                reasons?: string[];
              };
              return {
                otherAssetId: e.fromId === assetId ? e.toId : e.fromId,
                relationType: e.relationType,
                matchPercent: Math.round(
                  (meta.weighted ?? Number(e.confidence)) * 100,
                ),
                reasons: meta.reasons ?? [],
              };
            }),
          };
        },
      },
      {
        name: 'fingerprints.value_occurrences',
        description:
          'Reverse index: where else a normalized finding value appears across assets (by label+value or valueHash).',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            valueHash: { type: 'string' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.correlation.getValueOccurrences({
            label: input.label as string | undefined,
            value: input.value as string | undefined,
            valueHash: input.valueHash as string | undefined,
          }),
      },
      {
        name: 'fingerprints.recompute_asset',
        description:
          'Recompute correlation/similarity for one asset on demand (e.g. after attaching new findings to a case).',
        inputSchema: {
          type: 'object',
          properties: { assetId: { type: 'string' } },
          required: ['assetId'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.RECOMPUTE_CORRELATION,
        // Internal, idempotent recompute — always allowed while a cycle runs.
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'source',
          }),
        handler: async (input) =>
          this.correlation.recomputeForAsset(String(input.assetId)),
      },
      {
        name: 'cases.from_cluster',
        description:
          'Promote a set of similar/clustered assets into a case (or add them to an existing case), optionally attaching their findings as evidence.',
        inputSchema: {
          type: 'object',
          properties: {
            assetIds: { type: 'array', items: { type: 'string' } },
            caseId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
            },
            attachFindings: { type: 'boolean' },
          },
          required: ['assetIds'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'case',
        decisionAction: AgentDecisionAction.CREATE_CASE,
        resolveGate: async (input, tc): Promise<ToolGate> => {
          const caseId =
            typeof input.caseId === 'string' ? input.caseId : undefined;
          const mode = caseId
            ? await this.applier.caseGate(
                caseId,
                tc.ctx.settings.autopilotCaseEnabled,
              )
            : this.applier.effectiveMode(
                AiManagementMode.INHERIT,
                tc.ctx.settings.autopilotCaseEnabled,
              );
          return { mode, entityType: 'case', entityId: caseId };
        },
        handler: async (input) =>
          this.duplicates.runCaseAction({
            assetIds: (input.assetIds as string[]) ?? [],
            caseId: (input.caseId as string | undefined) ?? null,
            title: (input.title as string | undefined) ?? null,
            description: (input.description as string | undefined) ?? null,
            severity: (input.severity as Severity | undefined) ?? null,
            attachFindings:
              (input.attachFindings as boolean | undefined) ?? false,
          }),
      },
      {
        name: 'fingerprints.tune_config',
        description:
          'Tune correlation config: per-label weights, related/duplicate thresholds, default weight, and exclusion rules. Affects how similarity is scored instance-wide.',
        inputSchema: {
          type: 'object',
          properties: {
            defaultWeight: { type: 'number' },
            relatedMin: { type: 'number' },
            duplicateMin: { type: 'number' },
            labelWeights: { type: 'object' },
            exclusions: { type: 'array' },
          },
          additionalProperties: false,
        },
        // Preserve the nested labelWeights/exclusions verbatim.
        lenientInput: false,
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.TUNE_CORRELATION,
        resolveGate: (_input, tc) =>
          Promise.resolve({
            mode: this.applier.effectiveMode(
              AiManagementMode.INHERIT,
              tc.ctx.settings.autopilotConfigEnabled,
            ),
            entityType: 'system',
          }),
        handler: async (input) =>
          this.correlation.saveConfig({
            defaultWeight: input.defaultWeight as number | undefined,
            relatedMin: input.relatedMin as number | undefined,
            duplicateMin: input.duplicateMin as number | undefined,
            labelWeights: input.labelWeights as
              | Record<string, number>
              | undefined,
            exclusions: input.exclusions as never,
          }),
      },
    ];
  }
}
