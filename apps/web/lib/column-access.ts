/**
 * Column hide/mask (docs/prd/DQ-data-query.md §5.8), as the web shows it.
 * The API decides and the query job applies; this mirrors the API's
 * `effectiveColumnPolicy` (apps/api/src/data-query/column-masks.ts) so a
 * dialog can say what "follow the classification" will mean before it is
 * saved. `column-access.spec.ts` pins the two to the same cases.
 */
export const COLUMN_ACTIONS = ["clear", "mask", "hide", "restrict"] as const;
export type ColumnAction = (typeof COLUMN_ACTIONS)[number];

export const MASK_KINDS = [
  "redact",
  "partial",
  "hash",
  "null",
  "scrub",
] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

export const DEFAULT_MASK: MaskKind = "redact";

/** What a classification means for a column nobody set a policy on. */
const BY_CLASSIFICATION: Readonly<
  Record<string, { action: ColumnAction; mask?: MaskKind }>
> = {
  personal: { action: "mask", mask: DEFAULT_MASK },
  sensitive: { action: "mask", mask: DEFAULT_MASK },
  secret: { action: "hide" },
};

export interface ColumnAccess {
  action: ColumnAction;
  mask?: MaskKind;
  fromClassification: boolean;
}

const isColumnAction = (value: unknown): value is ColumnAction =>
  (COLUMN_ACTIONS as readonly unknown[]).includes(value);
const isMaskKind = (value: unknown): value is MaskKind =>
  (MASK_KINDS as readonly unknown[]).includes(value);

/** Personal and sensitive data masked, secrets hidden, the rest in clear. */
export function columnAccessFor(input: {
  access: string | null;
  maskKind: string | null;
  classification: string | null;
}): ColumnAccess {
  const kind = isMaskKind(input.maskKind) ? input.maskKind : undefined;
  if (isColumnAction(input.access)) {
    return input.access === "mask"
      ? {
          action: "mask",
          mask: kind ?? DEFAULT_MASK,
          fromClassification: false,
        }
      : { action: input.access, fromClassification: false };
  }
  const derived = input.classification
    ? BY_CLASSIFICATION[input.classification]
    : undefined;
  if (!derived) return { action: "clear", fromClassification: true };
  return derived.action === "mask"
    ? {
        action: "mask",
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
  scrub: 5,
};

/**
 * How much an access shows, least to most (the API's `exposureOf`): only
 * someone who reads the table in clear may raise it.
 */
export function exposureOf(access: ColumnAccess): number {
  if (access.action === "restrict") return 0;
  if (access.action === "hide") return 1;
  if (access.action === "clear") return 6;
  return MASK_EXPOSURE[access.mask ?? DEFAULT_MASK];
}

/** The role that reads masked columns in clear, given like Data reader. */
export const DATA_READER_UNMASKED = "data-reader-unmasked";
export const DATA_READER = "data-reader";
export const DATA_ROLE_KEYS: readonly string[] = [
  DATA_READER,
  DATA_READER_UNMASKED,
];
