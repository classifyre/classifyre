import type { DetectorArguments } from './quality-rules';

/**
 * Library and sql quality rules as one query over a table
 * (docs/prd/GOV-governed-data-assets.md §5.4, G-4): a single SELECT whose
 * columns are the measurements, so a table is read once however many rules
 * it has. The query runs through the SQL job's gate like any other: plain
 * SELECT, allowlisted functions, only this table.
 */
export interface TableRule {
  id: string;
  type: string;
  metric: string;
  columnName: string | null;
  arguments: DetectorArguments;
}

export interface CompiledQuality {
  sql: string;
  /** Rule id → the result column that holds its measurement. */
  aliases: Map<string, string>;
  /** Rule id → why it could not be compiled (an unknown column). */
  errors: Map<string, string>;
}

export const ROWS_ALIAS = 'q__rows';

/** `"my col"`: a quoted identifier, quotes doubled. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `'it''s'` or a bare number: a literal for IN lists. */
export function literal(value: string | number): string {
  return typeof value === 'number'
    ? String(value)
    : `'${value.replace(/'/g, "''")}'`;
}

function asText(column: string): string {
  return `CAST(${ident(column)} AS VARCHAR)`;
}

function countWhere(condition: string): string {
  return `SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END)`;
}

/** What one rule measures, as an expression over `table`, or an error. */
function expression(
  rule: TableRule,
  table: string,
  columns: ReadonlySet<string>,
): { sql: string } | { error: string } {
  const column = rule.columnName;
  const known = (name: string) => columns.has(name);
  if (column && !known(column)) {
    return { error: `The table has no column ${column}.` };
  }
  const args = rule.arguments ?? {};
  if (rule.type === 'sql') {
    const query = (args.query ?? '')
      .replace(/\{object\}/g, table)
      .replace(/\{property\}/g, column ? ident(column) : '{property}');
    return { sql: `(${query})` };
  }
  switch (rule.metric) {
    case 'rowCount':
      return { sql: 'COUNT(*)' };
    case 'nullValues':
      return { sql: countWhere(`${ident(column!)} IS NULL`) };
    case 'missingValues': {
      const missing = args.missingValues?.length ? args.missingValues : [''];
      return {
        sql: countWhere(
          `${ident(column!)} IS NULL OR ${asText(column!)} IN (${missing
            .map((v) => literal(String(v)))
            .join(', ')})`,
        ),
      };
    }
    case 'invalidValues': {
      const tests: string[] = [];
      if (args.validValues?.length) {
        tests.push(
          `${asText(column!)} NOT IN (${args.validValues
            .map((v) => literal(String(v)))
            .join(', ')})`,
        );
      }
      if (args.pattern) {
        tests.push(
          `NOT REGEXP_MATCHES(${asText(column!)}, ${literal(args.pattern)})`,
        );
      }
      return {
        sql: countWhere(
          `${ident(column!)} IS NOT NULL AND (${tests.join(' OR ')})`,
        ),
      };
    }
    case 'duplicateValues': {
      if (column) {
        return {
          sql: `COUNT(${ident(column)}) - COUNT(DISTINCT ${ident(column)})`,
        };
      }
      const properties = args.properties ?? [];
      const unknown = properties.filter((p) => !known(p));
      if (unknown.length) {
        return { error: `The table has no column ${unknown.join(', ')}.` };
      }
      const list = properties.map(ident).join(', ');
      return {
        sql: `COUNT(*) - (SELECT COUNT(*) FROM (SELECT DISTINCT ${list} FROM ${table}) AS q__distinct)`,
      };
    }
    default:
      return { error: `${rule.type}/${rule.metric} cannot be measured here.` };
  }
}

/**
 * One SELECT measuring every rule over `table` (its SQL name,
 * `source.schema.table`), plus the row count percentages are taken of.
 */
export function compileQuality(
  table: string,
  columns: readonly string[],
  rules: readonly TableRule[],
): CompiledQuality {
  const known = new Set(columns);
  const aliases = new Map<string, string>();
  const errors = new Map<string, string>();
  const parts = [`COUNT(*) AS ${ROWS_ALIAS}`];
  rules.forEach((rule, index) => {
    const result = expression(rule, table, known);
    if ('error' in result) {
      errors.set(rule.id, result.error);
      return;
    }
    const alias = `q_${index}`;
    aliases.set(rule.id, alias);
    parts.push(`${result.sql} AS ${alias}`);
  });
  return {
    sql: `SELECT ${parts.join(', ')} FROM ${table}`,
    aliases,
    errors,
  };
}

/**
 * The first data row of the job's CSV result, by column name. Values are
 * numbers (or empty); the header is the aliases above.
 */
export function readCsvRow(csv: string): Map<string, number | null> {
  const lines = csv.replace(/\r/g, '').split('\n').filter(Boolean);
  const out = new Map<string, number | null>();
  if (lines.length < 2) return out;
  const split = (line: string) =>
    line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const header = split(lines[0]);
  const row = split(lines[1]);
  header.forEach((name, i) => {
    const cell = row[i];
    const value = cell === undefined || cell === '' ? null : Number(cell);
    out.set(name, value === null || Number.isFinite(value) ? value : null);
  });
  return out;
}
