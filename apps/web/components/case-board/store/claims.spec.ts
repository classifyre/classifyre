import { advanceClaims, followOwnWrites, recordOwnWrite, textClaim, type OwnWrites } from "./claims";
import { editText } from "./commands";
import type { BoardOp } from "./ops";
import type { BoardItem } from "./types";

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T10:00:01.000Z";
const T2 = "2026-09-26T10:00:02.000Z";
const T3 = "2026-09-26T10:00:03.000Z";

const note = (updatedAt: string, text = "before"): BoardItem => ({
  id: "N",
  kind: "NOTE",
  refId: null,
  x: 0,
  y: 0,
  width: 220,
  height: 160,
  z: 0,
  parentId: null,
  collapsed: false,
  style: {},
  content: { text },
  createdBy: null,
  updatedBy: null,
  updatedAt,
});

const claimOf = (ops: BoardOp[]) => (ops[0] as Extract<BoardOp, { type: "item.update" }>).expectedUpdatedAt;

describe("claims: the board's own writes do not count against its text edits", () => {
  it("follows only the steps this board's own writes made", () => {
    const own: OwnWrites = new Map();
    recordOwnWrite(own, "N", T0, T1);
    recordOwnWrite(own, "N", T1, T2);
    expect(followOwnWrites(own, "N", T0)).toBe(T2);
    // Someone else moved the row from T2 to T3: that step is not on record.
    expect(followOwnWrites(own, "N", T2)).toBe(T2);
    expect(followOwnWrites(own, "other", T0)).toBe(T0);
  });

  it("accepts Dates and differently spelled stamps", () => {
    const own: OwnWrites = new Map();
    recordOwnWrite(own, "N", new Date(T0), new Date(T1));
    expect(followOwnWrites(own, "N", "2026-09-26T10:00:00Z")).toBe(T1);
  });

  it("lets a redo after an undo claim the version the undo left, not the one the edit began from", () => {
    const own: OwnWrites = new Map();
    const cmd = editText(note(T0), "after");
    // The edit and its undo both claim the version editing began from.
    expect(claimOf(cmd.forward)).toBe(T0);
    expect(claimOf(cmd.inverse)).toBe(T0);

    // Run: the server accepts the edit, T0 → T1.
    recordOwnWrite(own, "N", claimOf(advanceClaims(cmd.forward, own))!, T1);
    // Undo: its claim moves to T1, and the server takes it to T2.
    const undo = advanceClaims(cmd.inverse, own);
    expect(claimOf(undo)).toBe(T1);
    recordOwnWrite(own, "N", claimOf(undo)!, T2);
    // Redo: the original op now claims T2 — before, it claimed T0 and was always refused.
    expect(claimOf(advanceClaims(cmd.forward, own))).toBe(T2);
  });

  it("leaves ops without a claim alone", () => {
    const own: OwnWrites = new Map([["N", new Map([[T0, T1]])]]);
    const move: BoardOp = { type: "item.update", opId: "m", id: "N", patch: { x: 1 } };
    expect(advanceClaims([move], own)[0]).toBe(move);
  });

  it("claims the version editing began from only when the text changed underneath the editor", () => {
    const began = { text: "before", updatedAt: T0 };
    // Nothing but this board's own writes since (a move): the version on screen.
    expect(textClaim(note(T1), "before", began)).toBe(T1);
    // Someone else's text arrived meanwhile: the server must refuse the save.
    expect(textClaim(note(T3), "theirs", began)).toBe(T0);
    expect(textClaim(note(T1), "before", null)).toBe(T1);
  });

  it("clamps text to what the op schema accepts, so one long note cannot sink a batch", () => {
    const cmd = editText(note(T0), "x".repeat(25_000));
    const op = cmd.forward[0] as Extract<BoardOp, { type: "item.update" }>;
    expect(op.patch.content?.text).toHaveLength(20_000);
  });
});
