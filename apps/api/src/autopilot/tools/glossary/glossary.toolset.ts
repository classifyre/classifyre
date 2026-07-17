import { Injectable } from '@nestjs/common';
import { AiManagementMode } from '@prisma/client';
import { GlossaryService } from '../../../glossary/glossary.service';
import type { Tool } from '../tool.types';

/**
 * Shared-vocabulary tools. The glossary is the one namespace investigators and
 * agents both read: canonical terms, aliases and entity typing. Agents may
 * propose terms, but proposals stay unverified until an operator confirms.
 */
@Injectable()
export class GlossaryToolset {
  constructor(private readonly glossary: GlossaryService) {}

  list(): Tool[] {
    return [
      {
        name: 'glossary.lookup',
        description:
          'Resolve a name, alias or concept against the shared investigation glossary (exact, alias and semantic matches). Use it before treating two spellings as different entities, and to adopt the canonical term the operator uses.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Name/alias to resolve.' },
            limit: { type: 'number', description: 'Max results (default 10).' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async (input) =>
          this.glossary.lookup(
            typeof input.query === 'string' ? input.query : '',
            typeof input.limit === 'number' ? input.limit : undefined,
          ),
      },
      {
        name: 'glossary.propose',
        description:
          'Propose a SHARED VOCABULARY term for the operator-facing glossary: the canonical spelling of a real-world person, organization, location, project codename, document reference, or recurring domain jargon found in the corpus (e.g. term "Jane Doe" aliases ["J. Doe", "Doe, Jane"]; term "Project Aurora"). Write the term the way a human would say it — never snake_case slugs, ids, or hashes. This is NOT a place for observations, per-source summaries, or investigation state; those belong in memory.write. Proposals are UNVERIFIED until an operator confirms them and never overwrite operator-curated terms — at most your aliases are merged. Never re-propose a term an operator removed.',
        inputSchema: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } },
            entityType: {
              type: 'string',
              enum: [
                'PERSON',
                'ORGANIZATION',
                'LOCATION',
                'REFERENCE',
                'TERM',
                'OTHER',
              ],
            },
            notes: {
              type: 'string',
              description: 'Why this term matters; keep to 1-2 sentences.',
            },
          },
          required: ['term'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'memory',
          }),
        handler: async (input, tc) =>
          this.glossary.upsert({
            term: typeof input.term === 'string' ? input.term : '',
            aliases: (input.aliases as string[] | undefined) ?? [],
            entityType: input.entityType as never,
            notes: input.notes as string | undefined,
            origin: 'AGENT',
            author: String(tc.ctx.run.agentKind),
          }),
      },
    ];
  }
}
