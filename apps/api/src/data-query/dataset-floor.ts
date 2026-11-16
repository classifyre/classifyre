/**
 * What a shared dataset's output columns inherit (docs/prd/DQ-data-query.md
 * §5.12): each column's *floor* is the strictest classification of the input
 * columns it comes from; a column whose lineage could not be traced takes the
 * strictest of every input (fail closed). The dataset's own settings may make
 * a column stricter than its floor, never looser. Pure functions, shared by
 * the catalog (what the job masks), governance (what a steward may set) and
 * the dataset's own views.
 */
import {
  CLASSIFICATIONS,
  type Classification,
} from '../governance/governance-rules';
import {
  effectiveColumnPolicy,
  exposureOf,
  type ColumnPolicy,
} from './column-masks';

/** One input column an output column comes from. */
export interface UpstreamColumn {
  assetId: string;
  column: string;
}

/** An output column of a shared dataset, as recorded when it was saved. */
export interface DatasetColumn {
  name: string;
  type: string;
  upstreams: UpstreamColumn[];
  /** False when lineage could not say where it comes from: fail closed. */
  traced: boolean;
  /** How it is derived: IDENTITY, TRANSFORMED, AGGREGATED… (from lineage). */
  transform?: string | null;
}

/** One input's field mappings, as the job's describe returns them. */
export interface DescribedLineage {
  table: string;
  fields: {
    downstream: string | null;
    upstreams: string[];
    transform?: string | null;
    type?: string;
  }[];
}

export function rankOf(value: string | null | undefined): number {
  return value ? CLASSIFICATIONS.indexOf(value as Classification) : -1;
}

/** The stricter of two classifications (null = none). */
export function stricterClassification(
  a: string | null | undefined,
  b: string | null | undefined,
): Classification | null {
  const best = rankOf(a) >= rankOf(b) ? a : b;
  return rankOf(best) >= 0 ? (best as Classification) : null;
}

/** The policy that shows less of a column; ties keep `a`. */
export function stricterPolicy(a: ColumnPolicy, b: ColumnPolicy): ColumnPolicy {
  return exposureOf(b) < exposureOf(a) ? b : a;
}

/**
 * The output columns of a described query, with the input columns each one
 * comes from. `assetIdOf` maps the job's table names (`source.schema.table`)
 * to input asset ids.
 */
export function datasetColumns(
  columns: { name: string; type: string }[],
  lineage: DescribedLineage[],
  assetIdOf: (sqlName: string) => string | undefined,
): DatasetColumn[] {
  const byColumn = new Map<
    string,
    { upstreams: UpstreamColumn[]; transform: string | null }
  >();
  // Columns no table feeds (a literal, count(*)): traced, inherit nothing.
  const constant = new Set<string>();
  for (const entry of lineage) {
    if (entry.table === '') {
      for (const field of entry.fields) {
        if (field.downstream) constant.add(field.downstream.toLowerCase());
      }
      continue;
    }
    const assetId = assetIdOf(entry.table.toLowerCase());
    if (!assetId) continue;
    for (const field of entry.fields) {
      if (!field.downstream || field.type === 'INDIRECT') continue;
      const key = field.downstream.toLowerCase();
      const found = byColumn.get(key) ?? { upstreams: [], transform: null };
      for (const column of field.upstreams) {
        found.upstreams.push({ assetId, column });
      }
      found.transform = strongerTransform(found.transform, field.type ?? null);
      byColumn.set(key, found);
    }
  }
  return columns.map((column) => {
    const key = column.name.toLowerCase();
    const found = byColumn.get(key);
    return {
      name: column.name,
      type: column.type,
      upstreams: found?.upstreams ?? [],
      traced: Boolean(found?.upstreams.length) || constant.has(key),
      transform: found?.transform ?? (constant.has(key) ? 'CONSTANT' : null),
    };
  });
}

const TRANSFORM_ORDER = ['IDENTITY', 'MAPPED', 'TRANSFORMED', 'AGGREGATED'];

function strongerTransform(a: string | null, b: string | null) {
  return TRANSFORM_ORDER.indexOf(b ?? '') > TRANSFORM_ORDER.indexOf(a ?? '')
    ? b
    : a;
}

/** What a dataset column inherits from its inputs. */
export interface ColumnFloor {
  floor: Classification | null;
  /**
   * The strictest of the input columns' own policies (a steward's mask or
   * hide on a column nobody classified), or null when they add nothing to
   * the classification.
   */
  policy: ColumnPolicy | null;
  from: UpstreamColumn[];
  /** False when lineage could not say where it comes from: fail closed. */
  traced: boolean;
}

/** How a dataset's inputs are looked up while working out floors. */
export interface FloorInputs {
  /** An input column's effective classification. */
  classify: (assetId: string, column: string) => string | null | undefined;
  /** The strictest classification of all inputs. */
  strictest: Classification | null;
  /** An input column's own policy, when a steward set one. */
  policyOf?: (assetId: string, column: string) => ColumnPolicy | null;
  /** The strictest steward-set policy of all inputs. */
  strictestPolicy?: ColumnPolicy | null;
  /**
   * Whether an input has the column (any case). Lineage names something that
   * is not a column when the query uses a whole row (`SELECT t AS r FROM x t`,
   * `to_json(t)`): that column carries every column, so it is untraced.
   */
  known?: (assetId: string, column: string) => boolean;
}

/**
 * Each output column's floor: the strictest classification and steward
 * policy of its upstream columns, or of every input when it was not traced
 * or an upstream is not a column of its input.
 */
export function columnFloors(
  columns: readonly DatasetColumn[],
  inputs: FloorInputs,
): Map<string, ColumnFloor> {
  const out = new Map<string, ColumnFloor>();
  for (const column of columns) {
    const traced =
      column.traced &&
      column.upstreams.every(
        (u) => !inputs.known || inputs.known(u.assetId, u.column),
      );
    if (!traced) {
      out.set(column.name, {
        floor: inputs.strictest,
        policy: inputs.strictestPolicy ?? null,
        from: [],
        traced: false,
      });
      continue;
    }
    let floor: Classification | null = null;
    let policy: ColumnPolicy | null = null;
    let from: UpstreamColumn[] = [];
    for (const upstream of column.upstreams) {
      const own = inputs.policyOf?.(upstream.assetId, upstream.column) ?? null;
      if (own) policy = policy ? stricterPolicy(policy, own) : own;
      const value = inputs.classify(upstream.assetId, upstream.column) ?? null;
      const rank = rankOf(value);
      if (rank < 0) continue;
      if (rank > rankOf(floor)) {
        floor = value as Classification;
        from = [upstream];
      } else if (rank === rankOf(floor)) {
        from.push(upstream);
      }
    }
    out.set(column.name, { floor, policy, from, traced: true });
  }
  return out;
}

/**
 * A dataset column's effective policy for readers: its own settings (a
 * steward's access, mask and classification, which can only add to the
 * floor), never showing more than the floor's classification would.
 */
export function datasetColumnPolicy(input: {
  floor: string | null;
  /** The inputs' own policies (a mask set without a classification). */
  floorPolicy?: ColumnPolicy | null;
  access: string | null | undefined;
  maskKind: string | null | undefined;
  classification: string | null | undefined;
}): ColumnPolicy {
  const floorPolicy = effectiveColumnPolicy({
    access: null,
    maskKind: null,
    classification: input.floor,
  });
  const own = effectiveColumnPolicy({
    access: input.access,
    maskKind: input.maskKind,
    classification: stricterClassification(input.classification, input.floor),
  });
  const inherited = input.floorPolicy
    ? stricterPolicy(floorPolicy, input.floorPolicy)
    : floorPolicy;
  return stricterPolicy(own, inherited);
}

/** Parse the `columns` JSON of a stored dataset (defensive: it is JSONB). */
export function parseDatasetColumns(value: unknown): DatasetColumn[] {
  if (!Array.isArray(value)) return [];
  const out: DatasetColumn[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.name !== 'string' || !entry.name) continue;
    const upstreams = Array.isArray(entry.upstreams)
      ? entry.upstreams.flatMap((u) => {
          const up = u as Record<string, unknown> | null;
          return up &&
            typeof up.assetId === 'string' &&
            typeof up.column === 'string'
            ? [{ assetId: up.assetId, column: up.column }]
            : [];
        })
      : [];
    out.push({
      name: entry.name,
      type: typeof entry.type === 'string' ? entry.type : '',
      upstreams,
      // A traced column with no upstream is one no table feeds (count(*)).
      traced: entry.traced === true,
      transform: typeof entry.transform === 'string' ? entry.transform : null,
    });
  }
  return out;
}
