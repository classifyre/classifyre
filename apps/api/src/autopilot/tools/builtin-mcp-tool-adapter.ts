import { AiManagementMode } from '@prisma/client';
import type { Tool, ToolContext } from './tool.types';
import { bridgeMutationsAllowed } from './mcp-bridge-gate';

/** Namespace of the bridged built-in Classifyre MCP tools in the registry. */
export const BUILTIN_MCP_PREFIX = 'mcp.builtin.';

/** Tool shape as listed by the MCP client from the built-in server. */
export interface BuiltinRemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * Adapt one built-in Classifyre MCP tool into a harness Tool, namespaced as
 * `mcp.builtin.<name>`. Read tools (readOnlyHint) run ungated; everything else
 * is treated as mutating (fail-closed) and only runs for a run that set the
 * bridge flag (see {@link bridgeMutationsAllowed}). For any other caller the
 * gate resolves OBSERVE_ONLY, so the dispatcher records the call without
 * executing it.
 */
export function adaptBuiltinMcpTool(opts: {
  remote: BuiltinRemoteTool;
  call: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}): Tool {
  const readOnly = opts.remote.annotations?.readOnlyHint === true;
  return {
    name: `${BUILTIN_MCP_PREFIX}${opts.remote.name}`,
    description:
      opts.remote.description?.trim() ||
      `Built-in Classifyre MCP tool "${opts.remote.name}".`,
    inputSchema: opts.remote.inputSchema ?? {
      type: 'object',
      additionalProperties: true,
    },
    // Preserve the tool's argument shape verbatim (source configs, pipelines…).
    lenientInput: false,
    sideEffect: readOnly ? 'read' : 'mutate',
    domain: 'system',
    resolveGate: readOnly
      ? undefined
      : (_input, tc: ToolContext) =>
          Promise.resolve({
            mode: bridgeMutationsAllowed(tc)
              ? AiManagementMode.MANAGED
              : AiManagementMode.OBSERVE_ONLY,
            entityType: 'system' as const,
          }),
    handler: async (input) => opts.call(opts.remote.name, input),
  };
}
