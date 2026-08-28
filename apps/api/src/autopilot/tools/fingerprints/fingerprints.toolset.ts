import { Injectable } from '@nestjs/common';
import {
  AgentDecisionAction,
  AiManagementMode,
  Prisma,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { CorrelationReviewService } from '../../../correlation/review/correlation-review.service';
import {
  CORRELATION_RELATION_TYPES,
  CorrelationService,
} from '../../../correlation/correlation.service';
import { DuplicatesFinderAgentService } from '../../../correlation/duplicates-finder-agent.service';
import { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolGate } from '../tool.types';

// Sourced from the engine rather than restated, so a new correlation edge type
// (identical_content was the first) reaches the harness instead of being
// silently filtered out of every similar_assets answer.
const RELATION_TYPES = CORRELATION_RELATION_TYPES;

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
    private readonly review: CorrelationReviewService,
  ) {}

  list(): Tool[] {
    return [
      {
        name: 'fingerprints.similar_assets',
        description:
          'For one asset, return its identity cluster members and top correlated assets (similarity % + shared-value reasons), each annotated with the review pattern it belongs to, whether lineage explains the match, and any verdict a human already recorded.',
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

          // Review state, keyed by pair. Without it an agent has no way to
          // know a human already ruled on a match, and will keep proposing
          // work that was settled — or argue against a decision it cannot see.
          const pairKeys = edges.map((e) =>
            e.fromId < e.toId
              ? { aId: e.fromId, bId: e.toId }
              : { aId: e.toId, bId: e.fromId },
          );
          const [signatures, verdicts] = pairKeys.length
            ? await Promise.all([
                this.prisma.correlationPairSignature.findMany({
                  where: { OR: pairKeys },
                  select: {
                    aId: true,
                    bId: true,
                    patternKey: true,
                    lineageState: true,
                    lineageRelation: true,
                  },
                }),
                this.prisma.correlationPairVerdict.findMany({
                  where: { OR: pairKeys },
                  select: { aId: true, bId: true, verdict: true },
                }),
              ])
            : [[], []];
          const key = (a: string, b: string) =>
            a < b ? `${a}|${b}` : `${b}|${a}`;
          const signatureBy = new Map(
            signatures.map((x) => [key(x.aId, x.bId), x]),
          );
          const verdictBy = new Map(
            verdicts.map((x) => [key(x.aId, x.bId), x.verdict]),
          );

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
              const k = key(e.fromId, e.toId);
              const signature = signatureBy.get(k);
              return {
                otherAssetId: e.fromId === assetId ? e.toId : e.fromId,
                relationType: e.relationType,
                matchPercent: Math.round(
                  (meta.weighted ?? Number(e.confidence)) * 100,
                ),
                reasons: meta.reasons ?? [],
                patternKey: signature?.patternKey ?? null,
                // PATH means lineage explains the resemblance (a derived copy).
                // NO_PATH means both sides have lineage and nothing connects
                // them, which is the case worth raising. UNKNOWN means we have
                // no lineage here and it is evidence of nothing either way.
                lineageState: signature?.lineageState ?? 'UNKNOWN',
                lineageRelation: signature?.lineageRelation ?? 'UNKNOWN',
                verdict: verdictBy.get(k) ?? null,
              };
            }),
          };
        },
      },
      {
        name: 'fingerprints.review_queue',
        description:
          'The duplicate-review backlog: failure patterns ranked by how much work each one settles, with how many pairs are still undecided and how many the lineage graph cannot explain. Read-only — recording a verdict is a human decision.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Patterns to return (default 20, max 60)',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const raw = Number(input.limit);
          const limit = Number.isFinite(raw)
            ? Math.min(60, Math.max(1, Math.trunc(raw)))
            : 20;
          const [patterns, remaining] = await Promise.all([
            this.prisma.correlationPattern.findMany({
              orderBy: { pairCount: 'desc' },
              take: limit,
            }),
            this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
              SELECT COUNT(*)::bigint AS count
              FROM correlation_pair_signatures s
              LEFT JOIN correlation_pair_verdicts v
                ON v.a_id = s.a_id AND v.b_id = s.b_id
              WHERE v.a_id IS NULL
            `),
          ]);
          return {
            workRemaining: Number(remaining[0]?.count ?? 0),
            patterns: patterns.map((p) => ({
              patternKey: p.patternKey,
              family: p.family,
              labels: p.labels,
              pairCount: p.pairCount,
              clusterCount: p.clusterCount,
              assetCount: p.assetCount,
              avgWeighted: Number(p.avgWeighted),
              topologyShape: p.topologyShape,
              ruleKind: p.ruleKind,
              // The cell worth acting on: similar, both sides have lineage,
              // and no path between them.
              unexplainedPairs: p.lineageNoPathPairs,
              explainedPairs: p.lineagePathPairs,
              unknownLineagePairs: p.lineageUnknownPairs,
            })),
          };
        },
      },
      {
        name: 'fingerprints.clear_safe_band',
        description:
          'Confirm the duplicate pairs that need no human judgement: a near-perfect score AND a lineage path explaining it (a derived copy). Deliberately narrow — anything the lineage graph cannot explain is left for a person, however high it scores, because an unexplained near-identical pair is the finding worth surfacing. Decisions are recorded as agent decisions and counted separately from human work.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum pairs to confirm (default 500, max 5000)',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.TUNE_CORRELATION,
        // Gated with the rest of the correlation controls. This writes
        // verdicts, so it must be unreachable when autopilot is off for the
        // workspace: an agent silently marking duplicates reviewed would empty
        // a person's queue without their knowledge.
        resolveGate: (_input, tc): Promise<ToolGate> =>
          Promise.resolve({
            mode: this.applier.effectiveMode(
              AiManagementMode.INHERIT,
              tc.ctx.settings.autopilotConfigEnabled,
            ),
            entityType: 'system',
          }),
        handler: async (input) => this.review.agentClearSafeBand(Number(input.limit) || 500),
      },
      {
        name: 'fingerprints.decisions',
        description:
          'Duplicate decisions already taken, and what became of them. Use `unactionedOnly` to find pairs a person confirmed as duplicates but never took into a case — those are the ready-made evidence for one. Never re-raise a pair that already has a verdict.',
        inputSchema: {
          type: 'object',
          properties: {
            verdict: {
              type: 'string',
              enum: ['CONFIRMED', 'REJECTED', 'UNSURE', 'SPLIT'],
            },
            patternKey: { type: 'string' },
            unactionedOnly: { type: 'boolean' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.review.decisions({
            verdict: input.verdict,
            patternKey: input.patternKey,
            unactionedOnly: input.unactionedOnly,
            limit: input.limit,
          }),
      },
      {
        name: 'fingerprints.decisions_to_case',
        description:
          'Take confirmed duplicate pairs into a case as evidence, creating the case or extending an existing one. This is how a duplicate finding becomes something a person can work: the assets are attached as evidence and the verdicts are linked to the case so the decision can be traced back.',
        inputSchema: {
          type: 'object',
          properties: {
            pairs: {
              type: 'array',
              items: {
                type: 'object',
                properties: { aId: { type: 'string' }, bId: { type: 'string' } },
                required: ['aId', 'bId'],
                additionalProperties: false,
              },
            },
            caseId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            attachFindings: { type: 'boolean' },
          },
          required: ['pairs'],
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
          this.review.decisionsToCase(input as never),
      },
      {
        name: 'fingerprints.match_cause',
        description:
          'Why one pair matched, as something to fix: the label carrying most of the score, the values that matched, and how many other pairs the same combination produced. Use before proposing a weight change or an exclusion, so the fix is aimed at the actual driver.',
        inputSchema: {
          type: 'object',
          properties: { aId: { type: 'string' }, bId: { type: 'string' } },
          required: ['aId', 'bId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.review.rejectCause(String(input.aId), String(input.bId)),
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
