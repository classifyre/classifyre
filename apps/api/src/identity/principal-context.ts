import type { ClsService } from 'nestjs-cls';
import { CLS_ACTOR } from './actor-context.service';
import {
  CLS_CAPABILITIES,
  CLS_ORG_ID,
  CLS_PERSON,
  CLS_RESOURCE_GRANTS,
  type ClsPerson,
} from './iam-access-policy';
import { RESOURCE_GRANTABLE_CAPABILITIES } from './access-policy';
import { resourceGrantsInWorkspace } from './grant-evaluation';
import type { Capability } from './capabilities';
import type { IdentityService, Principal } from './identity.service';

/**
 * Puts a principal's access in one workspace into the current CLS context:
 * actor, capabilities, organization, person (with their groups) and the
 * grants on single sources and tables. The one place that does it, for a
 * signed-in request (namespace hook), an MCP token and a SQL connection — so
 * none of them can forget a part (MCP once forgot the resource grants).
 */
export async function applyPrincipalContext(
  cls: ClsService,
  identity: Pick<IdentityService, 'groupLineage'>,
  principal: Principal,
  capabilities: Set<Capability>,
  namespaceId: string,
): Promise<void> {
  cls.set(CLS_ACTOR, principal.actor);
  cls.set(CLS_CAPABILITIES, capabilities);
  if (principal.orgId) cls.set(CLS_ORG_ID, principal.orgId);
  if (principal.actor.id?.startsWith('user:')) {
    cls.set<ClsPerson>(CLS_PERSON, {
      actorRef: principal.actor.id,
      groupIds: await identity.groupLineage(principal),
    });
  }
  cls.set(
    CLS_RESOURCE_GRANTS,
    Object.fromEntries(
      RESOURCE_GRANTABLE_CAPABILITIES.map((capability) => [
        capability,
        resourceGrantsInWorkspace(principal.grants, namespaceId, capability),
      ]),
    ),
  );
}
