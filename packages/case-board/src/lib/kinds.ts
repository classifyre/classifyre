/**
 * The kinds of relation the board draws and follows (PRD §5.11): lineage
 * (data flowing from one asset into another), links (references, usage,
 * links people drew), duplicates, and look-alikes. The server groups
 * relations the same way (graph-trace.ts).
 */

export type TraceKind = "lineage" | "links" | "duplicates" | "similar";
export const TRACE_KINDS: readonly TraceKind[] = ["lineage", "links", "duplicates", "similar"];

/** Lineage and links point somewhere; duplicates and look-alikes do not. */
export const isDirectedKind = (kind: TraceKind) => kind === "lineage" || kind === "links";

/** How each kind of relation is tinted wherever the board shows kinds. */
export const TRACE_KIND_STROKE: Record<TraceKind, string> = {
  lineage: "var(--foreground)",
  links: "var(--cb-edge)",
  duplicates: "var(--cb-violet)",
  similar: "var(--cb-blue)",
};

/** Kinds of link that read one way ("A precedes B"); the rest are mutual. */
export const DIRECTED_LINK_KINDS: ReadonlySet<string> = new Set(["precedes", "derived_from", "communicates_with"]);

export type Stance = "SUPPORTS" | "CONTRADICTS" | "NEUTRAL";

/** Green supports, red dashed contradicts, grey neutral. */
export const STANCE_STROKE: Record<Stance, { color: string; dash: string | undefined }> = {
  SUPPORTS: { color: "var(--cb-supports)", dash: undefined },
  CONTRADICTS: { color: "var(--cb-contradicts)", dash: "6 4" },
  NEUTRAL: { color: "var(--cb-neutral)", dash: undefined },
};
