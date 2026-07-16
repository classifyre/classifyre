import type { AgentDecisionAction, AiManagementMode } from '@prisma/client';
import type { JsonSchema } from '../../ai';
import type { AgentContext } from '../autopilot.types';
import type { AgentAuditService } from '../audit/agent-audit.service';
import type { AgentLoggerService } from '../audit/agent-logger.service';

/**
 * Whether a tool only reads system state or mutates the domain. Mutating tools
 * are subject to OBSERVE_ONLY gating in the dispatcher; read tools never are.
 */
export type ToolSideEffect = 'read' | 'mutate';

/** The domain entity a mutating tool touches, for OBSERVE_ONLY gating. */
export type ToolDomain =
  | 'inquiry'
  | 'case'
  | 'source'
  | 'detector'
  | 'memory'
  | 'system';

/** Resolved management gate for a single tool invocation. */
export interface ToolGate {
  mode: AiManagementMode;
  /** Entity stamped on the AgentDecision (for audit/UI). */
  entityType?: ToolDomain;
  entityId?: string;
}

/** Everything a tool handler needs from the harness at call time. */
export interface ToolContext {
  ctx: AgentContext;
  audit: AgentAuditService;
  log: AgentLoggerService;
}

/**
 * A capability the autopilot agent loop can invoke. Tools are the single way
 * the harness observes or changes the system: every call is validated against
 * `inputSchema`, gated (mutating tools) and recorded as an AgentDecision by the
 * tool dispatcher.
 *
 * The generic defaults to `Record<string, unknown>` so concrete tools narrow
 * their input type while the registry can hold them as `Tool` uniformly.
 */
export interface Tool<I = Record<string, unknown>, O = unknown> {
  /** Namespaced, dot-separated, e.g. "findings.search", "inquiries.create". */
  name: string;
  /** One/two sentences shown to the model in the tool catalog. */
  description: string;
  /** JSON Schema for the tool input; validated before the handler runs. */
  inputSchema: JsonSchema;
  /**
   * Input validation mode. Default (true) is lenient — coerces scalars, fills
   * defaults and STRIPS unknown properties (robust to LLM drift, but it also
   * empties free-form nested objects). Set false for tools whose input carries
   * arbitrary nested payloads (e.g. a detector pipeline schema or a source
   * config patch): the input is validated strictly and passed through intact.
   */
  lenientInput?: boolean;
  sideEffect: ToolSideEffect;
  /** Domain for gating + audit; null/undefined for instance-level reads. */
  domain?: ToolDomain | null;
  /**
   * Decision action recorded for a successful mutate call. Defaults to
   * TOOL_CALL; specific mutating tools set a finer action (e.g. CREATE_INQUIRY)
   * so the audit trail reads naturally.
   */
  decisionAction?: AgentDecisionAction;
  /**
   * Resolve the effective management mode for THIS invocation (entity aiMode →
   * instance flag). REQUIRED for `mutate` tools — the dispatcher fails closed
   * (treats the call as OBSERVE_ONLY) when a mutating tool omits it.
   */
  resolveGate?(input: I, tc: ToolContext): Promise<ToolGate>;
  /**
   * Perform the tool's work and return a JSON-serializable result that is fed
   * back to the model as the tool observation. Throw to signal failure (the
   * dispatcher records FAILED and returns the error to the model).
   */
  handler(input: I, tc: ToolContext): Promise<O>;
}

/**
 * Outcome of one dispatched tool call, returned to the agent loop.
 *
 * APPLIED means a mutation was performed and a decision row recorded. READ_OK
 * means a read tool returned successfully and nothing changed. They are
 * distinct because run summaries report "N applied": counting reads as applied
 * produced summaries like "11 applied" for runs whose persisted decisionCount
 * was 0, which is how the logs stopped being trustworthy.
 */
export interface ToolCallResult {
  tool: string;
  outcome:
    | 'APPLIED'
    | 'READ_OK'
    | 'SKIPPED_OBSERVE_ONLY'
    | 'FAILED'
    | 'DEDUPED';
  /** JSON-serializable observation (handler result, or an error description). */
  result: unknown;
}
