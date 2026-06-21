import { AiManagementMode } from '@prisma/client';
import type { JsonSchema } from '../../ai';
import type { Tool, ToolContext } from '../tools/tool.types';

export interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Adapt a remote MCP tool into a harness Tool. Namespaced as
 * `mcp.<slug>.<remoteName>`. External tools are treated as MUTATING and only
 * run when the instance MCP flag is on AND the server is trusted — otherwise
 * the dispatcher records them observe-only and never invokes the remote.
 */
export function adaptMcpTool(opts: {
  slug: string;
  trusted: boolean;
  remote: RemoteTool;
  call: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
}): Tool {
  return {
    name: `mcp.${opts.slug}.${opts.remote.name}`,
    description:
      opts.remote.description?.trim() ||
      `External MCP tool "${opts.remote.name}" from server "${opts.slug}".`,
    inputSchema:
      (opts.remote.inputSchema as JsonSchema | undefined) ?? {
        type: 'object',
        additionalProperties: true,
      },
    // Preserve the remote tool's arbitrary argument shape verbatim.
    lenientInput: false,
    sideEffect: 'mutate',
    domain: null,
    resolveGate: async (_input, tc: ToolContext) => ({
      mode:
        tc.ctx.settings.autopilotMcpEnabled && opts.trusted
          ? AiManagementMode.MANAGED
          : AiManagementMode.OBSERVE_ONLY,
      entityType: 'system',
    }),
    handler: async (input) =>
      opts.call(opts.remote.name, input as Record<string, unknown>),
  };
}
