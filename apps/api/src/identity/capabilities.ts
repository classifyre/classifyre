/**
 * The one catalogue of things the API allows (docs/prd/IAM-access-management.md
 * §6). Every REST route and every MCP tool resolves to exactly one capability;
 * roles (`roles.ts`) are bundles of them. Capabilities only add up: there are
 * no deny rules and no conditions.
 *
 * Adding a feature: add its capability here, put it in the built-in roles
 * (at least `workspace-admin`, which a spec checks), then declare it on the
 * routes (`@Requires` / `@AccessArea`) and MCP tools (`mcp-tool-capabilities.ts`).
 */
/** `public`: held only by visitors of the public tenant, never granted. */
export type CapabilityScope = 'workspace' | 'tenant' | 'platform' | 'public';

export interface CapabilityDefinition {
  id: string;
  scope: CapabilityScope;
  description: string;
}

export const CAPABILITIES = [
  // Workspace
  {
    id: 'workspace.view',
    scope: 'workspace',
    description: 'Open the workspace and read its settings and activity.',
  },
  {
    id: 'workspace.settings',
    scope: 'workspace',
    description:
      'Change workspace settings, embeddings, maintenance and background queues.',
  },
  {
    id: 'workspace.pause',
    scope: 'workspace',
    description: 'Pause and resume the workspace.',
  },
  {
    id: 'workspace.delete',
    scope: 'workspace',
    description: 'Delete the workspace.',
  },
  {
    id: 'workspace.transfer',
    scope: 'workspace',
    description: 'Export, import or copy workspace data.',
  },
  {
    id: 'notification.view',
    scope: 'workspace',
    description:
      'Get the notifications sent to your groups in the workspace, and mark them read, important or dismissed for yourself.',
  },
  // Access
  {
    id: 'access.view',
    scope: 'workspace',
    description: 'See who has access to the workspace.',
  },
  {
    id: 'access.manage',
    scope: 'workspace',
    description: 'Give and remove access to the workspace.',
  },
  // Sources and scans
  {
    id: 'source.view',
    scope: 'workspace',
    description: 'Read sources, their notebooks and their scans.',
  },
  {
    id: 'source.manage',
    scope: 'workspace',
    description: 'Create, change and delete sources.',
  },
  {
    id: 'source.run',
    scope: 'workspace',
    description: 'Start, stop and re-run scans.',
  },
  {
    id: 'source.purge',
    scope: 'workspace',
    description: 'Remove the assets or findings a source produced.',
  },
  // Findings and assets
  {
    id: 'finding.view',
    scope: 'workspace',
    description: 'Read findings, extractions and their evidence.',
  },
  {
    id: 'finding.triage',
    scope: 'workspace',
    description: 'Change finding status and severity, alone or in bulk.',
  },
  {
    id: 'asset.view',
    scope: 'workspace',
    description: 'Read assets, lineage, connections and duplicates.',
  },
  {
    id: 'asset.tag',
    scope: 'workspace',
    description: 'Tag assets, add or remove connections, save explore views.',
  },
  // Detectors
  {
    id: 'detector.view',
    scope: 'workspace',
    description: 'Read detectors, their tests and training history.',
  },
  {
    id: 'detector.manage',
    scope: 'workspace',
    description: 'Create, change and delete detectors and their tests.',
  },
  {
    id: 'detector.train',
    scope: 'workspace',
    description: 'Train detectors and give them feedback.',
  },
  // Code
  {
    id: 'code.author',
    scope: 'workspace',
    description:
      'Write and run code: custom source notebooks and code detectors.',
  },
  // Investigations
  {
    id: 'case.view',
    scope: 'workspace',
    description: 'Read cases, their boards, threads and timelines.',
  },
  {
    id: 'case.edit',
    scope: 'workspace',
    description: 'Create cases and work on them.',
  },
  {
    id: 'case.manage',
    scope: 'workspace',
    description: 'Close, reopen, clean up and delete cases.',
  },
  {
    id: 'inquiry.view',
    scope: 'workspace',
    description: 'Read inquiries and their matches.',
  },
  {
    id: 'inquiry.edit',
    scope: 'workspace',
    description: 'Create, change and delete inquiries.',
  },
  {
    id: 'lead.review',
    scope: 'workspace',
    description: 'Propose, accept and dismiss case leads.',
  },
  // Meaning
  {
    id: 'glossary.view',
    scope: 'workspace',
    description: 'Read the glossary, bindings and semantic links.',
  },
  {
    id: 'glossary.edit',
    scope: 'workspace',
    description: 'Write glossary terms, schemes, relations and bindings.',
  },
  {
    id: 'glossary.approve',
    scope: 'workspace',
    description: 'Approve glossary terms, bindings and suggestions.',
  },
  {
    id: 'entity.view',
    scope: 'workspace',
    description: 'Read entities and their values.',
  },
  {
    id: 'entity.manage',
    scope: 'workspace',
    description: 'Create, merge and change entities.',
  },
  {
    id: 'correlation.review',
    scope: 'workspace',
    description: 'Decide duplicates and change correlation settings.',
  },
  // Agents
  {
    id: 'agent.view',
    scope: 'workspace',
    description: 'Read agent configuration, runs, memory and AI providers.',
  },
  {
    id: 'agent.configure',
    scope: 'workspace',
    description: 'Configure agents, AI providers, MCP servers and chat bots.',
  },
  {
    id: 'agent.use',
    scope: 'workspace',
    description: 'Ask the assistant and use AI completion.',
  },
  // Data out
  {
    id: 'data.export',
    scope: 'workspace',
    description: 'Export data out of the workspace (CSV, archives).',
  },
  {
    // The rows themselves, not what was found in them. Given on a whole
    // workspace by a role, or on one source or table by a data-reader grant
    // (docs/prd/DQ-data-query.md §4).
    id: 'data.query',
    scope: 'workspace',
    description:
      'Query the rows of tables with SQL: every table here, or only the sources and tables a grant names.',
  },
  // Tokens
  {
    id: 'mcp.token.own',
    scope: 'workspace',
    description: 'Create and revoke your own MCP tokens.',
  },
  {
    id: 'mcp.token.admin',
    scope: 'workspace',
    description: 'See and revoke every MCP token of the workspace.',
  },
  // Tenant
  {
    id: 'tenant.workspace.create',
    scope: 'tenant',
    description: 'Create workspaces for a group you belong to.',
  },
  {
    id: 'tenant.access.manage',
    scope: 'tenant',
    description: 'Manage grants across the tenant.',
  },
  {
    id: 'tenant.categories.manage',
    scope: 'tenant',
    description: 'Manage workspace categories.',
  },
  {
    id: 'tenant.audit.view',
    scope: 'tenant',
    description: 'Read the tenant audit trail.',
  },
  // Platform
  {
    id: 'platform.tenants.manage',
    scope: 'platform',
    description: 'Create and change tenants.',
  },
] as const satisfies readonly CapabilityDefinition[];

export type Capability = (typeof CAPABILITIES)[number]['id'];

export const CAPABILITY_IDS: readonly Capability[] = CAPABILITIES.map(
  (capability) => capability.id,
);

export const WORKSPACE_CAPABILITIES: readonly Capability[] =
  CAPABILITIES.filter((capability) => capability.scope === 'workspace').map(
    (capability) => capability.id,
  );

export function isCapability(value: string): value is Capability {
  return (CAPABILITY_IDS as readonly string[]).includes(value);
}
