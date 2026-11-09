/**
 * A quick look at SQL before a job is started for it
 * (docs/prd/DQ-data-query.md §5.4).
 *
 * Starting a job costs seconds; a query the job's gate is certain to refuse
 * should not cost them. This catches the obvious cases — more than one
 * statement, not a SELECT, a file or table function, a name of a table that
 * does not exist or is not granted — with the job's own codes and messages.
 * It never allows anything: whatever it lets through is checked again,
 * properly, by the SQLGlot gate in the job (apps/cli/src/query/gate.py).
 */

export interface PrecheckRefusal {
  code: string;
  message: string;
}

/** Table functions and system functions the gate refuses, by name. */
const FORBIDDEN_CALL =
  /\b(read_\w+|query|query_table|glob|getenv|current_setting|postgres_\w+|mysql_\w+|sqlite_\w+|duckdb_\w+|pragma_\w+|delta_scan|iceberg_\w+|parquet_\w+|load_extension|install_extension)\s*\(/i;

const READ_ONLY_START = /^(select|with|from|values|\()\b/i;

/**
 * The SQL with string literals, quoted identifiers and comments blanked out,
 * so keywords and names are only ever found in code.
 */
export function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += `'${' '.repeat(Math.max(0, Math.min(j, sql.length) - i - 1))}'`;
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Statements in the SQL: semicolons in code, ignoring a trailing one. */
function statementCount(code: string): number {
  return code
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean).length;
}

/** `a.b.c` names in code, lower-cased, quotes removed. */
function threePartNames(code: string): string[] {
  const part = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)';
  const re = new RegExp(
    `(?<![A-Za-z0-9_."])(${part})\\s*\\.\\s*(${part})\\s*\\.\\s*(${part})(?!\\s*\\()`,
    'g',
  );
  const names: string[] = [];
  for (const match of code.matchAll(re)) {
    names.push(
      match
        .slice(1, 4)
        .map((p) => p.replace(/^"|"$/g, '').toLowerCase())
        .join('.'),
    );
  }
  return names;
}

/**
 * A refusal the job would certainly give, or null when the SQL may run.
 * `allowed` are the full names this person may query; `sources` every
 * source name of the workspace (so `alias.column` references, which are
 * two-part, and three-part names of other things are left to the gate).
 */
export function precheckSql(
  sql: string,
  allowed: ReadonlySet<string>,
  sources: ReadonlySet<string>,
): PrecheckRefusal | null {
  const code = codeOnly(sql).trim();
  if (!code) {
    return { code: 'invalid_sql', message: 'Write a SELECT statement.' };
  }
  if (statementCount(code) > 1) {
    return { code: 'select_only', message: 'Run one statement at a time.' };
  }
  if (!READ_ONLY_START.test(code)) {
    return {
      code: 'select_only',
      message: 'Only SELECT statements can run here.',
    };
  }
  const call = FORBIDDEN_CALL.exec(code);
  if (call) {
    return {
      code: 'function_not_allowed',
      message: `The function ${call[1].toUpperCase()} is not available here.`,
    };
  }
  if (/\bfrom\s*'/i.test(code) || /\bjoin\s*'/i.test(code)) {
    return {
      code: 'function_not_allowed',
      message: 'Only tables can be read here, not files or table functions.',
    };
  }
  for (const name of threePartNames(code)) {
    const source = name.split('.')[0];
    if (sources.has(source) && !allowed.has(name)) {
      return {
        code: 'table_not_available',
        message: `The table ${name} does not exist or you cannot query it.`,
      };
    }
  }
  return null;
}
