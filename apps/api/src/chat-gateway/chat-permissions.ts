import { AiManagementMode } from '@prisma/client';
import { MCP_CAPABILITY_GROUPS } from '../mcp-catalog';
import type { Tool } from '../autopilot/tools/tool.types';
import { BUILTIN_MCP_PREFIX } from './builtin-mcp-tool-adapter';

/**
 * Autopilot investigation tools a chat bot may use directly (cases,
 * hypotheses, evidence, inquiries). Curated: graph-edge and memory tools stay
 * agent-only. In a chat turn their writes are recorded, never run (see
 * withChatBotGate).
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
 * A chat turn never changes anything: a chat message has no signed-in person
 * behind it (docs/prd/IAM-access-management.md, H-1). Mutating tools resolve
 * OBSERVE_ONLY whatever the autopilot settings say, so the dispatcher records
 * the call without running it. Read tools pass through.
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
      return { ...base, mode: AiManagementMode.OBSERVE_ONLY };
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
