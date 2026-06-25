import { Injectable } from '@nestjs/common';
import { AiClientService } from '../../ai';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import { ToolDispatcherService } from '../tools/tool-dispatcher.service';
import { runPipeline, stepOutput } from '../agent-runtime';
import type { ApplySummary } from '../decision-applier.service';
import type { AgentContext } from '../autopilot.types';
import { runAgentLoop, type AgentLoopResult } from './agent-loop';
import { missionFor, type Mission } from './missions';
import { AgentConfigService } from './agent-config.service';
import { SystemBriefService } from './system-brief.service';
import { McpClientService } from '../mcp-client/mcp-client.service';

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
  ) {}

  /** True when the given AgentKind has a harness mission. */
  supports(kind: AgentContext['run']['agentKind']): boolean {
    return missionFor(kind) !== null;
  }

  async execute(ctx: AgentContext, mission?: Mission): Promise<ApplySummary> {
    const resolved =
      mission ?? (await this.agentConfig.resolveMission(ctx.run.agentKind));
    if (!resolved) {
      throw new Error(`No harness mission for agent kind ${ctx.run.agentKind}`);
    }

    const briefText = this.brief.render(await this.brief.compose());
    // Mission tools + any external MCP tools scoped to this mission kind.
    const allowedTools = [
      ...resolved.allowedTools,
      ...this.mcp.toolNamesForKind(resolved.kind),
    ];

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
              { systemBrief: briefText, allowedTools },
            ),
        },
      ],
      this.audit,
      this.log,
    );

    const result = stepOutput<AgentLoopResult>(ctx, 'reason-act');
    return result.summary;
  }
}
