import { Prisma } from '@prisma/client';

/**
 * Tracing an asset's connections through the global edge table: what feeds
 * it (upstream), what it feeds (downstream), and what is the same as or like
 * it (sideways), hop by hop. Used by the case board's "Show connections" and
 * its multi-hop neighbour suggestions.
 *
 * The walk is pure over a `fetchLevel` callback so its rules can be tested
 * without a database; `GraphService.trace` supplies the bounded SQL.
 */

export const TRACE_KINDS = [
  'lineage',
  'links',
  'duplicates',
  'similar',
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];
export type TraceSide = 'seed' | 'up' | 'down' | 'side';
export type TraceDirection = 'up' | 'down' | 'both';

/** Walks never go deeper than this; "all hops" means this many. */
export const TRACE_MAX_DEPTH = 6;
/** Edges read per node and direction: a hub is drawn, not walked through whole. */
export const TRACE_PER_NODE = 25;

/**
 * The kind of an edge, as the board groups them. Correlation edges carry no
 * useful class, so their relation types decide first.
 */
export const TRACE_KIND_SQL = Prisma.sql`(CASE
  WHEN e.relation_type IN ('likely_duplicate', 'identical_content')
    OR e.relation_class = 'IDENTITY'::"EdgeClass" THEN 'duplicates'
  WHEN e.relation_type = 'related' THEN 'similar'
  WHEN e.relation_class = 'FLOW'::"EdgeClass" THEN 'lineage'
  ELSE 'links'
END)`;

/** One edge read for a frontier node, and which way it points from there. */
export interface TraceEdgeRow {
  src_type: string;
  src_id: string;
  dir: 'out' | 'in';
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation_type: string;
  relation_class: string | null;
  confidence: number | null;
  kind: TraceKind;
}

export interface TraceNodeRef {
  type: string;
  id: string;
}

export interface TraceFound extends TraceNodeRef {
  depth: number;
  side: TraceSide;
  /** The node it was first reached from (shortest route back to a seed). */
  via: string | null;
  /** The kind of the edge it was reached by. */
  viaKind: TraceKind | null;
}

export interface TraceWalk {
  found: Map<string, TraceFound>;
  edges: Map<string, TraceEdgeRow>;
  truncated: boolean;
}

export const traceKey = (type: string, id: string) => `${type}:${id}`;

/** Lineage and links point somewhere; duplicates and similarity do not. */
export const isDirected = (kind: TraceKind) =>
  kind === 'lineage' || kind === 'links';

/**
 * Which side of the seed a neighbour lands on, or null when the walk should
 * not take this edge. Upstream keeps going up and downstream keeps going
 * down, so the trace never doubles back into siblings; a duplicate or a
 * similar asset joins the side of the node it hangs off.
 */
export function nextSide(
  from: TraceSide,
  row: Pick<TraceEdgeRow, 'dir' | 'kind'>,
  direction: TraceDirection,
): TraceSide | null {
  if (!isDirected(row.kind)) return from === 'seed' ? 'side' : from;
  // An edge pointing *into* the node came from upstream of it.
  const move: TraceSide = row.dir === 'in' ? 'up' : 'down';
  if (from === 'up' || from === 'down') return move === from ? move : null;
  if (direction === 'up' && move === 'down') return null;
  if (direction === 'down' && move === 'up') return null;
  return move;
}

export async function walkTrace(
  seeds: TraceNodeRef[],
  opts: { depth: number; direction: TraceDirection; limit: number },
  fetchLevel: (frontier: TraceNodeRef[]) => Promise<TraceEdgeRow[]>,
): Promise<TraceWalk> {
  const found = new Map<string, TraceFound>();
  const edges = new Map<string, TraceEdgeRow>();
  let truncated = false;
  for (const s of seeds) {
    found.set(traceKey(s.type, s.id), {
      ...s,
      depth: 0,
      side: 'seed',
      via: null,
      viaKind: null,
    });
  }
  let frontier = [...found.values()];
  for (let level = 1; level <= opts.depth && frontier.length > 0; level++) {
    const rows = await fetchLevel(
      frontier.map(({ type, id }) => ({ type, id })),
    );
    const next: TraceFound[] = [];
    for (const row of rows) {
      const from = found.get(traceKey(row.src_type, row.src_id));
      if (!from) continue;
      const side = nextSide(from.side, row, opts.direction);
      if (!side) continue;
      const [type, id] =
        row.dir === 'out'
          ? [row.to_type, row.to_id]
          : [row.from_type, row.from_id];
      const key = traceKey(type, id);
      if (!found.has(key)) {
        if (found.size >= opts.limit) {
          truncated = true;
          continue;
        }
        const node: TraceFound = {
          type,
          id,
          depth: level,
          side,
          via: traceKey(from.type, from.id),
          viaKind: row.kind,
        };
        found.set(key, node);
        next.push(node);
      }
      edges.set(row.id, row);
    }
    frontier = next;
  }
  // Only edges between nodes the trace kept.
  for (const [id, e] of edges) {
    if (
      !found.has(traceKey(e.from_type, e.from_id)) ||
      !found.has(traceKey(e.to_type, e.to_id))
    ) {
      edges.delete(id);
    }
  }
  return { found, edges, truncated };
}
