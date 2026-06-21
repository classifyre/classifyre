import { Injectable, Logger } from '@nestjs/common';
import { AgentDecisionAction, AgentDecisionOutcome } from '@prisma/client';
import { AiManagementMode } from '@prisma/client';
import {
  normalizeAgainstSchema,
  validateAgainstSchema,
} from '../../ai/schema-validate';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import type { Tool, ToolCallResult, ToolContext } from './tool.types';

/**
 * Single chokepoint between the agent loop and any tool. Generalizes the
 * decision-applier contract to arbitrary tools:
 *  - idempotent across run resumes via a per-call dedupeKey (mutations only);
 *  - validates tool input against the tool's JSON schema (hallucination guard);
 *  - enforces OBSERVE_ONLY gating for mutating tools — fails CLOSED when a
 *    mutating tool declares no gate;
 *  - records one AgentDecision per mutating call (APPLIED / SKIPPED_OBSERVE_ONLY
 *    / FAILED) with the model's rationale; read calls are logged technically
 *    only, to keep the decision audit focused on changes.
 */
@Injectable()
export class ToolDispatcherService {
  private readonly logger = new Logger(ToolDispatcherService.name);

  constructor(
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
  ) {}

  async dispatch(
    tc: ToolContext,
    tool: Tool,
    rawInput: unknown,
    dedupeKey: string,
    rationale: string,
  ): Promise<ToolCallResult> {
    const runId = tc.ctx.run.id;
    const mutate = tool.sideEffect === 'mutate';

    await this.log.technical(
      runId,
      `Tool call: ${tool.name} (${tool.sideEffect})`,
      { input: rawInput, rationale },
    );

    // 1. Resume guard — never re-apply a mutation already recorded this run.
    if (mutate && (await this.audit.hasDecision(runId, dedupeKey))) {
      return { tool: tool.name, outcome: 'DEDUPED', result: { deduped: true } };
    }

    // 2. Validate input against the tool schema. Lenient (default) coerces and
    //    strips unknowns; strict (lenientInput:false) preserves nested payloads.
    let input: Record<string, unknown>;
    try {
      const raw = rawInput ?? {};
      if (tool.lenientInput === false) {
        validateAgainstSchema(raw, tool.inputSchema);
        input = raw as Record<string, unknown>;
      } else {
        input = normalizeAgainstSchema(raw, tool.inputSchema) as Record<
          string,
          unknown
        >;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mutate) {
        await this.record(tc, tool, AgentDecisionOutcome.FAILED, rationale, {
          dedupeKey,
          payload: { error: message, input: rawInput },
        });
      } else {
        await this.log.technical(
          runId,
          `Tool ${tool.name} received invalid input.`,
          { error: message },
          'WARN',
        );
      }
      return { tool: tool.name, outcome: 'FAILED', result: { error: message } };
    }

    // 3. OBSERVE_ONLY gate (mutating tools only). Fail closed when no gate.
    if (mutate) {
      const gate = tool.resolveGate
        ? await tool.resolveGate(input, tc)
        : { mode: AiManagementMode.OBSERVE_ONLY };
      if (gate.mode !== AiManagementMode.MANAGED) {
        await this.record(
          tc,
          tool,
          AgentDecisionOutcome.SKIPPED_OBSERVE_ONLY,
          rationale,
          {
            dedupeKey,
            entityType: gate.entityType ?? tool.domain ?? undefined,
            entityId: gate.entityId,
            payload: { input },
          },
        );
        return {
          tool: tool.name,
          outcome: 'SKIPPED_OBSERVE_ONLY',
          result: {
            skipped: true,
            reason: tool.resolveGate
              ? 'Entity or instance is observe-only; mutation not applied.'
              : 'Tool declared no management gate; refused as observe-only.',
          },
        };
      }

      // 4a. Run the mutating handler under audit.
      try {
        const result = await tool.handler(input, tc);
        await this.record(tc, tool, AgentDecisionOutcome.APPLIED, rationale, {
          dedupeKey,
          entityType: gate.entityType ?? tool.domain ?? undefined,
          entityId: gate.entityId ?? extractId(result),
          payload: { input, result: summarize(result) },
        });
        return { tool: tool.name, outcome: 'APPLIED', result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.record(tc, tool, AgentDecisionOutcome.FAILED, rationale, {
          dedupeKey,
          entityType: gate.entityType ?? tool.domain ?? undefined,
          entityId: gate.entityId,
          payload: { error: message, input },
        });
        this.logger.warn(`Tool ${tool.name} failed: ${message}`);
        return {
          tool: tool.name,
          outcome: 'FAILED',
          result: { error: message },
        };
      }
    }

    // 4b. Read tool — run and return; technical log only, no decision row.
    try {
      const result = await tool.handler(input, tc);
      return { tool: tool.name, outcome: 'APPLIED', result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.log.technical(
        runId,
        `Read tool ${tool.name} failed.`,
        { error: message },
        'WARN',
      );
      return { tool: tool.name, outcome: 'FAILED', result: { error: message } };
    }
  }

  private async record(
    tc: ToolContext,
    tool: Tool,
    outcome: AgentDecisionOutcome,
    rationale: string,
    opts: {
      dedupeKey: string;
      entityType?: import('./tool.types').ToolDomain;
      entityId?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.recordDecision(tc.ctx.run.id, {
      action:
        outcome === AgentDecisionOutcome.APPLIED
          ? (tool.decisionAction ?? AgentDecisionAction.TOOL_CALL)
          : AgentDecisionAction.TOOL_CALL,
      outcome,
      rationale: rationale || `Tool ${tool.name}`,
      entityType: opts.entityType,
      entityId: opts.entityId,
      payload: { tool: tool.name, ...(opts.payload ?? {}) },
      dedupeKey: opts.dedupeKey,
    });
  }
}

/** Best-effort id extraction so created entities are stamped on the decision. */
function extractId(result: unknown): string | undefined {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/** Trim large tool results before storing them in the decision payload. */
function summarize(result: unknown): unknown {
  const json = JSON.stringify(result);
  if (json === undefined) return null;
  return json.length > 4000 ? `${json.slice(0, 4000)}…(truncated)` : result;
}
