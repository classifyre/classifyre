import type { PrismaClient } from '@prisma/client';
import { governedDataScope } from '../governance/governance-filter';
import type { GovernancePerson } from '../governance/governance-rules';
import type { AccessPolicy } from '../identity/access-policy';
import type { Actor } from '../identity/actor';
import type { DataPrincipal } from './data-principal';

/** Who reads masked and hidden columns in clear (DQ §5.8). */
export interface ClearScope {
  all: boolean;
  sourceIds: ReadonlySet<string>;
  assetIds: ReadonlySet<string>;
}

/**
 * What an actor reads in clear: everything with `data.unmask` on the
 * workspace (a role); a source or table with `data.unmask` granted on it (an
 * unmasked Data reader grant); and what they, or a group of theirs, own or
 * steward. The one rule the catalog (what the job masks) and governance
 * (who may loosen a mask) both go by.
 */
export async function clearScopeOf(
  db: Pick<PrismaClient, 'governanceRole'>,
  policy: AccessPolicy,
  actor: Actor,
  person: GovernancePerson | null,
): Promise<ClearScope> {
  const capabilities = await policy.capabilities(actor);
  return clearScopeFor(db, {
    ownerRef: null,
    person,
    capabilities,
    resourceGrants: (capability) =>
      policy.resourceGrants?.(capability) ?? { sourceIds: [], assetIds: [] },
  });
}

/** {@link clearScopeOf} for any principal: a person or a dataset's owning group. */
export async function clearScopeFor(
  db: Pick<PrismaClient, 'governanceRole'>,
  principal: DataPrincipal,
): Promise<ClearScope> {
  if (principal.capabilities.has('data.unmask')) {
    return { all: true, sourceIds: new Set(), assetIds: new Set() };
  }
  const grants = principal.resourceGrants('data.unmask');
  const governed = await governedDataScope(db, principal.person);
  return {
    all: false,
    sourceIds: new Set([...grants.sourceIds, ...governed.sourceIds]),
    assetIds: new Set([...grants.assetIds, ...governed.assetIds]),
  };
}

/** Whether a table (or a whole source, without `assetId`) is read in clear. */
export function readsInClear(
  scope: ClearScope,
  target: { sourceId: string; assetId?: string | null },
): boolean {
  return (
    scope.all ||
    scope.sourceIds.has(target.sourceId) ||
    (!!target.assetId && scope.assetIds.has(target.assetId))
  );
}
