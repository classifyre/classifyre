import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentKind, AgentTriggerMode, InstanceSettings } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import {
  DEFAULT_MISSIONS,
  missionFor,
  policyFor,
  type AgentPolicy,
  type Mission,
} from './missions';
import { DETECTION_CHAIN, INVESTIGATION_CHAIN } from '../autopilot.constants';

/** The two chains a pipeline agent can belong to. They run concurrently. */
export type AgentChain = 'INVESTIGATION' | 'DETECTION';

const CHAINS: ReadonlyArray<{ name: AgentChain; kinds: readonly AgentKind[] }> =
  [
    { name: 'INVESTIGATION', kinds: INVESTIGATION_CHAIN },
    { name: 'DETECTION', kinds: DETECTION_CHAIN },
  ];

/**
 * Where an agent sits in the pipeline, derived from the chain definitions so
 * the UI cannot drift from the order the worker actually executes.
 */
function chainPlacement(kind: AgentKind): {
  chain: AgentChain | null;
  chainPosition: number;
  runsAfter: AgentKind | null;
} {
  for (const { name, kinds } of CHAINS) {
    const index = kinds.indexOf(kind);
    if (index === -1) continue;
    return {
      chain: name,
      chainPosition: index + 1,
      runsAfter: index > 0 ? (kinds[index - 1] ?? null) : null,
    };
  }
  // DREAM has no chain: it runs on its own schedule, alone.
  return { chain: null, chainPosition: 0, runsAfter: null };
}

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
  [AgentKind.ESCALATION]: 'autopilotEscalationEnabled',
};

/**
 * Bounds for the policy numerics.
 *
 * Wide on purpose — these are an operator's dials, and the only job here is to
 * reject values that cannot mean anything. A staleness backstop measured in
 * years is useless but harmless; a negative one would silently disable the
 * liveness guarantee, so it is refused.
 */
const LIMITS = {
  maxIterations: { min: 1, max: 50 },
  minIntervalMinutes: { min: 0, max: 7 * 24 * 60 },
  maxStalenessHours: { min: 0, max: 365 * 24 },
  runBudgetMinutes: { min: 1, max: 8 * 60 },
} as const;

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
  /** Effective scheduling policy, and the factory values behind it. */
  triggerMode: AgentTriggerMode;
  defaultTriggerMode: AgentTriggerMode;
  waitForMatching: boolean;
  defaultWaitForMatching: boolean;
  waitForEvidence: boolean;
  defaultWaitForEvidence: boolean;
  waitForScans: boolean;
  defaultWaitForScans: boolean;
  minIntervalMinutes: number;
  defaultMinIntervalMinutes: number;
  maxStalenessHours: number;
  defaultMaxStalenessHours: number;
  /**
   * Which chain this agent belongs to, and where in it.
   *
   * Structural, not cosmetic: within a chain the order is a real data
   * dependency, and the two chains run concurrently. Sent to the UI so the
   * operator can see what runs after what without reading the source — the
   * order lives in one place (autopilot.constants) and the page follows it.
   */
  chain: AgentChain | null;
  /** 1-based position within {@link chain}; 0 when the agent has none. */
  chainPosition: number;
  /** The agent immediately before this one, whose output it consumes. */
  runsAfter: AgentKind | null;
  /** null = follow the instance-wide run budget. */
  runBudgetMinutes: number | null;
  lastTriggeredAt: Date | null;
  /** True when anything about this agent differs from factory defaults. */
  customized: boolean;
}

export interface UpdateAgentInput {
  enabled?: boolean;
  goal?: string | null;
  maxIterations?: number | null;
  toolNames?: string[] | null;
  triggerMode?: AgentTriggerMode | null;
  waitForMatching?: boolean | null;
  waitForEvidence?: boolean | null;
  waitForScans?: boolean | null;
  minIntervalMinutes?: number | null;
  maxStalenessHours?: number | null;
  runBudgetMinutes?: number | null;
}

/**
 * Resolves an agent's effective mission by merging its optional AgentConfig row
 * over the hardcoded factory default (missions.ts), and exposes the read/write
 * surface the Harness → Agents UI uses. The enable flag is bridged to the
 * corresponding InstanceSettings agent flag the worker honours, so this
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
      allowedTools: withGlossaryLookup(
        row.toolsOverride ? row.toolNames : fallback.allowedTools,
      ),
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
      const toolNames = withGlossaryLookup(
        row?.toolsOverride ? row.toolNames : def.allowedTools,
      );
      const flag = ENABLE_FLAG[def.kind];
      const factory = policyFor(def.kind);
      // Every policy column is null = "follow the shipped default", so an agent
      // nobody has touched keeps tracking the defaults instead of freezing at
      // whatever they were the day its row happened to be created.
      const policy = {
        triggerMode: row?.triggerMode ?? factory.triggerMode,
        waitForMatching: row?.waitForMatching ?? factory.waitForMatching,
        waitForEvidence: row?.waitForEvidence ?? factory.waitForEvidence,
        waitForScans: row?.waitForScans ?? factory.waitForScans,
        minIntervalMinutes:
          row?.minIntervalMinutes ?? factory.minIntervalMinutes,
        maxStalenessHours: row?.maxStalenessHours ?? factory.maxStalenessHours,
      };
      return {
        kind: def.kind,
        // A missing singleton is the same fresh-workspace state that
        // InstanceSettingsService creates with every agent enabled.
        enabled: flag ? (settings ? Boolean(settings[flag]) : true) : true,
        enableable: flag !== undefined,
        goal,
        defaultGoal: def.goal,
        maxIterations,
        defaultMaxIterations: def.maxIterations,
        toolNames,
        defaultToolNames: def.allowedTools,
        ...policy,
        defaultTriggerMode: factory.triggerMode,
        defaultWaitForMatching: factory.waitForMatching,
        defaultWaitForEvidence: factory.waitForEvidence,
        defaultWaitForScans: factory.waitForScans,
        defaultMinIntervalMinutes: factory.minIntervalMinutes,
        defaultMaxStalenessHours: factory.maxStalenessHours,
        ...chainPlacement(def.kind),
        runBudgetMinutes: row?.runBudgetMinutes ?? null,
        lastTriggeredAt: row?.lastTriggeredAt ?? null,
        customized:
          goal !== def.goal ||
          maxIterations !== def.maxIterations ||
          !sameTools(toolNames, def.allowedTools) ||
          policy.triggerMode !== factory.triggerMode ||
          policy.waitForMatching !== factory.waitForMatching ||
          policy.waitForEvidence !== factory.waitForEvidence ||
          policy.waitForScans !== factory.waitForScans ||
          policy.minIntervalMinutes !== factory.minIntervalMinutes ||
          policy.maxStalenessHours !== factory.maxStalenessHours ||
          row?.runBudgetMinutes != null,
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
      triggerMode?: AgentTriggerMode | null;
      waitForMatching?: boolean | null;
      waitForEvidence?: boolean | null;
      waitForScans?: boolean | null;
      minIntervalMinutes?: number | null;
      maxStalenessHours?: number | null;
      runBudgetMinutes?: number | null;
    } = {};

    if (input.goal !== undefined) {
      const trimmed = input.goal?.trim();
      data.goal = trimmed ? trimmed : null;
    }
    if (input.maxIterations !== undefined) {
      data.maxIterations = boundedInt(
        input.maxIterations,
        'maxIterations',
        LIMITS.maxIterations,
      );
    }
    if (input.minIntervalMinutes !== undefined) {
      data.minIntervalMinutes = boundedInt(
        input.minIntervalMinutes,
        'minIntervalMinutes',
        LIMITS.minIntervalMinutes,
      );
    }
    if (input.maxStalenessHours !== undefined) {
      data.maxStalenessHours = boundedInt(
        input.maxStalenessHours,
        'maxStalenessHours',
        LIMITS.maxStalenessHours,
      );
    }
    if (input.runBudgetMinutes !== undefined) {
      data.runBudgetMinutes = boundedInt(
        input.runBudgetMinutes,
        'runBudgetMinutes',
        LIMITS.runBudgetMinutes,
      );
    }
    if (input.triggerMode !== undefined) {
      if (
        input.triggerMode !== null &&
        !Object.values(AgentTriggerMode).includes(input.triggerMode)
      ) {
        throw new BadRequestException(
          `Unknown trigger mode "${String(input.triggerMode)}"`,
        );
      }
      data.triggerMode = input.triggerMode;
    }
    if (input.waitForMatching !== undefined) {
      data.waitForMatching = input.waitForMatching;
    }
    if (input.waitForEvidence !== undefined) {
      data.waitForEvidence = input.waitForEvidence;
    }
    if (input.waitForScans !== undefined) {
      data.waitForScans = input.waitForScans;
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
   * Effective scheduling policy for one agent, for the worker.
   *
   * Separate from {@link list} because the worker needs this per cycle and
   * `list` renders every agent's goal — kilobytes of mission text — to answer
   * a question about six numbers.
   */
  async resolvePolicy(kind: AgentKind): Promise<AgentPolicy> {
    const factory = policyFor(kind);
    const row = await this.prisma.agentConfig.findUnique({ where: { kind } });
    if (!row) return factory;
    return {
      triggerMode: row.triggerMode ?? factory.triggerMode,
      waitForMatching: row.waitForMatching ?? factory.waitForMatching,
      waitForEvidence: row.waitForEvidence ?? factory.waitForEvidence,
      waitForScans: row.waitForScans ?? factory.waitForScans,
      minIntervalMinutes: row.minIntervalMinutes ?? factory.minIntervalMinutes,
      maxStalenessHours: row.maxStalenessHours ?? factory.maxStalenessHours,
    };
  }

  /** When this agent last started, or null if it never has. */
  async lastTriggeredAt(kind: AgentKind): Promise<Date | null> {
    const row = await this.prisma.agentConfig.findUnique({
      where: { kind },
      select: { lastTriggeredAt: true },
    });
    return row?.lastTriggeredAt ?? null;
  }

  /**
   * Stamp an agent as started, which is what both guardrails compare against.
   *
   * Recorded here rather than derived from `agent_runs` because a run that was
   * never created leaves no row, and the minimum-gap floor has to hold for
   * attempts as well as completions.
   */
  async markTriggered(kind: AgentKind, at: Date = new Date()): Promise<void> {
    await this.prisma.agentConfig.upsert({
      where: { kind },
      create: { kind, lastTriggeredAt: at },
      update: { lastTriggeredAt: at },
    });
  }

  /** Per-agent run budget override, or null to use the instance setting. */
  async runBudgetMinutes(kind: AgentKind): Promise<number | null> {
    const row = await this.prisma.agentConfig.findUnique({
      where: { kind },
      select: { runBudgetMinutes: true },
    });
    return row?.runBudgetMinutes ?? null;
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

/**
 * An integer within bounds, or null to mean "reset to the factory default".
 *
 * `null` has to survive: it is how every reset in this service is expressed,
 * and validating it as a number would make "restore default" impossible.
 */
function boundedInt(
  value: number | null,
  field: string,
  limits: { min: number; max: number },
): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
    throw new BadRequestException(
      `${field} must be an integer between ${limits.min} and ${limits.max}`,
    );
  }
  return value;
}

function sameTools(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((name) => set.has(name));
}

/** A proposer without canonical lookup can only create duplicates. Preserve
 * this invariant even for tool overrides saved before glossary.lookup existed. */
function withGlossaryLookup(toolNames: string[]): string[] {
  if (
    !toolNames.includes('glossary.propose') ||
    toolNames.includes('glossary.lookup')
  ) {
    return toolNames;
  }
  const proposeAt = toolNames.indexOf('glossary.propose');
  return [
    ...toolNames.slice(0, proposeAt),
    'glossary.lookup',
    ...toolNames.slice(proposeAt),
  ];
}
