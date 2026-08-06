import { Injectable } from '@nestjs/common';
import { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import { AgentMemoryService } from '../../memory/agent-memory.service';
import { SystemBriefService } from '../../harness/system-brief.service';
import {
  AI_ACTOR,
  DEFERRED_KEY_PREFIX,
  DEFERRED_TAG,
} from '../../autopilot.constants';
import type { MemoryWrite } from '../../autopilot.types';
import type { Tool } from '../tool.types';

const MEMORY_KINDS = [
  'DECISION_PRECEDENT',
  'ENTITY_MAP',
  'SOURCE_PROFILE',
  'DETECTOR_INSIGHT',
  'OPERATOR_DIRECTIVE',
] as const;

const DEFAULT_REVISIT_COVERAGE = 0.9;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

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
        name: 'agenda.defer',
        description:
          'Park something for a later cycle that will have more of the corpus. Use when you have noticed a pattern worth pursuing but cannot justify acting on it yet — too little coverage, evidence still being scored, or a hypothesis needing sources that have not been scanned. This is the correct move for "I expect this to recur elsewhere": it records the intent without creating an inquiry that would have to be reconciled later. Deferred items are surfaced back to you once coverage reaches revisitAtCoverage.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description:
                'Short stable identifier for what is being deferred.',
            },
            reason: {
              type: 'string',
              description:
                'What you observed and what is missing before it can be acted on.',
            },
            revisitAtCoverage: {
              type: 'number',
              description:
                'Scanned-source fraction (0–1) at which this is worth revisiting. Defaults to 0.9.',
            },
          },
          required: ['topic', 'reason'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'memory',
        decisionAction: AgentDecisionAction.NO_ACTION,
        resolveGate: () =>
          Promise.resolve({
            mode: AiManagementMode.MANAGED,
            entityType: 'memory',
          }),
        handler: async (input, tc) => {
          const revisitAtCoverage = clamp01(
            typeof input.revisitAtCoverage === 'number'
              ? input.revisitAtCoverage
              : DEFAULT_REVISIT_COVERAGE,
          );
          const topic = String(input.topic);
          await this.memory.writeMany(
            [
              {
                kind: 'DECISION_PRECEDENT',
                key: `${DEFERRED_KEY_PREFIX}${topic}`,
                content: `${String(input.reason)} (revisit at ${Math.round(revisitAtCoverage * 100)}% corpus coverage)`,
                tags: [DEFERRED_TAG, `revisit-at:${revisitAtCoverage}`],
                verified: false,
              },
            ],
            undefined,
            'AGENT',
            String(tc.ctx.run.agentKind),
          );
          return { deferred: topic, revisitAtCoverage };
        },
      },
      {
        name: 'memory.write',
        description:
          'Record a long-lived memory the agent should recall in future cycles (decision precedent, entity map, source profile, detector insight, or sacred operator directive). Memory is for durable facts that change a FUTURE decision — not a diary. Do NOT record that a cycle reviewed things and found nothing new, or that ranking was unavailable: the run summary already says so, one such note per cycle buries the memories that matter, and every one of them is re-read and re-billed on every later run. NOT for vocabulary: real-world names, organizations, codenames and jargon belong in glossary.propose, never here. Memories you write are UNVERIFIED hypotheses by default; set verified=true ONLY when you checked the claim against real system state this cycle (e.g. inspected the actual findings). Never mark a summary of state you did not directly observe as verified.',
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
