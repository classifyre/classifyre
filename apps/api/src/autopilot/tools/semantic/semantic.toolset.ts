import { Injectable } from '@nestjs/common';
import { AgentSemanticService } from '../../search/agent-semantic.service';
import type { Tool } from '../tool.types';

/**
 * Semantic evidence tools: corpus-relative importance ranking, free-text
 * semantic retrieval, neighbour expansion and boilerplate triage. All
 * read-only. Descriptions repeatedly anchor the two ground rules from the
 * first-use retrospective: severity is not importance, and similarity is not
 * proof.
 */
@Injectable()
export class SemanticToolset {
  constructor(private readonly semantic: AgentSemanticService) {}

  list(): Tool[] {
    return [
      {
        name: 'findings.ranked',
        description:
          'Top OPEN findings by evidence importance — the corpus-relative triage order (quality, novelty, cross-document recurrence, context; NOT detector severity). One representative per duplicate group, with the reason codes behind each score. Start investigative triage here instead of severity.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description: 'Optional source id; defaults to the run scope.',
            },
            limit: { type: 'number', description: 'Max rows (default 25).' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) => {
          const sourceId =
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId ?? null;
          return this.semantic.rankedFindings(
            sourceId,
            typeof input.limit === 'number' ? input.limit : undefined,
          );
        },
      },
      {
        name: 'findings.semantic_search',
        description:
          'Free-text semantic search over finding evidence (meaning, not keywords) — use it to explore a hypothesis ("payments routed through shell companies") when exact terms are unknown. Results carry importance + reasons. Similarity is retrieval guidance, never proof of a relationship.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to look for.' },
            sourceId: {
              type: 'string',
              description: 'Optional source id to scope the search.',
            },
            limit: { type: 'number', description: 'Max rows (default 15).' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) =>
          this.semantic.semanticSearch(
            typeof input.query === 'string' ? input.query : '',
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId ?? null,
            typeof input.limit === 'number' ? input.limit : undefined,
          ),
      },
      {
        name: 'findings.similar',
        description:
          'Semantic neighbours of one finding across the whole corpus. Use it to expand a confirmed lead (what else looks like this?) or to test whether a striking finding is actually one of many near-copies. Similar evidence is a lead to verify against source text, not a connection.',
        inputSchema: {
          type: 'object',
          properties: {
            findingId: { type: 'string' },
            limit: { type: 'number', description: 'Max rows (default 10).' },
          },
          required: ['findingId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.semantic.similarFindings(
            typeof input.findingId === 'string' ? input.findingId : '',
            typeof input.limit === 'number' ? input.limit : undefined,
          ),
      },
      {
        name: 'findings.explain',
        description:
          'Full evidence-ranking explanation for one finding: importance, quality, outlier strength, duplicate group size, reason list and raw signals, with detector severity/confidence kept separate. Call before escalating or attaching a finding to a case.',
        inputSchema: {
          type: 'object',
          properties: { findingId: { type: 'string' } },
          required: ['findingId'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.semantic.explainFinding(
            typeof input.findingId === 'string' ? input.findingId : '',
          ),
      },
      {
        name: 'findings.boilerplate',
        description:
          'Near-duplicate boilerplate clusters in a source (repeated headers, form text, OCR artifacts). These are noise to skip or bulk-triage — never present a boilerplate cluster as an investigative pattern.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: {
              type: 'string',
              description: 'Optional source id; defaults to the run scope.',
            },
            threshold: {
              type: 'number',
              description: 'Similarity threshold 0.8–1 (default 0.95).',
            },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input, tc) => {
          const sourceId =
            (input.sourceId as string | undefined) ?? tc.ctx.sourceId;
          if (!sourceId) {
            return {
              error: 'sourceId is required outside a source-scoped run',
            };
          }
          return this.semantic.boilerplateClusters(
            sourceId,
            typeof input.threshold === 'number' ? input.threshold : undefined,
          );
        },
      },
    ];
  }
}
