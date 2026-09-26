import {
  BOARD_FRAME_TITLE_MAX_CHARS,
  BOARD_HYPOTHESIS_TITLE_MAX_CHARS,
  BOARD_NOTE_MAX_CHARS,
  type BoardEndpoint,
  type BoardLinkCertainty,
  type BoardStance,
  type BoardStyle,
} from "@workspace/schemas/case-board";
import { absolutePosition, opId, type BoardOp } from "./ops";
import type {
  BoardDomain,
  BoardItem,
  BoardItemStyle,
  BoardLink,
  BoardSupport,
  Bubble,
  ItemPreview,
} from "./types";

/**
 * A user intent: the ops that do it and the ops that undo it (PRD §5.13).
 * Command-based, not snapshot-based, because the server has to be told what
 * to persist and domain side effects (adding evidence, a stance) cannot be
 * inverted by restoring a snapshot.
 *
 * Ids are generated here, on the client, so forward and inverse can address
 * the same row without temp-id remapping.
 */
export interface Command {
  label: string;
  forward: BoardOp[];
  inverse: BoardOp[];
  /** System actions (auto-placement) and irreversible ones are not undoable. */
  undoable?: boolean;
  /** Display hints for rows the server has not described yet. */
  previews?: Record<string, ItemPreview>;
}

export interface XY {
  x: number;
  y: number;
}

export const NOTE_SIZE = { width: 220, height: 160 };
export const FRAME_MIN = { width: 320, height: 200 };

/** Concatenate commands; the inverse runs in reverse order. */
export function combine(label: string, ...cmds: Array<Command | null | undefined>): Command {
  const parts = cmds.filter((c): c is Command => !!c && c.forward.length > 0);
  return {
    label,
    forward: parts.flatMap((c) => c.forward),
    inverse: [...parts].reverse().flatMap((c) => c.inverse),
    undoable: parts.every((c) => c.undoable !== false),
    previews: Object.assign({}, ...parts.map((c) => c.previews ?? {})),
  };
}

// ─── Notes & frames ──────────────────────────────────────────────────────────

export function addNote(at: XY, opts: { color?: BoardItemStyle["color"]; text?: string; parentId?: string | null } = {}): Command & { id: string } {
  const id = crypto.randomUUID();
  return {
    id,
    label: "Add note",
    forward: [
      {
        type: "item.create",
        opId: opId(),
        id,
        kind: "NOTE",
        x: at.x,
        y: at.y,
        width: NOTE_SIZE.width,
        height: NOTE_SIZE.height,
        parentId: opts.parentId ?? null,
        style: { color: opts.color ?? "yellow" },
        content: { text: opts.text ?? "" },
      },
    ],
    inverse: [{ type: "item.delete", opId: opId(), id }],
  };
}

export function addFrame(rect: XY & { width: number; height: number }, title = ""): Command & { id: string } {
  const id = crypto.randomUUID();
  return {
    id,
    label: "Add frame",
    forward: [
      {
        type: "item.create",
        opId: opId(),
        id,
        kind: "FRAME",
        x: rect.x,
        y: rect.y,
        width: Math.max(FRAME_MIN.width, rect.width),
        height: Math.max(FRAME_MIN.height, rect.height),
        style: { color: "gray" },
        content: { title },
      },
    ],
    inverse: [{ type: "item.delete", opId: opId(), id }],
  };
}

/** Duplicate notes/frames next to the originals. */
export function duplicateItems(items: BoardItem[]): Command {
  const cmds = items
    .filter((i) => i.kind === "NOTE" || i.kind === "FRAME")
    .map((i) => {
      const id = crypto.randomUUID();
      const cmd: Command = {
        label: "Duplicate",
        forward: [
          {
            type: "item.create",
            opId: opId(),
            id,
            kind: i.kind as "NOTE" | "FRAME",
            x: (i.x ?? 0) + 24,
            y: (i.y ?? 0) + 24,
            ...(i.width ? { width: i.width } : {}),
            ...(i.height ? { height: i.height } : {}),
            parentId: i.parentId,
            style: toStylePatch(i.style),
            content: i.kind === "NOTE" ? { text: i.content.text ?? "" } : { title: i.content.title ?? "" },
          },
        ],
        inverse: [{ type: "item.delete", opId: opId(), id }],
      };
      return cmd;
    });
  return combine(cmds.length === 1 ? "Duplicate" : `Duplicate ${cmds.length} items`, ...cmds);
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Move {
  id: string;
  from: XY & { parentId?: string | null };
  to: XY & { parentId?: string | null };
}

export function moveItems(moves: Move[], label?: string): Command {
  const patch = (m: Move["from"]) => ({
    x: m.x,
    y: m.y,
    ...(m.parentId !== undefined ? { parentId: m.parentId } : {}),
  });
  return {
    label: label ?? (moves.length === 1 ? "Move item" : `Move ${moves.length} items`),
    forward: moves.map((m) => ({ type: "item.update", opId: opId(), id: m.id, patch: patch(m.to) })),
    inverse: moves.map((m) => ({ type: "item.update", opId: opId(), id: m.id, patch: patch(m.from) })),
  };
}

/**
 * First placement of items the server created unplaced. A system action, not
 * the user's, so it is not undoable ("unplacing" an item means nothing).
 */
export function placeItems(positions: ReadonlyMap<string, XY>, label = "Auto-place"): Command {
  return {
    label,
    undoable: false,
    forward: [...positions].map(([id, p]) => ({
      type: "item.update" as const,
      opId: opId(),
      id,
      patch: { x: Math.round(p.x), y: Math.round(p.y) },
    })),
    inverse: [],
  };
}

export function resizeItem(
  item: BoardItem,
  to: { x: number; y: number; width: number; height: number },
): Command {
  return {
    label: "Resize",
    forward: [{ type: "item.update", opId: opId(), id: item.id, patch: to }],
    inverse: [
      {
        type: "item.update",
        opId: opId(),
        id: item.id,
        patch: {
          x: item.x ?? to.x,
          y: item.y ?? to.y,
          width: item.width,
          height: item.height,
        },
      },
    ],
  };
}

export function setCollapsed(item: BoardItem, collapsed: boolean): Command {
  return {
    label: collapsed ? "Collapse" : "Expand",
    forward: [{ type: "item.update", opId: opId(), id: item.id, patch: { collapsed } }],
    inverse: [{ type: "item.update", opId: opId(), id: item.id, patch: { collapsed: item.collapsed } }],
  };
}

export function bringToFront(items: BoardItem[], topZ: number, back = false): Command {
  let z = back ? -1 : topZ + 1;
  return {
    label: back ? "Send to back" : "Bring to front",
    forward: items.map((i) => ({
      type: "item.update" as const,
      opId: opId(),
      id: i.id,
      patch: { z: back ? z-- : z++ },
    })),
    inverse: items.map((i) => ({ type: "item.update" as const, opId: opId(), id: i.id, patch: { z: i.z } })),
  };
}

// ─── Text & style ────────────────────────────────────────────────────────────

/**
 * Replace a note's text or a frame's title. `claim` is the `updatedAt` the
 * editor started from (the item's current one by default): a stale edit is
 * refused per op, so two people typing into one note cannot silently
 * overwrite each other (PRD §5.12). The undo claims the same version, moved
 * forward over this edit when it is replayed (claims.ts), so it cannot wipe
 * out an edit someone made after this one either.
 */
export function editText(item: BoardItem, value: string, claim: string = item.updatedAt): Command {
  const field = item.kind === "NOTE" ? "text" : "title";
  const max = item.kind === "NOTE" ? BOARD_NOTE_MAX_CHARS : BOARD_FRAME_TITLE_MAX_CHARS;
  return {
    label: item.kind === "NOTE" ? "Edit note" : "Rename frame",
    forward: [
      {
        type: "item.update",
        opId: opId(),
        id: item.id,
        patch: { content: { [field]: value.slice(0, max) } },
        expectedUpdatedAt: claim,
      },
    ],
    inverse: [
      {
        type: "item.update",
        opId: opId(),
        id: item.id,
        patch: { content: { [field]: item.content[field] ?? "" } },
        expectedUpdatedAt: claim,
      },
    ],
  };
}

function toStylePatch(style: BoardItemStyle): BoardStyle {
  const patch: BoardStyle = {};
  if (style.color) patch.color = style.color;
  if (style.highlight) patch.highlight = style.highlight;
  if (style.rowHighlights) patch.rowHighlights = { ...style.rowHighlights };
  return patch;
}

/** Style patch with its exact inverse (`null` where a key was absent). */
export function setStyle(items: BoardItem[], patch: Omit<BoardStyle, "rowHighlights">, label = "Style"): Command {
  return {
    label,
    forward: items.map((i) => ({ type: "item.update" as const, opId: opId(), id: i.id, patch: { style: patch } })),
    inverse: items.map((i) => {
      const prev: BoardStyle = {};
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
        prev[key] = (i.style[key] as never) ?? null;
      }
      return { type: "item.update" as const, opId: opId(), id: i.id, patch: { style: prev } };
    }),
  };
}

export function setRowHighlight(
  item: BoardItem,
  findingId: string,
  color: BoardItemStyle["highlight"] | null,
): Command {
  return {
    label: color ? "Highlight finding" : "Clear highlight",
    forward: [
      {
        type: "item.update",
        opId: opId(),
        id: item.id,
        patch: { style: { rowHighlights: { [findingId]: color ?? null } } },
      },
    ],
    inverse: [
      {
        type: "item.update",
        opId: opId(),
        id: item.id,
        patch: {
          style: { rowHighlights: { [findingId]: item.style.rowHighlights?.[findingId] ?? null } },
        },
      },
    ],
  };
}

export interface FindingMove {
  findingId: string;
  /** Where it sat before: a spot the user chose, or null for its default spot. */
  from: XY | null;
  to: XY;
}

/** Move finding nodes around their asset; they stay attached to it. */
export function moveFindings(item: BoardItem, moves: FindingMove[]): Command {
  const to: Record<string, XY> = {};
  const from: Record<string, XY | null> = {};
  for (const m of moves) {
    to[m.findingId] = { x: Math.round(m.to.x), y: Math.round(m.to.y) };
    from[m.findingId] = m.from ? { x: m.from.x, y: m.from.y } : null;
  }
  return {
    label: moves.length === 1 ? "Move finding" : `Move ${moves.length} findings`,
    forward: [{ type: "item.update", opId: opId(), id: item.id, patch: { style: { findingPositions: to } } }],
    inverse: [{ type: "item.update", opId: opId(), id: item.id, patch: { style: { findingPositions: from } } }],
  };
}

/** Send every moved finding back to its default spot (tidy-up does this). */
export function resetFindingPositions(item: BoardItem): Command | null {
  const current = item.style.findingPositions;
  if (!current || Object.keys(current).length === 0) return null;
  const clear: Record<string, null> = {};
  for (const findingId of Object.keys(current)) clear[findingId] = null;
  return {
    label: "Reset findings",
    forward: [{ type: "item.update", opId: opId(), id: item.id, patch: { style: { findingPositions: clear } } }],
    inverse: [{ type: "item.update", opId: opId(), id: item.id, patch: { style: { findingPositions: { ...current } } } }],
  };
}

// ─── Deleting user items ─────────────────────────────────────────────────────

/**
 * Delete notes, frames, comment pins and hypothesis cards (the thread stays).
 * The inverse restores them and puts their former children back in place.
 */
export function deleteItems(d: BoardDomain, items: BoardItem[]): Command {
  const deletable = items.filter((i) => i.kind !== "EVIDENCE");
  const deleting = new Set(deletable.map((i) => i.id));
  const reparent: BoardOp[] = [];
  for (const child of d.items.values()) {
    if (!child.parentId || !deleting.has(child.parentId) || deleting.has(child.id)) continue;
    reparent.push({
      type: "item.update",
      opId: opId(),
      id: child.id,
      patch: { parentId: child.parentId, x: child.x ?? 0, y: child.y ?? 0 },
    });
  }
  return {
    label: deletable.length === 1 ? "Delete" : `Delete ${deletable.length} items`,
    forward: deletable.map((i) => ({ type: "item.delete" as const, opId: opId(), id: i.id })),
    inverse: [
      ...deletable.map((i) => ({ type: "item.restore" as const, opId: opId(), id: i.id })),
      ...reparent,
    ],
  };
}

// ─── Links ───────────────────────────────────────────────────────────────────

export interface NewLink {
  source: BoardEndpoint;
  target: BoardEndpoint;
  kind: string;
  label?: string;
  certainty?: BoardLinkCertainty;
  confidence?: number;
}

export function createLink(input: NewLink): Command & { id: string } {
  const id = crypto.randomUUID();
  return {
    id,
    label: "Link",
    forward: [{ type: "link.create", opId: opId(), id, ...input }],
    inverse: [{ type: "link.delete", opId: opId(), id }],
  };
}

export function updateLink(
  link: BoardLink,
  patch: Partial<Pick<BoardLink, "kind" | "label" | "certainty" | "confidence" | "note">>,
): Command {
  const prev: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) prev[key] = link[key];
  const withExpected = patch.label !== undefined || patch.note !== undefined;
  return {
    label: "Edit link",
    forward: [
      {
        type: "link.update",
        opId: opId(),
        id: link.id,
        patch,
        ...(withExpected ? { expectedUpdatedAt: link.updatedAt } : {}),
      },
    ],
    inverse: [
      {
        type: "link.update",
        opId: opId(),
        id: link.id,
        patch: prev,
        ...(withExpected ? { expectedUpdatedAt: link.updatedAt } : {}),
      },
    ],
  };
}

export function deleteLinks(links: BoardLink[]): Command {
  return {
    label: links.length === 1 ? "Delete link" : `Delete ${links.length} links`,
    forward: links.map((l) => ({ type: "link.delete" as const, opId: opId(), id: l.id })),
    inverse: links.map((l) => ({ type: "link.restore" as const, opId: opId(), id: l.id })),
  };
}

/** Promotion writes the global graph; undoing it is "Delete everywhere", a separate decision. */
export function promoteLink(link: BoardLink): Command {
  return {
    label: "Promote to global relationship",
    undoable: false,
    forward: [{ type: "link.promote", opId: opId(), id: link.id }],
    inverse: [],
  };
}

// ─── Evidence & findings ─────────────────────────────────────────────────────

export function addEvidence(
  entity: { entityType: "asset" | "finding"; entityId: string },
  at: XY | null,
  preview?: ItemPreview,
): Command & { itemId: string } {
  const itemId = crypto.randomUUID();
  return {
    itemId,
    label: "Add evidence",
    forward: [
      {
        type: "evidence.add",
        opId: opId(),
        itemId,
        ...entity,
        ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}),
      },
    ],
    inverse: [{ type: "evidence.remove", opId: opId(), itemId }],
    previews: preview ? { [itemId]: preview } : undefined,
  };
}

/**
 * Remove evidence from the case. Undo replays `evidence.add` on the same item,
 * which the server answers by restoring the evidence exactly — attached
 * findings, notes and hypothesis stances included.
 */
export function removeEvidence(item: BoardItem, bubble: Bubble): Command {
  const abs = { x: item.x ?? 0, y: item.y ?? 0 };
  return {
    label: "Remove from case",
    forward: [{ type: "evidence.remove", opId: opId(), itemId: item.id }],
    inverse: [
      {
        type: "evidence.add",
        opId: opId(),
        itemId: item.id,
        entityType: "asset",
        entityId: bubble.assetId,
        x: abs.x,
        y: abs.y,
      },
    ],
  };
}

export function attachFinding(itemId: string, findingId: string): Command {
  return {
    label: "Attach finding",
    forward: [{ type: "finding.attach", opId: opId(), itemId, findingId }],
    inverse: [{ type: "finding.detach", opId: opId(), itemId, findingId }],
  };
}

export function detachFinding(itemId: string, findingId: string): Command {
  return {
    label: "Detach finding",
    forward: [{ type: "finding.detach", opId: opId(), itemId, findingId }],
    inverse: [{ type: "finding.attach", opId: opId(), itemId, findingId }],
  };
}

// ─── Hypotheses & stances ────────────────────────────────────────────────────

/** Undo removes the card from the board; the thread and its log are kept. */
export function createHypothesis(
  title: string,
  at: XY | null,
  supports: BoardEndpoint[] = [],
  color?: string,
): Command & { itemId: string } {
  const itemId = crypto.randomUUID();
  return {
    itemId,
    label: "New hypothesis",
    forward: [
      {
        type: "hypothesis.create",
        opId: opId(),
        itemId,
        // Longer is refused by the op schema, and a refused batch is dropped whole.
        title: title.slice(0, BOARD_HYPOTHESIS_TITLE_MAX_CHARS),
        ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}),
        ...(color ? { color } : {}),
        ...(supports.length > 0 ? { supports } : {}),
      },
    ],
    inverse: [{ type: "item.delete", opId: opId(), id: itemId }],
  };
}

export function setStance(
  hypothesisItemId: string,
  target: BoardEndpoint,
  stance: BoardStance,
  previous: BoardSupport | null,
  note?: string,
): Command {
  return {
    label: "Set stance",
    forward: [
      {
        type: "stance.set",
        opId: opId(),
        hypothesisItemId,
        target,
        stance,
        ...(note ? { note } : {}),
      },
    ],
    inverse: previous
      ? [
          {
            type: "stance.set",
            opId: opId(),
            hypothesisItemId,
            target,
            stance: previous.stance,
            ...(previous.note ? { note: previous.note } : {}),
          },
        ]
      : [{ type: "stance.remove", opId: opId(), hypothesisItemId, target }],
  };
}

export function removeStance(hypothesisItemId: string, target: BoardEndpoint, previous: BoardSupport): Command {
  return {
    label: "Remove stance",
    forward: [{ type: "stance.remove", opId: opId(), hypothesisItemId, target }],
    inverse: [
      {
        type: "stance.set",
        opId: opId(),
        hypothesisItemId,
        target,
        stance: previous.stance,
        ...(previous.note ? { note: previous.note } : {}),
      },
    ],
  };
}

// ─── Comments & threads ──────────────────────────────────────────────────────

export function addComment(body: string, anchor: BoardEndpoint | null, at: XY): Command & { itemId: string } {
  const itemId = crypto.randomUUID();
  return {
    itemId,
    label: "Comment",
    forward: [
      {
        type: "comment.create",
        opId: opId(),
        itemId,
        body: body.slice(0, BOARD_NOTE_MAX_CHARS),
        anchor,
        x: Math.round(at.x),
        y: Math.round(at.y),
      },
    ],
    inverse: [{ type: "item.delete", opId: opId(), id: itemId }],
  };
}

export function resolveComment(itemId: string, resolved: boolean): Command {
  return {
    label: resolved ? "Resolve comment" : "Reopen comment",
    forward: [{ type: "comment.resolve", opId: opId(), itemId, resolved }],
    inverse: [{ type: "comment.resolve", opId: opId(), itemId, resolved: !resolved }],
  };
}

export function placeThread(threadId: string, existingItemId: string | null, at: XY): Command {
  const itemId = existingItemId ?? crypto.randomUUID();
  return {
    label: "Place on board",
    forward: [
      {
        type: "thread.place",
        opId: opId(),
        itemId,
        threadId,
        x: Math.round(at.x),
        y: Math.round(at.y),
      },
    ],
    inverse: [{ type: "item.delete", opId: opId(), id: itemId }],
  };
}

/** Absolute position of an item's top-left corner (children are parent-relative). */
export function itemAbsolute(d: BoardDomain, itemId: string): XY {
  return absolutePosition(d.items, itemId);
}
