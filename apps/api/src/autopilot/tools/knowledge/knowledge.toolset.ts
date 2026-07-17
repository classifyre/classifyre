import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { AgentMemoryService } from '../../memory/agent-memory.service';
import { SystemBriefService } from '../../harness/system-brief.service';
import { AI_ACTOR } from '../../autopilot.constants';
import type { MemoryWrite } from '../../autopilot.types';
import type { Tool } from '../tool.types';

const MEMORY_KINDS = [
  'DECISION_PRECEDENT',
  'ENTITY_MAP',
  'SOURCE_PROFILE',
  'DETECTOR_INSIGHT',
  'OPERATOR_DIRECTIVE',
] as const;

/**
 * Tools for the agent's own knowledge: writing long-lived memory and
 * reading/updating the living system brief. Memory and brief writes are
 * low-risk internal learning, so their gate is the instance AI switch (always
 * MANAGED while a cycle runs) rather than a per-entity OBSERVE_ONLY mode.
 */
@Injectable()
export class KnowledgeToolset {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly brief: SystemBriefService,
  ) {}

  list(): Tool[] {
    return [
      {
        name: 'memory.write',
        description:
          'Record a long-lived memory the agent should recall in future cycles (decision precedent, entity map, source profile, detector insight, or sacred operator directive). NOT for vocabulary: real-world names, organizations, codenames and jargon belong in glossary.propose, never here. Memories you write are UNVERIFIED hypotheses by default; set verified=true ONLY when you checked the claim against real system state this cycle (e.g. inspected the actual findings). Never mark a summary of state you did not directly observe as verified.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...MEMORY_KINDS] },
            key: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            verified: {
              type: 'boolean',
              description:
                'True only when the content was confirmed against real findings/state this cycle.',
            },
          },
          required: ['kind', 'key', 'content'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'memory',
          }),
        handler: async (input, tc) => {
          const write: MemoryWrite = {
            kind: input.kind as MemoryWrite['kind'],
            key: String(input.key),
            content: String(input.content),
            tags: (input.tags as string[] | undefined) ?? [],
            verified: input.verified === true,
          };
          const written = await this.memory.writeMany(
            [write],
            undefined,
            'AGENT',
            String(tc.ctx.run.agentKind),
          );
          return { written, verified: write.verified === true };
        },
      },
      {
        name: 'memory.list',
        description:
          'List the full memory inventory (id, kind, key, content, tags, weight) for consolidation. Bounded.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => this.memory.listForConsolidation(),
      },
      {
        name: 'memory.delete',
        description:
          'Delete one memory by id (prune noise/stale/duplicate). Never delete OPERATOR_DIRECTIVE or operator-deletion precedents.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'memory',
          }),
        handler: async (input) => {
          const deleted = await this.memory.deleteById(String(input.id));
          return { deleted };
        },
      },
      {
        name: 'memory.rewrite',
        description:
          'Rewrite one memory by id with crisper content (and optionally new tags).',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'content'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'memory',
          }),
        handler: async (input) => {
          const rewritten = await this.memory.rewriteById(
            String(input.id),
            String(input.content),
            input.tags as string[] | undefined,
          );
          return { rewritten };
        },
      },
      {
        name: 'system_brief.get',
        description:
          'Read the current system brief overview narrative (the durable framing). Coverage facts, glossary, topics, gaps and the setup checklist are composed automatically and are not editable here.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => this.brief.get(),
      },
      {
        name: 'system_brief.update',
        description:
          "Set the system-brief OVERVIEW only — a short, stable 2–4 sentence framing of what this instance is for and its posture. Provide it as 'content'. Do NOT restate coverage counts, glossary, topics or gaps; those sections are composed automatically.",
        inputSchema: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'system',
        decisionAction: AgentDecisionAction.UPDATE_SYSTEM_BRIEF,
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'system',
          }),
        handler: (input) =>
          this.brief.update({ content: String(input.content) }, AI_ACTOR),
      },
    ];
  }
}
