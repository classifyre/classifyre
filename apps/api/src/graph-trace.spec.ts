import {
  nextSide,
  traceKey,
  walkTrace,
  type TraceEdgeRow,
  type TraceKind,
  type TraceNodeRef,
} from './graph-trace';

type E = [from: string, to: string, kind: TraceKind];

/** A fake edge table: each hop returns every edge touching the frontier, both ways. */
function fetcher(edges: E[]) {
  const rows = edges.map(([from, to, kind], i) => ({
    id: `e${i}`,
    from_type: 'asset',
    from_id: from,
    to_type: 'asset',
    to_id: to,
    relation_type: kind === 'lineage' ? 'TRANSFORM' : 'REFERENCES',
    relation_class: null,
    confidence: null,
    kind,
  }));
  const calls: string[][] = [];
  const fetchLevel = (frontier: TraceNodeRef[]): Promise<TraceEdgeRow[]> => {
    calls.push(frontier.map((f) => f.id));
    const out: TraceEdgeRow[] = [];
    for (const f of frontier) {
      for (const r of rows) {
        if (r.from_id === f.id)
          out.push({ ...r, src_type: 'asset', src_id: f.id, dir: 'out' });
        if (r.to_id === f.id)
          out.push({ ...r, src_type: 'asset', src_id: f.id, dir: 'in' });
      }
    }
    return Promise.resolve(out);
  };
  return { fetchLevel, calls };
}

const seedA = [{ type: 'asset', id: 'A' }];

describe('nextSide', () => {
  it('sends lineage into the seed upstream and out of it downstream', () => {
    expect(nextSide('seed', { dir: 'in', kind: 'lineage' }, 'both')).toBe('up');
    expect(nextSide('seed', { dir: 'out', kind: 'lineage' }, 'both')).toBe(
      'down',
    );
  });

  it('keeps upstream going up and downstream going down', () => {
    expect(nextSide('up', { dir: 'in', kind: 'links' }, 'both')).toBe('up');
    expect(nextSide('up', { dir: 'out', kind: 'links' }, 'both')).toBeNull();
    expect(nextSide('down', { dir: 'out', kind: 'lineage' }, 'both')).toBe(
      'down',
    );
    expect(nextSide('down', { dir: 'in', kind: 'lineage' }, 'both')).toBeNull();
  });

  it('puts duplicates and similar assets beside the node they hang off', () => {
    expect(nextSide('seed', { dir: 'out', kind: 'duplicates' }, 'both')).toBe(
      'side',
    );
    expect(nextSide('up', { dir: 'in', kind: 'similar' }, 'both')).toBe('up');
  });

  it('honours a one-way trace from the seed', () => {
    expect(nextSide('seed', { dir: 'out', kind: 'lineage' }, 'up')).toBeNull();
    expect(nextSide('seed', { dir: 'in', kind: 'lineage' }, 'down')).toBeNull();
    expect(nextSide('side', { dir: 'in', kind: 'lineage' }, 'down')).toBeNull();
  });
});

describe('walkTrace', () => {
  // U2 → U → A → D → D2, U → X (a sibling of A), A ~ S (duplicate)
  const graph: E[] = [
    ['U2', 'U', 'lineage'],
    ['U', 'A', 'lineage'],
    ['A', 'D', 'lineage'],
    ['D', 'D2', 'lineage'],
    ['U', 'X', 'lineage'],
    ['A', 'S', 'duplicates'],
  ];

  it('walks upstream, downstream and sideways, hop by hop, without doubling back', async () => {
    const { fetchLevel } = fetcher(graph);
    const walk = await walkTrace(
      seedA,
      { depth: 2, direction: 'both', limit: 100 },
      fetchLevel,
    );
    const side = (id: string) => walk.found.get(traceKey('asset', id));
    expect(side('A')).toMatchObject({ side: 'seed', depth: 0 });
    expect(side('U')).toMatchObject({
      side: 'up',
      depth: 1,
      via: 'asset:A',
      viaKind: 'lineage',
    });
    expect(side('U2')).toMatchObject({ side: 'up', depth: 2, via: 'asset:U' });
    expect(side('D')).toMatchObject({ side: 'down', depth: 1 });
    expect(side('D2')).toMatchObject({ side: 'down', depth: 2 });
    expect(side('S')).toMatchObject({
      side: 'side',
      depth: 1,
      viaKind: 'duplicates',
    });
    // X is fed by U but does not feed A: a sibling, not part of A's trace.
    expect(side('X')).toBeUndefined();
    expect(walk.truncated).toBe(false);
  });

  it('stops at the requested depth', async () => {
    const { fetchLevel, calls } = fetcher(graph);
    const walk = await walkTrace(
      seedA,
      { depth: 1, direction: 'both', limit: 100 },
      fetchLevel,
    );
    expect(walk.found.has(traceKey('asset', 'U2'))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('traces one way when asked', async () => {
    const { fetchLevel } = fetcher(graph);
    const walk = await walkTrace(
      seedA,
      { depth: 3, direction: 'down', limit: 100 },
      fetchLevel,
    );
    expect([...walk.found.keys()].sort()).toEqual(
      ['asset:A', 'asset:D', 'asset:D2', 'asset:S'].sort(),
    );
  });

  it('marks the walk truncated at its node limit, and only returns edges between kept nodes', async () => {
    const { fetchLevel } = fetcher(graph);
    const walk = await walkTrace(
      seedA,
      { depth: 3, direction: 'both', limit: 3 },
      fetchLevel,
    );
    expect(walk.found.size).toBe(3);
    expect(walk.truncated).toBe(true);
    for (const e of walk.edges.values()) {
      expect(walk.found.has(traceKey(e.from_type, e.from_id))).toBe(true);
      expect(walk.found.has(traceKey(e.to_type, e.to_id))).toBe(true);
    }
  });

  it('walks from several seeds at once', async () => {
    const { fetchLevel } = fetcher(graph);
    const walk = await walkTrace(
      [
        { type: 'asset', id: 'U2' },
        { type: 'asset', id: 'D2' },
      ],
      { depth: 1, direction: 'both', limit: 100 },
      fetchLevel,
    );
    expect(walk.found.get(traceKey('asset', 'U'))).toMatchObject({
      side: 'down',
      via: 'asset:U2',
    });
    expect(walk.found.get(traceKey('asset', 'D'))).toMatchObject({
      side: 'up',
      via: 'asset:D2',
    });
  });
});
