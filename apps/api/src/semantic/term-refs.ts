import type { PrismaService } from '../prisma.service';
import { keyFromTermUrn, termUrn } from '../glossary/glossary-norm';

/** Endpoint type of an edge to a glossary term (C12). */
export const TERM_NODE = 'term';
/**
 * Endpoint type of an edge to a term key nobody has defined yet. Never
 * `external`, so the connection map and external-node hydration ignore it; it
 * stitches to `term` when the key appears (SL3 R6).
 */
export const TERM_REF_NODE = 'term_ref';
/** Relation type of a connector declaration (C12): class REFERENCE. */
export const MEANS_RELATION = 'MEANS';

/** Node types that are meaning, not lineage: walks skip them (rule SL-4). */
export const MEANING_NODE_TYPES = [TERM_NODE, TERM_REF_NODE] as const;

export function isTermUrn(urn: string | null | undefined): boolean {
  return (
    typeof urn === 'string' && urn.trim().toLowerCase().startsWith('term://')
  );
}

/**
 * Resolve normalised `term://glossary/<key>` URNs against current keys, then
 * previous keys (C8). Returns urn → term id for the ones that resolve.
 */
export async function resolveTermUrns(
  prisma: Pick<PrismaService, 'glossaryTerm'>,
  urns: string[],
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const urn of urns) {
    const key = keyFromTermUrn(urn);
    if (key) byKey.set(key, urn);
  }
  const resolved = new Map<string, string>();
  if (!byKey.size) return resolved;
  const keys = [...byKey.keys()];
  const terms = await prisma.glossaryTerm.findMany({
    where: { OR: [{ key: { in: keys } }, { previousKeys: { hasSome: keys } }] },
    select: { id: true, key: true, previousKeys: true },
  });
  for (const term of terms) {
    const current = byKey.get(term.key);
    if (current) resolved.set(current, term.id);
  }
  for (const term of terms) {
    for (const previous of term.previousKeys) {
      const urn = byKey.get(previous);
      if (urn && !resolved.has(urn)) resolved.set(urn, term.id);
    }
  }
  return resolved;
}

/**
 * Bind `term_ref` endpoints whose key now names a term, like
 * `stitchExternalEdges` does for assets: scans and glossary edits can happen in
 * either order. Returns the assets whose declarations changed, so the linker
 * can relink them.
 */
export async function stitchTermRefs(
  prisma: PrismaService,
  keys: string[],
): Promise<{ stitched: number; assetIds: string[] }> {
  const urns = [...new Set(keys.map((key) => termUrn(key.toLowerCase())))];
  const resolved = await resolveTermUrns(prisma, urns);
  let stitched = 0;
  const assetIds = new Set<string>();
  for (const [urn, termId] of resolved) {
    const touched = await prisma.$queryRaw<
      Array<{ from_type: string; from_id: string }>
    >`
      SELECT from_type, from_id FROM edges WHERE to_type = ${TERM_REF_NODE} AND to_id = ${urn}`;
    for (const row of touched)
      if (row.from_type === 'asset') assetIds.add(row.from_id);
    stitched += await prisma.$transaction(async (tx) => {
      const incoming = await tx.$executeRaw`
        UPDATE edges SET to_type = ${TERM_NODE}, to_id = ${termId}
         WHERE to_type = ${TERM_REF_NODE} AND to_id = ${urn}
           AND NOT EXISTS (
             SELECT 1 FROM edges existing
              WHERE existing.to_type = ${TERM_NODE} AND existing.to_id = ${termId}
                AND existing.from_type = edges.from_type AND existing.from_id = edges.from_id
                AND existing.relation_type = edges.relation_type)`;
      const outgoing = await tx.$executeRaw`
        UPDATE edges SET from_type = ${TERM_NODE}, from_id = ${termId}
         WHERE from_type = ${TERM_REF_NODE} AND from_id = ${urn}
           AND NOT EXISTS (
             SELECT 1 FROM edges existing
              WHERE existing.from_type = ${TERM_NODE} AND existing.from_id = ${termId}
                AND existing.to_type = edges.to_type AND existing.to_id = edges.to_id
                AND existing.relation_type = edges.relation_type)`;
      await tx.$executeRaw`
        DELETE FROM edges
         WHERE (to_type = ${TERM_REF_NODE} AND to_id = ${urn})
            OR (from_type = ${TERM_REF_NODE} AND from_id = ${urn})`;
      return incoming + outgoing;
    });
  }
  return { stitched, assetIds: [...assetIds] };
}

/** Unknown term references, grouped by key (SL4 G-4). */
export async function unknownTermRefs(
  prisma: PrismaService,
  limit = 200,
): Promise<
  Array<{
    urn: string;
    key: string | null;
    edges: number;
    assets: number;
    sources: string[];
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{ urn: string; edges: bigint; assets: bigint; sources: string[] }>
  >`
    SELECT e.to_id AS urn, count(*) AS edges,
           count(DISTINCT e.from_id) FILTER (WHERE e.from_type = 'asset') AS assets,
           array_remove(array_agg(DISTINCT a.source_id), NULL) AS sources
      FROM edges e
      LEFT JOIN assets a ON e.from_type = 'asset' AND a.id = e.from_id
     WHERE e.to_type = ${TERM_REF_NODE}
     GROUP BY e.to_id
     ORDER BY count(*) DESC
     LIMIT ${limit}`;
  return rows.map((row) => ({
    urn: row.urn,
    key: keyFromTermUrn(row.urn),
    edges: Number(row.edges),
    assets: Number(row.assets),
    sources: row.sources,
  }));
}
