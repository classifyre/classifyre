import { MCP_CAPABILITY_GROUPS } from '../mcp-catalog';
import type { AccessAreaOptions } from './access.decorators';
import type { Capability } from './capabilities';

/**
 * The capability each MCP tool needs, the MCP twin of `@AccessArea` on REST
 * controllers. A tool's capability group gives the area; its `readOnlyHint`
 * picks `view` or `change`. Tools whose action is narrower than their group's
 * default are listed in {@link MCP_TOOL_CAPABILITY_OVERRIDES}.
 *
 * Capability groups (`mcp-catalog.ts`) stay what they were: what a token was
 * scoped to. Capabilities are what its owner may do. A tool is usable only
 * when both allow it.
 */
export const MCP_GROUP_ACCESS: Record<string, AccessAreaOptions> = {
  sources: { view: 'source.view', change: 'source.manage' },
  custom_detectors: { view: 'detector.view', change: 'detector.manage' },
  runs: { view: 'source.view', change: 'source.run' },
  findings: { view: 'finding.view', change: 'finding.triage' },
  assets: { view: 'asset.view', change: 'asset.tag' },
  inquiries: { view: 'inquiry.view', change: 'inquiry.edit' },
  cases: { view: 'case.view', change: 'case.edit' },
  case_board: { view: 'case.view', change: 'case.edit' },
  autopilot: { view: 'agent.view', change: 'agent.configure' },
  correlation: { view: 'asset.view', change: 'correlation.review' },
  custom_source_code: { view: 'source.view', change: 'code.author' },
  extractions: { view: 'finding.view', change: 'detector.manage' },
  case_leads: { view: 'case.view', change: 'lead.review' },
  glossary: { view: 'glossary.view', change: 'glossary.edit' },
  entities: { view: 'entity.view', change: 'entity.manage' },
  lineage: { view: 'asset.view', change: 'asset.tag' },
};

export const MCP_TOOL_CAPABILITY_OVERRIDES: Record<string, Capability> = {
  start_source_run: 'source.run',
  test_source_connection: 'source.manage',
  purge_source_assets: 'source.purge',
  purge_source_findings: 'source.purge',
  train_custom_detector: 'detector.train',
  retire_out_of_scope_findings: 'finding.triage',
  close_case: 'case.manage',
  reopen_case: 'case.manage',
  clear_case_escalations: 'case.manage',
  decide_glossary_proposal: 'glossary.approve',
  approve_binding: 'glossary.approve',
  disable_binding: 'glossary.approve',
};

const GROUP_OF_TOOL = new Map<string, string>(
  MCP_CAPABILITY_GROUPS.flatMap((group) =>
    group.toolNames.map((tool) => [tool, group.id] as const),
  ),
);

/**
 * The capability a tool needs, or null when it has no group or no explicit
 * `readOnlyHint` (a spec forbids both, and the server disables such tools).
 */
export function mcpToolCapability(
  toolName: string,
  readOnlyHint: boolean | undefined,
): Capability | null {
  const override = MCP_TOOL_CAPABILITY_OVERRIDES[toolName];
  if (override) return override;
  const group = GROUP_OF_TOOL.get(toolName);
  const area = group ? MCP_GROUP_ACCESS[group] : undefined;
  if (!area || readOnlyHint === undefined) return null;
  return readOnlyHint ? area.view : area.change;
}
