/**
 * Column hide/mask (docs/prd/DQ-data-query.md §5.8), as the web shows it.
 * The API decides and the query job applies; this mirrors the default rule
 * so a dialog can say what "follow the classification" will mean before it
 * is saved.
 */
export const COLUMN_ACTIONS = ["clear", "mask", "hide"] as const;
export type ColumnAction = (typeof COLUMN_ACTIONS)[number];

export const MASK_KINDS = ["redact", "partial", "hash", "null"] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

export interface ColumnAccess {
  action: ColumnAction;
  mask?: MaskKind;
  fromClassification: boolean;
}

/** Personal and sensitive data masked, secrets hidden, the rest in clear. */
export function columnAccessFor(input: {
  access: string | null;
  maskKind: string | null;
  classification: string | null;
}): ColumnAccess {
  const kind = (MASK_KINDS as readonly string[]).includes(input.maskKind ?? "")
    ? (input.maskKind as MaskKind)
    : undefined;
  if ((COLUMN_ACTIONS as readonly string[]).includes(input.access ?? "")) {
    const action = input.access as ColumnAction;
    return action === "mask"
      ? { action, mask: kind ?? "redact", fromClassification: false }
      : { action, fromClassification: false };
  }
  if (input.classification === "secret") {
    return { action: "hide", fromClassification: true };
  }
  if (
    input.classification === "personal" ||
    input.classification === "sensitive"
  ) {
    return {
      action: "mask",
      mask: kind ?? "redact",
      fromClassification: true,
    };
  }
  return { action: "clear", fromClassification: true };
}

/** The role that reads masked columns in clear, given like Data reader. */
export const DATA_READER_UNMASKED = "data-reader-unmasked";
export const DATA_READER = "data-reader";
export const DATA_ROLE_KEYS: readonly string[] = [
  DATA_READER,
  DATA_READER_UNMASKED,
];
