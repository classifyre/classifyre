import type { TraceEdgeRow } from '../graph-trace';
import type { GraphTraceResult } from '../graph.service';
import type { MeaningTraceTerm } from '../semantic/board/semantic-board-layer.service';
import type {
  ExploreEdgeDto,
  ExploreNeighbourhoodResponseDto,
  ExploreNodeDto,
  ExploreTermDto,
} from './explore.dto';
import {
  EXPLORE_KINDS,
  type EdgeWalkKind,
  type ExploreKind,
  type ExploreScope,
} from './explore-kinds';

/**
 * Explore's neighbourhood is several bounded reads — one edge walk per kind,
 * the shared glossary terms, the look-alikes by vector — merged into one
 * graph. Pure, so the rules can be tested without a database.
 */

/** Terms drawn at most: the ones that tie the most assets together. */
export const EXPLORE_TERM_LIMIT = 24;
/** Characters of an alike passage returned with its link. */
const PASSAGE_CHARS = 280;

export interface ExploreAsset {
  id: string;
  label: string;
  assetType: string | null;
  sourceType: string | null;
  sourceName: string | null;
  sourceId?: string | null;
}

export interface MeaningPart {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  seedTerms: Array<{ assetId: string; termId: string }>;
  terms: MeaningTraceTerm[];
  truncated: boolean;
}

export interface AlikePart {
  seedId: string;
  hits: Array<{ asset: ExploreAsset; score: number; text: string | null }>;
}

export function mergeNeighbourhood(input: {
  seeds: ExploreAsset[];
  walks: Array<{ kind: EdgeWalkKind; result: GraphTraceResult }>;
  meaning: MeaningPart | null;
  alike: AlikePart[];
  alikeStatus: 'ok' | 'off';
}): ExploreNeighbourhoodResponseDto {
  const nodes = new Map<string, ExploreNodeDto>();
  const edges = new Map<string, ExploreEdgeDto>();
  let truncated = false;

  for (const seed of input.seeds) {
    nodes.set(seed.id, {
      ...seed,
      sourceId: seed.sourceId ?? null,
      foreign: false,
      type: 'asset',
      depth: 0,
      side: 'seed',
      kinds: [],
      caseIds: [],
      inquiryIds: [],
    });
  }

  /** Add a neighbour, or note one more kind of connection to it. */
  const reach = (
    node: Omit<
      ExploreNodeDto,
      'kinds' | 'caseIds' | 'inquiryIds' | 'sourceId' | 'foreign'
    > & { sourceId?: string | null },
    kind: ExploreKind,
  ) => {
    const known = nodes.get(node.id);
    if (!known) {
      nodes.set(node.id, {
        ...node,
        sourceId: node.sourceId ?? null,
        foreign: false,
        kinds: [kind],
        caseIds: [],
        inquiryIds: [],
      });
      return;
    }
    if (known.side === 'seed') return;
    if (!known.kinds.includes(kind)) known.kinds.push(kind);
    known.depth = Math.min(known.depth, node.depth);
    // Upstream and downstream say more than "sideways": lineage places a node.
    if (known.side === 'side' && node.side !== 'side') known.side = node.side;
  };

  for (const { kind, result } of input.walks) {
    truncated ||= result.truncated;
    for (const n of result.nodes) {
      if (n.side === 'seed') continue;
      reach(
        {
          id: n.id,
          type: n.type,
          label: n.label,
          assetType: n.assetType,
          sourceType: n.sourceType,
          sourceName: n.sourceName,
          depth: n.depth,
          side: n.side,
        },
        kind,
      );
    }
    for (const e of result.edges) {
      if (edges.has(e.id)) continue;
      edges.set(e.id, {
        id: e.id,
        fromType: e.fromType,
        fromId: e.fromId,
        toType: e.toType,
        toId: e.toId,
        kind,
        relationType: e.relationType,
        relationClass: e.relationClass,
        confidence: e.confidence,
        origin: e.origin,
        sharedByLabel: e.sharedByLabel,
        note: e.note,
        passage: null,
      });
    }
  }

  const terms = new Map<string, ExploreTermDto>();
  if (input.meaning) {
    truncated ||= input.meaning.truncated;
    for (const raw of input.meaning.nodes) {
      if (raw.status === 'DELETED') continue;
      reach(
        {
          id: String(raw.id),
          type: 'asset',
          label: String(raw.label),
          assetType: (raw.assetType as string | null) ?? null,
          sourceType: (raw.sourceType as string | null) ?? null,
          sourceName: (raw.sourceName as string | null) ?? null,
          depth: 1,
          side: 'side',
        },
        'meaning',
      );
    }
    // Each asset that carries a term points at the term: the term is drawn
    // between them, so the reason two documents are tied is on the canvas.
    const carriers = new Map<string, Set<string>>();
    const carry = (assetId: string, termId: string) => {
      if (!nodes.has(assetId)) return;
      const set = carriers.get(termId) ?? new Set<string>();
      set.add(assetId);
      carriers.set(termId, set);
    };
    for (const link of input.meaning.seedTerms)
      carry(link.assetId, link.termId);
    for (const e of input.meaning.edges) {
      const via = e.viaTerm as { id?: string } | undefined;
      if (via?.id) carry(String(e.toId), via.id);
    }
    // A term ties things together when two assets on the canvas carry it;
    // a starting point's own term also says what it is about, so it stays
    // even when nothing else here carries it.
    const seedIds = new Set(input.seeds.map((s) => s.id));
    const worth = [...carriers.entries()].filter(
      ([, assets]) =>
        assets.size >= 2 || [...assets].some((id) => seedIds.has(id)),
    );
    const kept = worth
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, EXPLORE_TERM_LIMIT);
    if (kept.length < worth.length) truncated = true;
    const termById = new Map(input.meaning.terms.map((t) => [t.id, t]));
    for (const [termId, assets] of kept) {
      const term = termById.get(termId);
      if (!term) continue;
      terms.set(termId, { ...term });
      for (const assetId of assets) {
        const id = `mt:${assetId}:${termId}`;
        edges.set(id, {
          id,
          fromType: 'asset',
          fromId: assetId,
          toType: 'term',
          toId: termId,
          kind: 'meaning',
          relationType: 'MEANS',
          relationClass: 'REFERENCE',
          confidence: null,
          origin: 'INFERRED',
          sharedByLabel: null,
          note: null,
          passage: null,
        });
      }
    }
    // An asset the meaning trace brought in whose every term was dropped
    // hangs on nothing: leave it out.
    const tied = new Set(
      [...edges.values()]
        .filter((e) => e.kind === 'meaning')
        .map((e) => e.fromId),
    );
    for (const [id, node] of nodes) {
      if (
        node.side !== 'seed' &&
        node.kinds.length === 1 &&
        node.kinds[0] === 'meaning' &&
        !tied.has(id)
      ) {
        nodes.delete(id);
      }
    }
  }

  for (const part of input.alike) {
    for (const hit of part.hits) {
      reach({ ...hit.asset, type: 'asset', depth: 1, side: 'side' }, 'alike');
      const id = `vx:${part.seedId}:${hit.asset.id}`;
      edges.set(id, {
        id,
        fromType: 'asset',
        fromId: part.seedId,
        toType: 'asset',
        toId: hit.asset.id,
        kind: 'alike',
        relationType: 'ALIKE',
        relationClass: null,
        confidence: Math.round(hit.score * 100) / 100,
        origin: 'INFERRED',
        sharedByLabel: null,
        note: null,
        passage: hit.text ? hit.text.slice(0, PASSAGE_CHARS) : null,
      });
    }
  }

  // Only edges whose two ends are drawn.
  const drawn = (type: string, id: string) =>
    type === 'term' ? terms.has(id) : nodes.has(id);
  const keptEdges = [...edges.values()].filter(
    (e) => drawn(e.fromType, e.fromId) && drawn(e.toType, e.toId),
  );

  return {
    seeds: input.seeds.map((s) => s.id),
    home: [],
    nodes: [...nodes.values()],
    terms: [...terms.values()],
    edges: keptEdges,
    counts: countKinds([...nodes.values()], keptEdges),
    alike: input.alikeStatus,
    truncated,
    cases: [],
    inquiries: [],
  };
}

/**
 * Neighbours per kind of connection that reached them. A starting point that
 * another starting point is connected to is a neighbour too: a source small
 * enough that every asset is a starting point would otherwise count none, and
 * read as having no connections at all.
 */
function countKinds(
  nodes: ExploreNodeDto[],
  edges: ExploreEdgeDto[],
): Record<ExploreKind, number> {
  const seeds = new Set(
    nodes.filter((n) => n.side === 'seed').map((n) => n.id),
  );
  return Object.fromEntries(
    EXPLORE_KINDS.map((kind) => {
      const joined = new Set<string>();
      for (const e of edges) {
        if (e.kind !== kind || e.fromId === e.toId) continue;
        if (e.fromType !== 'asset' || e.toType !== 'asset') continue;
        if (seeds.has(e.fromId) && seeds.has(e.toId)) {
          joined.add(e.fromId);
          joined.add(e.toId);
        }
      }
      return [
        kind,
        nodes.filter((n) => n.side !== 'seed' && n.kinds.includes(kind))
          .length + joined.size,
      ];
    }),
  ) as Record<ExploreKind, number>;
}

/**
 * Say which assets come from somewhere else, and keep the connections asked
 * for: all of them, those that stay inside the home sources ('internal'), or
 * those that leave them ('external'). Home is the explored source, or the
 * starting points' own sources. An object named by URN that nothing scanned
 * is outside by definition. Starting points always stay; a neighbour left
 * with no line, and a term no kept asset carries, go.
 */
export function withScope(
  view: ExploreNeighbourhoodResponseDto,
  input: {
    home: string[];
    scope: ExploreScope;
    sourceOf: ReadonlyMap<string, string | null>;
  },
): ExploreNeighbourhoodResponseDto {
  const home = new Set(input.home);
  const nodes = view.nodes.map((n) => {
    const sourceId = input.sourceOf.get(n.id) ?? n.sourceId ?? null;
    const foreign =
      home.size > 0 &&
      (n.type !== 'asset' || (sourceId !== null && !home.has(sourceId)));
    return { ...n, sourceId, foreign };
  });
  if (input.scope === 'all' || home.size === 0) {
    return { ...view, home: input.home, nodes };
  }
  const outside = input.scope === 'external';
  const byId = new Map(
    nodes
      .filter((n) => n.side === 'seed' || n.foreign === outside)
      .map((n) => [n.id, n]),
  );
  // Outside means across the edge of the source: a line between two of its
  // own assets is not one, nor is a term only its own assets carry.
  const crosses = (a: ExploreNodeDto, b: ExploreNodeDto) =>
    !outside || a.foreign || b.foreign;
  const termCarriers = new Map<string, ExploreNodeDto[]>();
  for (const e of view.edges) {
    if (e.toType !== 'term') continue;
    const carrier = byId.get(e.fromId);
    if (carrier) {
      termCarriers.set(e.toId, [...(termCarriers.get(e.toId) ?? []), carrier]);
    }
  }
  const terms = view.terms.filter((t) => {
    const carriers = termCarriers.get(t.id) ?? [];
    return outside ? carriers.some((c) => c.foreign) : carriers.length > 0;
  });
  const termIds = new Set(terms.map((t) => t.id));
  const edges = view.edges.filter((e) => {
    if (e.toType === 'term') return byId.has(e.fromId) && termIds.has(e.toId);
    const from = byId.get(e.fromId);
    const to = byId.get(e.toId);
    return !!from && !!to && crosses(from, to);
  });
  const tied = new Set(edges.flatMap((e) => [e.fromId, e.toId]));
  const kept = [...byId.values()].filter(
    (n) => n.side === 'seed' || tied.has(n.id),
  );
  return {
    ...view,
    home: input.home,
    nodes: kept,
    terms,
    edges,
    counts: countKinds(kept, edges),
  };
}

/**
 * Add the edges that run between assets already in the view (a link drawn
 * between two neighbours, lineage running across). Nothing new is drawn and
 * no asset changes how it was reached: switching a kind off still hides what
 * only that kind brought in, even when a line of another kind touches it.
 */
export function withEdgesAmong(
  view: ExploreNeighbourhoodResponseDto,
  rows: TraceEdgeRow[],
): ExploreNeighbourhoodResponseDto {
  const nodes = new Set(view.nodes.map((n) => n.id));
  const known = new Set(view.edges.map((e) => e.id));
  const added: ExploreEdgeDto[] = [];
  for (const r of rows) {
    if (known.has(r.id) || !nodes.has(r.from_id) || !nodes.has(r.to_id)) {
      continue;
    }
    known.add(r.id);
    added.push({
      id: r.id,
      fromType: r.from_type,
      fromId: r.from_id,
      toType: r.to_type,
      toId: r.to_id,
      kind: r.kind,
      relationType: r.relation_type,
      relationClass: r.relation_class,
      confidence: r.confidence === null ? null : Number(r.confidence),
      origin: r.origin,
      sharedByLabel: r.shared_by_label,
      note: r.note,
      passage: null,
    });
  }
  return added.length ? { ...view, edges: [...view.edges, ...added] } : view;
}

/** Cases that hold assets of the view as evidence, and watches answered by them. */
export interface ExploreMarks {
  cases: Array<{
    id: string;
    title: string;
    status: string;
    assetIds: string[];
  }>;
  inquiries: Array<{
    id: string;
    title: string;
    status: string;
    assetIds: string[];
  }>;
}

/** Mark each asset with the cases it is evidence in and the watches it answers. */
export function withMarks(
  view: ExploreNeighbourhoodResponseDto,
  marks: ExploreMarks,
): ExploreNeighbourhoodResponseDto {
  const caseIds = new Map<string, string[]>();
  const inquiryIds = new Map<string, string[]>();
  const add = (into: Map<string, string[]>, assetId: string, id: string) =>
    into.set(assetId, [...(into.get(assetId) ?? []), id]);
  for (const c of marks.cases)
    for (const a of c.assetIds) add(caseIds, a, c.id);
  for (const q of marks.inquiries) {
    for (const a of q.assetIds) add(inquiryIds, a, q.id);
  }
  return {
    ...view,
    nodes: view.nodes.map((n) => ({
      ...n,
      caseIds: caseIds.get(n.id) ?? [],
      inquiryIds: inquiryIds.get(n.id) ?? [],
    })),
    cases: marks.cases.map(({ id, title, status }) => ({ id, title, status })),
    inquiries: marks.inquiries.map(({ id, title, status }) => ({
      id,
      title,
      status,
    })),
  };
}

/** One pair of duplicate review, as the duplicates map reads it. */
export interface DuplicatePairRow {
  a_id: string;
  b_id: string;
  /** SHARED_LABELS, PHONETIC, IDENTICAL_CONTENT or NEAR_DUPLICATE_TEXT. */
  family: string;
  weighted: number;
  verdict: string | null;
}

/** The scorer's edge for a pair matched on values. */
export interface ScoredEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  shared_by_label: Record<string, number> | null;
}

export const pairKey = (a: string, b: string) =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/** Pairs drawn around one starting point at most: the strongest. */
export const DUPLICATE_PAIRS_PER_HUB = 12;

/**
 * The assets in the most pairs (the strongest first among equals) become the
 * starting points, each with its partners around it, and the pairs that
 * touch them, strongest first and a bounded number per starting point, are
 * drawn. `pairs` come strongest first.
 */
export function pickDuplicateHubs(
  pairs: DuplicatePairRow[],
  max: number,
): { hubs: string[]; drawn: DuplicatePairRow[]; truncated: boolean } {
  const stats = new Map<string, { n: number; best: number }>();
  for (const p of pairs) {
    for (const id of [p.a_id, p.b_id]) {
      const s = stats.get(id) ?? { n: 0, best: 0 };
      s.n += 1;
      s.best = Math.max(s.best, p.weighted);
      stats.set(id, s);
    }
  }
  const partners = new Map<string, Set<string>>();
  for (const p of pairs) {
    partners.set(p.a_id, (partners.get(p.a_id) ?? new Set()).add(p.b_id));
    partners.set(p.b_id, (partners.get(p.b_id) ?? new Set()).add(p.a_id));
  }
  // A hub's partners are drawn around it, not as hubs of their own: the
  // canvas then reads as clusters, each one asset and what is the same as it.
  const hubs: string[] = [];
  const around = new Set<string>();
  const ranked = [...stats.entries()].sort(
    ([a, x], [b, y]) => y.n - x.n || y.best - x.best || a.localeCompare(b),
  );
  for (const [id] of ranked) {
    if (hubs.length >= max) break;
    if (around.has(id)) continue;
    hubs.push(id);
    for (const other of partners.get(id) ?? []) around.add(other);
  }
  // A pair between two hubs' partners touches no hub: while there is room,
  // its better-connected end becomes one, so no match is left out for nothing.
  for (const p of pairs) {
    if (hubs.length >= max) break;
    if (hubs.includes(p.a_id) || hubs.includes(p.b_id)) continue;
    const a = stats.get(p.a_id)!;
    const b = stats.get(p.b_id)!;
    hubs.push(b.n > a.n ? p.b_id : p.a_id);
  }
  const isHub = new Set(hubs);
  const used = new Map<string, number>();
  const drawn: DuplicatePairRow[] = [];
  for (const p of pairs) {
    const ends = [p.a_id, p.b_id].filter((id) => isHub.has(id));
    if (!ends.length) continue;
    if (ends.every((id) => (used.get(id) ?? 0) >= DUPLICATE_PAIRS_PER_HUB)) {
      continue;
    }
    for (const id of ends) used.set(id, (used.get(id) ?? 0) + 1);
    drawn.push(p);
  }
  return { hubs, drawn, truncated: drawn.length < pairs.length };
}

/**
 * The drawn pairs as two walks, "same as" and "shared values", with the
 * reason duplicate review gives: identical content, repeated text (confirmed
 * or with its score), or what the scorer says of a pair matched on values.
 */
export function duplicateWalks(
  pairs: DuplicatePairRow[],
  assets: ReadonlyMap<string, ExploreAsset>,
  hubs: ReadonlySet<string>,
  scored: ReadonlyMap<string, ScoredEdge>,
  truncated: boolean,
): Array<{ kind: 'duplicates' | 'similar'; result: GraphTraceResult }> {
  const walks = {
    duplicates: { nodes: [], edges: [], truncated } as GraphTraceResult,
    similar: { nodes: [], edges: [], truncated } as GraphTraceResult,
  };
  const placed = { duplicates: new Set<string>(), similar: new Set<string>() };
  for (const p of pairs) {
    const edge = scored.get(pairKey(p.a_id, p.b_id));
    let kind: 'duplicates' | 'similar' = 'duplicates';
    let relationType: string;
    if (p.family === 'IDENTICAL_CONTENT') relationType = 'identical_content';
    else if (p.family === 'NEAR_DUPLICATE_TEXT') {
      relationType =
        p.verdict === 'CONFIRMED' ? 'repeated_text_confirmed' : 'repeated_text';
    } else if (p.verdict === 'CONFIRMED') {
      // A reviewer's word outranks the score: it is the same, whatever it shares.
      relationType = 'confirmed_duplicate';
    } else {
      relationType = edge?.relation_type ?? 'related';
      if (relationType !== 'likely_duplicate') kind = 'similar';
    }
    const walk = walks[kind];
    walk.edges.push({
      id: edge?.id ?? `px:${p.a_id}:${p.b_id}`,
      fromType: 'asset',
      fromId: p.a_id,
      toType: 'asset',
      toId: p.b_id,
      relationType,
      relationClass: kind === 'duplicates' ? 'IDENTITY' : 'REFERENCE',
      kind,
      confidence: Number(p.weighted),
      origin: 'INFERRED',
      sharedByLabel: edge?.shared_by_label ?? null,
      note: null,
    });
    for (const id of [p.a_id, p.b_id]) {
      const asset = assets.get(id);
      if (!asset || hubs.has(id) || placed[kind].has(id)) continue;
      placed[kind].add(id);
      walk.nodes.push({
        ...asset,
        type: 'asset',
        status: null,
        missing: false,
        depth: 1,
        side: 'side',
        via: null,
        viaKind: kind,
      });
    }
  }
  return [
    { kind: 'duplicates', result: walks.duplicates },
    { kind: 'similar', result: walks.similar },
  ];
}

/** Duplicate review's verdict for a pair, keyed by `pairKey`. */
export type PairVerdicts = ReadonlyMap<string, string>;

/**
 * What duplicate review decided, on every "same as" and "shared values"
 * line: confirmed, unsure, or nothing yet. A pair someone ruled apart (or
 * split) is not the same, whatever the scorer says, so its line goes, and so
 * does a neighbour only that line brought.
 */
export function withReview(
  view: ExploreNeighbourhoodResponseDto,
  verdicts: PairVerdicts,
): ExploreNeighbourhoodResponseDto {
  let dropped = false;
  const edges: ExploreEdgeDto[] = [];
  for (const e of view.edges) {
    const paired =
      (e.kind === 'duplicates' || e.kind === 'similar') &&
      e.fromType === 'asset' &&
      e.toType === 'asset';
    if (!paired) {
      edges.push(e);
      continue;
    }
    const verdict = verdicts.get(pairKey(e.fromId, e.toId));
    if (verdict === 'REJECTED' || verdict === 'SPLIT') {
      dropped = true;
      continue;
    }
    edges.push({
      ...e,
      review: verdict === 'CONFIRMED' || verdict === 'UNSURE' ? verdict : null,
    });
  }
  if (!dropped) return { ...view, edges };
  const tied = new Set(edges.flatMap((e) => [e.fromId, e.toId]));
  const nodes = view.nodes.filter((n) => n.side === 'seed' || tied.has(n.id));
  return { ...view, nodes, edges, counts: countKinds(nodes, edges) };
}

/** The asset pairs of a view's "same as" and "shared values" lines. */
export function reviewedPairs(
  view: ExploreNeighbourhoodResponseDto,
): Array<[string, string]> {
  return view.edges
    .filter(
      (e) =>
        (e.kind === 'duplicates' || e.kind === 'similar') &&
        e.fromType === 'asset' &&
        e.toType === 'asset',
    )
    .map((e) => (e.fromId < e.toId ? [e.fromId, e.toId] : [e.toId, e.fromId]));
}
