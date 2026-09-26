import type { BoardOp, BoardStyle } from "@workspace/schemas/case-board";
import { placeholderBubble, tallyBubble } from "./domain";
import type {
  BoardDomain,
  BoardItem,
  BoardItemStyle,
  BoardLink,
  BoardSupport,
  BoardThread,
  BubbleRow,
  ItemPreview,
} from "./types";

export type { BoardOp } from "@workspace/schemas/case-board";

export interface LocalContext {
  actor: string | null;
  previews: ReadonlyMap<string, ItemPreview>;
  /** ISO timestamp used for optimistic rows. */
  now: string;
}

export interface LocalResult {
  domain: BoardDomain;
  /**
   * False when the op's full effect can only be known from the server (a new
   * thread's id, a restored bubble's rows): the board refetches once the
   * batch is applied.
   */
  exact: boolean;
}

export const opId = (): string => crypto.randomUUID();

const PENDING_THREAD = "pending:";

// ─── Immutable helpers ────────────────────────────────────────────────────────

function withItem(d: BoardDomain, item: BoardItem): BoardDomain {
  return { ...d, items: new Map(d.items).set(item.id, item) };
}

function withLink(d: BoardDomain, link: BoardLink): BoardDomain {
  return { ...d, links: new Map(d.links).set(link.id, link) };
}

function withThread(d: BoardDomain, thread: BoardThread): BoardDomain {
  return { ...d, threads: new Map(d.threads).set(thread.id, thread) };
}

/** Style keys holding one entry per finding, merged entry by entry. */
const PER_FINDING_STYLE_KEYS = new Set(["rowHighlights", "findingPositions"]);

/** Same merge the server does: key by key, `null` removes, per-finding keys entry by entry. */
export function mergeStyle(
  current: BoardItemStyle,
  patch: BoardStyle | undefined,
): BoardItemStyle {
  if (!patch) return current;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (PER_FINDING_STYLE_KEYS.has(key)) {
      const rows: Record<string, unknown> = { ...((current as Record<string, unknown>)[key] as object | undefined) };
      for (const [findingId, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry === null) delete rows[findingId];
        else rows[findingId] = entry;
      }
      if (Object.keys(rows).length > 0) next[key] = rows;
      else delete next[key];
      continue;
    }
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as BoardItemStyle;
}

/** Absolute canvas position of an item, walking up its frames. */
export function absolutePosition(
  items: ReadonlyMap<string, BoardItem>,
  id: string,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const item = items.get(cursor);
    if (!item) break;
    x += item.x ?? 0;
    y += item.y ?? 0;
    cursor = item.parentId;
  }
  return { x, y };
}

/** Take an item off the board locally: links and children follow the server's rules. */
function removeItem(d: BoardDomain, item: BoardItem): BoardDomain {
  const items = new Map(d.items);
  items.delete(item.id);
  // Children keep their place on the canvas: parent-relative → absolute.
  for (const child of d.items.values()) {
    if (child.parentId !== item.id) continue;
    const abs = absolutePosition(d.items, child.id);
    items.set(child.id, { ...child, parentId: null, x: abs.x, y: abs.y });
  }
  const links = new Map(d.links);
  const buriedLinks = new Map(d.graveyard.links);
  for (const link of d.links.values()) {
    if (link.sourceItemId === item.id || link.targetItemId === item.id) {
      links.delete(link.id);
      buriedLinks.set(link.id, link);
    }
  }
  let next: BoardDomain = {
    ...d,
    items,
    links,
    graveyard: {
      items: new Map(d.graveyard.items).set(item.id, item),
      links: buriedLinks,
    },
  };
  if (item.kind === "EVIDENCE") {
    const bubbles = new Map(next.bubbles);
    const bubble = bubbles.get(item.id);
    bubbles.delete(item.id);
    const itemByAsset = new Map(next.itemByAsset);
    const itemByFinding = new Map(next.itemByFinding);
    if (bubble) {
      itemByAsset.delete(bubble.assetId);
      for (const row of [...bubble.rows, ...bubble.unattached]) itemByFinding.delete(row.findingId);
    }
    const supports = new Map(next.supports);
    for (const s of next.supports.values()) {
      if (s.endpoint?.itemId === item.id) supports.set(s.id, { ...s, endpoint: null });
    }
    next = { ...next, bubbles, itemByAsset, itemByFinding, supports };
  }
  if ((item.kind === "HYPOTHESIS" || item.kind === "COMMENT") && item.refId) {
    const thread = next.threads.get(item.refId);
    if (thread) next = withThread(next, { ...thread, onBoard: false, itemId: item.id });
  }
  return next;
}

/** Bring a locally removed item back, with the links that left with it. */
function reviveItem(d: BoardDomain, item: BoardItem, at?: { x?: number; y?: number }): BoardDomain {
  const revived: BoardItem = {
    ...item,
    x: at?.x ?? item.x,
    y: at?.y ?? item.y,
    parentId: item.parentId && d.items.has(item.parentId) ? item.parentId : null,
  };
  const buriedItems = new Map(d.graveyard.items);
  buriedItems.delete(item.id);
  const items = new Map(d.items).set(item.id, revived);
  const links = new Map(d.links);
  const buriedLinks = new Map(d.graveyard.links);
  for (const link of d.graveyard.links.values()) {
    const other =
      link.sourceItemId === item.id
        ? link.targetItemId
        : link.targetItemId === item.id
          ? link.sourceItemId
          : null;
    if (other && items.has(other)) {
      links.set(link.id, link);
      buriedLinks.delete(link.id);
    }
  }
  let next: BoardDomain = {
    ...d,
    items,
    links,
    graveyard: { items: buriedItems, links: buriedLinks },
  };
  if ((item.kind === "HYPOTHESIS" || item.kind === "COMMENT") && item.refId) {
    const thread = next.threads.get(item.refId);
    if (thread) next = withThread(next, { ...thread, onBoard: true, itemId: item.id });
  }
  return next;
}

function sameEndpoint(
  a: { itemId: string; findingId: string | null } | null,
  b: { itemId: string; findingId?: string | null },
): boolean {
  return !!a && a.itemId === b.itemId && (a.findingId ?? null) === (b.findingId ?? null);
}

function moveRow(
  d: BoardDomain,
  itemId: string,
  findingId: string,
  to: "rows" | "unattached",
): BoardDomain {
  const bubble = d.bubbles.get(itemId);
  if (!bubble) return d;
  const from = to === "rows" ? bubble.unattached : bubble.rows;
  const row = from.find((r) => r.findingId === findingId);
  if (!row) return d;
  const moved: BubbleRow = { ...row, caseFindingId: to === "rows" ? "pending" : null };
  const next = tallyBubble({
    ...bubble,
    rows:
      to === "rows"
        ? [...bubble.rows, moved]
        : bubble.rows.filter((r) => r.findingId !== findingId),
    unattached:
      to === "unattached"
        ? row.missing
          ? bubble.unattached
          : [...bubble.unattached, moved]
        : bubble.unattached.filter((r) => r.findingId !== findingId),
  });
  return { ...d, bubbles: new Map(d.bubbles).set(itemId, next) };
}

function placeholderThread(
  id: string,
  kind: BoardThread["kind"],
  title: string,
  ctx: LocalContext,
  itemId: string,
): BoardThread {
  return {
    id,
    kind,
    title,
    status: kind === "HYPOTHESIS" ? "PROPOSED" : null,
    confidence: null,
    color: null,
    createdBy: ctx.actor,
    entryCount: 1,
    lastEntryAt: ctx.now,
    lastAuthor: ctx.actor,
    lastExcerpt: title,
    supportingCount: 0,
    contradictingCount: 0,
    neutralCount: 0,
    resolvedAt: null,
    resolvedBy: null,
    itemId,
    onBoard: true,
    pending: true,
  };
}

function newItem(
  id: string,
  kind: BoardItem["kind"],
  ctx: LocalContext,
  extra: Partial<BoardItem>,
): BoardItem {
  return {
    id,
    kind,
    refId: null,
    x: null,
    y: null,
    width: null,
    height: null,
    z: 0,
    parentId: null,
    collapsed: false,
    style: {},
    content: {},
    createdBy: ctx.actor,
    updatedBy: ctx.actor,
    updatedAt: ctx.now,
    pending: true,
    ...extra,
  };
}

// ─── The reducer ─────────────────────────────────────────────────────────────

/**
 * Apply one op to the local domain, the way the server will. Pure and
 * idempotent: re-applying an op the server already reflects (a refetch that
 * raced an in-flight batch) changes nothing.
 */
export function applyLocal(d: BoardDomain, op: BoardOp, ctx: LocalContext): LocalResult {
  switch (op.type) {
    case "item.create": {
      if (d.items.has(op.id)) return { domain: d, exact: true };
      const buried = d.graveyard.items.get(op.id);
      if (buried) return { domain: reviveItem(d, buried), exact: true };
      const item = newItem(op.id, op.kind, ctx, {
        x: op.x,
        y: op.y,
        width: op.width ?? null,
        height: op.height ?? null,
        z: op.z ?? 0,
        parentId: op.parentId ?? null,
        style: mergeStyle({}, op.style),
        content: op.content ?? (op.kind === "NOTE" ? { text: "" } : { title: "" }),
      });
      return { domain: withItem(d, item), exact: true };
    }
    case "item.update": {
      const item = d.items.get(op.id);
      if (!item) return { domain: d, exact: false };
      const p = op.patch;
      const next: BoardItem = { ...item, updatedBy: ctx.actor };
      if (p.x !== undefined) next.x = p.x;
      if (p.y !== undefined) next.y = p.y;
      if (p.width !== undefined) next.width = p.width;
      if (p.height !== undefined) next.height = p.height;
      if (p.z !== undefined) next.z = p.z;
      if (p.parentId !== undefined) next.parentId = p.parentId;
      if (p.collapsed !== undefined) next.collapsed = p.collapsed;
      if (p.style) next.style = mergeStyle(item.style, p.style);
      if (p.content) next.content = { ...item.content, ...p.content };
      return { domain: withItem(d, next), exact: true };
    }
    case "item.delete": {
      const item = d.items.get(op.id);
      if (!item) return { domain: d, exact: true };
      if (item.kind === "EVIDENCE") return { domain: d, exact: false };
      return { domain: removeItem(d, item), exact: true };
    }
    case "item.restore": {
      if (d.items.has(op.id)) return { domain: d, exact: true };
      const buried = d.graveyard.items.get(op.id);
      if (!buried) return { domain: d, exact: false };
      return { domain: reviveItem(d, buried), exact: buried.kind !== "EVIDENCE" };
    }
    case "link.create": {
      if (d.links.has(op.id)) return { domain: d, exact: true };
      const buried = d.graveyard.links.get(op.id);
      if (buried) {
        const links = new Map(d.graveyard.links);
        links.delete(op.id);
        return {
          domain: { ...withLink(d, buried), graveyard: { ...d.graveyard, links } },
          exact: true,
        };
      }
      const link: BoardLink = {
        id: op.id,
        sourceItemId: op.source.itemId,
        sourceFindingId: op.source.findingId ?? null,
        targetItemId: op.target.itemId,
        targetFindingId: op.target.findingId ?? null,
        kind: op.kind,
        label: op.label ?? null,
        certainty: op.certainty ?? "CONFIRMED",
        confidence: op.confidence ?? null,
        note: op.note ?? null,
        promotedEdgeId: null,
        createdBy: ctx.actor,
        updatedAt: ctx.now,
      };
      return { domain: withLink(d, link), exact: true };
    }
    case "link.update": {
      const link = d.links.get(op.id);
      if (!link) return { domain: d, exact: false };
      const p = op.patch;
      return {
        domain: withLink(d, {
          ...link,
          ...(p.kind !== undefined ? { kind: p.kind } : {}),
          ...(p.label !== undefined ? { label: p.label } : {}),
          ...(p.certainty !== undefined ? { certainty: p.certainty } : {}),
          ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
          ...(p.note !== undefined ? { note: p.note } : {}),
        }),
        exact: true,
      };
    }
    case "link.delete": {
      const link = d.links.get(op.id);
      if (!link) return { domain: d, exact: true };
      const links = new Map(d.links);
      links.delete(op.id);
      return {
        domain: {
          ...d,
          links,
          graveyard: { ...d.graveyard, links: new Map(d.graveyard.links).set(op.id, link) },
        },
        exact: true,
      };
    }
    case "link.restore": {
      if (d.links.has(op.id)) return { domain: d, exact: true };
      const buried = d.graveyard.links.get(op.id);
      if (!buried) return { domain: d, exact: false };
      const links = new Map(d.graveyard.links);
      links.delete(op.id);
      return {
        domain: { ...withLink(d, buried), graveyard: { ...d.graveyard, links } },
        exact: true,
      };
    }
    case "link.promote": {
      const link = d.links.get(op.id);
      if (!link || link.promotedEdgeId) return { domain: d, exact: false };
      return { domain: withLink(d, { ...link, promotedEdgeId: "pending" }), exact: false };
    }
    case "evidence.add": {
      if (d.items.has(op.itemId)) return { domain: d, exact: true };
      const buried = d.graveyard.items.get(op.itemId);
      if (buried) return { domain: reviveItem(d, buried, op), exact: false };
      const item = newItem(op.itemId, "EVIDENCE", ctx, { x: op.x ?? null, y: op.y ?? null });
      const bubble = placeholderBubble(op.itemId, ctx.previews.get(op.itemId) ?? {});
      return {
        domain: { ...withItem(d, item), bubbles: new Map(d.bubbles).set(op.itemId, bubble) },
        exact: false,
      };
    }
    case "evidence.remove": {
      const item = d.items.get(op.itemId);
      if (!item || item.kind !== "EVIDENCE") return { domain: d, exact: false };
      return { domain: removeItem(d, item), exact: false };
    }
    case "finding.attach":
      return { domain: moveRow(d, op.itemId, op.findingId, "rows"), exact: false };
    case "finding.detach": {
      let next = moveRow(d, op.itemId, op.findingId, "unattached");
      const links = new Map(next.links);
      const buried = new Map(next.graveyard.links);
      for (const link of next.links.values()) {
        const touches =
          (link.sourceItemId === op.itemId && link.sourceFindingId === op.findingId) ||
          (link.targetItemId === op.itemId && link.targetFindingId === op.findingId);
        if (touches) {
          links.delete(link.id);
          buried.set(link.id, link);
        }
      }
      next = { ...next, links, graveyard: { ...next.graveyard, links: buried } };
      return { domain: next, exact: false };
    }
    case "hypothesis.create": {
      if (d.items.has(op.itemId)) return { domain: d, exact: true };
      const buried = d.graveyard.items.get(op.itemId);
      if (buried) return { domain: reviveItem(d, buried, op), exact: false };
      const threadId = `${PENDING_THREAD}${op.itemId}`;
      let next = withItem(
        d,
        newItem(op.itemId, "HYPOTHESIS", ctx, {
          refId: threadId,
          x: op.x ?? null,
          y: op.y ?? null,
        }),
      );
      next = withThread(next, {
        ...placeholderThread(threadId, "HYPOTHESIS", op.title, ctx, op.itemId),
        color: op.color ?? null,
      });
      const supports = new Map(next.supports);
      for (const target of op.supports ?? []) {
        const id = `${PENDING_THREAD}${op.itemId}:${target.itemId}:${target.findingId ?? ""}`;
        supports.set(id, {
          id,
          threadId,
          stance: "SUPPORTS",
          weight: null,
          note: null,
          endpoint: { itemId: target.itemId, findingId: target.findingId ?? null },
          pending: true,
        });
      }
      return { domain: { ...next, supports }, exact: false };
    }
    case "stance.set": {
      const hypothesis = d.items.get(op.hypothesisItemId);
      if (!hypothesis?.refId) return { domain: d, exact: false };
      const threadId = hypothesis.refId;
      const supports = new Map(d.supports);
      let previous: BoardSupport | undefined;
      for (const s of d.supports.values()) {
        if (s.threadId === threadId && sameEndpoint(s.endpoint, op.target)) {
          previous = s;
          supports.delete(s.id);
        }
      }
      const id = previous?.id ?? `${PENDING_THREAD}${op.hypothesisItemId}:${op.target.itemId}:${op.target.findingId ?? ""}`;
      supports.set(id, {
        id,
        threadId,
        stance: op.stance,
        weight: op.weight ?? previous?.weight ?? null,
        note: op.note ?? previous?.note ?? null,
        endpoint: { itemId: op.target.itemId, findingId: op.target.findingId ?? null },
        pending: !previous,
      });
      let next: BoardDomain = { ...d, supports };
      if (op.target.findingId) next = moveRow(next, op.target.itemId, op.target.findingId, "rows");
      return { domain: next, exact: false };
    }
    case "stance.remove": {
      const hypothesis =
        d.items.get(op.hypothesisItemId) ?? d.graveyard.items.get(op.hypothesisItemId);
      if (!hypothesis?.refId) return { domain: d, exact: false };
      const supports = new Map(d.supports);
      for (const s of d.supports.values()) {
        if (s.threadId === hypothesis.refId && sameEndpoint(s.endpoint, op.target)) {
          supports.delete(s.id);
        }
      }
      return { domain: { ...d, supports }, exact: false };
    }
    case "comment.create": {
      if (d.items.has(op.itemId)) return { domain: d, exact: true };
      const buried = d.graveyard.items.get(op.itemId);
      if (buried) return { domain: reviveItem(d, buried), exact: false };
      const threadId = `${PENDING_THREAD}${op.itemId}`;
      let next = withItem(
        d,
        newItem(op.itemId, "COMMENT", ctx, {
          refId: threadId,
          x: op.x ?? null,
          y: op.y ?? null,
          parentId: op.anchor?.itemId ?? null,
          style: op.anchor?.findingId ? { anchorFindingId: op.anchor.findingId } : {},
        }),
      );
      next = withThread(next, placeholderThread(threadId, "DISCUSSION", op.body, ctx, op.itemId));
      return { domain: next, exact: false };
    }
    case "comment.resolve": {
      const item = d.items.get(op.itemId);
      const thread = item?.refId ? d.threads.get(item.refId) : undefined;
      if (!thread) return { domain: d, exact: false };
      return {
        domain: withThread(d, {
          ...thread,
          resolvedAt: op.resolved ? ctx.now : null,
          resolvedBy: op.resolved ? ctx.actor : null,
        }),
        exact: true,
      };
    }
    case "thread.place": {
      const thread = d.threads.get(op.threadId);
      if (!thread) return { domain: d, exact: false };
      const existingId = thread.itemId;
      const live = existingId ? d.items.get(existingId) : undefined;
      if (live) {
        return {
          domain: withItem(d, { ...live, x: op.x ?? live.x, y: op.y ?? live.y }),
          exact: false,
        };
      }
      const buried = existingId ? d.graveyard.items.get(existingId) : undefined;
      if (buried) return { domain: reviveItem(d, buried, op), exact: false };
      const kind = thread.kind === "HYPOTHESIS" ? "HYPOTHESIS" : "COMMENT";
      let next = withItem(
        d,
        newItem(op.itemId, kind, ctx, {
          refId: thread.id,
          x: op.x ?? null,
          y: op.y ?? null,
          parentId: op.anchor?.itemId ?? null,
        }),
      );
      next = withThread(next, { ...thread, itemId: op.itemId, onBoard: true });
      return { domain: next, exact: false };
    }
  }
}

/** Apply a list of ops; `exact` only if every op was. */
export function applyAll(
  d: BoardDomain,
  ops: readonly BoardOp[],
  ctx: LocalContext,
): LocalResult {
  let domain = d;
  let exact = true;
  for (const op of ops) {
    const res = applyLocal(domain, op, ctx);
    domain = res.domain;
    exact = exact && res.exact;
  }
  return { domain, exact };
}

/**
 * Merge consecutive geometry-only updates of one item (a drag storm becomes
 * one op). Text edits carrying `expectedUpdatedAt` are never merged: each is
 * a claim about the version it started from.
 */
export function coalesce(ops: readonly BoardOp[]): BoardOp[] {
  const out: BoardOp[] = [];
  for (const op of ops) {
    const prev = out.at(-1);
    if (
      prev?.type === "item.update" &&
      op.type === "item.update" &&
      prev.id === op.id &&
      !prev.expectedUpdatedAt &&
      !op.expectedUpdatedAt &&
      !prev.patch.style &&
      !op.patch.style &&
      !prev.patch.content &&
      !op.patch.content
    ) {
      out[out.length - 1] = { ...prev, patch: { ...prev.patch, ...op.patch } };
      continue;
    }
    out.push(op);
  }
  return out;
}
