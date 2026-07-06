import { AiManagementMode } from '@prisma/client';
import { MCP_CAPABILITY_GROUPS } from '../mcp-catalog';
import type { Tool } from '../autopilot/tools/tool.types';
import { BUILTIN_MCP_PREFIX, chatBotState } from './builtin-mcp-tool-adapter';

/**
 * Autopilot investigation tools a chat bot may use directly (cases,
 * hypotheses, evidence, inquiries). Curated: graph-edge and memory tools stay
 * agent-only. Their own gates key on autopilot enablement; in a chat turn
 * that is overridden by the bot's allowMutations (see withChatBotGate) —
 * a human asking in chat is manual operation, not an autonomous cycle.
 */
export const CHAT_INVESTIGATION_TOOL_NAMES = [
  'cases.list',
  'cases.closed',
  'cases.detail',
  'cases.create',
  'cases.update_fields',
  'cases.close',
  'cases.reopen',
  'cases.add_hypothesis',
  'cases.update_hypothesis',
  'cases.add_evidence',
  'cases.attach_findings',
  'cases.add_note',
  'cases.link_support',
  'inquiries.list',
  'inquiries.create',
  'inquiries.update',
] as const;

/**
 * In a chat turn the ONLY mutation gate that matters is the bot's
 * allowMutations flag: the operator asked in person, so autopilot
 * enablement settings do not apply. Preserves the original gate's
 * entity/decision metadata, overrides just the mode. Read tools pass through.
 */
export function withChatBotGate(tool: Tool): Tool {
  if (tool.sideEffect === 'read') return tool;
  return {
    ...tool,
    resolveGate: async (input, tc) => {
      const base = (await tool.resolveGate?.(input, tc)) ?? {
        mode: AiManagementMode.MANAGED,
        entityType: 'system' as const,
      };
      return {
        ...base,
        mode: chatBotState(tc)?.allowMutations
          ? AiManagementMode.MANAGED
          : AiManagementMode.OBSERVE_ONLY,
      };
    },
  };
}

/**
 * Registry names of the built-in MCP tools a bot may call. Empty
 * `capabilityGroups` means "all" — every bridged tool, including any not
 * listed in a catalog group. A specific selection maps group ids through
 * MCP_CAPABILITY_GROUPS (unknown ids are ignored) and intersects with what
 * the bridge actually registered.
 */
export function allowedBuiltinToolNames(
  capabilityGroups: string[],
  bridgedNames: string[],
): string[] {
  if (capabilityGroups.length === 0) return [...bridgedNames];
  const selected = new Set(
    MCP_CAPABILITY_GROUPS.filter((g) => capabilityGroups.includes(g.id))
      .flatMap((g) => g.toolNames)
      .map((name) => `${BUILTIN_MCP_PREFIX}${name}`),
  );
  return bridgedNames.filter((name) => selected.has(name));
}
