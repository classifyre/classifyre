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
  // Notebook code is how a source is configured: reading it needs
  // source.manage, like the REST notebook routes.
  custom_source_code: { view: 'source.manage', change: 'code.author' },
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

/**
 * The REST entity a tool group's changes belong to (see `routeEntity` in
 * `audit.interceptor.ts`), and the argument names that carry its id, so a
 * case's history shows its MCP changes next to its REST ones.
 */
const MCP_GROUP_ENTITY: Record<string, { type: string; idKeys: string[] }> = {
  sources: { type: 'sources', idKeys: ['sourceId', 'source_id', 'id'] },
  custom_source_code: { type: 'sources', idKeys: ['sourceId', 'source_id'] },
  runs: { type: 'runners', idKeys: ['runnerId', 'runner_id', 'id'] },
  custom_detectors: {
    type: 'custom-detectors',
    idKeys: ['customDetectorId', 'detectorId', 'detector_id', 'id'],
  },
  findings: { type: 'findings', idKeys: ['findingId', 'finding_id', 'id'] },
  extractions: { type: 'findings', idKeys: ['findingId', 'finding_id'] },
  assets: { type: 'assets', idKeys: ['assetId', 'asset_id', 'id'] },
  lineage: { type: 'graph', idKeys: ['assetId', 'asset_id', 'id'] },
  inquiries: { type: 'inquiries', idKeys: ['inquiryId', 'inquiry_id', 'id'] },
  cases: { type: 'cases', idKeys: ['caseId', 'case_id', 'id'] },
  case_board: { type: 'cases', idKeys: ['caseId', 'case_id', 'id'] },
  case_leads: { type: 'cases', idKeys: ['caseId', 'case_id'] },
  glossary: { type: 'glossary', idKeys: ['termId', 'idOrKey', 'id'] },
  entities: { type: 'entities', idKeys: ['entityId', 'idOrKey', 'id'] },
  correlation: { type: 'correlation', idKeys: ['assetId', 'id'] },
  autopilot: { type: 'autopilot', idKeys: ['id'] },
};

export function mcpToolEntity(
  toolName: string,
  args: unknown,
): { entityType: string | null; entityId: string | null } {
  const group = GROUP_OF_TOOL.get(toolName);
  const entity = group ? MCP_GROUP_ENTITY[group] : undefined;
  if (!entity) return { entityType: null, entityId: null };
  const record =
    args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const key = entity.idKeys.find((name) => typeof record[name] === 'string');
  return {
    entityType: entity.type,
    entityId: key ? (record[key] as string) : null,
  };
}
