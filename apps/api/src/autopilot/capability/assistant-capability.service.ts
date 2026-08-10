import { Injectable, Logger } from '@nestjs/common';
import { AgentKind } from '@prisma/client';
import { AiClientService, AiSchemaError, type AiMessage } from '../../ai';
import { AiProviderConfigService } from '../../ai-provider-config.service';
import { CustomDetectorsService } from '../../custom-detectors.service';
import { McpClientService } from '../mcp-client/mcp-client.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import { AgentConfigService } from '../harness/agent-config.service';
import { SystemBriefService } from '../harness/system-brief.service';
import {
  RESPONSE_PROTOCOL,
  loopTurnSchema,
  repairTurn,
  type LoopTurn,
} from '../harness/agent-loop';
import { LLM_PROBES, PROBE_TOOLS } from './probes';
import type {
  AgentCapacityReport,
  AgentReadiness,
  CapabilityCostProjection,
  CapabilityProgressCallback,
  CapabilityReport,
  CapabilityVerdict,
  ProbeBuildContext,
  ProbeResult,
} from './capability.types';

/**
 * Rough tokens-per-character for English prose + JSON. Every capacity number
 * derived from it is reported as an estimate and the divisor is surfaced in the
 * report's `assumptions`, because a silently wrong context calculation is worse
 * than an openly approximate one.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Tokens the transcript is assumed to grow by per iteration: one model turn
 * plus its tool observations. Derived from typical harness runs — observations
 * dominate, and findings/case reads are the large ones.
 */
const TOKENS_PER_ITERATION = 1500;

/** Fraction of the context window below which an agent is called at risk. */
const DEGRADED_HEADROOM = 0.15;

/**
 * Grades the currently selected assistant model against what the agent harness
 * actually requires of it.
 *
 * This is deliberately NOT the credential test: that one proves the key and
 * model id work. This suite runs the real turn contract, the real tool catalog
 * and the real mission prompts, and grades tool arguments with the same
 * validator ToolDispatcherService uses — but it never invokes a tool handler.
 * Every observation fed back to the model is a synthetic fixture, so the suite
 * has no side effects and is safe to run against a live instance.
 */
@Injectable()
export class AssistantCapabilityService {
  private readonly logger = new Logger(AssistantCapabilityService.name);

  constructor(
    private readonly ai: AiClientService,
    private readonly configs: AiProviderConfigService,
    private readonly registry: ToolRegistry,
    private readonly agentConfig: AgentConfigService,
    private readonly brief: SystemBriefService,
    private readonly mcp: McpClientService,
    private readonly detectors: CustomDetectorsService,
  ) {}

  async run(
    configId: string,
    onProgress?: CapabilityProgressCallback,
  ): Promise<CapabilityReport> {
    const startedAt = Date.now();
    const config = await this.configs.get(configId);
    await onProgress?.({
      type: 'started',
      configId,
      configName: config.name,
      provider: config.provider,
      model: config.model,
      totalProbes: LLM_PROBES.length,
    });

    const ctx: ProbeBuildContext = {
      registry: this.registry,
      allowedTools: PROBE_TOOLS,
      catalog: this.registry.catalog(PROBE_TOOLS),
    };

    const probes: ProbeResult[] = [];
    let abortedEarly = false;

    for (const [probeIndex, probe] of LLM_PROBES.entries()) {
      const index = probeIndex + 1;
      await onProgress?.({
        type: 'probe_started',
        index,
        totalProbes: LLM_PROBES.length,
        probe: {
          id: probe.id,
          tier: probe.tier,
          title: probe.title,
          whatItProves: probe.whatItProves,
        },
      });
      // Tier gate: without the turn contract, nothing downstream is meaningful,
      // so a protocol failure stops the suite instead of spending more tokens.
      if (abortedEarly) {
        const result = skipped(
          probe,
          'Skipped: the model failed the turn-contract probes, so higher-level behaviour cannot be measured.',
        );
        probes.push(result);
        await onProgress?.({
          type: 'probe_completed',
          index,
          totalProbes: LLM_PROBES.length,
          probe: result,
        });
        continue;
      }

      // The recovery probe only earns its tokens when first-shot JSON failed.
      if (probe.id === 'json.recovery') {
        const strict = probes.find((p) => p.id === 'json.strict');
        if (strict?.status === 'PASS') {
          const result = skipped(
            probe,
            'Not exercised: the model produced valid JSON on the first attempt, so the correction path never runs.',
          );
          probes.push(result);
          await onProgress?.({
            type: 'probe_completed',
            index,
            totalProbes: LLM_PROBES.length,
            probe: result,
          });
          continue;
        }
      }

      const result = await this.runProbe(probe, ctx, configId);
      probes.push(result);
      await onProgress?.({
        type: 'probe_completed',
        index,
        totalProbes: LLM_PROBES.length,
        probe: result,
      });

      if (
        probe.tier === 'PROTOCOL' &&
        result.status !== 'PASS' &&
        this.isFatalProtocolFailure(probe.id)
      ) {
        abortedEarly = true;
      }
    }

    await onProgress?.({ type: 'capacity_started' });
    const agents = await this.analyzeCapacity(config.contextSize ?? null);
    await onProgress?.({ type: 'capacity_completed', agents });
    const cost = this.projectCost(probes, agents, config);
    const verdict = this.verdict(probes, agents);

    const totalInputTokens = sum(probes.map((p) => p.inputTokens ?? 0));
    const totalOutputTokens = sum(probes.map((p) => p.outputTokens ?? 0));

    return {
      configId,
      configName: config.name,
      provider: config.provider,
      model: config.model,
      verdict,
      headline: this.headline(verdict, probes, agents),
      abortedEarly,
      probes,
      agents,
      cost,
      totalInputTokens,
      totalOutputTokens,
      totalDurationMs: Date.now() - startedAt,
      ranAt: new Date().toISOString(),
      assumptions: [
        `Token counts for prompts are estimated at ~${CHARS_PER_TOKEN} characters per token; provider-reported usage is exact where shown.`,
        `Transcript growth is projected at ~${TOKENS_PER_ITERATION} tokens per iteration (one model turn plus its tool observations).`,
        'Capacity uses each agent’s effective configuration — your goal, tool and iteration overrides, plus any MCP tools scoped to that agent.',
        'No tool handler is executed: every observation the model saw was a fixture, so this run changed nothing in your instance.',
      ],
    };
  }

  // ── Probe execution ─────────────────────────────────────────────────────────

  private async runProbe(
    probe: (typeof LLM_PROBES)[number],
    ctx: ProbeBuildContext,
    configId: string,
  ): Promise<ProbeResult> {
    const { messages, schema, maxRetries } = probe.build(ctx);
    const startedAt = Date.now();

    try {
      const response = await this.ai.completeJson<LoopTurn>(
        messages,
        schema ?? loopTurnSchema,
        {
          configId,
          temperature: 0.2,
          repair: repairTurn,
          maxRetries: maxRetries ?? 0,
          // Fail fast. completeWithBackoff otherwise sleeps 60s/120s/240s on a
          // rate limit, which would make the suite look hung rather than
          // reporting the rate limit it actually hit.
          rateLimitRetries: 0,
        },
      );

      const grade = probe.grade(response.content, ctx);
      return {
        id: probe.id,
        tier: probe.tier,
        title: probe.title,
        whatItProves: probe.whatItProves,
        status: grade.status,
        reason: grade.reason,
        prompt: lastUserMessage(messages),
        rawOutput: response.raw ?? JSON.stringify(response.content),
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
      };
    } catch (error) {
      const schemaError = error instanceof AiSchemaError ? error : null;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Capability probe "${probe.id}" failed: ${message}`);

      return {
        id: probe.id,
        tier: probe.tier,
        title: probe.title,
        whatItProves: probe.whatItProves,
        // A schema failure IS the probe's answer (the model cannot hold the
        // contract); anything else is an infrastructure problem, not a verdict
        // on the model, and is reported as ERROR so it is not read as one.
        status: schemaError ? 'FAIL' : 'ERROR',
        reason: schemaError
          ? `The model did not produce a turn matching the harness schema: ${message}`
          : `The probe could not complete: ${message}`,
        prompt: lastUserMessage(messages),
        rawOutput: schemaError?.attempts?.[0]?.raw ?? null,
        latencyMs: Date.now() - startedAt,
        inputTokens: schemaError?.usage?.inputTokens ?? null,
        outputTokens: schemaError?.usage?.outputTokens ?? null,
      };
    }
  }

  /**
   * A protocol probe is fatal when it means no turn can be parsed at all.
   * json.strict alone is not fatal — the retry path may still carry the model,
   * which is what json.recovery then measures.
   */
  private isFatalProtocolFailure(probeId: string): boolean {
    if (probeId === 'json.strict') return false;
    if (probeId === 'json.recovery') return true;
    return probeId === 'react.turn_shape';
  }

  // ── Capacity ────────────────────────────────────────────────────────────────

  /**
   * Per-agent context arithmetic, mirroring exactly how HarnessService composes
   * a run: effective mission (with your overrides) + MCP tools scoped to that
   * agent + the detector type registry primer + the rendered system brief.
   */
  private async analyzeCapacity(
    contextSize: number | null,
  ): Promise<AgentCapacityReport[]> {
    const briefText = this.brief.render(await this.brief.compose());
    const protocolText = RESPONSE_PROTOCOL.join('\n');
    const summaries = await this.agentConfig.list();

    const reports: AgentCapacityReport[] = [];
    for (const summary of summaries) {
      const allowedTools = [
        ...summary.toolNames,
        ...this.mcp.toolNamesForKind(summary.kind),
      ];
      const primer =
        summary.kind === AgentKind.DETECTOR_AUTHOR
          ? this.detectors.buildTypeRegistry()
          : '';

      const systemPromptTokens = estimateTokens(
        [
          summary.goal,
          primer,
          briefText,
          this.registry.catalog(allowedTools),
          protocolText,
        ].join('\n'),
      );
      const projectedPeakTokens =
        systemPromptTokens + summary.maxIterations * TOKENS_PER_ITERATION;

      const headroomPct =
        contextSize && contextSize > 0
          ? Math.max(0, 1 - projectedPeakTokens / contextSize)
          : null;

      reports.push({
        kind: summary.kind,
        ...this.readiness(
          summary.kind,
          systemPromptTokens,
          projectedPeakTokens,
          contextSize,
          headroomPct,
        ),
        maxIterations: summary.maxIterations,
        toolCount: allowedTools.length,
        systemPromptTokens,
        projectedPeakTokens,
        contextSize,
        headroomPct,
      });
    }
    return reports;
  }

  private readiness(
    kind: AgentKind,
    systemPromptTokens: number,
    projectedPeakTokens: number,
    contextSize: number | null,
    headroomPct: number | null,
  ): { readiness: AgentReadiness; reason: string } {
    if (contextSize === null || contextSize <= 0) {
      return {
        readiness: 'UNKNOWN',
        reason: `No context window is recorded for this credential, so headroom cannot be checked. This agent needs at least ~${fmt(projectedPeakTokens)} tokens; set "Context size" on the provider to have it verified.`,
      };
    }
    if (systemPromptTokens >= contextSize) {
      return {
        readiness: 'WILL_FAIL',
        reason: `The system prompt alone is ~${fmt(systemPromptTokens)} tokens against a ${fmt(contextSize)}-token window. ${kind} cannot start — trim its toolset or use a larger-context model.`,
      };
    }
    if (projectedPeakTokens >= contextSize) {
      return {
        readiness: 'WILL_FAIL',
        reason: `Starts at ~${fmt(systemPromptTokens)} tokens but is projected to reach ~${fmt(projectedPeakTokens)} by iteration ${Math.ceil((contextSize - systemPromptTokens) / TOKENS_PER_ITERATION)} of ${fmt(contextSize)}. Later iterations will be truncated.`,
      };
    }
    if (headroomPct !== null && headroomPct < DEGRADED_HEADROOM) {
      return {
        readiness: 'DEGRADED',
        reason: `Fits, but only ~${Math.round(headroomPct * 100)}% of the window is spare at peak. A few large tool observations would overflow it — reduce maxIterations or the toolset.`,
      };
    }
    return {
      readiness: 'READY',
      reason: `~${fmt(systemPromptTokens)}-token prompt, peaking near ~${fmt(projectedPeakTokens)} of ${fmt(contextSize)} — comfortable headroom.`,
    };
  }

  // ── Cost + verdict ──────────────────────────────────────────────────────────

  private projectCost(
    probes: ProbeResult[],
    agents: AgentCapacityReport[],
    config: {
      inputCostPerMTok: number | null;
      outputCostPerMTok: number | null;
    },
  ): CapabilityCostProjection {
    const measured = probes.filter(
      (p) => p.inputTokens !== null && p.outputTokens !== null,
    );
    if (measured.length === 0) {
      return {
        avgInputTokensPerTurn: null,
        avgOutputTokensPerTurn: null,
        estimatedCostPerRunUsd: null,
        basedOnAgent: null,
      };
    }

    const avgInput = Math.round(
      sum(measured.map((p) => p.inputTokens ?? 0)) / measured.length,
    );
    const avgOutput = Math.round(
      sum(measured.map((p) => p.outputTokens ?? 0)) / measured.length,
    );

    // Price the heaviest agent: it is the one that decides whether the bill is
    // acceptable, and averaging across agents would hide it.
    const heaviest = [...agents].sort(
      (a, b) => b.projectedPeakTokens - a.projectedPeakTokens,
    )[0];

    let estimatedCostPerRunUsd: number | null = null;
    if (
      heaviest &&
      config.inputCostPerMTok !== null &&
      config.outputCostPerMTok !== null
    ) {
      // Each iteration re-sends the whole transcript, so input cost grows
      // roughly linearly across the run: sum, not a flat per-turn figure.
      const iterations = heaviest.maxIterations;
      const inputTokens =
        iterations * heaviest.systemPromptTokens +
        (TOKENS_PER_ITERATION * iterations * (iterations - 1)) / 2;
      const outputTokens = iterations * avgOutput;
      estimatedCostPerRunUsd =
        (inputTokens / 1_000_000) * config.inputCostPerMTok +
        (outputTokens / 1_000_000) * config.outputCostPerMTok;
    }

    return {
      avgInputTokensPerTurn: avgInput,
      avgOutputTokensPerTurn: avgOutput,
      estimatedCostPerRunUsd,
      basedOnAgent: heaviest?.kind ?? null,
    };
  }

  private verdict(
    probes: ProbeResult[],
    agents: AgentCapacityReport[],
  ): CapabilityVerdict {
    const failed = (tier: string) =>
      probes.some((p) => p.tier === tier && p.status === 'FAIL');

    if (
      failed('PROTOCOL') &&
      probes.some((p) => p.id === 'json.recovery' && p.status === 'FAIL')
    ) {
      return 'UNUSABLE';
    }
    if (
      probes.some(
        (p) =>
          p.tier === 'PROTOCOL' &&
          p.id === 'react.turn_shape' &&
          p.status === 'FAIL',
      )
    ) {
      return 'UNUSABLE';
    }
    if (failed('TOOL_USE') || failed('CHAINING')) return 'DEGRADED';
    if (agents.some((a) => a.readiness === 'WILL_FAIL')) return 'DEGRADED';
    if (failed('PROTOCOL') || failed('JUDGMENT')) return 'DEGRADED';
    if (agents.some((a) => a.readiness === 'DEGRADED')) return 'DEGRADED';
    return 'READY';
  }

  private headline(
    verdict: CapabilityVerdict,
    probes: ProbeResult[],
    agents: AgentCapacityReport[],
  ): string {
    const failures = probes.filter((p) => p.status === 'FAIL');
    const blocked = agents.filter((a) => a.readiness === 'WILL_FAIL');

    if (verdict === 'UNUSABLE') {
      return 'This model cannot hold the harness turn contract. Agent runs will fail with a schema error before doing any work — pick a different model for the assistant.';
    }
    if (verdict === 'READY') {
      return `Passed all ${probes.filter((p) => p.status === 'PASS').length} exercised probes, and every agent fits its context window. This model can drive the harness.`;
    }

    const parts: string[] = [];
    if (failures.length > 0) {
      parts.push(
        `${failures.length} probe${failures.length === 1 ? '' : 's'} failed (${failures.map((f) => f.id).join(', ')})`,
      );
    }
    if (blocked.length > 0) {
      parts.push(
        `${blocked.map((a) => a.kind).join(', ')} ${blocked.length === 1 ? 'does' : 'do'} not fit the context window`,
      );
    }
    return `Usable but compromised: ${parts.join('; ')}. Read the per-probe detail below before relying on unattended runs.`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function skipped(
  probe: (typeof LLM_PROBES)[number],
  reason: string,
): ProbeResult {
  return {
    id: probe.id,
    tier: probe.tier,
    title: probe.title,
    whatItProves: probe.whatItProves,
    status: 'SKIPPED',
    reason,
    prompt: null,
    rawOutput: null,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
  };
}

function lastUserMessage(messages: AiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]?.content ?? null;
  }
  return null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function fmt(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}
