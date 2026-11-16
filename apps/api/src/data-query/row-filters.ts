/**
 * Row filters (docs/prd/DQ-data-query.md §5.10): which rows of a table each
 * reader sees. Free of the database, so the rules can be tested on their own;
 * `apps/cli/src/query/rows.py` turns a filter into the WHERE clause of the
 * table's view.
 *
 * A table without a policy shows every row to everyone who may query it.
 * Once its owner or steward turns filtering on, a reader sees the rows that
 * at least one rule for them selects (a rule for one of their groups, or for
 * everyone), and no row without such a rule. The owners and stewards of the
 * table or its source see every row: they decide what the others see.
 */

export const ROW_OPS = ['in', 'not_in'] as const;
export type RowOp = (typeof ROW_OPS)[number];

export type RowValue = string | number | boolean;

/** One column test: the value is (or is not) one of `values`. */
export type RowCondition = {
  column: string;
  op: RowOp;
  values: RowValue[];
};

/** A rule as stored: who it is for, and the conditions a row must meet. */
export interface RowRule {
  id: string;
  /** `group:<id>`, or {@link EVERYONE}. */
  principalRef: string;
  /** All of them; none selects every row. */
  conditions: RowCondition[];
}

/**
 * What the job applies to one table: a row is shown when it meets every
 * condition of at least one entry. No entry: no row.
 */
export interface RowFilter {
  anyOf: RowCondition[][];
}

export const EVERYONE = 'everyone';

export const MAX_ROW_RULES = 20;
export const MAX_ROW_CONDITIONS = 5;
export const MAX_ROW_VALUES = 100;
const MAX_VALUE_LENGTH = 200;

export class RowRuleError extends Error {}

const isOp = (value: unknown): value is RowOp =>
  (ROW_OPS as readonly unknown[]).includes(value);

function parseValue(value: unknown): RowValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RowRuleError('A value must be a finite number.');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_LENGTH) {
      throw new RowRuleError(
        `A value can be at most ${MAX_VALUE_LENGTH} characters.`,
      );
    }
    return value;
  }
  throw new RowRuleError('A value is text, a number, or true or false.');
}

/** Conditions as given (by a person, or read back from the database). */
export function parseConditions(input: unknown): RowCondition[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new RowRuleError('Conditions are a list.');
  }
  if (input.length > MAX_ROW_CONDITIONS) {
    throw new RowRuleError(
      `A rule has at most ${MAX_ROW_CONDITIONS} conditions.`,
    );
  }
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new RowRuleError('A condition names a column, a test and values.');
    }
    const { column, op, values } = raw as Record<string, unknown>;
    if (typeof column !== 'string' || !column.trim()) {
      throw new RowRuleError('A condition names a column.');
    }
    if (!isOp(op)) {
      throw new RowRuleError(`A condition tests ${ROW_OPS.join(' or ')}.`);
    }
    if (!Array.isArray(values) || values.length === 0) {
      throw new RowRuleError(`The condition on ${column} needs a value.`);
    }
    if (values.length > MAX_ROW_VALUES) {
      throw new RowRuleError(
        `A condition takes at most ${MAX_ROW_VALUES} values.`,
      );
    }
    return {
      column: column.trim(),
      op,
      values: [
        ...new Map(
          values.map((v) => [JSON.stringify(v), parseValue(v)]),
        ).values(),
      ],
    };
  });
}

/** `group:<id>` or `everyone`; anything else is refused. */
export function parseRowPrincipal(input: unknown): string {
  if (input === EVERYONE) return EVERYONE;
  if (typeof input === 'string' && /^group:[A-Za-z0-9._-]+$/.test(input)) {
    return input;
  }
  throw new RowRuleError(
    'A rule is for a group (group:<id>) or for everyone: access goes to groups.',
  );
}

/** A stored rule's conditions, or none when they do not parse (never more rows). */
export function storedConditions(value: unknown): RowCondition[] | null {
  try {
    return parseConditions(value);
  } catch {
    return null;
  }
}

/**
 * The filter one person reads a filtered table through: the rules for
 * everyone and for their groups. A rule whose stored conditions no longer
 * parse selects nothing.
 */
export function rowFilterFor(
  rules: readonly { principalRef: string; conditions: unknown }[],
  groupIds: readonly string[],
): RowFilter {
  const mine = new Set([EVERYONE, ...groupIds.map((id) => `group:${id}`)]);
  const anyOf: RowCondition[][] = [];
  for (const rule of rules) {
    if (!mine.has(rule.principalRef)) continue;
    const conditions = storedConditions(rule.conditions);
    if (conditions) anyOf.push(conditions);
  }
  return { anyOf };
}

/** Whether a filter lets every row through (a rule without conditions). */
export function selectsEveryRow(filter: RowFilter): boolean {
  return filter.anyOf.some((conditions) => conditions.length === 0);
}

function sameRule(
  a: { principalRef: string; conditions: RowCondition[] },
  b: { principalRef: string; conditions: RowCondition[] },
): boolean {
  return (
    a.principalRef === b.principalRef &&
    JSON.stringify(a.conditions) === JSON.stringify(b.conditions)
  );
}

/**
 * Whether going from `before` to `after` can show someone more rows: turning
 * filtering off, or any rule that is new or changed. Removing rules and
 * turning filtering on only ever show less. (Narrowing a rule in place counts
 * as a change: whether a new set of values is narrower depends on the data.)
 */
export function rowPolicyLoosens(
  before: { enabled: boolean; rules: RowRule[] },
  after: {
    enabled: boolean;
    rules: { id?: string; principalRef: string; conditions: RowCondition[] }[];
  },
): boolean {
  if (before.enabled && !after.enabled) return true;
  if (!after.enabled) return false;
  if (!before.enabled) {
    // Turning filtering on hides every row nobody has a rule for: stricter
    // than before, whatever the rules say.
    return false;
  }
  const old = new Map(before.rules.map((rule) => [rule.id, rule]));
  return after.rules.some((rule) => {
    const was = rule.id ? old.get(rule.id) : undefined;
    return !was || !sameRule(was, rule);
  });
}

/** A condition as people read it: `region is one of Tirol, Salzburg`. */
export function describeCondition(condition: RowCondition): string {
  const values = condition.values.map(String).join(', ');
  return condition.op === 'in'
    ? `${condition.column} is one of ${values}`
    : `${condition.column} is none of ${values}`;
}

/** A table's row filter as a run keeps it, to show "Rows filtered for you". */
export type RunRowFilter = {
  table: string;
  anyOf: RowCondition[][];
};

/** The row filters of the tables a run names. */
export function runRowFiltersOf(
  tables: readonly { sqlName: string; rowFilter?: RowFilter }[],
): RunRowFilter[] {
  return tables
    .filter((table) => table.rowFilter)
    .map((table) => ({ table: table.sqlName, anyOf: table.rowFilter!.anyOf }));
}

/** A run's stored row filters; entries of another shape are dropped. */
export function parseRunRowFilters(value: unknown): RunRowFilter[] {
  if (!Array.isArray(value)) return [];
  const out: RunRowFilter[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { table, anyOf } = entry as Record<string, unknown>;
    if (typeof table !== 'string' || !Array.isArray(anyOf)) continue;
    const parsed = anyOf.map(storedConditions);
    if (parsed.some((conditions) => conditions === null)) continue;
    out.push({ table, anyOf: parsed as RowCondition[][] });
  }
  return out;
}
