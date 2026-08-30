import type { ToolContext } from './tool.types';

/**
 * AgentContext.state key carrying the tool names this run may call.
 *
 * The loop already enforces this list before dispatch. It is repeated here
 * because `tools.search` has to answer "what can I call?" from inside a handler,
 * and a search that offered tools the dispatcher would then refuse would teach
 * the model a menu it cannot order from — which costs an iteration per lesson,
 * every run, forever.
 */
export const GRANTED_TOOLS_STATE_KEY = 'tools:granted';

/**
 * Names this run may call, or null when the run never declared a set.
 *
 * Null means "this caller does not use search-based disclosure" — every
 * existing mission — and the meta tools say so rather than quietly falling back
 * to the whole registry.
 */
export function grantedToolsFor(tc: ToolContext): string[] | null {
  const value = tc.ctx.state[GRANTED_TOOLS_STATE_KEY];
  if (!Array.isArray(value)) return null;
  return value.filter((n): n is string => typeof n === 'string');
}
