import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { GovernancePerson } from './governance-rules';

/**
 * Asset search by governance (docs/prd/GOV-governed-data-assets.md §5.6):
 * `governance` (ungoverned, governed, or a lifecycle), `ownerRef`,
 * `stewardRef`. `me` in a ref filter means the signed-in person, and for
 * stewards also their groups.
 *
 * An asset is owned when it or its source has an open OWNER; its owner is its
 * own when it names one, else its source's (R2). Roles are polymorphic rows,
 * so the filter turns them into id lists of assets and sources, which stay
 * small: the people a workspace names, not its assets.
 */
export const GOVERNANCE_FILTERS = [
  'ungoverned',
  'governed',
  'draft',
  'active',
  'deprecated',
  'retired',
  'failing',
] as const;
export type GovernanceFilter = (typeof GOVERNANCE_FILTERS)[number];

export interface GovernanceSearch {
  governance?: unknown;
  ownerRef?: unknown;
  stewardRef?: unknown;
}

type Db = Pick<PrismaClient, 'governanceRole'>;

async function openScopes(
  db: Db,
  where: Prisma.GovernanceRoleWhereInput,
): Promise<{ assetIds: string[]; sourceIds: string[] }> {
  const rows = await db.governanceRole.findMany({
    where: { ...where, dateOut: null },
    select: { scopeType: true, scopeId: true },
  });
  const assetIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const row of rows) {
    (row.scopeType === 'ASSET' ? assetIds : sourceIds).add(row.scopeId);
  }
  return { assetIds: [...assetIds], sourceIds: [...sourceIds] };
}

function refsFor(
  value: string,
  person: GovernancePerson | null,
  withGroups: boolean,
): string[] {
  if (value !== 'me') return [value];
  if (!person) {
    throw new BadRequestException(
      '`me` needs a signed-in person; name a principal instead.',
    );
  }
  return [
    person.actorRef,
    ...(withGroups ? person.groupIds.map((id) => `group:${id}`) : []),
  ];
}

const either = (scopes: {
  assetIds: string[];
  sourceIds: string[];
}): Prisma.AssetWhereInput => ({
  OR: [{ id: { in: scopes.assetIds } }, { sourceId: { in: scopes.sourceIds } }],
});

/** The where-clause for the governance filters, or null when none is set. */
export async function governanceAssetWhere(
  db: Db,
  search: GovernanceSearch,
  person: GovernancePerson | null,
): Promise<Prisma.AssetWhereInput | null> {
  const clauses: Prisma.AssetWhereInput[] = [];
  const governance =
    typeof search.governance === 'string'
      ? search.governance.trim().toLowerCase()
      : undefined;
  const ownerRef =
    typeof search.ownerRef === 'string' ? search.ownerRef.trim() : '';
  const stewardRef =
    typeof search.stewardRef === 'string' ? search.stewardRef.trim() : '';

  if (governance) {
    if (!(GOVERNANCE_FILTERS as readonly string[]).includes(governance)) {
      throw new BadRequestException(
        `governance is one of ${GOVERNANCE_FILTERS.join(', ')}; got ${governance}`,
      );
    }
    // A failing quality rule keeps one open QUALITY finding (GOV R9).
    const owned =
      governance === 'failing' ? null : await openScopes(db, { role: 'OWNER' });
    if (!owned) {
      clauses.push({
        findings: { some: { detectorType: 'QUALITY', status: 'OPEN' } },
      });
    } else if (governance === 'ungoverned') {
      clauses.push({
        AND: [
          { id: { notIn: owned.assetIds } },
          { sourceId: { notIn: owned.sourceIds } },
        ],
      });
    } else {
      clauses.push(either(owned));
      if (governance === 'draft') {
        clauses.push({
          OR: [{ governance: null }, { governance: { status: 'DRAFT' } }],
        });
      } else if (governance !== 'governed') {
        clauses.push({
          governance: {
            status: governance.toUpperCase() as
              | 'ACTIVE'
              | 'DEPRECATED'
              | 'RETIRED',
          },
        });
      }
    }
  }

  if (ownerRef) {
    const refs = refsFor(ownerRef, person, false);
    const theirs = await openScopes(db, {
      role: 'OWNER',
      principalRef: { in: refs },
    });
    // A source's owner owns its assets that name no owner of their own.
    const ownOwners = await openScopes(db, {
      role: 'OWNER',
      scopeType: 'ASSET',
    });
    clauses.push({
      OR: [
        { id: { in: theirs.assetIds } },
        {
          AND: [
            { sourceId: { in: theirs.sourceIds } },
            { id: { notIn: ownOwners.assetIds } },
          ],
        },
      ],
    });
  }

  if (stewardRef) {
    const refs = refsFor(stewardRef, person, true);
    clauses.push(
      either(
        await openScopes(db, {
          role: 'STEWARD',
          principalRef: { in: refs },
        }),
      ),
    );
  }

  return clauses.length ? { AND: clauses } : null;
}

/**
 * What an owner may query (GOV R3, decided 2026-11-12): the tables they own,
 * and every table of a source they own. Not export (`data.export` stays a
 * role capability). Stewards and custodians get no data access from a role.
 */
export async function ownerDataScope(
  db: Db,
  actorRef: string | null | undefined,
): Promise<{ assetIds: string[]; sourceIds: string[] }> {
  if (!actorRef?.startsWith('user:')) return { assetIds: [], sourceIds: [] };
  return openScopes(db, { role: 'OWNER', principalRef: actorRef });
}
