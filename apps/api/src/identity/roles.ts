import {
  CAPABILITY_IDS,
  WORKSPACE_CAPABILITIES,
  type Capability,
  type CapabilityScope,
} from './capabilities';

/**
 * Built-in roles (docs/prd/IAM-access-management.md §6.2). A role is a fixed
 * bundle of capabilities and never names a team; a grant joins a group to a
 * role on a scope. Roles sit side by side rather than inheriting from each
 * other, so each list below is the whole role.
 */
export interface RoleDefinition {
  key: string;
  title: string;
  /** Where the role can be granted. `workspace` roles can also be granted on a group's workspaces. */
  scope: CapabilityScope;
  capabilities: readonly Capability[];
}

const VIEWS: readonly Capability[] = WORKSPACE_CAPABILITIES.filter((id) =>
  id.endsWith('.view'),
);

const WORKSPACE_ADMIN: readonly Capability[] = WORKSPACE_CAPABILITIES.filter(
  (id) => id !== 'code.author',
);

export const BUILT_IN_ROLES = [
  {
    key: 'viewer',
    title: 'Viewer',
    scope: 'workspace',
    capabilities: [...VIEWS, 'mcp.token.own'],
  },
  {
    key: 'investigator',
    title: 'Investigator',
    scope: 'workspace',
    capabilities: [
      ...VIEWS,
      'mcp.token.own',
      'agent.use',
      'finding.triage',
      'asset.tag',
      'case.edit',
      'inquiry.edit',
      'lead.review',
    ],
  },
  {
    key: 'curator',
    title: 'Curator',
    scope: 'workspace',
    capabilities: [
      ...VIEWS,
      'mcp.token.own',
      'agent.use',
      'glossary.edit',
      'glossary.approve',
      'entity.manage',
      'correlation.review',
    ],
  },
  {
    // Deliberately without case and inquiry access (use case U3).
    key: 'source-manager',
    title: 'Source manager',
    scope: 'workspace',
    capabilities: [
      'workspace.view',
      'mcp.token.own',
      'source.view',
      'source.manage',
      'source.run',
      'source.purge',
      'detector.view',
      'detector.manage',
      'detector.train',
      'finding.view',
      'asset.view',
    ],
  },
  {
    key: 'workspace-admin',
    title: 'Workspace admin',
    scope: 'workspace',
    capabilities: WORKSPACE_ADMIN,
  },
  {
    // Add-on: combined with another role, never granted alone in practice.
    key: 'code-author',
    title: 'Code author',
    scope: 'workspace',
    capabilities: ['code.author'],
  },
  {
    key: 'workspace-manager',
    title: 'Workspace manager',
    scope: 'tenant',
    capabilities: ['tenant.workspace.create', ...WORKSPACE_ADMIN],
  },
  {
    key: 'auditor',
    title: 'Auditor',
    scope: 'tenant',
    capabilities: ['tenant.audit.view', 'access.view', 'workspace.view'],
  },
  {
    key: 'tenant-admin',
    title: 'Tenant admin',
    scope: 'tenant',
    capabilities: CAPABILITY_IDS.filter((id) => !id.startsWith('platform.')),
  },
  {
    key: 'platform-operator',
    title: 'Platform operator',
    scope: 'platform',
    capabilities: ['platform.tenants.manage'],
  },
] as const satisfies readonly RoleDefinition[];

export type RoleKey = (typeof BUILT_IN_ROLES)[number]['key'];
