import type { Capability } from './capabilities';
import { BUILT_IN_ROLES } from './roles';
import type { GrantScope } from './tenancy.service';

const ROLE_CAPABILITIES = new Map<string, readonly Capability[]>(
  BUILT_IN_ROLES.map((role) => [role.key, role.capabilities]),
);

/** Unknown keys (a grant stored before a role was removed) give nothing. */
export function roleCapabilities(roleKey: string): readonly Capability[] {
  return ROLE_CAPABILITIES.get(roleKey) ?? [];
}

/**
 * Whether a grant applies to one workspace (docs/prd §5): tenant grants
 * always do, workspace grants to that workspace, group grants to every
 * workspace owned by that group or by a group below it. `ownerLineage` is the
 * owner group followed by its ancestors.
 */
export function grantApplies(
  grant: GrantScope,
  workspace: { namespaceId: string; ownerLineage: readonly string[] },
): boolean {
  switch (grant.scopeType) {
    case 'tenant':
      return true;
    case 'workspace':
      return grant.scopeId === workspace.namespaceId;
    case 'group':
      return workspace.ownerLineage.includes(grant.scopeId);
    case 'source':
    case 'asset':
      // A grant on one source or table gives nothing workspace-wide; its
      // capabilities apply to that resource only (see dataGrantsInWorkspace).
      return false;
  }
}

/** Sources and tables of one workspace the grants open to `capability`. */
export interface ResourceGrants {
  sourceIds: string[];
  assetIds: string[];
}

/**
 * The sources and tables of one workspace that resource grants (scope
 * `source` / `asset`, id `<namespaceId>/<id>`) open to a capability. A grant
 * on the whole workspace is not counted here: it is in the capability set.
 */
export function resourceGrantsInWorkspace(
  grants: readonly (GrantScope & { roleKey: string })[],
  namespaceId: string,
  capability: Capability,
): ResourceGrants {
  const prefix = `${namespaceId}/`;
  const sourceIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const grant of grants) {
    if (grant.scopeType !== 'source' && grant.scopeType !== 'asset') continue;
    if (!grant.scopeId.startsWith(prefix)) continue;
    if (!roleCapabilities(grant.roleKey).includes(capability)) continue;
    const id = grant.scopeId.slice(prefix.length);
    if (!id) continue;
    (grant.scopeType === 'source' ? sourceIds : assetIds).add(id);
  }
  return { sourceIds: [...sourceIds], assetIds: [...assetIds] };
}

/** Every capability the grants give in one workspace. Grants only add up. */
/**
 * What anyone of the tenant may do in a public workspace without a grant on
 * it: read, as a visitor does (docs/prd/IAM §13 step 8h).
 */
export const PUBLIC_WORKSPACE_CAPABILITIES: readonly Capability[] =
  roleCapabilities('visitor');

export function capabilitiesInWorkspace(
  grants: readonly (GrantScope & { roleKey: string })[],
  workspace: {
    namespaceId: string;
    ownerLineage: readonly string[];
    /** A public workspace adds read-only access for everyone of its tenant. */
    public?: boolean;
  },
): Set<Capability> {
  const capabilities = new Set<Capability>(
    workspace.public ? PUBLIC_WORKSPACE_CAPABILITIES : [],
  );
  for (const grant of grants) {
    if (!grantApplies(grant, workspace)) continue;
    for (const capability of roleCapabilities(grant.roleKey)) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

/** Capabilities from grants on the whole tenant only (registry-level routes). */
export function tenantCapabilities(
  grants: readonly (Pick<GrantScope, 'scopeType'> & { roleKey: string })[],
): Set<Capability> {
  const capabilities = new Set<Capability>();
  for (const grant of grants) {
    if (grant.scopeType !== 'tenant') continue;
    for (const capability of roleCapabilities(grant.roleKey)) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

/**
 * Whether the grants allow creating a workspace owned by `ownerLineage[0]`:
 * a tenant-wide `tenant.workspace.create`, or one granted on that group or a
 * group above it. Membership of the owner group is checked separately, as an
 * invariant no grant can lift (§8.2).
 */
export function canCreateWorkspaceFor(
  grants: readonly (GrantScope & { roleKey: string })[],
  ownerLineage: readonly string[],
): boolean {
  return grants.some(
    (grant) =>
      roleCapabilities(grant.roleKey).includes('tenant.workspace.create') &&
      (grant.scopeType === 'tenant' ||
        (grant.scopeType === 'group' && ownerLineage.includes(grant.scopeId))),
  );
}
