import type { AgentKind } from '@prisma/client';
import type { AiMessage, JsonSchema } from '../../ai';
import type { ToolRegistry } from '../tools/tool-registry.service';
import type { LoopTurn } from '../harness/agent-loop';

/**
 * Probe groups, in execution order. PROTOCOL is the gate: a model that cannot
 * hold the turn contract cannot drive the loop at all, so the suite aborts
 * there rather than spending tokens proving the obvious downstream.
 */
export type ProbeTier =
  | 'PROTOCOL'
  | 'TOOL_USE'
  | 'CHAINING'
  | 'JUDGMENT'
  | 'CAPACITY';

export type ProbeStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'ERROR';

/** Grading outcome for one probe. */
export interface ProbeGrade {
  status: ProbeStatus;
  /** Human-readable justification — always populated, pass or fail. */
  reason: string;
}

/** What the probe suite hands each probe when building its prompt. */
export interface ProbeBuildContext {
  registry: ToolRegistry;
  /** Tool names the probe prompts advertise (a real, small mission subset). */
  allowedTools: string[];
  /** Rendered catalog for `allowedTools` — the real registry rendering. */
  catalog: string;
}

/**
 * One LLM-backed probe: builds a conversation, then grades the parsed turn.
 * Probes never dispatch a tool handler — every observation they feed back is a
 * synthetic fixture, which is what makes the suite safe to run in production.
 */
export interface LlmProbe {
  id: string;
  tier: Exclude<ProbeTier, 'CAPACITY'>;
  title: string;
  /** One sentence: which harness requirement this probe stands in for. */
  whatItProves: string;
  /**
   * Messages to send. `schema` defaults to the real loopTurnSchema; a probe
   * may narrow it. `maxRetries` > 0 only for the recovery probe — every other
   * probe measures first-shot compliance, because the harness pays for retries.
   */
  build(ctx: ProbeBuildContext): {
    messages: AiMessage[];
    schema?: JsonSchema;
    maxRetries?: number;
  };
  grade(turn: LoopTurn, ctx: ProbeBuildContext): ProbeGrade;
}

/** Result of one executed probe, including everything needed to audit it. */
export interface ProbeResult {
  id: string;
  tier: ProbeTier;
  title: string;
  whatItProves: string;
  status: ProbeStatus;
  reason: string;
  /** The final user-turn text sent, so the operator can see what was asked. */
  prompt: string | null;
  /** Verbatim model output. Null for CAPACITY probes (no LLM call). */
  rawOutput: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Per-agent readiness derived from probe outcomes + context arithmetic. */
export type AgentReadiness = 'READY' | 'DEGRADED' | 'WILL_FAIL' | 'UNKNOWN';

export interface AgentCapacityReport {
  kind: AgentKind;
  readiness: AgentReadiness;
  /** Why it got that verdict — the operator-facing explanation. */
  reason: string;
  maxIterations: number;
  toolCount: number;
  /** Estimated tokens in the agent's rendered system prompt. */
  systemPromptTokens: number;
  /** Estimated tokens at the last iteration (prompt + projected transcript). */
  projectedPeakTokens: number;
  /** Configured context window, or null when the credential does not declare one. */
  contextSize: number | null;
  /** Fraction of the window still free at peak; null when contextSize unknown. */
  headroomPct: number | null;
}

export interface CapabilityCostProjection {
  /** Mean tokens per model turn observed across the probe suite. */
  avgInputTokensPerTurn: number | null;
  avgOutputTokensPerTurn: number | null;
  /** Projected USD for one full run of the most expensive agent. Null without pricing. */
  estimatedCostPerRunUsd: number | null;
  /** Agent the cost projection is based on. */
  basedOnAgent: AgentKind | null;
}

export type CapabilityVerdict = 'READY' | 'DEGRADED' | 'UNUSABLE';

export interface CapabilityReport {
  configId: string;
  configName: string;
  provider: string;
  model: string;
  verdict: CapabilityVerdict;
  /** One-paragraph plain-language summary of the verdict. */
  headline: string;
  /** True when PROTOCOL failed and later tiers were skipped. */
  abortedEarly: boolean;
  probes: ProbeResult[];
  agents: AgentCapacityReport[];
  cost: CapabilityCostProjection;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  ranAt: string;
  /**
   * Assumptions the capacity arithmetic rests on, surfaced verbatim so the
   * numbers can be argued with rather than taken on faith.
   */
  assumptions: string[];
}

export type CapabilityProgressEvent =
  | {
      type: 'started';
      configId: string;
      configName: string;
      provider: string;
      model: string;
      totalProbes: number;
    }
  | {
      type: 'probe_started';
      index: number;
      totalProbes: number;
      probe: Pick<ProbeResult, 'id' | 'tier' | 'title' | 'whatItProves'>;
    }
  | {
      type: 'probe_completed';
      index: number;
      totalProbes: number;
      probe: ProbeResult;
    }
  | { type: 'capacity_started' }
  | { type: 'capacity_completed'; agents: AgentCapacityReport[] };

export type CapabilityProgressCallback = (
  event: CapabilityProgressEvent,
) => void | Promise<void>;
