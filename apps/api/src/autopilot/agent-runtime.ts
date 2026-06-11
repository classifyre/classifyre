import { Logger } from '@nestjs/common';
import { AgentAuditService } from './audit/agent-audit.service';
import type { AgentLoggerService } from './audit/agent-logger.service';
import type { AgentContext, AgentStep } from './autopilot.types';

const logger = new Logger('AgentRuntime');

/**
 * Generic resumable step pipeline. Each step's JSON-serializable output is
 * persisted to AgentRun.stepState after it finishes; when a run is resumed
 * (pg-boss redelivery after a crash or provider failure) completed steps are
 * skipped and their stored output is reused — in particular, validated LLM
 * output is never re-requested.
 */
export async function runPipeline(
  ctx: AgentContext,
  steps: AgentStep[],
  audit: AgentAuditService,
  log?: AgentLoggerService,
): Promise<void> {
  // Seed state from a previous attempt of this run, if any.
  const persisted = (ctx.run.stepState ?? {}) as Record<string, unknown>;
  ctx.state = { ...persisted, ...ctx.state };

  for (const step of steps) {
    if (step.name in ctx.state) {
      logger.debug(
        `Run ${ctx.run.id}: step ${step.name} already done, skipping`,
      );
      await log?.technical(
        ctx.run.id,
        `Step "${step.name}" already completed in a previous attempt — reusing stored output.`,
      );
      continue;
    }
    logger.log(`Run ${ctx.run.id}: executing step ${step.name}`);
    const startedAt = Date.now();
    try {
      const output = await step.execute(ctx);
      ctx.state[step.name] = output ?? null;
      await audit.saveStep(ctx.run.id, step.name, ctx.state);
      await log?.technical(
        ctx.run.id,
        `Step "${step.name}" completed in ${Date.now() - startedAt}ms.`,
      );
    } catch (error) {
      await log?.technical(
        ctx.run.id,
        `Step "${step.name}" failed after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'ERROR',
      );
      throw error;
    }
  }
}

/** Typed accessor for a previous step's output. */
export function stepOutput<T>(ctx: AgentContext, stepName: string): T {
  if (!(stepName in ctx.state)) {
    throw new Error(
      `Step output "${stepName}" missing — pipeline ordering bug`,
    );
  }
  return ctx.state[stepName] as T;
}
