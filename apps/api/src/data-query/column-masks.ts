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
export const COLUMN_ACTIONS = ['clear', 'mask', 'hide'] as const;
export type ColumnAction = (typeof COLUMN_ACTIONS)[number];

/**
 * - `redact`: text becomes `****`, anything else NULL;
 * - `partial`: text keeps its last four characters (`••••••1234`), anything
 *   else NULL;
 * - `hash`: a keyed hash (16 hex characters), the same for equal values in
 *   one workspace, so masked columns still join and count distinct;
 * - `null`: NULL.
 */
export const MASK_KINDS = ['redact', 'partial', 'hash', 'null'] as const;
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

/** One masked or hidden column, as the query job applies it. */
export interface ColumnMask {
  column: string;
  action: 'mask' | 'hide';
  mask?: MaskKind;
}

export function toColumnMask(
  column: string,
  policy: ColumnPolicy,
): ColumnMask | null {
  if (policy.action === 'clear') return null;
  return policy.action === 'mask'
    ? { column, action: 'mask', mask: policy.mask ?? DEFAULT_MASK }
    : { column, action: 'hide' };
}

/** The type a masked column has: a hash is text, every other mask keeps it. */
export function maskedType(type: string, mask: MaskKind | undefined): string {
  return mask === 'hash' ? 'VARCHAR' : type;
}

export interface MaskedColumn {
  name: string;
  type: string;
  /** Set when governance masks or hides it. */
  access?: 'mask' | 'hide';
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
