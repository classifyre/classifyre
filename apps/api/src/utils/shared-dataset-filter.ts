import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Whether a shared dataset can be read now (DQ §5.12), as the shared
 * datasets list works it out: retired by its lifecycle; else blocked while it
 * has a block; else unavailable while a read last found an input missing;
 * else live.
 */
export const DATASET_STATES = [
  'live',
  'blocked',
  'unavailable',
  'retired',
] as const;
export type DatasetState = (typeof DATASET_STATES)[number];

export interface DatasetSearch {
  datasetState?: unknown;
  promoted?: unknown;
}

function stateOf(search: DatasetSearch): DatasetState | null {
  const value = search.datasetState;
  if (value === undefined || value === null || value === '') return null;
  if (!(DATASET_STATES as readonly unknown[]).includes(value)) {
    throw new BadRequestException(
      `datasetState is one of ${DATASET_STATES.join(', ')}; got ${JSON.stringify(value)}`,
    );
  }
  return value as DatasetState;
}

function promotedOf(search: DatasetSearch): boolean | null {
  const value = search.promoted;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

/** The asset list's where-clause for these filters, or null when none is set. */
export function datasetAssetWhere(
  search: DatasetSearch,
): Prisma.AssetWhereInput | null {
  const state = stateOf(search);
  const promoted = promotedOf(search);
  if (!state && promoted === null) return null;
  const clauses: Prisma.AssetWhereInput[] = [
    { sharedDataset: { isNot: null } },
  ];
  const notRetired: Prisma.AssetWhereInput = {
    OR: [{ governance: null }, { governance: { status: { not: 'RETIRED' } } }],
  };
  if (state === 'retired') {
    clauses.push({ governance: { status: 'RETIRED' } });
  } else if (state === 'blocked') {
    clauses.push(notRetired, { sharedDataset: { blocks: { some: {} } } });
  } else if (state === 'unavailable') {
    clauses.push(notRetired, {
      sharedDataset: { blocks: { none: {} }, unavailableAt: { not: null } },
    });
  } else if (state === 'live') {
    clauses.push(notRetired, {
      sharedDataset: { blocks: { none: {} }, unavailableAt: null },
    });
  }
  if (promoted !== null) {
    clauses.push({
      sharedDataset: {
        promotedAt: promoted ? { not: null } : null,
      },
    });
  }
  return { AND: clauses };
}

/** The same filters as SQL over `assets <alias>`, or null when none is set. */
export function datasetAssetSql(
  search: DatasetSearch,
  alias = 'a',
): Prisma.Sql | null {
  const state = stateOf(search);
  const promoted = promotedOf(search);
  if (!state && promoted === null) return null;
  const a = Prisma.raw(alias);
  const retired = Prisma.sql`COALESCE((SELECT g.status::text FROM asset_governance g WHERE g.asset_id = ${a}.id), 'DRAFT') = 'RETIRED'`;
  const blocked = Prisma.sql`EXISTS (SELECT 1 FROM shared_dataset_blocks b WHERE b.asset_id = sd.asset_id)`;
  const conditions: Prisma.Sql[] = [];
  if (state === 'retired') conditions.push(retired);
  else if (state === 'blocked')
    conditions.push(Prisma.sql`NOT ${retired}`, blocked);
  else if (state === 'unavailable')
    conditions.push(
      Prisma.sql`NOT ${retired}`,
      Prisma.sql`NOT ${blocked}`,
      Prisma.sql`sd.unavailable_at IS NOT NULL`,
    );
  else if (state === 'live')
    conditions.push(
      Prisma.sql`NOT ${retired}`,
      Prisma.sql`NOT ${blocked}`,
      Prisma.sql`sd.unavailable_at IS NULL`,
    );
  if (promoted !== null) {
    conditions.push(
      promoted
        ? Prisma.sql`sd.promoted_at IS NOT NULL`
        : Prisma.sql`sd.promoted_at IS NULL`,
    );
  }
  const where = conditions.length
    ? Prisma.sql` AND ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
  return Prisma.sql`EXISTS (SELECT 1 FROM shared_datasets sd WHERE sd.asset_id = ${a}.id${where})`;
}
