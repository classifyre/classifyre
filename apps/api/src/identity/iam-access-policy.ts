import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type {
  AccessDecision,
  AccessPolicy,
  ResourceGrants,
  ResourceRef,
} from './access-policy';
import type { Capability } from './capabilities';

/** Capabilities of the current request's principal in its workspace (set by the namespace hook). */
export const CLS_CAPABILITIES = 'classifyre:capabilities';

/** Per capability, the sources and tables single-resource grants open (set by the namespace hook). */
export const CLS_RESOURCE_GRANTS = 'classifyre:resourceGrants';

/**
 * The signed-in person of the current request, as notifications see them
 * (set by the namespace hook and the MCP handler): their `user:<sub>` and
 * every group they are in, with the groups above those.
 */
export const CLS_PERSON = 'classifyre:person';

/** The Keycloak organization of the request's tenant (set by the namespace hook), to name groups. */
export const CLS_ORG_ID = 'classifyre:orgId';

export interface ClsPerson {
  actorRef: string;
  groupIds: string[];
}

const NO_RESOURCES: ResourceGrants = { sourceIds: [], assetIds: [] };

/**
 * The policy with sign-in on: a capability is allowed when the principal's
 * grants give it in the current workspace. The namespace hook computes the
 * set once per request; this only reads it.
 */
@Injectable()
export class IamAccessPolicy implements AccessPolicy {
  constructor(private readonly cls: ClsService) {}

  private current(): ReadonlySet<Capability> {
    if (!this.cls.isActive()) return new Set();
    return this.cls.get<ReadonlySet<Capability>>(CLS_CAPABILITIES) ?? new Set();
  }

  check(
    _actor: unknown,
    capability: Capability,
    resource?: ResourceRef,
  ): AccessDecision {
    if (this.current().has(capability)) return { allow: true };
    if (resource && (resource.type === 'source' || resource.type === 'asset')) {
      const grants = this.resourceGrants(capability);
      const ids =
        resource.type === 'source' ? grants.sourceIds : grants.assetIds;
      if (ids.includes(resource.id)) return { allow: true };
    }
    return { allow: false, reason: `needs ${capability}` };
  }

  resourceGrants(capability: Capability): ResourceGrants {
    if (!this.cls.isActive()) return NO_RESOURCES;
    const all =
      this.cls.get<Partial<Record<Capability, ResourceGrants>>>(
        CLS_RESOURCE_GRANTS,
      ) ?? {};
    return all[capability] ?? NO_RESOURCES;
  }

  capabilities(): ReadonlySet<Capability> {
    return this.current();
  }
}
