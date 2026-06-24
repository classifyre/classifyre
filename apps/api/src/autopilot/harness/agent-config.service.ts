import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentKind, InstanceSettings } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import { DEFAULT_MISSIONS, missionFor, type Mission } from './missions';

const INSTANCE_SETTINGS_ID = 1;

/** MCP tools are namespaced "mcp.<slug>.<tool>" — built-in tools never are. */
const MCP_PREFIX = 'mcp.';

/**
 * Per-agent enable flag on InstanceSettings. DREAM has no flag (it runs on a
 * cron and is always enabled), so it is intentionally absent here.
 */
const ENABLE_FLAG: Partial<Record<AgentKind, keyof InstanceSettings>> = {
  [AgentKind.INQUIRY]: 'autopilotInquiryEnabled',
  [AgentKind.CASE]: 'autopilotCaseEnabled',
  [AgentKind.CONFIG]: 'autopilotConfigEnabled',
  [AgentKind.DETECTOR_AUTHOR]: 'autopilotDetectorEnabled',
};

/** Effective + default configuration for one agent, for the management UI. */
export interface AgentSummary {
  kind: AgentKind;
  /** Whether the agent runs on scan cycles. DREAM is always enabled. */
  enabled: boolean;
  /** False when the agent has no enable flag (DREAM) — UI hides the toggle. */
  enableable: boolean;
  goal: string;
  defaultGoal: string;
  maxIterations: number;
  defaultMaxIterations: number;
  toolNames: string[];
  defaultToolNames: string[];
  /** True when the agent's goal/tools/iterations differ from factory defaults. */
  customized: boolean;
}

export interface UpdateAgentInput {
  enabled?: boolean;
  goal?: string | null;
  maxIterations?: number | null;
  toolNames?: string[] | null;
}

/**
 * Resolves an agent's effective mission by merging its optional AgentConfig row
 * over the hardcoded factory default (missions.ts), and exposes the read/write
 * surface the Harness → Agents UI uses. The enable flag is bridged to the
 * existing InstanceSettings master switches the worker already honours, so this
 * service is the single place agent configuration is interpreted.
 */
@Injectable()
export class AgentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ToolRegistry,
  ) {}

  /** Effective mission for the agent loop, or null when the kind has none. */
  async resolveMission(kind: AgentKind): Promise<Mission | null> {
    const fallback = missionFor(kind);
    if (!fallback) return null;
    const row = await this.prisma.agentConfig.findUnique({ where: { kind } });
    if (!row) return fallback;
    return {
      kind,
      goal: row.goal ?? fallback.goal,
      maxIterations: row.maxIterations ?? fallback.maxIterations,
      allowedTools: row.toolsOverride ? row.toolNames : fallback.allowedTools,
    };
  }

  /** Summaries for every agent with a factory mission (canonical order). */
  async list(): Promise<AgentSummary[]> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    const rows = await this.prisma.agentConfig.findMany();
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    return DEFAULT_MISSIONS.map((def) => {
      const row = byKind.get(def.kind);
      const goal = row?.goal ?? def.goal;
      const maxIterations = row?.maxIterations ?? def.maxIterations;
      const toolNames = row?.toolsOverride ? row.toolNames : def.allowedTools;
      const flag = ENABLE_FLAG[def.kind];
      return {
        kind: def.kind,
        enabled: flag ? Boolean(settings?.[flag]) : true,
        enableable: flag !== undefined,
        goal,
        defaultGoal: def.goal,
        maxIterations,
        defaultMaxIterations: def.maxIterations,
        toolNames,
        defaultToolNames: def.allowedTools,
        customized:
          goal !== def.goal ||
          maxIterations !== def.maxIterations ||
          !sameTools(toolNames, def.allowedTools),
      };
    });
  }

  /** Update one agent's config. Returns the refreshed summary. */
  async update(
    kind: AgentKind,
    input: UpdateAgentInput,
  ): Promise<AgentSummary> {
    const def = missionFor(kind);
    if (!def) {
      throw new BadRequestException(`Unknown agent "${kind}"`);
    }

    if (input.enabled !== undefined) {
      const flag = ENABLE_FLAG[kind];
      if (!flag) {
        throw new BadRequestException(
          `Agent "${kind}" cannot be enabled or disabled`,
        );
      }
      await this.prisma.instanceSettings.update({
        where: { id: INSTANCE_SETTINGS_ID },
        data: { [flag]: input.enabled },
      });
    }

    const data: {
      goal?: string | null;
      maxIterations?: number | null;
      toolNames?: string[];
      toolsOverride?: boolean;
    } = {};

    if (input.goal !== undefined) {
      const trimmed = input.goal?.trim();
      data.goal = trimmed ? trimmed : null;
    }
    if (input.maxIterations !== undefined) {
      if (
        input.maxIterations !== null &&
        (!Number.isInteger(input.maxIterations) ||
          input.maxIterations < 1 ||
          input.maxIterations > 50)
      ) {
        throw new BadRequestException('maxIterations must be between 1 and 50');
      }
      data.maxIterations = input.maxIterations;
    }
    if (input.toolNames !== undefined) {
      if (input.toolNames === null) {
        // Reset to factory toolset.
        data.toolNames = [];
        data.toolsOverride = false;
      } else {
        data.toolNames = this.validateTools(input.toolNames);
        data.toolsOverride = true;
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.agentConfig.upsert({
        where: { kind },
        create: { kind, ...data },
        update: data,
      });
    }

    const summary = (await this.list()).find((a) => a.kind === kind);
    if (!summary) {
      throw new BadRequestException(`Unknown agent "${kind}"`);
    }
    return summary;
  }

  /**
   * Validate that every assigned name is a known built-in tool. MCP tools are
   * scoped per-server (McpServerConfig.agentKinds), not assigned here, so they
   * are rejected. Returns a de-duplicated list.
   */
  private validateTools(names: string[]): string[] {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    for (const name of unique) {
      if (name.startsWith(MCP_PREFIX)) {
        throw new BadRequestException(
          `"${name}" is an MCP tool — assign it to agents via its MCP server, not here.`,
        );
      }
      if (!this.registry.get(name)) {
        throw new BadRequestException(`Unknown tool "${name}"`);
      }
    }
    return unique;
  }
}

function sameTools(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((name) => set.has(name));
}
