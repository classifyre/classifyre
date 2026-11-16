/**
 * Row filters (docs/prd/DQ-data-query.md §5.10), as the web edits and shows
 * them. The API decides and the query job applies; these only turn values
 * into text and back, and say what a filter means.
 */
export const EVERYONE = "everyone";

export type RowValue = string | number | boolean;

export interface RowCondition {
  column: string;
  op: string;
  values: RowValue[];
}

/** Values as one line to edit: `Tirol, Salzburg`. */
export function valuesText(values: readonly RowValue[]): string {
  return values.map(String).join(", ");
}

/**
 * A typed line back into values: split on commas, trimmed, empties dropped.
 * Numbers stay text: the job compares them with the column's own type.
 */
export function parseValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** `region is one of Tirol, Salzburg`, in the words given. */
export function describeCondition(
  condition: RowCondition,
  words: { in: string; not_in: string },
): string {
  const op = condition.op === "not_in" ? words.not_in : words.in;
  return `${condition.column} ${op} ${valuesText(condition.values)}`;
}

/** A whole filter: entries joined by "or", conditions by "and". */
export function describeFilter(
  anyOf: readonly (readonly RowCondition[])[],
  words: { in: string; not_in: string; and: string; or: string; none: string },
): string {
  if (!anyOf.length) return words.none;
  return anyOf
    .map((conditions) =>
      conditions.map((c) => describeCondition(c, words)).join(words.and),
    )
    .join(words.or);
}
