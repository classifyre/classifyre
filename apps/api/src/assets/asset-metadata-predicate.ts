import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Filters over an asset's connector-authored `metadata`, compiled once.
 *
 * Shared by the runner-scoped asset query a connector calls through
 * `ctx.query_assets()` and by the `metadata` filter of asset search, so a
 * predicate means the same thing wherever it is written.
 *
 * Values compare as JSON, strictly: `{"eq": 5}` matches the number 5 and not
 * the string "5". Connector metadata is typed by whoever wrote it, and a
 * comparison that silently coerced would match differently depending on which
 * connector happened to write the key. Range operators compare numbers with
 * numbers, or strings with strings (ISO dates order correctly as text); a value
 * of the other type never matches.
 */

export const METADATA_OPERATORS = [
  'eq',
  'in',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;
export type MetadataOperator = (typeof METADATA_OPERATORS)[number];

type Scalar = string | number | boolean;

export interface MetadataPredicate {
  /** Path segments below `metadata`, e.g. ["legal_form_code"]. */
  path: string[];
  operator: MetadataOperator;
  value: Scalar | Scalar[];
}

export const METADATA_PREDICATE_LIMITS = {
  keys: 20,
  depth: 5,
  inValues: 1000,
} as const;

const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * A key as a path: `legal_form_code`, `metadata.legal_form_code` (the prefix
 * is what the connector docs write), or a nested `address.postcode`.
 */
export function parseMetadataPath(key: string): string[] {
  const trimmed = String(key ?? '').trim();
  const withoutPrefix = trimmed.startsWith('metadata.')
    ? trimmed.slice('metadata.'.length)
    : trimmed;
  const segments = withoutPrefix.split('.');
  if (
    !withoutPrefix ||
    segments.length > METADATA_PREDICATE_LIMITS.depth ||
    segments.some((segment) => !SEGMENT.test(segment))
  ) {
    throw new BadRequestException(
      `Invalid metadata key ${JSON.stringify(key)}: use letters, digits, _ and -, ` +
        `with dots for at most ${METADATA_PREDICATE_LIMITS.depth} nested levels.`,
    );
  }
  return segments;
}

/**
 * Validate `{key: {operator: value}}` into predicates, failing loudly: an
 * operator or value this does not understand is an error, never a filter that
 * matches everything.
 */
export function parseMetadataWhere(
  raw: unknown,
  options: { operators?: readonly MetadataOperator[] } = {},
): MetadataPredicate[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException(
      'where must be an object of {metadataKey: {operator: value}}.',
    );
  }
  const allowed = options.operators ?? METADATA_OPERATORS;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > METADATA_PREDICATE_LIMITS.keys) {
    throw new BadRequestException(
      `where accepts at most ${METADATA_PREDICATE_LIMITS.keys} keys.`,
    );
  }

  const predicates: MetadataPredicate[] = [];
  for (const [key, condition] of entries) {
    const path = parseMetadataPath(key);
    if (
      !condition ||
      typeof condition !== 'object' ||
      Array.isArray(condition) ||
      Object.keys(condition).length === 0
    ) {
      throw new BadRequestException(
        `where.${key} must be an object like {"eq": "value"}; operators: ${allowed.join(', ')}.`,
      );
    }
    for (const [operator, value] of Object.entries(
      condition as Record<string, unknown>,
    )) {
      if (!allowed.includes(operator as MetadataOperator)) {
        throw new BadRequestException(
          `Unknown operator ${JSON.stringify(operator)} for where.${key}; ` +
            `use one of: ${allowed.join(', ')}.`,
        );
      }
      predicates.push({
        path,
        operator: operator as MetadataOperator,
        value: validValue(key, operator as MetadataOperator, value),
      });
    }
  }
  return predicates;
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function validValue(
  key: string,
  operator: MetadataOperator,
  value: unknown,
): Scalar | Scalar[] {
  switch (operator) {
    case 'exists':
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `where.${key}.exists must be true or false.`,
        );
      }
      return value;
    case 'in':
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > METADATA_PREDICATE_LIMITS.inValues ||
        !value.every(isScalar)
      ) {
        throw new BadRequestException(
          `where.${key}.in must be 1 to ${METADATA_PREDICATE_LIMITS.inValues} strings, numbers or booleans.`,
        );
      }
      return value;
    case 'eq':
      if (!isScalar(value)) {
        throw new BadRequestException(
          `where.${key}.eq must be a string, number or boolean.`,
        );
      }
      return value;
    default:
      if (
        !(typeof value === 'number' && Number.isFinite(value)) &&
        typeof value !== 'string'
      ) {
        throw new BadRequestException(
          `where.${key}.${operator} must be a number or a string.`,
        );
      }
      return value;
  }
}

/** The JSON value at a path: `alias.metadata #> '{a,b}'`. */
function jsonAt(alias: string, path: string[]): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(alias)}.metadata #> ${path}::text[]`;
}

const RANGE_SQL: Record<'gt' | 'gte' | 'lt' | 'lte', string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

/** AND of every predicate, as SQL over `alias.metadata`; TRUE when empty. */
export function metadataPredicateSql(
  predicates: MetadataPredicate[],
  alias = 'a',
): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias ${alias}`);
  }
  if (predicates.length === 0) return Prisma.sql`TRUE`;
  const clauses = predicates.map((predicate) => {
    const value = jsonAt(alias, predicate.path);
    switch (predicate.operator) {
      case 'eq':
        return Prisma.sql`${value} = ${JSON.stringify(predicate.value)}::jsonb`;
      case 'in':
        return Prisma.sql`${value} = ANY(${(predicate.value as Scalar[]).map((item) => JSON.stringify(item))}::jsonb[])`;
      case 'exists':
        // A key holding JSON null counts as absent.
        return predicate.value
          ? Prisma.sql`(${value} IS NOT NULL AND jsonb_typeof(${value}) <> 'null')`
          : Prisma.sql`(${value} IS NULL OR jsonb_typeof(${value}) = 'null')`;
      default: {
        const op = Prisma.raw(RANGE_SQL[predicate.operator]);
        const text = Prisma.sql`${Prisma.raw(alias)}.metadata #>> ${predicate.path}::text[]`;
        return typeof predicate.value === 'number'
          ? Prisma.sql`(jsonb_typeof(${value}) = 'number' AND (${text})::numeric ${op} ${predicate.value})`
          : Prisma.sql`(jsonb_typeof(${value}) = 'string' AND ${text} ${op} ${predicate.value})`;
      }
    }
  });
  return Prisma.join(clauses, ' AND ');
}

/**
 * The same predicates as a Prisma `where`, for queries built with the client.
 *
 * Only equality compiles here: Prisma's JSON range filters compare `jsonb`
 * across types by its type ordering (a boolean sorts above every number), which
 * is not the numeric comparison {@link metadataPredicateSql} performs. Callers
 * that use this pass `operators: ['eq', 'in']` to {@link parseMetadataWhere}, so
 * an unsupported operator is a 400 rather than a different answer.
 */
export function metadataPredicatePrisma(
  predicates: MetadataPredicate[],
): Prisma.AssetWhereInput[] {
  return predicates.map((predicate) => {
    if (predicate.operator === 'eq') {
      return {
        metadata: {
          path: predicate.path,
          equals: predicate.value,
        },
      };
    }
    if (predicate.operator === 'in') {
      return {
        OR: (predicate.value as Scalar[]).map((item) => ({
          metadata: { path: predicate.path, equals: item },
        })),
      };
    }
    throw new BadRequestException(
      `Operator ${predicate.operator} is not supported here; use eq or in.`,
    );
  });
}
