import {
  ApplyBoardOpsSchema,
  BoardOpSchema,
} from '@workspace/schemas/case-board';
import { parseActorName } from '../actor-name.decorator';
import { mergeStyle, toRelationType } from './case-board.service';
import { summarizeOps } from './case-board.events';

const id = () => crypto.randomUUID();

describe('BoardOpSchema', () => {
  it('accepts every op shape the board sends', () => {
    const item = id();
    const ops = [
      {
        type: 'item.create',
        opId: '1',
        id: item,
        kind: 'NOTE',
        x: 0,
        y: 0,
        content: { text: 'a' },
      },
      {
        type: 'item.update',
        opId: '2',
        id: item,
        patch: { x: 1, style: { highlight: null } },
        expectedUpdatedAt: new Date().toISOString(),
      },
      { type: 'item.delete', opId: '3', id: item },
      { type: 'item.restore', opId: '4', id: item },
      {
        type: 'link.create',
        opId: '5',
        id: id(),
        source: { itemId: item, findingId: 'f-1' },
        target: { itemId: id() },
        kind: 'related_to',
        certainty: 'SUSPECTED',
      },
      {
        type: 'link.update',
        opId: '6',
        id: id(),
        patch: { label: null, confidence: 0.4 },
      },
      { type: 'link.promote', opId: '7', id: id() },
      {
        type: 'evidence.add',
        opId: '8',
        itemId: id(),
        entityType: 'finding',
        entityId: 'finding-1',
      },
      {
        type: 'finding.detach',
        opId: '9',
        itemId: id(),
        findingId: 'finding-1',
      },
      {
        type: 'hypothesis.create',
        opId: '10',
        itemId: id(),
        title: 'H',
        supports: [{ itemId: id() }],
      },
      {
        type: 'stance.set',
        opId: '11',
        hypothesisItemId: id(),
        target: { itemId: id() },
        stance: 'NEUTRAL',
      },
      {
        type: 'comment.create',
        opId: '12',
        itemId: id(),
        body: 'why?',
        anchor: null,
      },
      { type: 'comment.resolve', opId: '13', itemId: id(), resolved: true },
      {
        type: 'thread.place',
        opId: '14',
        itemId: id(),
        threadId: id(),
        x: 1,
        y: 2,
      },
    ];
    for (const op of ops) {
      const res = BoardOpSchema.safeParse(op);
      expect({ type: op.type, ok: res.success }).toEqual({
        type: op.type,
        ok: true,
      });
    }
  });

  it('fails closed on unknown keys instead of silently dropping them', () => {
    const res = BoardOpSchema.safeParse({
      type: 'item.update',
      opId: '1',
      id: id(),
      patch: { x: 1, colour: 'red' },
    });
    expect(res.success).toBe(false);
  });

  it('refuses kinds a client may not create directly', () => {
    for (const kind of ['EVIDENCE', 'HYPOTHESIS', 'COMMENT']) {
      const res = BoardOpSchema.safeParse({
        type: 'item.create',
        opId: '1',
        id: id(),
        kind,
        x: 0,
        y: 0,
      });
      expect(res.success).toBe(false);
    }
  });

  it('bounds batches and coordinates', () => {
    const op = { type: 'item.delete', opId: '1', id: id() };
    expect(
      ApplyBoardOpsSchema.safeParse({
        clientId: 'c',
        baseVersion: 0,
        ops: Array(201).fill(op),
      }).success,
    ).toBe(false);
    expect(
      ApplyBoardOpsSchema.safeParse({ clientId: 'c', baseVersion: 0, ops: [] })
        .success,
    ).toBe(false);
    expect(
      BoardOpSchema.safeParse({
        type: 'item.create',
        opId: '1',
        id: id(),
        kind: 'NOTE',
        x: Infinity,
        y: 0,
      }).success,
    ).toBe(false);
  });
});

describe('mergeStyle', () => {
  it('merges key by key and removes keys set to null', () => {
    expect(
      mergeStyle({ color: 'yellow', highlight: 'red' }, { highlight: null }),
    ).toEqual({
      color: 'yellow',
    });
    expect(mergeStyle(null, { color: 'blue' })).toEqual({ color: 'blue' });
    expect(mergeStyle({ highlight: 'red' }, { highlight: null })).toBeNull();
  });

  it('merges finding positions per finding, null sending one back to its default spot', () => {
    const current = {
      findingPositions: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } },
    };
    expect(
      mergeStyle(current, {
        findingPositions: { a: null, c: { x: 5, y: 6 } },
      }),
    ).toEqual({ findingPositions: { b: { x: 3, y: 4 }, c: { x: 5, y: 6 } } });
    expect(
      mergeStyle(
        { findingPositions: { a: { x: 1, y: 2 } } },
        { findingPositions: { a: null } },
      ),
    ).toBeNull();
  });

  it('merges row highlights per finding so one row never rewrites the others', () => {
    const current = { rowHighlights: { a: 'yellow', b: 'green' } };
    expect(
      mergeStyle(current, { rowHighlights: { b: null, c: 'pink' } }),
    ).toEqual({
      rowHighlights: { a: 'yellow', c: 'pink' },
    });
    expect(
      mergeStyle(
        { rowHighlights: { a: 'yellow' } },
        { rowHighlights: { a: null } },
      ),
    ).toBeNull();
  });
});

describe('toRelationType', () => {
  it('maps board link kinds onto the global relation vocabulary', () => {
    expect(toRelationType('communicates_with')).toBe('COMMUNICATES_WITH');
    expect(toRelationType('same_entity')).toBe('SAME_AS');
    expect(toRelationType(' Leaked to! ')).toBe('LEAKED_TO');
    expect(toRelationType('***')).toBe('RELATED_TO');
  });
});

describe('summarizeOps', () => {
  it('summarises the most frequent change first', () => {
    const item = id();
    expect(
      summarizeOps([
        { type: 'item.update', opId: '1', id: item, patch: { x: 1 } },
        { type: 'item.update', opId: '2', id: id(), patch: { y: 1 } },
        { type: 'item.update', opId: '3', id: id(), patch: { x: 2 } },
        { type: 'item.create', opId: '4', id: id(), kind: 'NOTE', x: 0, y: 0 },
      ]),
    ).toBe('moved 3 items · added a note or frame');
    expect(summarizeOps([])).toBe('changed the board');
  });
});

describe('parseActorName', () => {
  it('decodes, trims and caps the self-declared name', () => {
    expect(parseActorName(encodeURIComponent('Jürgen Müller'))).toBe(
      'Jürgen Müller',
    );
    expect(parseActorName('  MK  ')).toBe('MK');
    expect(parseActorName('100%')).toBe('100%');
    expect(parseActorName('a\u0000b')).toBe('a b');
    expect(parseActorName('x'.repeat(200))).toHaveLength(64);
    expect(parseActorName('')).toBeUndefined();
    expect(parseActorName(undefined)).toBeUndefined();
    expect(parseActorName(['first', 'second'])).toBe('first');
  });
});
