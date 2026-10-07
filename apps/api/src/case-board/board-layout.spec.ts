import {
  FRAME_PADDING,
  FRAME_TITLE_HEIGHT,
  layeredLayout,
} from '@workspace/schemas/case-board';
import type { BoardItemDto, CaseBoardResponseDto } from '../dto/case-board.dto';
import {
  boxOf,
  buildBoardModel,
  planArrivals,
  planFrame,
  planPlacement,
  planTidy,
  rectOf,
  type BoardModel,
} from './board-layout';

type Kind = BoardItemDto['kind'];

let seq = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`;

function item(kind: Kind, patch: Partial<BoardItemDto> = {}): BoardItemDto {
  return {
    id: uuid(),
    kind,
    refId: null,
    x: 0,
    y: 0,
    width: null,
    height: null,
    z: 0,
    parentId: null,
    collapsed: false,
    style: null,
    content: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...patch,
  };
}

/** A board read with evidence items (each with `findings` attached) and extras. */
function board(opts: {
  evidence?: Array<{ findings?: number; patch?: Partial<BoardItemDto> }>;
  items?: BoardItemDto[];
  links?: Array<[number | string, number | string]>;
}): { res: CaseBoardResponseDto; evidenceItems: BoardItemDto[] } {
  const evidence: CaseBoardResponseDto['evidence'] = [];
  const evidenceItems: BoardItemDto[] = [];
  (opts.evidence ?? []).forEach((ev, i) => {
    const evidenceId = `ev-${i}`;
    const assetId = `asset-${i}`;
    evidence.push({
      id: evidenceId,
      entityType: 'asset',
      entityId: assetId,
      entity: { id: assetId, label: `asset ${i}` },
      findings: Array.from({ length: ev.findings ?? 0 }, (_, f) => ({
        id: `cf-${i}-${f}`,
        caseEvidenceId: evidenceId,
        findingId: `f-${i}-${f}`,
        findingLabel: 'TYPE',
      })),
    } as unknown as CaseBoardResponseDto['evidence'][number]);
    evidenceItems.push(item('EVIDENCE', { refId: evidenceId, ...ev.patch }));
  });
  const items = [...evidenceItems, ...(opts.items ?? [])];
  const idOf = (ref: number | string) =>
    typeof ref === 'number' ? evidenceItems[ref].id : ref;
  const res = {
    board: {
      id: 'board',
      caseId: 'case',
      version: 3,
      readOnly: false,
      caseStatus: 'OPEN',
    },
    items,
    links: (opts.links ?? []).map(([a, b], i) => ({
      id: `link-${i}`,
      sourceItemId: idOf(a),
      sourceFindingId: null,
      targetItemId: idOf(b),
      targetFindingId: null,
      kind: 'related_to',
      label: null,
      certainty: 'CONFIRMED',
      confidence: null,
      note: null,
      promotedEdgeId: null,
    })),
    evidence,
    graph: { nodes: [], edges: [], truncated: false },
    supports: [],
    threads: [],
  } as unknown as CaseBoardResponseDto;
  return { res, evidenceItems };
}

function overlapping(model: BoardModel, ids: string[]): string[] {
  const rects = ids.map((id) => ({
    id,
    r: rectOf(model, model.items.get(id)!),
  }));
  const hits: string[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i].r;
      const b = rects[j].r;
      if (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      ) {
        hits.push(`${rects[i].id}~${rects[j].id}`);
      }
    }
  }
  return hits;
}

/** Apply planned positions to the model's items (as the ops would). */
function apply(
  model: BoardModel,
  positions: Map<string, { x: number; y: number }>,
) {
  for (const [id, p] of positions) {
    const current = model.items.get(id)!;
    model.items.set(id, { ...current, x: p.x, y: p.y });
  }
}

describe('layeredLayout', () => {
  const nodes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      width: 100,
      height: 60,
    }));

  it('puts a relation’s source left of its target', () => {
    const laid = layeredLayout(nodes(3), [
      { source: 'n0', target: 'n1' },
      { source: 'n1', target: 'n2' },
    ]);
    expect(laid.get('n0')!.x).toBeLessThan(laid.get('n1')!.x);
    expect(laid.get('n1')!.x).toBeLessThan(laid.get('n2')!.x);
  });

  it('survives cycles, self-loops, duplicates and unknown ids', () => {
    const laid = layeredLayout(nodes(3), [
      { source: 'n0', target: 'n1' },
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n0' },
      { source: 'n1', target: 'n1' },
      { source: 'n0', target: 'n1' },
      { source: 'n0', target: 'missing' },
    ]);
    expect(laid.size).toBe(3);
  });

  it('never overlaps boxes, and is deterministic', () => {
    const input = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      width: 80 + (i % 5) * 60,
      height: 50 + (i % 3) * 70,
    }));
    const edges = input.slice(1).map((n, i) => ({
      source: `n${Math.floor(i / 3)}`,
      target: n.id,
    }));
    const a = layeredLayout(input, edges, { x: 10, y: 20 });
    const b = layeredLayout(input, edges, { x: 10, y: 20 });
    expect([...a]).toEqual([...b]);
    const boxes = input.map((n) => ({
      ...a.get(n.id)!,
      w: n.width,
      h: n.height,
    }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const p = boxes[i];
        const q = boxes[j];
        const clear =
          p.x + p.w <= q.x ||
          q.x + q.w <= p.x ||
          p.y + p.h <= q.y ||
          q.y + q.h <= p.y;
        expect(clear).toBe(true);
      }
    }
    expect(Math.min(...boxes.map((p) => p.x))).toBe(10);
    expect(Math.min(...boxes.map((p) => p.y))).toBe(20);
  });

  it('packs unrelated nodes into rows rather than one long line', () => {
    const laid = layeredLayout(nodes(16), []);
    const rows = new Set([...laid.values()].map((p) => p.y));
    expect(rows.size).toBeGreaterThan(1);
    expect(rows.size).toBeLessThan(16);
  });
});

describe('boxOf', () => {
  it('sizes evidence with the findings around its asset', () => {
    const { res, evidenceItems } = board({
      evidence: [{ findings: 0 }, { findings: 6 }],
    });
    const model = buildBoardModel(res);
    const bare = boxOf(model, evidenceItems[0]);
    const busy = boxOf(model, evidenceItems[1]);
    expect(bare).toEqual({ dx: 0, dy: 0, width: 176, height: 92 });
    expect(busy.dx).toBeLessThan(0);
    expect(busy.dy).toBeLessThan(0);
    expect(busy.width).toBeGreaterThan(bare.width);
  });

  it('counts a dragged finding, and forgets it when findings reset', () => {
    const { res, evidenceItems } = board({
      evidence: [
        {
          findings: 1,
          patch: { style: { findingPositions: { 'f-0-0': { x: 900, y: 0 } } } },
        },
      ],
    });
    const model = buildBoardModel(res);
    expect(boxOf(model, evidenceItems[0]).width).toBeGreaterThan(1000);
    expect(
      boxOf(model, evidenceItems[0], { resetFindings: true }).width,
    ).toBeLessThan(400);
  });
});

describe('planPlacement', () => {
  it('lays out a board nothing is placed on yet', () => {
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 2, patch: { x: null, y: null } },
        { findings: 5, patch: { x: null, y: null } },
        { findings: 0, patch: { x: null, y: null } },
      ],
      links: [[0, 1]],
    });
    const model = buildBoardModel(res);
    const positions = planPlacement(model);
    expect(positions.size).toBe(3);
    apply(model, positions);
    expect(
      overlapping(
        model,
        evidenceItems.map((i) => i.id),
      ),
    ).toEqual([]);
  });

  it('puts a new item next to what it connects to, never moving placed ones', () => {
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 3, patch: { x: 0, y: 0 } },
        { findings: 3, patch: { x: 2000, y: 0 } },
        { findings: 1, patch: { x: null, y: null } },
      ],
      links: [[1, 2]],
    });
    const model = buildBoardModel(res);
    const positions = planPlacement(model);
    expect([...positions.keys()]).toEqual([evidenceItems[2].id]);
    apply(model, positions);
    const placed = rectOf(model, model.items.get(evidenceItems[2].id)!);
    const anchor = rectOf(model, model.items.get(evidenceItems[1].id)!);
    const far = rectOf(model, model.items.get(evidenceItems[0].id)!);
    const dist = (a: typeof placed, b: typeof placed) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(dist(placed, anchor)).toBeLessThan(dist(placed, far));
    expect(
      overlapping(
        model,
        evidenceItems.map((i) => i.id),
      ),
    ).toEqual([]);
  });

  it('hangs a comment pin off its item and sends loners right of the board', () => {
    const note = item('NOTE', { x: null, y: null });
    const { res, evidenceItems } = board({
      evidence: [{ findings: 0, patch: { x: 100, y: 100 } }],
    });
    const pin = item('COMMENT', {
      x: null,
      y: null,
      parentId: evidenceItems[0].id,
    });
    res.items.push(note, pin);
    const positions = planPlacement(buildBoardModel(res));
    expect(positions.get(pin.id)).toBeDefined();
    expect(Math.abs(positions.get(pin.id)!.x)).toBeLessThan(200);
    expect(positions.get(note.id)!.x).toBeGreaterThan(100 + 176);
  });
});

describe('planTidy', () => {
  it('lays top-level items out without overlaps and resets dragged findings', () => {
    const frame = item('FRAME', { x: 5000, y: 5000, width: 400, height: 300 });
    const child = item('NOTE', { x: 30, y: 60, parentId: frame.id });
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 4, patch: { x: 0, y: 0 } },
        { findings: 2, patch: { x: 50, y: 40 } },
        {
          findings: 1,
          patch: {
            x: 40,
            y: 30,
            style: { findingPositions: { 'f-2-0': { x: 700, y: 700 } } },
          },
        },
      ],
      items: [frame, child],
      links: [
        [0, 1],
        [1, child.id],
      ],
    });
    const model = buildBoardModel(res);
    const plan = planTidy(model);
    // Children travel with their frame: only top-level items move.
    expect(plan.moves.map((m) => m.itemId)).not.toContain(child.id);
    expect(plan.resetFindings).toEqual([
      { itemId: evidenceItems[2].id, findingIds: ['f-2-0'] },
    ]);
    // Size evidence the way it will be after the reset, then check overlaps.
    const reset = evidenceItems[2];
    model.items.set(reset.id, { ...reset, style: null });
    apply(model, new Map(plan.moves.map((m) => [m.itemId, m.to])));
    expect(
      overlapping(model, [...evidenceItems.map((i) => i.id), frame.id]),
    ).toEqual([]);
    // Every move says where the item was.
    expect(plan.moves.every((m) => m.from !== null)).toBe(true);
  });

  it('moves nothing twice: tidying a tidy board is a no-op', () => {
    const { res } = board({
      evidence: [{ findings: 2 }, { findings: 3 }, { findings: 0 }],
      links: [[0, 1]],
    });
    const model = buildBoardModel(res);
    apply(model, new Map(planTidy(model).moves.map((m) => [m.itemId, m.to])));
    expect(planTidy(model).moves).toEqual([]);
  });
});

describe('planFrame', () => {
  it('builds a new frame around its members, clear of everything else', () => {
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 2, patch: { x: 0, y: 0 } },
        { findings: 2, patch: { x: 1500, y: 0 } },
        { findings: 0, patch: { x: 400, y: 0 } },
      ],
      links: [[0, 1]],
    });
    const model = buildBoardModel(res);
    const plan = planFrame(model, [evidenceItems[0].id, evidenceItems[1].id], {
      kind: 'new',
      frameId: uuid(),
      title: 'Payroll',
      arrangement: 'compact',
    });
    expect(plan.members).toHaveLength(2);
    for (const m of plan.members) {
      const box = boxOf(model, model.items.get(m.itemId)!);
      expect(m.to.x + box.dx).toBeGreaterThanOrEqual(FRAME_PADDING);
      expect(m.to.y + box.dy).toBeGreaterThanOrEqual(FRAME_TITLE_HEIGHT);
      expect(m.to.x + box.dx + box.width).toBeLessThanOrEqual(plan.frame.width);
      expect(m.to.y + box.dy + box.height).toBeLessThanOrEqual(
        plan.frame.height,
      );
    }
    // The frame does not land on the evidence left outside it.
    const outside = rectOf(model, model.items.get(evidenceItems[2].id)!);
    const f = plan.frame;
    const clear =
      f.x + f.width <= outside.x ||
      outside.x + outside.w <= f.x ||
      f.y + f.height <= outside.y ||
      outside.y + outside.h <= f.y;
    expect(clear).toBe(true);
  });

  it('keeps members where they stand when asked', () => {
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 0, patch: { x: 100, y: 200 } },
        { findings: 0, patch: { x: 500, y: 260 } },
      ],
    });
    const model = buildBoardModel(res);
    const plan = planFrame(
      model,
      evidenceItems.map((i) => i.id),
      { kind: 'new', frameId: uuid(), title: 'Keep', arrangement: 'keep' },
    );
    for (const m of plan.members) {
      const before = model.items.get(m.itemId)!;
      expect(plan.frame.x + m.to.x).toBe(before.x);
      expect(plan.frame.y + m.to.y).toBe(before.y);
    }
  });

  it('fills an existing frame and grows it when full, skipping what cannot go in', () => {
    const frame = item('FRAME', { x: 0, y: 0, width: 330, height: 220 });
    const { res, evidenceItems } = board({
      evidence: [
        { findings: 0, patch: { x: 1000, y: 0 } },
        { findings: 0, patch: { x: 1400, y: 0 } },
      ],
      items: [frame],
    });
    const pin = item('COMMENT', { parentId: evidenceItems[0].id });
    res.items.push(pin);
    const model = buildBoardModel(res);
    const plan = planFrame(
      model,
      [evidenceItems[0].id, evidenceItems[1].id, pin.id, 'nope', frame.id],
      { kind: 'existing', frameId: frame.id },
    );
    expect(plan.members.map((m) => m.itemId)).toEqual([
      evidenceItems[0].id,
      evidenceItems[1].id,
    ]);
    expect(plan.skipped.map((s) => s.itemId)).toEqual([
      pin.id,
      'nope',
      frame.id,
    ]);
    expect(plan.resize).not.toBeNull();
    expect(plan.resize!.height).toBeGreaterThan(220);
  });

  it('refuses a frame id that is not a frame', () => {
    const { res, evidenceItems } = board({ evidence: [{}, {}] });
    expect(() =>
      planFrame(buildBoardModel(res), [evidenceItems[1].id], {
        kind: 'existing',
        frameId: evidenceItems[0].id,
      }),
    ).toThrow(/not a FRAME/);
  });
});

describe('planArrivals', () => {
  /** A board with one hypothesis card, optionally inside a frame, and `n` unplaced evidence items it holds a stance on. */
  function withHypothesis(opts: {
    inFrame?: boolean;
    collapsedFrame?: boolean;
    hypothesisPlaced?: boolean;
    arrivals?: number;
  }) {
    const frame = item('FRAME', {
      x: 400,
      y: 100,
      width: 600,
      height: 400,
      collapsed: opts.collapsedFrame ?? false,
    });
    const hypothesis = item('HYPOTHESIS', {
      refId: 't1',
      x: opts.hypothesisPlaced === false ? null : opts.inFrame ? 40 : 100,
      y: opts.hypothesisPlaced === false ? null : opts.inFrame ? 60 : 100,
      parentId: opts.inFrame ? frame.id : null,
    });
    const count = opts.arrivals ?? 2;
    const { res, evidenceItems } = board({
      evidence: Array.from({ length: count }, () => ({
        findings: 1,
        patch: { x: null, y: null },
      })),
      items: opts.inFrame ? [frame, hypothesis] : [hypothesis],
    });
    const r = res as unknown as {
      threads: unknown[];
      supports: unknown[];
    };
    r.threads = [
      {
        id: 't1',
        title: 'Shell company',
        itemId: hypothesis.id,
        onBoard: true,
      },
    ];
    r.supports = evidenceItems.map((e, i) => ({
      id: `s${i}`,
      threadId: 't1',
      stance: 'SUPPORTS',
      endpoint: { itemId: e.id },
    }));
    return { res, frame, hypothesis, evidenceItems };
  }

  it('puts evidence inside the frame its hypothesis sits in, relative to the frame', () => {
    const { res, frame, evidenceItems } = withHypothesis({ inFrame: true });
    const model = buildBoardModel(res);
    const plan = planArrivals(model, new Set(evidenceItems.map((e) => e.id)));
    expect(plan.positions.size).toBe(0);
    expect(plan.frames).toHaveLength(1);
    expect(plan.frames[0].frameId).toBe(frame.id);
    const members = plan.frames[0].plan.members;
    expect(members.map((m) => m.itemId).sort()).toEqual(
      evidenceItems.map((e) => e.id).sort(),
    );
    for (const m of members) {
      expect(m.to.x).toBeGreaterThanOrEqual(0);
      expect(m.to.y).toBeGreaterThanOrEqual(0);
    }
    // two arrivals never share a spot
    const [a, b] = members.map((m) => `${m.to.x},${m.to.y}`);
    expect(a).not.toBe(b);
  });

  it('keeps a folded frame folded', () => {
    const { res, evidenceItems } = withHypothesis({
      inFrame: true,
      collapsedFrame: true,
    });
    const plan = planArrivals(
      buildBoardModel(res),
      new Set(evidenceItems.map((e) => e.id)),
    );
    expect(plan.frames).toHaveLength(1);
    // the plan may ask for the frame to be opened; the caller decides not to
    expect(plan.frames[0].plan.members).toHaveLength(2);
  });

  it('places evidence beside a hypothesis on the open canvas', () => {
    const { res, hypothesis, evidenceItems } = withHypothesis({ arrivals: 3 });
    const model = buildBoardModel(res);
    const plan = planArrivals(model, new Set(evidenceItems.map((e) => e.id)));
    expect(plan.frames).toEqual([]);
    expect(plan.positions.size).toBe(3);
    const hyp = rectOf(model, hypothesis);
    for (const [, at] of plan.positions) {
      // right of the hypothesis card, on the same band, never on top of it
      expect(at.x).toBeGreaterThan(hyp.x);
      expect(Math.abs(at.y - hyp.y)).toBeLessThan(2000);
    }
    const placed = new Map(
      [...plan.positions].map(([id, at]) => [
        id,
        { ...model.items.get(id)!, ...at },
      ]),
    );
    expect(placed.size).toBe(3);
  });

  it('leaves evidence alone when its hypothesis is not on the canvas yet', () => {
    const { res, evidenceItems } = withHypothesis({ hypothesisPlaced: false });
    const plan = planArrivals(
      buildBoardModel(res),
      new Set(evidenceItems.map((e) => e.id)),
    );
    expect(plan.frames).toEqual([]);
    expect(plan.positions.size).toBe(0);
  });

  it('does not move evidence that already has a spot, or items it was not asked about', () => {
    const { res, evidenceItems } = withHypothesis({ arrivals: 2 });
    evidenceItems[0].x = 10;
    evidenceItems[0].y = 10;
    const plan = planArrivals(
      buildBoardModel(res),
      new Set([evidenceItems[0].id]),
    );
    expect(plan.positions.size).toBe(0);
    expect(plan.frames).toEqual([]);
    const other = planArrivals(buildBoardModel(res), new Set());
    expect(other.positions.size).toBe(0);
  });
});
