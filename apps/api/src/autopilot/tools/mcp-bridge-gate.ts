import type { ToolContext } from './tool.types';

/**
 * AgentContext.state key marking a caller that may mutate through the bridged
 * built-in MCP tools.
 *
 * The bridge adapter treats every non-read MCP tool as mutating and fails
 * closed, because the MCP surface carries no gate of its own — it has no actor
 * attribution and no decision ledger, so the dispatcher is the only thing that
 * makes those calls reviewable. Until now the single caller that could open
 * that gate was a chat bot, and the check lived in the chat adapter.
 *
 * The supervisor is the second such caller, and it is not a chat bot. Rather
 * than teach the adapter about every future caller, both set a flag here.
 *
 * This flag is deliberately coarse: it says "this caller is authorised in
 * principle", not "this caller may call this tool". Per-tool authority is the
 * loop's granted set, which the capability menu writes — so switching off a
 * capability group removes the tool from the granted list and the call is
 * refused before it ever reaches a gate.
 */
export const MCP_BRIDGE_STATE_KEY = 'mcp:bridge';

export interface McpBridgeState {
  allowMutations: boolean;
}

/** True when the current run was started by a caller allowed to mutate. */
export function bridgeMutationsAllowed(tc: ToolContext): boolean {
  const value = tc.ctx.state[MCP_BRIDGE_STATE_KEY];
  if (!value || typeof value !== 'object') return false;
  return (value as Partial<McpBridgeState>).allowMutations === true;
}
