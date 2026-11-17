import { BadRequestException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
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
  responsibleRef?: unknown;
}

/** `responsibleRef`: owners and stewards, on the asset or its source. */
function responsibleRefOf(search: GovernanceSearch): string {
  return typeof search.responsibleRef === 'string'
    ? search.responsibleRef.trim()
    : '';
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

/**
 * The governed assets (GOV §4): those with an open OWNER, or whose source has
 * one. Null when nothing in the workspace is owned. Governed assets are never
 * hard-deleted: a purge keeps them and a source with any is not deleted.
 */
export async function governedAssetWhere(
  db: Db,
): Promise<Prisma.AssetWhereInput | null> {
  const owned = await openScopes(db, { role: 'OWNER' });
  if (!owned.assetIds.length && !owned.sourceIds.length) return null;
  return either(owned);
}

/**
 * The assets a purge keeps (GOV §4, DQ §5.8, §5.10): the governed ones, and
 * any that carry a protection someone set — a row filter, a column hidden,
 * masked or classified, or an open steward or custodian role. Their rows
 * cascade with the asset, and a re-scan brings the asset back with the same
 * id but without them: grant holders would then see every row and every
 * column, past ALL_ROWS_REQUIRED and UNMASK_REQUIRED.
 */
export async function protectedAssetWhere(
  db: Db,
): Promise<Prisma.AssetWhereInput> {
  const [governed, roles] = await Promise.all([
    governedAssetWhere(db),
    openScopes(db, {}),
  ]);
  const clauses: Prisma.AssetWhereInput[] = [
    { rowPolicy: { isNot: null } },
    {
      columnAnnotations: {
        some: {
          OR: [
            { access: { not: null } },
            { maskKind: { not: null } },
            { classification: { not: null } },
          ],
        },
      },
    },
  ];
  if (governed) clauses.push(governed);
  if (roles.assetIds.length || roles.sourceIds.length) {
    clauses.push(either(roles));
  }
  return { OR: clauses };
}

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

  const responsibleRef = responsibleRefOf(search);
  if (responsibleRef) {
    clauses.push(
      either(
        await openScopes(db, {
          role: { in: ['OWNER', 'STEWARD'] },
          principalRef: { in: refsFor(responsibleRef, person, true) },
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

/**
 * What a person reads in clear because they answer for it (DQ §5.8): the
 * tables and sources they, or a group of theirs, own or steward. Columns
 * governance masks are theirs to judge; custodians run the system and get
 * nothing from this. A group as principal (a shared dataset's owning group,
 * DQ §5.12) gets what it, or a group above it, stewards.
 */
export async function governedDataScope(
  db: Db,
  person: GovernancePerson | null,
): Promise<{ assetIds: string[]; sourceIds: string[] }> {
  const refs = person?.actorRef.startsWith('user:')
    ? [person.actorRef, ...person.groupIds.map((id) => `group:${id}`)]
    : person?.actorRef.startsWith('group:')
      ? person.groupIds.map((id) => `group:${id}`)
      : [];
  if (!refs.length) return { assetIds: [], sourceIds: [] };
  return openScopes(db, {
    role: { in: ['OWNER', 'STEWARD'] },
    principalRef: { in: refs },
  });
}

/**
 * The raw-SQL twin of {@link governanceAssetWhere}, for the aggregate queries
 * (`/search/assets/charts`, the governance dashboard): the same filters,
 * over the asset row aliased `alias`. Null when none is set.
 */
export async function governanceAssetSql(
  db: Db,
  search: GovernanceSearch,
  person: GovernancePerson | null,
  alias = 'a',
): Promise<Prisma.Sql | null> {
  const a = Prisma.raw(alias);
  const inScopes = (scopes: { assetIds: string[]; sourceIds: string[] }) =>
    Prisma.sql`(${a}.id = ANY(${scopes.assetIds}::text[]) OR ${a}.source_id = ANY(${scopes.sourceIds}::text[]))`;
  const clauses: Prisma.Sql[] = [];
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
    if (governance === 'failing') {
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM findings qf WHERE qf.asset_id = ${a}.id AND qf.detector_type = 'QUALITY' AND qf.status = 'OPEN')`,
      );
    } else {
      const owned = await openScopes(db, { role: 'OWNER' });
      if (governance === 'ungoverned') {
        clauses.push(Prisma.sql`NOT ${inScopes(owned)}`);
      } else {
        clauses.push(inScopes(owned));
        if (governance === 'draft') {
          clauses.push(
            Prisma.sql`COALESCE((SELECT g.status::text FROM asset_governance g WHERE g.asset_id = ${a}.id), 'DRAFT') = 'DRAFT'`,
          );
        } else if (governance !== 'governed') {
          clauses.push(
            Prisma.sql`EXISTS (SELECT 1 FROM asset_governance g WHERE g.asset_id = ${a}.id AND g.status::text = ${governance.toUpperCase()})`,
          );
        }
      }
    }
  }

  if (ownerRef) {
    const refs = refsFor(ownerRef, person, false);
    const [theirs, ownOwners] = await Promise.all([
      openScopes(db, { role: 'OWNER', principalRef: { in: refs } }),
      openScopes(db, { role: 'OWNER', scopeType: 'ASSET' }),
    ]);
    clauses.push(
      Prisma.sql`(${a}.id = ANY(${theirs.assetIds}::text[]) OR (${a}.source_id = ANY(${theirs.sourceIds}::text[]) AND NOT ${a}.id = ANY(${ownOwners.assetIds}::text[])))`,
    );
  }

  if (stewardRef) {
    const refs = refsFor(stewardRef, person, true);
    clauses.push(
      inScopes(
        await openScopes(db, { role: 'STEWARD', principalRef: { in: refs } }),
      ),
    );
  }

  const responsibleRef = responsibleRefOf(search);
  if (responsibleRef) {
    clauses.push(
      inScopes(
        await openScopes(db, {
          role: { in: ['OWNER', 'STEWARD'] },
          principalRef: { in: refsFor(responsibleRef, person, true) },
        }),
      ),
    );
  }

  return clauses.length ? Prisma.join(clauses, ' AND ') : null;
}

/**
 * The assets a person answers for (the dashboard's *Mine*): those they or a
 * group of theirs own or steward, on the asset or its source.
 */
export async function answerableScopes(
  db: Db,
  person: GovernancePerson | null,
): Promise<{ assetIds: string[]; sourceIds: string[] }> {
  if (!person) return { assetIds: [], sourceIds: [] };
  const refs = [person.actorRef, ...person.groupIds.map((id) => `group:${id}`)];
  return openScopes(db, {
    role: { in: ['OWNER', 'STEWARD'] },
    principalRef: { in: refs },
  });
}
