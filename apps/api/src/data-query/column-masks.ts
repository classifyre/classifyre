import { createHmac } from 'node:crypto';

/**
 * Column hide/mask (docs/prd/DQ-data-query.md §5.8).
 *
 * A column of a table shows one of three ways to someone who may query the
 * table but not read it in clear:
 * - `clear`: as it is;
 * - `mask`: its values replaced (the column stays, so SQL that names it runs);
 * - `hide`: not there at all, as if the table had no such column.
 *
 * A steward sets it per column; unset, it follows the column's
 * classification (GOV §5.1): personal and sensitive data masked, secrets
 * hidden. Masks are applied by the query job's views, so every way of
 * reading a table (the SQL page, a Data tab, an export, a SQL connection, a
 * published data product) filters, joins and groups on the masked values,
 * never on the real ones.
 */
/**
 * `restrict`: hidden from everyone but the table's (or its source's) owners
 * and stewards — Data reader, unmasked does not show it (national ids a
 * sales team reads its customers' table in clear without).
 */
export const COLUMN_ACTIONS = ['clear', 'mask', 'hide', 'restrict'] as const;
export type ColumnAction = (typeof COLUMN_ACTIONS)[number];

/** What a column can be for someone who does not read it in clear. */
export const COLUMN_MASK_ACTIONS = ['mask', 'hide', 'restrict'] as const;
export type ColumnMaskAction = (typeof COLUMN_MASK_ACTIONS)[number];

/**
 * - `redact`: text becomes `****`, anything else NULL;
 * - `partial`: text keeps its last four characters (`••••••1234`), anything
 *   else NULL;
 * - `hash`: a keyed hash (16 hex characters), the same for equal values in
 *   one workspace, so masked columns still join and count distinct;
 * - `null`: NULL.
 */
/**
 * `scrub`: free text with the identifiers and credentials in it replaced
 * (`[email]`, `[iban]`, `[key]` …, masks.py), the rest kept.
 */
export const MASK_KINDS = [
  'redact',
  'partial',
  'hash',
  'null',
  'scrub',
] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

export const DEFAULT_MASK: MaskKind = 'redact';

/** What a classification means for a column nobody set a policy on. */
const BY_CLASSIFICATION: Readonly<
  Record<string, { action: ColumnAction; mask?: MaskKind }>
> = {
  personal: { action: 'mask', mask: DEFAULT_MASK },
  sensitive: { action: 'mask', mask: DEFAULT_MASK },
  secret: { action: 'hide' },
};

export interface ColumnPolicy {
  action: ColumnAction;
  /** For `mask`. */
  mask?: MaskKind;
  /** True when it follows the classification, not a steward's choice. */
  fromClassification: boolean;
}

export function isColumnAction(value: unknown): value is ColumnAction {
  return (
    typeof value === 'string' &&
    (COLUMN_ACTIONS as readonly string[]).includes(value)
  );
}

export function isMaskKind(value: unknown): value is MaskKind {
  return (
    typeof value === 'string' &&
    (MASK_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The policy a column has: the steward's `access` when set, else what its
 * (effective) classification gives. A steward's mask kind also applies to
 * a default mask, so "personal, shown as last four" needs no explicit action.
 */
export function effectiveColumnPolicy(input: {
  access: string | null | undefined;
  maskKind: string | null | undefined;
  classification: string | null | undefined;
}): ColumnPolicy {
  const kind = isMaskKind(input.maskKind) ? input.maskKind : undefined;
  if (isColumnAction(input.access)) {
    return input.access === 'mask'
      ? {
          action: 'mask',
          mask: kind ?? DEFAULT_MASK,
          fromClassification: false,
        }
      : { action: input.access, fromClassification: false };
  }
  const derived = input.classification
    ? BY_CLASSIFICATION[input.classification]
    : undefined;
  if (!derived) return { action: 'clear', fromClassification: true };
  return derived.action === 'mask'
    ? {
        action: 'mask',
        mask: kind ?? derived.mask ?? DEFAULT_MASK,
        fromClassification: true,
      }
    : { action: derived.action, fromClassification: true };
}

/** How much of a column's values each mask leaves to see, least first. */
const MASK_EXPOSURE: Readonly<Record<MaskKind, number>> = {
  null: 2,
  redact: 2,
  hash: 3,
  partial: 4,
  // The text around what it removes shows: more than any other mask.
  scrub: 5,
};

/**
 * How much a policy shows of a column, least to most: hidden, emptied or
 * redacted, hashed (equal values still tell), last four, clear. A change
 * that raises it gives people who may not unmask more than they had.
 */
export function exposureOf(policy: ColumnPolicy): number {
  if (policy.action === 'restrict') return 0;
  if (policy.action === 'hide') return 1;
  if (policy.action === 'clear') return 6;
  return MASK_EXPOSURE[policy.mask ?? DEFAULT_MASK];
}

/** One masked or hidden column, as the query job applies it. */
export interface ColumnMask {
  column: string;
  action: ColumnMaskAction;
  mask?: MaskKind;
}

export function toColumnMask(
  column: string,
  policy: ColumnPolicy,
): ColumnMask | null {
  if (policy.action === 'clear') return null;
  if (policy.action === 'mask') {
    return { column, action: 'mask', mask: policy.mask ?? DEFAULT_MASK };
  }
  return { column, action: policy.action };
}

/**
 * The masks a query job applies for one person on one table: every mask for
 * someone who does not read it in clear (`restrict` as `hide`); only the
 * restricted columns, hidden, for someone who reads it in clear without
 * owning or stewarding it (`data.unmask`); none for its owners and stewards.
 */
export function jobMasks(
  masks: readonly ColumnMask[],
  inClear: boolean,
  governs: boolean,
): ColumnMask[] {
  if (governs) return [];
  return masks
    .filter((mask) => !inClear || mask.action === 'restrict')
    .map((mask) =>
      mask.action === 'restrict'
        ? { column: mask.column, action: 'hide' }
        : mask,
    );
}

/**
 * A masked or hidden column of a table a run names, as it ran — what the
 * result says above itself. A hidden column is counted, never named: its
 * name is as much the person's business as its values.
 */
export type RunMask =
  | { table: string; action: 'mask'; column: string; mask: MaskKind }
  | { table: string; action: 'hide' };

/** The masks of the tables a run names. */
export function runMasksOf(
  tables: readonly { sqlName: string; masks?: readonly ColumnMask[] }[],
): RunMask[] {
  return tables.flatMap((table) =>
    (table.masks ?? []).map(
      (mask): RunMask =>
        mask.action === 'hide' || mask.action === 'restrict'
          ? { table: table.sqlName, action: 'hide' }
          : {
              table: table.sqlName,
              action: 'mask',
              column: mask.column,
              mask: mask.mask ?? DEFAULT_MASK,
            },
    ),
  );
}

/** A run's stored masks, read back: anything not shaped like one is dropped. */
export function parseRunMasks(value: unknown): RunMask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RunMask[] => {
    if (!item || typeof item !== 'object') return [];
    const { table, action, column, mask } = item as Record<string, unknown>;
    if (typeof table !== 'string') return [];
    if (action === 'hide') return [{ table, action }];
    if (action !== 'mask' || typeof column !== 'string') return [];
    return [
      {
        table,
        action,
        column,
        mask: isMaskKind(mask) ? mask : DEFAULT_MASK,
      },
    ];
  });
}

/** Top-level parts of a DuckDB type list (`a INT, "b c" STRUCT(x INT)`). */
function splitTypeList(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * The type of a hashed value: text, field by field and element by element
 * for structs and lists, as the job's views mask them (`masks.py`).
 */
function hashedType(type: string): string {
  const t = type.trim();
  const list = /^(.*)\[\d*\]$/s.exec(t);
  if (list && !/^STRUCT\(.*\)$/is.test(t)) return `${hashedType(list[1])}[]`;
  const struct = /^STRUCT\((.*)\)$/is.exec(t);
  if (struct) {
    const fields = splitTypeList(struct[1]).map((part) => {
      const quoted = /^("(?:[^"]|"")*")\s+(.+)$/s.exec(part);
      const bare = /^(\S+)\s+(.+)$/s.exec(part);
      const match = quoted ?? bare;
      return match ? `${match[1]} ${hashedType(match[2])}` : null;
    });
    if (fields.every(Boolean)) return `STRUCT(${fields.join(', ')})`;
  }
  return 'VARCHAR';
}

/** The type a masked column has: a hash is text, every other mask keeps it. */
export function maskedType(type: string, mask: MaskKind | undefined): string {
  return mask === 'hash' ? hashedType(type) : type;
}

export interface MaskedColumn {
  name: string;
  type: string;
  /** Set when governance masks or hides it. */
  access?: ColumnMaskAction;
  mask?: MaskKind;
  /** It is masked or hidden for others, and this person reads it in clear. */
  inClear?: boolean;
}

/**
 * A table's columns as one person sees them: hidden ones left out, masked
 * ones marked (and typed as the mask makes them) — or, for someone who reads
 * the table in clear, every column, those with a policy marked `inClear`.
 * Column names match exactly, then case-insensitively (DuckDB's rule).
 */
export function columnsAsSeen(
  columns: readonly { name: string; type: string }[],
  masks: readonly ColumnMask[],
  inClear: boolean,
  /** Owns or stewards it: reads restricted columns too. */
  governs = inClear,
): { columns: MaskedColumn[]; hidden: number } {
  if (!masks.length) return { columns: [...columns], hidden: 0 };
  const exact = new Map(masks.map((m) => [m.column, m]));
  const folded = new Map(masks.map((m) => [m.column.toLowerCase(), m]));
  const out: MaskedColumn[] = [];
  let hidden = 0;
  for (const column of columns) {
    const mask =
      exact.get(column.name) ?? folded.get(column.name.toLowerCase());
    if (!mask) {
      out.push({ ...column });
    } else if (mask.action === 'restrict' && !governs) {
      hidden += 1;
    } else if (inClear) {
      out.push({
        ...column,
        access: mask.action,
        ...(mask.mask ? { mask: mask.mask } : {}),
        inClear: true,
      });
    } else if (mask.action === 'hide') {
      hidden += 1;
    } else {
      out.push({
        name: column.name,
        type: maskedType(column.type, mask.mask),
        access: 'mask',
        mask: mask.mask ?? DEFAULT_MASK,
      });
    }
  }
  return { columns: out, hidden };
}

/**
 * The key a workspace's `hash` masks use: equal values hash equally across
 * its tables (joins keep working), differently in other workspaces, and
 * nobody can rebuild the hash of a guessed value without the app's secret.
 */
export function maskSalt(secret: Buffer, namespaceId: string): string {
  return createHmac('sha256', secret)
    .update(`column-mask:${namespaceId}`)
    .digest('hex')
    .slice(0, 32);
}
