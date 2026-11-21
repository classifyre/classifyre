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
 * served; anything else (`FETCH BACKWARD`, `MOVE`, …) is left to PGlite, where
 * a data cursor does not exist and so fails as an unknown cursor.
 */
export type CursorStatement =
  | { kind: 'declare'; name: string; hold: boolean; query: string }
  | { kind: 'fetch'; name: string; count: number | 'all' }
  | { kind: 'close'; name: string | null };

const CURSOR_NAME = String.raw`("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const DECLARE_CURSOR = new RegExp(
  String.raw`^\s*declare\s+${CURSOR_NAME}\s+(?:binary\s+)?(?:(?:asensitive|insensitive)\s+)?` +
    String.raw`(?:(?:no\s+)?scroll\s+)?cursor\s+(?:(with|without)\s+hold\s+)?for\s+([\s\S]+?)\s*;?\s*$`,
  'i',
);
const FETCH_CURSOR = new RegExp(
  String.raw`^\s*fetch\s+(?:(next|all|forward\s+all|forward\s+\d+|forward|\d+)\s+)?(?:(?:from|in)\s+)?${CURSOR_NAME}\s*;?\s*$`,
  'i',
);
const CLOSE_CURSOR = new RegExp(
  String.raw`^\s*close\s+(all|${CURSOR_NAME.slice(1, -1)})\s*;?\s*$`,
  'i',
);

function cursorName(raw: string): string {
  return raw.startsWith('"')
    ? raw.slice(1, -1).replace(/""/g, '"')
    : raw.toLowerCase();
}

export function parseCursorStatement(sql: string): CursorStatement | null {
  const declare = DECLARE_CURSOR.exec(sql);
  if (declare) {
    return {
      kind: 'declare',
      name: cursorName(declare[1]),
      hold: declare[2]?.toLowerCase() === 'with',
      query: declare[3],
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
  return null;
}
