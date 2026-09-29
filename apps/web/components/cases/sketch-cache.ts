import type { BoardSketch } from "@workspace/schemas/case-board";

/**
 * Board sketches this tab drew, so a case card shows an edit the moment you
 * are back on the list, before the upload that carries it has landed (it may
 * still be in flight when the list asks for the cases).
 */

interface LocalSketch {
  sketch: BoardSketch;
  signature: string;
  /** Server time of the stored copy; unset while the upload is on its way. */
  storedAt?: number;
}

const local = new Map<string, LocalSketch>();

export function rememberSketch(caseId: string, sketch: BoardSketch, signature: string): void {
  local.set(caseId, { sketch, signature });
}

/** The server kept this tab's sketch (`kept`), or kept another one instead. */
export function settleSketch(caseId: string, signature: string, kept: boolean, updatedAt: Date): void {
  const entry = local.get(caseId);
  if (!entry || entry.signature !== signature) return;
  if (kept) entry.storedAt = updatedAt.getTime();
  else local.delete(caseId);
}

export function forgetSketch(caseId: string, signature: string): void {
  if (local.get(caseId)?.signature === signature) local.delete(caseId);
}

/** A stored sketch, if the server's JSON is one this app can draw. */
export function asBoardSketch(value: unknown): BoardSketch | null {
  const v = value as Partial<BoardSketch> | null | undefined;
  return v && v.v === 1 && Array.isArray(v.nodes) && Array.isArray(v.edges) ? (v as BoardSketch) : null;
}

/**
 * What a card draws: this tab's newest sketch of the board, unless the
 * server holds one stored after it (someone else edited the board since).
 */
export function pickSketch(
  caseId: string,
  stored: { sketch: unknown; updatedAt: Date } | null | undefined,
): BoardSketch | null {
  const mine = local.get(caseId);
  const theirs = stored ? asBoardSketch(stored.sketch) : null;
  if (!mine) return theirs;
  if (!theirs || mine.storedAt === undefined) return mine.sketch;
  return stored!.updatedAt.getTime() > mine.storedAt ? theirs : mine.sketch;
}
