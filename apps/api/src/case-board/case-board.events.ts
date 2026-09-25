import type { BoardOp } from '@workspace/schemas/case-board';

/**
 * Seam between the ops path and whatever tells other viewers a board changed
 * (the socket.io gateway). A token rather than a direct import keeps the
 * write service testable and free of the websocket module.
 */
export const CASE_BOARD_EVENTS = Symbol('CASE_BOARD_EVENTS');

export interface BoardChangedEvent {
  caseId: string;
  version: number;
  actor: string | null;
  /** The writing tab, so it can ignore the echo of its own batch. */
  clientId: string;
  /** "moved 3 items · added a note" — for the other viewers' toast. */
  summary: string;
}

export interface CaseBoardEvents {
  emitChanged(caseId: string, event: BoardChangedEvent): void;
}

const VERBS: Partial<Record<BoardOp['type'], [string, string]>> = {
  'item.create': ['added a note or frame', 'added {n} notes or frames'],
  'item.delete': ['removed an item', 'removed {n} items'],
  'item.restore': ['restored an item', 'restored {n} items'],
  'link.create': ['drew a link', 'drew {n} links'],
  'link.update': ['edited a link', 'edited {n} links'],
  'link.delete': ['removed a link', 'removed {n} links'],
  'link.restore': ['restored a link', 'restored {n} links'],
  'link.promote': ['made a link global', 'made {n} links global'],
  'evidence.add': ['added evidence', 'added {n} pieces of evidence'],
  'evidence.remove': ['removed evidence', 'removed {n} pieces of evidence'],
  'finding.attach': ['attached a finding', 'attached {n} findings'],
  'finding.detach': ['detached a finding', 'detached {n} findings'],
  'hypothesis.create': ['added a hypothesis', 'added {n} hypotheses'],
  'stance.set': ['set a stance', 'set {n} stances'],
  'stance.remove': ['removed a stance', 'removed {n} stances'],
  'comment.create': ['commented', 'added {n} comments'],
  'comment.resolve': ['resolved a comment', 'resolved {n} comments'],
  'thread.place': ['placed a thread', 'placed {n} threads'],
};

/** A short human summary of an applied batch, most frequent change first. */
export function summarizeOps(ops: readonly BoardOp[]): string {
  const counts = new Map<string, number>();
  let moved = 0;
  let edited = 0;
  for (const op of ops) {
    if (op.type === 'item.update') {
      const keys = Object.keys(op.patch);
      if (keys.some((k) => k === 'content')) edited += 1;
      else if (keys.some((k) => k === 'style'))
        counts.set('highlight', (counts.get('highlight') ?? 0) + 1);
      else moved += 1;
      continue;
    }
    counts.set(op.type, (counts.get(op.type) ?? 0) + 1);
  }
  const parts: Array<[number, string]> = [];
  if (moved > 0)
    parts.push([moved, moved === 1 ? 'moved an item' : `moved ${moved} items`]);
  if (edited > 0)
    parts.push([
      edited,
      edited === 1 ? 'edited a note' : `edited ${edited} notes`,
    ]);
  const highlights = counts.get('highlight') ?? 0;
  if (highlights > 0) {
    parts.push([
      highlights,
      highlights === 1
        ? 'highlighted an item'
        : `highlighted ${highlights} items`,
    ]);
    counts.delete('highlight');
  }
  for (const [type, n] of counts) {
    const verb = VERBS[type as BoardOp['type']];
    if (!verb) continue;
    parts.push([n, n === 1 ? verb[0] : verb[1].replace('{n}', String(n))]);
  }
  parts.sort((a, b) => b[0] - a[0]);
  return parts.length > 0
    ? parts
        .slice(0, 3)
        .map((p) => p[1])
        .join(' · ')
    : 'changed the board';
}
