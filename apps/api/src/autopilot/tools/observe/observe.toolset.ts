import { Injectable } from '@nestjs/common';
import { AgentMemoryKind } from '@prisma/client';
import { AgentSearchService } from '../../search/agent-search.service';
import { AgentMemoryService } from '../../memory/agent-memory.service';
import { RANKED_LIST_PAGE_SIZE } from '../../autopilot.constants';
import type { Tool } from '../tool.types';

const EMPTY_INPUT = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const RANKED_PAGE_INPUT = {
  type: 'object',
  properties: {
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: RANKED_LIST_PAGE_SIZE,
      default: RANKED_LIST_PAGE_SIZE,
    },
  },
  additionalProperties: false,
} as const;

/**
 * Read-only observation tools. Thin wrappers over the existing
 * AgentSearchService / AgentMemoryService so the agent loop can pull exactly
 * the slices of system state it needs, rather than receiving a fixed context
 * blob. None mutate; none are gated.
 */
@Injectable()
export class ObserveToolset {
  constructor(
    private readonly search: AgentSearchService,
    private readonly memory: AgentMemoryService,
  ) {}

  list(): Tool[] {
    return [
      {
        name: 'findings.search',
        description:
          'List open findings in scope, grouped by detector + finding type with bounded samples. Defaults to the current run/source scope. Pass customDetectorKey to isolate the findings one custom detector produced (use it to verify a detector you authored).',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description: 'Optional source id; defaults to the run scope.',
            },
            customDetectorKey: {
              type: 'string',
              description:
                'Optional: only findings from this custom detector key.',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) => {
          const sourceId =
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId;
          return this.search.summarizeNewFindings(
            sourceId,
            tc.ctx.manual ? null : tc.ctx.runnerId,
            (input.customDetectorKey as string | undefined) ?? null,
          );
        },
      },
      {
        name: 'assets.profile',
        description:
          'Aggregate shape of the ingested assets in scope: asset/source kinds, the most common metadata fields, and whether any finding exists yet. Use this to bootstrap detection on a source that has produced no findings (cold start).',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description: 'Optional source id; defaults to the run scope.',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) => {
          const sourceId =
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId;
          return this.search.assetMetadataProfile(
            sourceId,
            tc.ctx.manual ? null : tc.ctx.runnerId,
          );
        },
      },
      {
        name: 'assets.sample',
        description:
          'Bounded, redacted sample of assets in scope — id, name, kind, metadata fields and an extracted contentPreview when available. Use the id as detector.test sampleAssetId for real image/PDF tests. The concrete material to hypothesise a detector from when there are no findings to learn from.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description: 'Optional source id; defaults to the run scope.',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) => {
          const sourceId =
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId;
          return this.search.sampleAssets(
            sourceId,
            tc.ctx.manual ? null : tc.ctx.runnerId,
          );
        },
      },
      {
        name: 'inquiries.list',
        description:
          'List ACTIVE inquiries as complete, priority-ranked pages for dedupe/enrichment. Operator-created and inquiries with new matches lead. Continue with nextOffset when present. If omitted is above zero the dedupe check is incomplete — page again and search memory before creating.',
        inputSchema: RANKED_PAGE_INPUT,
        sideEffect: 'read',
        handler: async (input) =>
          this.search.listActiveInquiries({
            offset: input.offset as number | undefined,
            limit: input.limit as number | undefined,
          }),
      },
      {
        name: 'inquiries.archived',
        description:
          'List recently ARCHIVED inquiries — intentionally closed topics that must not be blindly recreated.',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.listRecentlyArchivedInquiries(),
      },
      {
        name: 'inquiries.sample_matches',
        description:
          'Sample the findings currently matching one inquiry (bounded).',
        inputSchema: {
          type: 'object',
          properties: { inquiryId: { type: 'string' } },
          required: ['inquiryId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.search.sampleInquiryMatches(input.inquiryId as string),
      },
      {
        name: 'cases.list',
        description:
          'List OPEN/IN_PROGRESS cases as complete pages in priority order, not date order: operator-created first, then severity, unevaluated hypotheses, and oldest attention. Each item carries rank, priority, and aiMode. INHERIT is managed during an enabled or manual CASE run, MANAGED is an explicit override, and OBSERVE_ONLY can be read but never mutated. Work from the top, justify any skip, and continue with nextOffset when present.',
        inputSchema: RANKED_PAGE_INPUT,
        sideEffect: 'read',
        handler: async (input) =>
          this.search.listOpenCases({
            offset: input.offset as number | undefined,
            limit: input.limit as number | undefined,
          }),
      },
      {
        name: 'cases.closed',
        description:
          'List recently CLOSED/ARCHIVED cases with their conclusions — solved topics to learn from.',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.listRecentlyClosedCases(),
      },
      {
        name: 'cases.detail',
        description:
          'Full detail of one case: hypotheses (threadIds), evidence (assetIds), findings, graph edges, linked inquiries and case-linked glossary vocabulary.',
        inputSchema: {
          type: 'object',
          properties: { caseId: { type: 'string' } },
          required: ['caseId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.search.caseDetail(input.caseId as string),
      },
      {
        name: 'duplicates.summary',
        description:
          'Duplicate/cluster signals the duplicates finder produced for the scan scope (clusters + top correlated pairs).',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async (_input, tc) =>
          this.search.summarizeDuplicatesForRunner(
            tc.ctx.sourceId,
            tc.ctx.manual ? null : tc.ctx.runnerId,
          ),
      },
      {
        name: 'corpus.coverage',
        description:
          'How much of the corpus has actually been scanned: scanned/never-scanned/in-flight/failing source counts, per-source scan state and text coverage, and how many open findings have an evidence score yet. Call this before making any claim about "the corpus", about the absence of something, or about a pattern holding across sources — a conclusion drawn at low coverage is a conclusion about a sample.',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.corpusCoverage(),
      },
      {
        name: 'findings.unmonitored',
        description:
          'High-importance open findings that NO active inquiry matches — evidence nobody is watching. The inverse of corpus.coverage: that tells you how much of the data has been READ, this tells you how much of what was found is being TRACKED. Grouped by detector and finding type, with sample finding ids you can build a matcher from. Start here when deciding whether a new inquiry is warranted.',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.unmonitoredFindings(),
      },
      {
        name: 'memory.search',
        description:
          'Recall long-lived agent memory (decision precedents, topic→entity maps) by free-text query. For shared vocabulary (names, orgs, codenames) use glossary.lookup instead.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Free text; split into OR-ed search terms.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) => {
          const terms = (typeof input.query === 'string' ? input.query : '')
            .split(/\s+/)
            .filter(Boolean);
          return this.memory.recall(
            [AgentMemoryKind.ENTITY_MAP, AgentMemoryKind.DECISION_PRECEDENT],
            terms,
          );
        },
      },
    ];
  }
}
