import { HYPOTHESIS_PALETTE } from "@workspace/case-board/lib/geometry";
import type { BoardState } from "./board-store";
import type { BoardDomain, BoardThread } from "./types";

export { HYPOTHESIS_PALETTE };

export interface HypothesisMeta {
  index: number;
  label: string;
  color: string;
}

/** H1, H2, … in creation order, with a stable colour per hypothesis. */
export function hypothesisMeta(
  threads: ReadonlyMap<string, BoardThread>,
): Map<string, HypothesisMeta> {
  const out = new Map<string, HypothesisMeta>();
  let index = 0;
  for (const t of threads.values()) {
    if (t.kind !== "HYPOTHESIS") continue;
    out.set(t.id, {
      index,
      label: `H${index + 1}`,
      color: t.color ?? HYPOTHESIS_PALETTE[index % HYPOTHESIS_PALETTE.length]!,
    });
    index += 1;
  }
  return out;
}

/**
 * Threads with a stance on an evidence item (on the bubble or any of its
 * rows), as a joined string so the selector result is a primitive and a
 * bubble re-renders only when its own set changes.
 */
export function stanceThreadKey(s: BoardState, itemId: string): string {
  const ids = new Set<string>();
  for (const support of s.supports.values()) {
    if (support.endpoint?.itemId === itemId) ids.add(support.threadId);
  }
  return [...ids].sort().join("|");
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** The highest z among items, for "Bring to front". */
export function topZ(s: BoardState): number {
  let z = 0;
  for (const item of s.items.values()) if (item.z > z) z = item.z;
  return z;
}

/** Something from the corpus that can become evidence on the board. */
export interface EvidenceCandidate {
  kind: "asset" | "finding";
  id: string;
  /** The asset itself, or the asset the finding was found in. */
  assetId: string;
  /** Name of that asset: what the new node is labelled with until the server answers. */
  assetName: string;
  assetType: string | null;
  sourceType: string | null;
}

/**
 * Where a candidate stands against the board: not there, there (an asset in
 * the case, or a finding attached to it), or — findings only — shown on its
 * asset but not attached yet.
 */
export type EvidenceStatus = "absent" | "onBoard" | "attachable";

export function evidenceStatus(d: Pick<BoardDomain, "itemByAsset" | "bubbles">, c: EvidenceCandidate): EvidenceStatus {
  const itemId = d.itemByAsset.get(c.assetId);
  if (!itemId) return "absent";
  if (c.kind === "asset") return "onBoard";
  return d.bubbles.get(itemId)?.rows.some((r) => r.findingId === c.id) ? "onBoard" : "attachable";
}
