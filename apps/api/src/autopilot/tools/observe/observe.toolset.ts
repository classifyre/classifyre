import { Injectable } from '@nestjs/common';
import { AgentMemoryKind } from '@prisma/client';
import { AgentSearchService } from '../../search/agent-search.service';
import { AgentMemoryService } from '../../memory/agent-memory.service';
import { MAX_GLOSSARY_ENTRIES } from '../../autopilot.constants';
import type { Tool } from '../tool.types';

const EMPTY_INPUT = {
  type: 'object',
  properties: {},
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
          'Bounded, redacted sample of raw assets in scope — name, kind and a preview of each asset’s metadata fields. The concrete material to hypothesise a detector from when there are no findings to learn from.',
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
          'List all ACTIVE inquiries as compact summaries (matchers, counts, linked cases) for dedupe/enrichment.',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.listActiveInquiries(),
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
          'List OPEN/IN_PROGRESS cases as compact summaries (status, severity, hypotheses, counts).',
        inputSchema: EMPTY_INPUT,
        sideEffect: 'read',
        handler: async () => this.search.listOpenCases(),
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
          'Full detail of one case: hypotheses (threadIds), evidence (assetIds), findings, graph edges, linked inquiries.',
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
        name: 'memory.search',
        description:
          'Recall long-lived agent memory (glossary, decision precedents, topic→entity maps) by free-text query.',
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
          const [glossary, related] = await Promise.all([
            this.memory.topByWeight(
              AgentMemoryKind.GLOSSARY,
              MAX_GLOSSARY_ENTRIES,
            ),
            this.memory.recall(
              [AgentMemoryKind.ENTITY_MAP, AgentMemoryKind.DECISION_PRECEDENT],
              terms,
            ),
          ]);
          return [...glossary, ...related];
        },
      },
    ];
  }
}
