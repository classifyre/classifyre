import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentKind, AgentRunStatus, AiManagementMode } from '@prisma/client';
import { AutopilotService } from '../autopilot/autopilot.service';
import { ToolRegistry } from '../autopilot/tools/tool-registry.service';
import type { Tool, ToolContext } from '../autopilot/tools/tool.types';
import { chatBotState } from './builtin-mcp-tool-adapter';

/** AgentKinds a chat bot may steer (CHAT itself is never steerable). */
type SteerableKind = Exclude<AgentKind, typeof AgentKind.CHAT>;
const STEERABLE_KINDS = Object.values(AgentKind).filter(
  (k): k is SteerableKind => k !== AgentKind.CHAT,
);

/**
 * Chat-only tools that let the bot talk to the autopilot harness: steer a
 * cycle (create cases/inquiries, tune configs, author detectors via the
 * background agents) and inspect its runs. Registered at runtime so the
 * autopilot missions — which enumerate their tools explicitly — never see
 * them.
 */
@Injectable()
export class ChatHarnessToolset implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly autopilot: AutopilotService,
  ) {}

  onModuleInit(): void {
    for (const tool of this.list()) this.registry.register(tool);
  }

  names(): string[] {
    return this.list().map((t) => t.name);
  }

  private list(): Tool[] {
    return [this.triggerTool(), this.runsSearchTool(), this.runGetTool()];
  }

  private triggerTool(): Tool {
    return {
      name: 'autopilot.trigger',
      description:
        'Steer the autonomous autopilot agents: enqueue a background cycle with a natural-language ' +
        'instruction. Use it to create/curate investigation cases and inquiries (INQUIRY, CASE), tune ' +
        'source configs (CONFIG), author custom detectors (DETECTOR_AUTHOR) or consolidate memory (DREAM). ' +
        'The cycle runs asynchronously — report the returned run ids and check later with autopilot.run_get.',
      inputSchema: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: 'What the agents should do or pay attention to.',
          },
          sourceId: {
            type: 'string',
            description: 'Limit the review to one source (optional).',
          },
          caseId: {
            type: 'string',
            description: 'Focus the CASE agent on one case (optional).',
          },
          agentKinds: {
            type: 'array',
            items: { type: 'string', enum: STEERABLE_KINDS },
            description: 'Which agents to run; omit for the full pipeline.',
          },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
      sideEffect: 'mutate',
      domain: 'system',
      resolveGate: (_input, tc: ToolContext) =>
        Promise.resolve({
          mode: chatBotState(tc)?.allowMutations
            ? AiManagementMode.MANAGED
            : AiManagementMode.OBSERVE_ONLY,
          entityType: 'system' as const,
        }),
      handler: async (input, tc) => {
        const bot = chatBotState(tc);
        const requested = normalizeKinds(input.agentKinds);
        if (bot && bot.agentKinds.length > 0) {
          const disallowed = requested.filter(
            (k) => !bot.agentKinds.includes(k),
          );
          if (requested.length === 0 || disallowed.length > 0) {
            throw new Error(
              `This bot may only steer these agents: ${bot.agentKinds.join(', ')}. ` +
                'Pass agentKinds restricted to that list.',
            );
          }
        }
        return this.autopilot.trigger({
          instruction: (asOptionalString(input.instruction) ?? '').slice(
            0,
            4000,
          ),
          sourceId: asOptionalString(input.sourceId),
          caseId: asOptionalString(input.caseId),
          agentKinds: requested.length > 0 ? requested : undefined,
        });
      },
    };
  }

  private runsSearchTool(): Tool {
    return {
      name: 'autopilot.runs_search',
      description:
        'List recent autopilot agent runs (kind, status, summary, tokens). Filter by agentKind, ' +
        'status (PENDING/RUNNING/COMPLETED/FAILED/SKIPPED/CANCELLED), trigger or a search string.',
      inputSchema: {
        type: 'object',
        properties: {
          agentKind: { type: 'string', enum: Object.values(AgentKind) },
          status: { type: 'string' },
          trigger: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'number', description: 'Max rows (default 20).' },
        },
        additionalProperties: false,
      },
      sideEffect: 'read',
      handler: async (input) =>
        this.autopilot.listRuns({
          agentKind: asEnumValue(input.agentKind, Object.values(AgentKind)),
          status: asEnumValue(input.status, Object.values(AgentRunStatus)),
          trigger: asOptionalString(input.trigger),
          search: asOptionalString(input.search),
          skip: 0,
          limit: typeof input.limit === 'number' ? input.limit : 20,
        }),
    };
  }

  private runGetTool(): Tool {
    return {
      name: 'autopilot.run_get',
      description:
        'Fetch one autopilot run by id: status, summary, decisions taken and token usage. ' +
        'Use it to report the outcome of a cycle started with autopilot.trigger.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      sideEffect: 'read',
      handler: async (input) => this.autopilot.getRun(String(input.id)),
    };
  }
}

function normalizeKinds(value: unknown): SteerableKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is SteerableKind =>
    STEERABLE_KINDS.includes(k as SteerableKind),
  );
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asEnumValue<T extends string>(
  value: unknown,
  allowed: T[],
): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}
