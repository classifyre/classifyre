import type { Tool } from './tool.types';

/**
 * The read side of the tool registry, as an injectable interface.
 *
 * One of two fixes for the same knot, and they address different halves of it.
 * The registry constructs every toolset; the supervisor's toolset needs agent
 * configuration; AgentConfigService validates tool names against the registry.
 * That closes a loop twice over:
 *
 *  - as an ES import cycle, which fails at module evaluation with "cannot
 *    access X before initialization" — this token breaks it, because the
 *    consumer then imports only tool types;
 *  - as a Nest dependency cycle, which does not fail at all under this runtime.
 *    The application simply stops initialising, silently, with the event loop
 *    draining while a promise waits forever and no error anywhere. That half is
 *    broken by SupervisorToolset resolving AgentConfigService through ModuleRef
 *    instead of injecting it.
 *
 * Removing either fix brings the whole knot back, so both have to stay.
 *
 * The provider is still the one live ToolRegistry (`useExisting`), so there is
 * no second catalog to drift.
 */
export interface ToolCatalog {
  get(name: string): Tool | undefined;
  list(allowed?: string[]): Tool[];
  names(): string[];
}

export const TOOL_CATALOG = Symbol('TOOL_CATALOG');
