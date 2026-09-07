import { MCP_CAPABILITY_GROUPS } from '../../mcp-catalog';
import { BUILTIN_MCP_PREFIX } from '../../chat-gateway/builtin-mcp-tool-adapter';
import type { Tool } from '../tools/tool.types';

/**
 * What the operator can switch off.
 *
 * The supervisor is given authority over everything by design, so the only
 * meaningful control is subtraction — and per-tool checkboxes are not a control
 * anyone actually uses across two hundred tools. These groups are the unit a
 * person reasons in: "it may tune detection" is a decision; "it may call
 * config.tune_source" is a lookup.
 *
 * Assignment is by TOOL, not by mission, and the mapping is total: every
 * mutating tool in the registry belongs to exactly one group, enforced by
 * `capabilities.completeness.spec.ts`. A mutating tool matching no group is not
 * granted — the fail-closed direction, so adding a tool and forgetting to
 * classify it makes it unreachable rather than silently free.
 *
 * Reads are the exception and fall through to `read_corpus`, which cannot be
 * switched off. An agent that cannot look at anything cannot decide anything;
 * the honest way to stop it is the enable switch.
 */
export interface CapabilityGroup {
  id: string;
  /** i18n key suffix under `harness.supervisor.capability.*`. */
  labelKey: string;
  /** Operator-facing summary. Kept here so API and UI cannot disagree. */
  description: string;
  /** Never switchable. Only `read_corpus`. */
  alwaysOn?: boolean;
  /** Ships on unless stated otherwise. */
  defaultOn: boolean;
  /** Irreversible in a way a re-scan cannot fully undo. */
  destructive?: boolean;
  /** Exact native tool names in this group. */
  tools?: string[];
  /** Native tool name prefixes, e.g. "fingerprints.". */
  prefixes?: string[];
  /** Ids from MCP_CAPABILITY_GROUPS, expanded to `mcp.builtin.<name>`. */
  mcpGroups?: string[];
}

/**
 * The supervisor's own instruments. Never in the menu: switching off
 * `journal.write` would not restrict the agent, it would break the record of
 * what it did, and switching off `schedule_wake` would stop it existing.
 * `agents.list` is here too — reading the roster is not commanding it.
 */
export const SUPERVISOR_CORE_TOOLS = [
  'agents.list',
  'inbox.read',
  'goals.list',
  'goals.update',
  'goals.propose',
  'journal.write',
  'supervisor.schedule_wake',
  'budget.status',
  'tools.search',
  'tools.list_namespaces',
];

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: 'read_corpus',
    labelKey: 'readCorpus',
    description:
      'Read findings, assets, sources, coverage and every other view of the corpus. Cannot be switched off.',
    alwaysOn: true,
    defaultOn: true,
  },
  {
    id: 'control_agents',
    labelKey: 'controlAgents',
    description:
      'Wake the other agents, leave instructions for their next run, retune when they run, and stop one mid-run.',
    defaultOn: true,
    tools: ['agents.run', 'agents.brief', 'agents.configure', 'agents.stop'],
  },
  {
    id: 'investigations',
    labelKey: 'investigations',
    description:
      'Create and maintain inquiries and cases: hypotheses, evidence, leads, chronology and closure.',
    defaultOn: true,
    prefixes: ['inquiries.', 'cases.', 'hypotheses.'],
    mcpGroups: ['inquiries', 'cases', 'case_leads'],
  },
  {
    id: 'detection_config',
    labelKey: 'detectionConfig',
    description:
      'Change which detectors run against a source, how it samples, and how often it is scanned.',
    defaultOn: true,
    tools: ['config.tune_source', 'sources.rescan', 'schedule.tune'],
    mcpGroups: ['sources'],
  },
  {
    id: 'detector_authoring',
    labelKey: 'detectorAuthoring',
    description: 'Author, train, test and retire custom detectors.',
    defaultOn: true,
    prefixes: ['detector.'],
    mcpGroups: ['custom_detectors'],
  },
  {
    id: 'duplicate_review',
    labelKey: 'duplicateReview',
    description:
      'Tune duplicate matching, exclude boilerplate patterns, clear the safe band and take confirmed pairs further.',
    defaultOn: true,
    prefixes: ['fingerprints.'],
    mcpGroups: ['correlation'],
  },
  {
    id: 'knowledge',
    labelKey: 'knowledge',
    description:
      'Write and prune long-lived memory, propose glossary terms, and maintain the system brief.',
    defaultOn: true,
    prefixes: ['memory.', 'glossary.', 'system_brief.', 'agenda.'],
    mcpGroups: ['glossary'],
  },
  {
    id: 'alerts',
    labelKey: 'alerts',
    description: 'Raise operator notifications.',
    defaultOn: true,
    tools: ['operator.notify'],
  },
  {
    id: 'corpus_hygiene',
    labelKey: 'corpusHygiene',
    description:
      'Delete findings and assets to remove noise. Findings and assets are derived data, so a re-scan rebuilds them — but curated status and history do not come back, and a deleted source does not come back at all.',
    defaultOn: false,
    destructive: true,
    prefixes: ['hygiene.'],
    tools: [
      `${BUILTIN_MCP_PREFIX}purge_source_findings`,
      `${BUILTIN_MCP_PREFIX}purge_source_assets`,
      `${BUILTIN_MCP_PREFIX}delete_source`,
    ],
  },
  {
    id: 'custom_source_code',
    labelKey: 'customSourceCode',
    description:
      'Read and edit the Python notebooks behind custom sources, and run them. This is arbitrary code execution against your data.',
    defaultOn: false,
    destructive: true,
    mcpGroups: ['custom_source_code'],
  },
  {
    id: 'external_mcp',
    labelKey: 'externalMcp',
    description:
      'Call tools from connected external MCP servers. Scoped per server under Harness → Config.',
    defaultOn: true,
  },
];

/** Ids of every group an operator may switch. */
export const SWITCHABLE_GROUP_IDS = CAPABILITY_GROUPS.filter(
  (g) => !g.alwaysOn,
).map((g) => g.id);

export const DEFAULT_ENABLED_GROUP_IDS = CAPABILITY_GROUPS.filter(
  (g) => g.defaultOn,
).map((g) => g.id);

/** Expand an MCP catalog group id to bridged registry names. */
function mcpGroupTools(groupId: string): string[] {
  const group = MCP_CAPABILITY_GROUPS.find((g) => g.id === groupId);
  if (!group) return [];
  return group.toolNames.map((n) => `${BUILTIN_MCP_PREFIX}${n}`);
}

/**
 * The group a tool belongs to, or null when nothing claims it.
 *
 * Resolved in three passes rather than by array order, because the claims are
 * not equally specific and ordering a list correctly is a thing people get
 * wrong quietly. An exact name beats a prefix, and a prefix beats "this whole
 * MCP catalog group" — so `delete_source` lands in corpus_hygiene, which names
 * it, rather than in detection_config, which merely claims every source tool.
 */
export function groupForTool(name: string): CapabilityGroup | null {
  const byName = CAPABILITY_GROUPS.find((g) => g.tools?.includes(name));
  if (byName) return byName;

  const byPrefix = CAPABILITY_GROUPS.find((g) =>
    g.prefixes?.some((p) => name.startsWith(p)),
  );
  if (byPrefix) return byPrefix;

  const byMcpGroup = CAPABILITY_GROUPS.find((g) =>
    g.mcpGroups?.some((id) => mcpGroupTools(id).includes(name)),
  );
  if (byMcpGroup) return byMcpGroup;

  // An external MCP server's tools are `mcp.<slug>.<tool>` — anything under the
  // mcp namespace that is not one of the bridged built-ins.
  if (name.startsWith('mcp.') && !name.startsWith(BUILTIN_MCP_PREFIX)) {
    return CAPABILITY_GROUPS.find((g) => g.id === 'external_mcp') ?? null;
  }
  return null;
}

/**
 * Resolve which tools the supervisor may CALL, given the groups switched on.
 *
 * Note this is the authority list, not the disclosure list: the result is
 * usually a couple of hundred names and is never rendered into a prompt. What
 * the model sees is the resident mission toolset plus whatever `tools.search`
 * hands it on demand.
 */
export function grantedToolNames(
  all: Tool[],
  enabledGroupIds: string[],
): string[] {
  const enabled = new Set(enabledGroupIds);
  const granted: string[] = [];
  for (const tool of all) {
    if (SUPERVISOR_CORE_TOOLS.includes(tool.name)) {
      granted.push(tool.name);
      continue;
    }
    // A capability group withholds writes, not sight.
    //
    // Switching off detector authoring should stop the agent changing
    // detectors, not stop it seeing which ones exist; switching off hygiene
    // should stop it purging, not stop it noticing that a source is nine parts
    // noise and saying so. Reads are also where a misclassification is
    // harmless, so this is the direction the fail-closed rule should not point.
    if (tool.sideEffect === 'read') {
      granted.push(tool.name);
      continue;
    }
    const group = groupForTool(tool.name);
    // Unclassified mutations stay out until someone classifies them. Adding a
    // tool and forgetting to file it is ordinary; that tool silently becoming
    // available to a self-directed agent is not.
    if (group && (group.alwaysOn || enabled.has(group.id))) {
      granted.push(tool.name);
    }
  }
  return granted;
}
