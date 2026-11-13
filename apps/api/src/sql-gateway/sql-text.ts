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
