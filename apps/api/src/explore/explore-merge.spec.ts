import type { GraphTraceResult } from '../graph.service';
import {
  mergeNeighbourhood,
  withEdgesAmong,
  withScope,
  withReview,
  duplicateWalks,
  pickDuplicateHubs,
  type DuplicatePairRow,
  type ExploreAsset,
} from './explore-merge';

const asset = (id: string): ExploreAsset => ({
  id,
  label: `${id}.txt`,
  assetType: 'TXT',
  sourceType: 'LOCAL_FOLDER',
  sourceName: 'Shared drive',
});

type TraceNode = GraphTraceResult['nodes'][number];
type TraceEdge = GraphTraceResult['edges'][number];

const node = (id: string, side: TraceNode['side'], depth = 1): TraceNode => ({
  id,
  type: 'asset',
  label: `${id}.txt`,
  assetType: 'TXT',
  sourceType: 'LOCAL_FOLDER',
  sourceName: 'Shared drive',
  status: 'UNCHANGED',
  missing: false,
  depth,
  side,
  via: null,
  viaKind: null,
});

const edge = (
  id: string,
  from: string,
  to: string,
  kind: TraceEdge['kind'],
  extra: Partial<TraceEdge> = {},
): TraceEdge => ({
  id,
  fromType: 'asset',
  fromId: from,
  toType: 'asset',
  toId: to,
  relationType: kind === 'lineage' ? 'TRANSFORM' : 'related',
  relationClass: kind === 'lineage' ? 'FLOW' : 'REFERENCE',
  kind,
  confidence: null,
  origin: 'INFERRED',
  sharedByLabel: null,
  note: null,
  ...extra,
});

const empty = { meaning: null, alike: [], alikeStatus: 'ok' as const };

describe('mergeNeighbourhood', () => {
  it('lists every kind that reached a node, and lets lineage place it', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'similar',
          result: {
            nodes: [node('s', 'seed', 0), node('b', 'side')],
            edges: [
              edge('e1', 's', 'b', 'similar', {
                confidence: 0.62,
                sharedByLabel: { person: 2 },
              }),
            ],
            truncated: false,
          },
        },
        {
          kind: 'lineage',
          result: {
            nodes: [node('s', 'seed', 0), node('b', 'down')],
            edges: [edge('e2', 's', 'b', 'lineage')],
            truncated: false,
          },
        },
      ],
    });

    const b = view.nodes.find((n) => n.id === 'b');
    expect(b?.kinds).toEqual(['similar', 'lineage']);
    expect(b?.side).toBe('down');
    expect(view.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
    // The reason travels with the link.
    expect(view.edges.find((e) => e.id === 'e1')?.sharedByLabel).toEqual({
      person: 2,
    });
    expect(view.counts).toMatchObject({ similar: 1, lineage: 1, alike: 0 });
  });

  it('marks the view truncated when any kind hit its bound', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'links',
          result: { nodes: [node('s', 'seed', 0)], edges: [], truncated: true },
        },
      ],
    });
    expect(view.truncated).toBe(true);
  });

  it('draws a shared term between the assets that carry it', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s1'), asset('s2')],
      walks: [],
      meaning: {
        nodes: [{ id: 'm', label: 'm.txt', status: 'UNCHANGED' }],
        edges: [
          {
            fromId: 's1',
            toId: 'm',
            viaTerm: { id: 'damp', key: 'damp', name: 'Damp and mould' },
          },
        ],
        seedTerms: [
          { assetId: 's1', termId: 'damp' },
          { assetId: 's2', termId: 'damp' },
          // Carried by one seed only: still says what that seed is about.
          { assetId: 's1', termId: 'own' },
        ],
        terms: [
          { id: 'damp', key: 'damp', name: 'Damp and mould', kind: 'CONCEPT' },
          { id: 'own', key: 'own', name: 'Leak', kind: 'CONCEPT' },
        ],
        truncated: false,
      },
    });

    expect(view.terms.map((t) => t.id)).toEqual(['damp', 'own']);
    const termEdges = view.edges.filter(
      (e) => e.kind === 'meaning' && e.toId === 'damp',
    );
    expect(termEdges.map((e) => e.fromId).sort()).toEqual(['m', 's1', 's2']);
    expect(
      view.edges.filter((e) => e.toId === 'own').map((e) => e.fromId),
    ).toEqual(['s1']);
    expect(view.counts.meaning).toBe(1);
  });

  it('leaves out an asset whose only term was dropped', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [],
      meaning: {
        nodes: [
          { id: 'gone', label: 'gone.txt', status: 'DELETED' },
          { id: 'kept', label: 'kept.txt', status: 'NEW' },
        ],
        edges: [
          { fromId: 's', toId: 'gone', viaTerm: { id: 't' } },
          { fromId: 's', toId: 'kept', viaTerm: { id: 't' } },
        ],
        seedTerms: [{ assetId: 's', termId: 't' }],
        terms: [{ id: 't', key: 't', name: 'T', kind: 'ENTITY' }],
        truncated: false,
      },
    });
    // A deleted asset is never drawn, even when the term index still has it.
    expect(view.nodes.map((n) => n.id).sort()).toEqual(['kept', 's']);
  });

  it('links look-alikes to their seed with score and passage', () => {
    const view = mergeNeighbourhood({
      seeds: [asset('s')],
      walks: [],
      meaning: null,
      alikeStatus: 'ok',
      alike: [
        {
          seedId: 's',
          hits: [{ asset: asset('a'), score: 0.8412, text: 'x'.repeat(400) }],
        },
      ],
    });
    const e = view.edges[0];
    expect(e).toMatchObject({ id: 'vx:s:a', kind: 'alike', confidence: 0.84 });
    expect(e.passage).toHaveLength(280);
    expect(view.counts.alike).toBe(1);
  });

  it('drops an edge whose far end is not drawn', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'links',
          result: {
            nodes: [node('s', 'seed', 0)],
            edges: [edge('e', 's', 'nowhere', 'links')],
            truncated: false,
          },
        },
      ],
    });
    expect(view.edges).toEqual([]);
  });

  it('adds a line someone drew between two neighbours, and nothing else', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'similar',
          result: {
            nodes: [node('s', 'seed', 0), node('a', 'side'), node('b', 'side')],
            edges: [
              edge('e1', 's', 'a', 'similar'),
              edge('e2', 's', 'b', 'similar'),
            ],
            truncated: false,
          },
        },
      ],
    });
    const row = (id: string, from: string, to: string) => ({
      src_type: 'asset',
      src_id: from,
      dir: 'out' as const,
      id,
      from_type: 'asset',
      from_id: from,
      to_type: 'asset',
      to_id: to,
      relation_type: 'references',
      relation_class: 'REFERENCE',
      confidence: 1,
      kind: 'links' as const,
      origin: 'MANUAL',
      shared_by_label: null,
      note: 'Invoice for that repair',
    });

    const after = withEdgesAmong(view, [
      row('m1', 'a', 'b'),
      row('e1', 's', 'a'),
      row('far', 'a', 'elsewhere'),
    ]);

    expect(after.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'm1']);
    expect(after.edges.at(-1)).toMatchObject({
      origin: 'MANUAL',
      note: 'Invoice for that repair',
    });
    // How each asset was reached does not change.
    expect(after.nodes.find((n) => n.id === 'a')?.kinds).toEqual(['similar']);
    expect(after.counts.links).toBe(0);
  });
});

describe('counts for a source whose assets are all starting points', () => {
  it('counts a starting point another is linked to, so the links are not "none"', () => {
    const view = mergeNeighbourhood({
      ...empty,
      seeds: [asset('a'), asset('b'), asset('c')],
      walks: [
        {
          kind: 'links',
          result: {
            nodes: [
              node('a', 'seed', 0),
              node('b', 'seed', 0),
              node('c', 'seed', 0),
            ],
            edges: [edge('e1', 'a', 'b', 'links')],
            truncated: false,
          },
        },
      ],
    });

    // a and b are each other's neighbour; c has none.
    expect(view.counts.links).toBe(2);
    expect(view.edges.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('withScope', () => {
  // s is the starting point in source A; b is in A too, c in source B.
  const view = () =>
    mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'links',
          result: {
            nodes: [node('s', 'seed', 0), node('b', 'side'), node('c', 'side')],
            edges: [
              edge('sb', 's', 'b', 'links'),
              edge('sc', 's', 'c', 'links'),
              edge('bc', 'b', 'c', 'links'),
            ],
            truncated: false,
          },
        },
      ],
      meaning: {
        nodes: [],
        edges: [],
        seedTerms: [
          { assetId: 's', termId: 't' },
          { assetId: 'b', termId: 't' },
        ],
        terms: [{ id: 't', key: 'damp', name: 'Damp', kind: 'CONCEPT' }],
        truncated: false,
      },
    });
  const sourceOf = new Map([
    ['s', 'A'],
    ['b', 'A'],
    ['c', 'B'],
  ]);

  it('says which assets come from another source, and keeps everything', () => {
    const after = withScope(view(), { home: ['A'], scope: 'all', sourceOf });
    expect(after.home).toEqual(['A']);
    expect(after.nodes.find((n) => n.id === 'c')).toMatchObject({
      sourceId: 'B',
      foreign: true,
    });
    expect(after.nodes.find((n) => n.id === 'b')?.foreign).toBe(false);
    expect(after.edges).toHaveLength(5);
  });

  it('keeps only what stays inside the source', () => {
    const after = withScope(view(), {
      home: ['A'],
      scope: 'internal',
      sourceOf,
    });
    expect(after.nodes.map((n) => n.id).sort()).toEqual(['b', 's']);
    expect(after.edges.map((e) => e.id).sort()).toEqual([
      'mt:b:t',
      'mt:s:t',
      'sb',
    ]);
    expect(after.terms.map((t) => t.id)).toEqual(['t']);
    expect(after.counts.links).toBe(1);
  });

  it('keeps only the connections that leave it', () => {
    const after = withScope(view(), {
      home: ['A'],
      scope: 'external',
      sourceOf,
    });
    // b is reached only from inside; the term only its own assets carry.
    expect(after.nodes.map((n) => n.id).sort()).toEqual(['c', 's']);
    expect(after.edges.map((e) => e.id)).toEqual(['sc']);
    expect(after.terms).toEqual([]);
    expect(after.counts.links).toBe(1);
  });

  it('treats an object nothing scanned as outside', () => {
    const base = view();
    base.nodes.push({
      ...base.nodes[1],
      id: 'urn',
      type: 'external',
      sourceId: null,
    });
    const after = withScope(base, { home: ['A'], scope: 'all', sourceOf });
    expect(after.nodes.find((n) => n.id === 'urn')?.foreign).toBe(true);
  });
});

describe('the duplicates map', () => {
  const pair = (
    a: string,
    b: string,
    weighted: number,
    family = 'SHARED_LABELS',
    verdict: string | null = null,
  ): DuplicatePairRow => ({ a_id: a, b_id: b, family, weighted, verdict });

  it('starts from the assets in the most pairs, each with its partners around it', () => {
    const pairs = [
      pair('a', 'b', 0.9),
      pair('c', 'd', 0.8),
      pair('a', 'c', 0.7),
      pair('e', 'f', 0.6),
    ];
    const { hubs, drawn, truncated } = pickDuplicateHubs(pairs, 2);
    // c is a's partner, so it stands around a; d is the next one on its own.
    expect(hubs).toEqual(['a', 'd']);
    // e–f touches neither, so it is left out, and the map says so.
    expect(drawn.map((p) => `${p.a_id}${p.b_id}`)).toEqual(['ab', 'cd', 'ac']);
    expect(truncated).toBe(true);
  });

  it("keeps a pair between two hubs' partners while there is room", () => {
    // b is a's partner, d is c's: b–d touches neither hub.
    const pairs = [
      pair('a', 'b', 0.9),
      pair('a', 'x', 0.85),
      pair('c', 'd', 0.8),
      pair('c', 'y', 0.75),
      pair('b', 'd', 0.7),
    ];
    const roomy = pickDuplicateHubs(pairs, 3);
    expect(roomy.hubs).toEqual(['a', 'c', 'b']);
    expect(roomy.drawn).toHaveLength(5);
    expect(roomy.truncated).toBe(false);
    // Without room, it is left out, and the map says so.
    const tight = pickDuplicateHubs(pairs, 2);
    expect(tight.drawn).toHaveLength(4);
    expect(tight.truncated).toBe(true);
  });

  it('calls a pair a reviewer confirmed the same, whatever it shares', () => {
    const [same] = duplicateWalks(
      [pair('h', 'x', 0.5, 'SHARED_LABELS', 'CONFIRMED')],
      new Map(['h', 'x'].map((id) => [id, asset(id)])),
      new Set(['h']),
      new Map(),
      false,
    );
    expect(same.result.edges.map((e) => e.relationType)).toEqual([
      'confirmed_duplicate',
    ]);
  });

  it('draws at most a dozen pairs around one starting point', () => {
    const pairs = Array.from({ length: 20 }, (_, i) =>
      pair('hub', `p${String(i).padStart(2, '0')}`, 0.9 - i / 100),
    );
    const { drawn } = pickDuplicateHubs(pairs, 1);
    expect(drawn).toHaveLength(12);
    expect(drawn[0]?.b_id).toBe('p00');
  });

  it('gives each pair the reason duplicate review gives', () => {
    const assets = new Map(
      ['h', 'x', 'y', 'z', 'w'].map((id) => [id, asset(id)]),
    );
    const walks = duplicateWalks(
      [
        pair('h', 'x', 0.99, 'IDENTICAL_CONTENT'),
        pair('h', 'y', 0.81, 'NEAR_DUPLICATE_TEXT', 'CONFIRMED'),
        pair('h', 'z', 0.7),
        pair('h', 'w', 0.4),
      ],
      assets,
      new Set(['h']),
      new Map([
        [
          'h|z',
          {
            id: 'e-hz',
            from_id: 'h',
            to_id: 'z',
            relation_type: 'likely_duplicate',
            shared_by_label: { person: 2 },
          },
        ],
      ]),
      false,
    );
    const [same, shared] = walks;
    expect(same.result.edges.map((e) => [e.id, e.relationType])).toEqual([
      ['px:h:x', 'identical_content'],
      ['px:h:y', 'repeated_text_confirmed'],
      ['e-hz', 'likely_duplicate'],
    ]);
    expect(same.result.edges[2]?.sharedByLabel).toEqual({ person: 2 });
    // No edge from the scorer: it only shares values.
    expect(shared.result.edges.map((e) => e.relationType)).toEqual(['related']);
    expect(shared.result.nodes.map((n) => n.id)).toEqual(['w']);
    // The starting point is never drawn as its own neighbour.
    expect(same.result.nodes.map((n) => n.id)).toEqual(['x', 'y', 'z']);
  });
});

describe('withReview', () => {
  const view = () =>
    mergeNeighbourhood({
      ...empty,
      seeds: [asset('s')],
      walks: [
        {
          kind: 'duplicates',
          result: {
            nodes: [node('a', 'side'), node('b', 'side'), node('c', 'side')],
            edges: [
              edge('sa', 's', 'a', 'duplicates'),
              edge('sb', 'b', 's', 'duplicates'),
              edge('sc', 's', 'c', 'duplicates'),
            ],
            truncated: false,
          },
        },
        {
          kind: 'lineage',
          result: {
            nodes: [node('l', 'down')],
            edges: [edge('sl', 's', 'l', 'lineage')],
            truncated: false,
          },
        },
      ],
    });

  it('says what review decided, and drops what it ruled apart', () => {
    const after = withReview(
      view(),
      new Map([
        ['a|s', 'CONFIRMED'],
        ['b|s', 'UNSURE'],
        ['c|s', 'REJECTED'],
      ]),
    );
    const review = Object.fromEntries(after.edges.map((e) => [e.id, e.review]));
    expect(review).toEqual({ sa: 'CONFIRMED', sb: 'UNSURE', sl: undefined });
    // c came only through the rejected pair.
    expect(after.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'l', 's']);
    expect(after.counts.duplicates).toBe(2);
  });

  it('marks an undecided pair as such', () => {
    const after = withReview(view(), new Map());
    expect(after.edges.find((e) => e.id === 'sc')?.review).toBeNull();
  });
});
