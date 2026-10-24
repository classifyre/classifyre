/**
 * The glossary's tabs, in one module both the server (per-tab `<head>`) and the
 * client (the tab bars) can import. The value is what `?tab=` carries.
 */

/** The first tab is the default: the glossary opens on its map. */
export const GLOSSARY_TABS = [
  "map",
  "concepts",
  "entities",
  "schemes",
  "vocabulary",
  "proposals",
] as const;
export type GlossaryTab = (typeof GLOSSARY_TABS)[number];

export const TERM_TABS = [
  "overview",
  "entity",
  "evidence",
  "bindings",
  "usage",
  "activity",
] as const;
export type TermTab = (typeof TERM_TABS)[number];

export function glossaryTabOf(value: unknown): GlossaryTab | null {
  return GLOSSARY_TABS.find((tab) => tab === value) ?? null;
}

export function termTabOf(value: unknown): TermTab | null {
  return TERM_TABS.find((tab) => tab === value) ?? null;
}

/** A `searchParams` value is a string, a list of them, or absent. */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
