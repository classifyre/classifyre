import type { BoardOp } from "./ops";

/**
 * Optimistic concurrency for text edits (PRD §5.12). A note or frame edit
 * claims a version (`updatedAt`) of its row, and the server refuses it when
 * the row has moved past that version. The board's own writes must not count
 * as someone else's: redoing an edit, or editing a note that was just created
 * or moved, would then be refused every time.
 *
 * So the board remembers the steps its own writes moved each row by — from
 * the version it had to the one the server answered with — and a claim made
 * before such a step moves forward along it. A step the board did not make
 * (someone else's edit, brought in by a refetch) is not on record, so a claim
 * stops in front of it and the server refuses the edit.
 */

/** Row id → version → the version one of this board's own writes moved it to. */
export type OwnWrites = Map<string, Map<string, string>>;

/** One ISO spelling for a version, whether it came as a Date or a string. */
export function stampOf(value: Date | string): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
}

export function recordOwnWrite(own: OwnWrites, id: string, from: Date | string, to: Date | string): void {
  const a = stampOf(from);
  const b = stampOf(to);
  if (a === b) return;
  let steps = own.get(id);
  if (!steps) {
    steps = new Map();
    own.set(id, steps);
  }
  steps.set(a, b);
}

/** The newest version a claim reaches through this board's own writes. */
export function followOwnWrites(own: OwnWrites, id: string, claim: string): string {
  let stamp = stampOf(claim);
  const steps = own.get(id);
  if (!steps) return stamp;
  const seen = new Set<string>([stamp]);
  for (let next = steps.get(stamp); next && !seen.has(next); next = steps.get(stamp)) {
    seen.add(next);
    stamp = next;
  }
  return stamp;
}

/** Ops whose text-edit claims are moved forward over this board's own writes. */
export function advanceClaims(ops: readonly BoardOp[], own: OwnWrites): BoardOp[] {
  return ops.map((op) => {
    if ((op.type !== "item.update" && op.type !== "link.update") || !op.expectedUpdatedAt) return op;
    const claim = followOwnWrites(own, op.id, op.expectedUpdatedAt);
    return claim === op.expectedUpdatedAt ? op : { ...op, expectedUpdatedAt: claim };
  });
}

/**
 * The version a text save claims. Only its own editor changes a note's text
 * while the editor is open, so text that changed underneath it came from
 * someone else (a refetch brought it in): claim the version editing began
 * from, and the server refuses the save instead of overwriting their edit.
 * Otherwise claim the version on screen, which already counts this board's
 * own writes since editing began (the note's creation, a move).
 */
export function textClaim(
  current: { updatedAt: string },
  currentText: string | undefined,
  began: { text: string; updatedAt: string } | null,
): string {
  return began && (currentText ?? "") !== began.text ? began.updatedAt : current.updatedAt;
}
