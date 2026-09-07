import { Injectable } from '@nestjs/common';
import { AgentKind } from '@prisma/client';
import { AiClientService } from '../../ai';
import { CustomDetectorsService } from '../../custom-detectors.service';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import { ToolDispatcherService } from '../tools/tool-dispatcher.service';
import { runPipeline, stepOutput } from '../agent-runtime';
import { HARNESS_BRIEF_CACHE_TTL_MS } from '../autopilot.constants';
import type { ApplySummary } from '../decision-applier.service';
import type { AgentContext } from '../autopilot.types';
import { runAgentLoop, type AgentLoopResult } from './agent-loop';
import { missionFor, type Mission } from './missions';
import { AgentConfigService } from './agent-config.service';
import { SystemBriefService } from './system-brief.service';
import { McpClientService } from '../mcp-client/mcp-client.service';
import { SupervisorService } from '../supervisor/supervisor.service';
import { renderProjection } from '../supervisor/supervisor-projection';
import { GRANTED_TOOLS_STATE_KEY } from '../tools/granted-tools';
import { MCP_BRIDGE_STATE_KEY } from '../tools/mcp-bridge-gate';

/**
 * Executes a mission via the resumable agent loop. The loop runs inside a
 * single `runPipeline` step ("reason-act") so the existing resume/cancel
 * machinery applies; the loop persists its own transcript between iterations.
 *
 * Returns an ApplySummary so the worker can format harness runs identically to
 * the legacy agents.
 */
@Injectable()
export class HarnessService {
  constructor(
    private readonly ai: AiClientService,
    private readonly registry: ToolRegistry,
    private readonly dispatcher: ToolDispatcherService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
    private readonly brief: SystemBriefService,
    private readonly mcp: McpClientService,
    private readonly agentConfig: AgentConfigService,
    private readonly detectors: CustomDetectorsService,
    private readonly supervisor: SupervisorService,
  ) {}

  /**
   * The rendered brief, reused across agent runs for
   * {@link HARNESS_BRIEF_CACHE_TTL_MS}. Recomposing it fresh on every run
   * (SystemBriefService.compose() reads live counts) meant the system prompt
   * changed on every single call, so no HTTP-side prompt cache could ever
   * hit — see the module doc on the TTL constant.
   */
  private briefCache: { text: string; expiresAt: number } | null = null;

  /** True when the given AgentKind has a harness mission. */
  supports(kind: AgentContext['run']['agentKind']): boolean {
    return missionFor(kind) !== null;
  }

  private async cachedBriefText(): Promise<string> {
    const now = Date.now();
    if (this.briefCache && this.briefCache.expiresAt > now) {
      return this.briefCache.text;
    }
    const text = this.brief.render(await this.brief.compose());
    this.briefCache = { text, expiresAt: now + HARNESS_BRIEF_CACHE_TTL_MS };
    return text;
  }

  async execute(ctx: AgentContext, mission?: Mission): Promise<ApplySummary> {
    const resolved =
      mission ?? (await this.agentConfig.resolveMission(ctx.run.agentKind));
    if (!resolved) {
      throw new Error(`No harness mission for agent kind ${ctx.run.agentKind}`);
    }

    const briefText = await this.cachedBriefText();
    // null here means "use the instance budget"; the loop resolves it.
    const runBudgetMinutes = await this.agentConfig.runBudgetMinutes(
      resolved.kind,
    );
    // Mission tools + any external MCP tools scoped to this mission kind.
    const allowedTools = [
      ...resolved.allowedTools,
      ...this.mcp.toolNamesForKind(resolved.kind),
    ];

    // The supervisor is the one agent whose authority and disclosure differ.
    // Every other mission calls exactly what its prompt describes; this one
    // holds a dozen resident tools and reaches the rest through tools.search,
    // because rendering the whole registry would put ~30k tokens of schema in
    // front of the reasoning it exists to do.
    const supervising = resolved.kind === AgentKind.SUPERVISOR;
    let grantedTools: string[] | undefined;
    let extraContext: string | undefined;
    if (supervising) {
      grantedTools = await this.supervisor.grantedTools(this.registry.list());
      // Resident must be a subset of granted, or the prompt describes tools the
      // dispatcher will refuse — which costs an iteration per lesson, every
      // wake, forever. Switching a capability off therefore also removes its
      // tools from the catalog, so the agent is never told about a power it
      // does not have.
      const callable = new Set(grantedTools);
      allowedTools.splice(
        0,
        allowedTools.length,
        ...allowedTools.filter((name) => callable.has(name)),
      );
    }
    if (supervising) {
      // Both flags are read from ctx.state by tools that cannot otherwise know
      // who is calling them: tools.search, to answer "what can I reach", and
      // the bridged MCP adapter, whose gate fails closed for unknown callers.
      ctx.state[GRANTED_TOOLS_STATE_KEY] = grantedTools;
      ctx.state[MCP_BRIDGE_STATE_KEY] = { allowMutations: true };
      extraContext = await this.supervisorProjection(ctx);
    }
    // The detector author sees the full engine menu (types + candidate models)
    // up front so it stops defaulting to REGEX/GLINER2.
    const missionPrimer =
      resolved.kind === AgentKind.DETECTOR_AUTHOR
        ? this.detectors.buildTypeRegistry()
        : undefined;

    await runPipeline(
      ctx,
      [
        {
          name: 'reason-act',
          execute: (c) =>
            runAgentLoop(
              c,
              resolved,
              {
                ai: this.ai,
                registry: this.registry,
                dispatcher: this.dispatcher,
                audit: this.audit,
                log: this.log,
              },
              {
                systemBrief: briefText,
                allowedTools,
                grantedTools,
                extraContext,
                missionPrimer,
                runBudgetMinutes,
              },
            ),
        },
      ],
      this.audit,
      this.log,
    );

    const result = stepOutput<AgentLoopResult>(ctx, 'reason-act');
    return result.summary;
  }

  /**
   * The supervisor's own state, as the tail of its prompt.
   *
   * Deliberately assembled here and not cached: goals, journal and spend are
   * exactly the parts that must be current, and they are the volatile section
   * the prompt ordering already puts last for that reason.
   */
  private async supervisorProjection(ctx: AgentContext): Promise<string> {
    const [state, goals, journal, budget, pendingEvents] = await Promise.all([
      this.supervisor.state(),
      this.supervisor.listGoals(),
      this.supervisor.listJournal(),
      this.supervisor.budget(ctx.settings),
      this.supervisor.countPending(),
    ]);
    return renderProjection({ state, goals, journal, budget, pendingEvents });
  }
}
