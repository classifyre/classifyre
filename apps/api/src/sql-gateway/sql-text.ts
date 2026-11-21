/**
 * Just enough of PostgreSQL's lexer to split a simple-query string into
 * statements and to find `$n` parameters in code: quoted strings (with `''`,
 * `E'…\''`), quoted identifiers, dollar quotes, line and nested block
 * comments. Everything else is the server's business (PGlite parses for real).
 */

interface Token {
  kind: 'code' | 'string' | 'ident' | 'comment';
  start: number;
  end: number;
}

function scan(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let codeStart = 0;
  const flush = (end: number) => {
    if (end > codeStart) tokens.push({ kind: 'code', start: codeStart, end });
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      flush(i);
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      tokens.push({ kind: 'comment', start: i, end: stop });
      i = codeStart = stop;
      continue;
    }
    if (c === '/' && next === '*') {
      flush(i);
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      tokens.push({ kind: 'comment', start: i, end: j });
      i = codeStart = j;
      continue;
    }
    if (c === "'") {
      flush(i);
      const escapes =
        i > 0 && /[eE]/.test(sql[i - 1]) && !/\w/.test(sql[i - 2] ?? '');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      tokens.push({
        kind: 'string',
        start: i,
        end: Math.min(j + 1, sql.length),
      });
      i = codeStart = Math.min(j + 1, sql.length);
      continue;
    }
    if (c === '"') {
      flush(i);
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      tokens.push({
        kind: 'ident',
        start: i,
        end: Math.min(j + 1, sql.length),
      });
      i = codeStart = Math.min(j + 1, sql.length);
      continue;
    }
    if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
      if (tag && !/[\w$]/.test(sql[i - 1] ?? '')) {
        flush(i);
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close < 0 ? sql.length : close + tag[0].length;
        tokens.push({ kind: 'string', start: i, end });
        i = codeStart = end;
        continue;
      }
    }
    i++;
  }
  flush(sql.length);
  return tokens;
}

/** Statements of a simple query, trimmed, empty ones dropped. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const token of scan(sql)) {
    if (token.kind !== 'code') continue;
    let at = sql.indexOf(';', token.start);
    while (at >= 0 && at < token.end) {
      out.push(sql.slice(start, at));
      start = at + 1;
      at = sql.indexOf(';', start);
    }
  }
  out.push(sql.slice(start));
  return out.map((s) => s.trim()).filter((s) => stripComments(s).trim());
}

/** The SQL without comments (strings and identifiers kept). */
export function stripComments(sql: string): string {
  return scan(sql)
    .filter((t) => t.kind !== 'comment')
    .map((t) => sql.slice(t.start, t.end))
    .join(' ');
}

/** The first keyword, upper-cased: SELECT, WITH, SET, SHOW, BEGIN, … */
export function firstKeyword(sql: string): string {
  const match = /^[\s(]*([A-Za-z]+)/.exec(stripComments(sql));
  return match ? match[1].toUpperCase() : '';
}

/** Statements that can read tables, and so may be data queries. */
export const READING_KEYWORDS = new Set(['SELECT', 'WITH', 'TABLE', 'VALUES']);

/** A PostgreSQL string literal. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Replaces `$1`, `$2`, … in code (not in strings, identifiers or comments)
 * with literals, so a bound statement runs as plain SQL in the query job.
 */
export function substituteParams(
  sql: string,
  literals: readonly string[],
): string {
  let out = '';
  for (const token of scan(sql)) {
    const text = sql.slice(token.start, token.end);
    if (token.kind !== 'code') {
      out += text;
      continue;
    }
    out += text.replace(/\$(\d+)(?!\d)/g, (whole, n: string) => {
      const literal = literals[Number(n) - 1];
      return literal === undefined ? whole : literal;
    });
  }
  return out;
}

/**
 * A cursor statement the gateway serves itself when its query reads data:
 * psqlODBC with `UseDeclareFetch=1` (what Excel and Power BI's ODBC sources
 * run) reads every result through `DECLARE … CURSOR … FOR`, `FETCH n IN` and
 * `CLOSE` (docs/prd/BIC-bi-client-compatibility.md D5). Only forward reads are
 * served. A cursor statement this does not read (`FETCH BACKWARD`, `MOVE`, a
 * DECLARE without `FOR`) is `unsupported`: the session refuses it when it
 * names a cursor over data, rather than letting PGlite answer it over empty
 * tables (0 rows, as if that were the result).
 */
export type CursorStatement =
  | {
      kind: 'declare';
      name: string;
      hold: boolean;
      scroll: boolean;
      query: string;
    }
  | { kind: 'fetch'; name: string; count: number | 'all' }
  | { kind: 'close'; name: string | null }
  | {
      kind: 'unsupported';
      verb: 'DECLARE' | 'FETCH' | 'MOVE';
      name: string | null;
    };

/** A cursor name: quoted (`""` an escaped quote) or plain. */
const NAME = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const CURSOR_NAME = `(${NAME})`;
/** PostgreSQL takes DECLARE's options in any order. */
const DECLARE_CURSOR = new RegExp(
  String.raw`^declare\s+${CURSOR_NAME}\s+((?:(?:binary|asensitive|insensitive|no\s+scroll|scroll)\s+)*)` +
    String.raw`cursor\s+(?:(with|without)\s+hold\s+)?for\s+([\s\S]+?)\s*;?\s*$`,
  'i',
);
const FETCH_CURSOR = new RegExp(
  String.raw`^fetch\s+(?:(next|all|forward\s+all|forward\s+\d+|forward|\d+)\s+)?(?:(?:from|in)\s+)?${CURSOR_NAME}\s*;?\s*$`,
  'i',
);
const CLOSE_CURSOR = new RegExp(
  String.raw`^close\s+(all|${NAME})\s*;?\s*$`,
  'i',
);
const CURSOR_VERB = /^(declare|fetch|move)\b/i;
const DECLARED_NAME = new RegExp(String.raw`^declare\s+${CURSOR_NAME}`, 'i');
const LAST_NAME = new RegExp(String.raw`${CURSOR_NAME}\s*;?\s*$`, 'i');

function cursorName(raw: string): string {
  return raw.startsWith('"')
    ? raw.slice(1, -1).replace(/""/g, '"')
    : raw.toLowerCase();
}

/** `sql` without the whitespace and comments before its first word. */
export function withoutLeadingComments(sql: string): string {
  let rest = sql;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '');
    if (trimmed.startsWith('--')) {
      const end = trimmed.indexOf('\n');
      rest = end < 0 ? '' : trimmed.slice(end + 1);
    } else if (trimmed.startsWith('/*')) {
      let depth = 0;
      let i = 0;
      for (; i < trimmed.length; i++) {
        if (trimmed.startsWith('/*', i)) {
          depth++;
          i++;
        } else if (trimmed.startsWith('*/', i)) {
          depth--;
          i++;
          if (depth === 0) break;
        }
      }
      rest = trimmed.slice(i + 1);
    } else {
      return trimmed;
    }
  }
}

export function parseCursorStatement(raw: string): CursorStatement | null {
  const sql = withoutLeadingComments(raw);
  const verb = CURSOR_VERB.exec(sql)?.[1]?.toUpperCase() as
    | 'DECLARE'
    | 'FETCH'
    | 'MOVE'
    | undefined;
  const declare = DECLARE_CURSOR.exec(sql);
  if (declare) {
    const options = declare[2].toLowerCase();
    return {
      kind: 'declare',
      name: cursorName(declare[1]),
      hold: declare[3]?.toLowerCase() === 'with',
      scroll: /(^|\s)scroll\b/.test(options) && !/no\s+scroll/.test(options),
      query: declare[4],
    };
  }
  const fetch = FETCH_CURSOR.exec(sql);
  if (fetch) {
    const how = (fetch[1] ?? 'next').toLowerCase().replace(/\s+/g, ' ');
    const number = /\d+/.exec(how);
    const count: number | 'all' = how.endsWith('all')
      ? 'all'
      : number
        ? Number(number[0])
        : 1;
    return { kind: 'fetch', name: cursorName(fetch[2]), count };
  }
  const close = CLOSE_CURSOR.exec(sql);
  if (close) {
    return {
      kind: 'close',
      name: /^all$/i.test(close[1]) ? null : cursorName(close[1]),
    };
  }
  if (verb) {
    const named =
      verb === 'DECLARE' ? DECLARED_NAME.exec(sql) : LAST_NAME.exec(sql);
    return {
      kind: 'unsupported',
      verb,
      name: named ? cursorName(named[1]) : null,
    };
  }
  return null;
}
