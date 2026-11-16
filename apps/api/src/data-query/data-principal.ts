import type { ResourceGrants } from '../identity/access-policy';
import type { Capability } from '../identity/capabilities';
import type { GovernancePerson } from '../governance/governance-rules';

/**
 * Whose rights a catalog is computed for (DQ §4, §5.8, §5.10, §5.12): the
 * signed-in person of a request, or the owning group of a shared dataset,
 * whose inputs are read with the group's rights and never the reader's.
 */
export interface DataPrincipal {
  /** `user:<sub>` for a person (owners read their own tables), null for a group. */
  ownerRef: string | null;
  /**
   * Who answers for tables (owner/steward roles) and whom row rules name:
   * a person with their groups, or `group:<id>` with the group and the
   * groups above it. Null for nobody (a visitor, a system actor).
   */
  person: GovernancePerson | null;
  capabilities: ReadonlySet<Capability>;
  resourceGrants(capability: Capability): ResourceGrants;
}

const NONE: ResourceGrants = { sourceIds: [], assetIds: [] };

/** A group as a principal: its grants, its stewardship, its row rules. */
export function groupPrincipal(input: {
  groupId: string;
  /** The group and every group above it, nearest first. */
  lineage: readonly string[];
  capabilities: ReadonlySet<Capability>;
  resourceGrants: Partial<Record<Capability, ResourceGrants>>;
}): DataPrincipal {
  return {
    ownerRef: null,
    person: {
      actorRef: `group:${input.groupId}`,
      groupIds: input.lineage.length ? input.lineage : [input.groupId],
    },
    capabilities: input.capabilities,
    resourceGrants: (capability) => input.resourceGrants[capability] ?? NONE,
  };
}
