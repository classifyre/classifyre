/**
 * What a relation type *means*, for edges that did not declare it.
 *
 * A connector built after lineage existed sends `relationClass` explicitly. Two
 * things do not: a CLI built before it, and every edge already in the database.
 * Both go through this table, which is the same mapping the backfill migration
 * (`20260824120000_add_edge_classes_and_urn`) applied — so an old connector and
 * a migrated row end up classed identically rather than one of them becoming a
 * lineage hop and the other not.
 *
 * Anything unrecognised falls back to REFERENCE: the class that propagates
 * nothing. An edge whose meaning nobody declared must not silently join the
 * lineage graph.
 */

export type EdgeClassName =
  | 'FLOW'
  | 'CONTAINMENT'
  | 'IDENTITY'
  | 'REFERENCE'
  | 'USAGE';

export const EDGE_CLASSES: readonly EdgeClassName[] = [
  'FLOW',
  'CONTAINMENT',
  'IDENTITY',
  'REFERENCE',
  'USAGE',
] as const;

/** Lineage is the FLOW subset. Every other class is a different question. */
export const LINEAGE_CLASS: EdgeClassName = 'FLOW';

const BY_RELATION_TYPE: Record<string, EdgeClassName> = {
  // Structural. What the lineage view collapses *by* — never a hop in a path.
  CONTAINS: 'CONTAINMENT',
  ATTACHED_TO: 'CONTAINMENT',

  // Data movement. These already point the way the data flows.
  WRITES: 'FLOW',
  EXPORTED_TO: 'FLOW',
  SENT_TO: 'FLOW',
  TRANSFORM: 'FLOW',
  VIEW: 'FLOW',
  COPY: 'FLOW',
  WRITE: 'FLOW',
  EXPORT: 'FLOW',
  SEND: 'FLOW',

  // Who touched it. READS belongs here rather than in FLOW: this product
  // already answers "who touched this?" with incoming ACCESSED/READS/EXECUTED,
  // and it points from the reader to the thing read — the opposite of the way
  // the data moved.
  OWNS: 'USAGE',
  ACCESSED: 'USAGE',
  READS: 'USAGE',
  EXECUTED: 'USAGE',

  // The same bytes in two places is the same thing seen twice, which is what
  // the lineage view's "merge identical nodes" control acts on.
  identical_content: 'IDENTITY',
  SAME_AS: 'IDENTITY',

  // Meaning and navigation. Propagate nothing. A foreign key moves no data.
  REFERENCES: 'REFERENCE',
  MENTIONS: 'REFERENCE',
  FOREIGN_KEY: 'REFERENCE',
  links_to: 'REFERENCE',
  related: 'REFERENCE',
  likely_duplicate: 'REFERENCE',
};

export function isEdgeClass(value: unknown): value is EdgeClassName {
  return (
    typeof value === 'string' && EDGE_CLASSES.includes(value as EdgeClassName)
  );
}

/** The class an edge should have, given what it declared and its relation type. */
export function resolveEdgeClass(
  declared: string | null | undefined,
  relationType: string,
): EdgeClassName {
  if (isEdgeClass(declared)) return declared;
  return BY_RELATION_TYPE[relationType] ?? 'REFERENCE';
}
