import type {
  BoardItemDto,
  BoardLinkDto,
  CaseBoardResponseDto,
  GraphNodeDto,
  GraphResponseDto,
} from "@workspace/api-client";
import {
  compareRows,
  findingVisualState,
  normalizeSeverity,
  SEVERITY_KEYS,
  SEVERITY_ORDER,
} from "./finding-state";
import type {
  BoardDomain,
  BoardItem,
  BoardItemStyle,
  BoardLink,
  Bubble,
  BubbleRow,
  ItemKind,
  ItemPreview,
  SeverityKey,
  SystemEdge,
} from "./types";

export const nodeKey = (type: string, id: string) => `${type}:${id}`;

/** Relation classes that are drawn. Containment is what a bubble *is*. */
const HIDDEN_CLASSES = new Set(["CONTAINMENT"]);

export function emptyDomain(): BoardDomain {
  return {
    items: new Map(),
    links: new Map(),
    bubbles: new Map(),
    threads: new Map(),
    supports: new Map(),
    systemEdges: new Map(),
    suggested: new Map(),
    itemByAsset: new Map(),
    itemByFinding: new Map(),
    graveyard: { items: new Map(), links: new Map() },
    truncated: false,
  };
}

export function toBoardItem(dto: BoardItemDto): BoardItem {
  const style = (dto.style ?? {}) as BoardItemStyle;
  const content = (dto.content ?? {}) as BoardItem["content"];
  return {
    id: dto.id,
    kind: dto.kind as ItemKind,
    refId: dto.refId ?? null,
    x: dto.x ?? null,
    y: dto.y ?? null,
    width: dto.width ?? null,
    height: dto.height ?? null,
    z: dto.z,
    parentId: dto.parentId ?? null,
    collapsed: dto.collapsed,
    style,
    content,
    createdBy: dto.createdBy ?? null,
    updatedBy: dto.updatedBy ?? null,
    updatedAt: iso(dto.updatedAt),
  };
}

export function toBoardLink(dto: BoardLinkDto): BoardLink {
  return {
    id: dto.id,
    sourceItemId: dto.sourceItemId,
    sourceFindingId: dto.sourceFindingId ?? null,
    targetItemId: dto.targetItemId,
    targetFindingId: dto.targetFindingId ?? null,
    kind: dto.kind,
    label: dto.label ?? null,
    certainty: dto.certainty,
    confidence: dto.confidence ?? null,
    note: dto.note ?? null,
    promotedEdgeId: dto.promotedEdgeId ?? null,
    createdBy: dto.createdBy ?? null,
    updatedAt: iso(dto.updatedAt),
  };
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function emptyCounts(): Record<SeverityKey, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/** Recompute a bubble's tally, NEW count and maximum severity from its rows. */
export function tallyBubble(bubble: Bubble): Bubble {
  const severityCounts = emptyCounts();
  let newCount = 0;
  let maxSeverity: SeverityKey | null = null;
  for (const row of bubble.rows) {
    if (row.severity) {
      severityCounts[row.severity] += 1;
      if (!maxSeverity || SEVERITY_ORDER[row.severity] < SEVERITY_ORDER[maxSeverity]) {
        maxSeverity = row.severity;
      }
    }
    if (row.state === "new") newCount += 1;
  }
  return {
    ...bubble,
    rows: [...bubble.rows].sort(compareRows),
    unattached: [...bubble.unattached].sort(compareRows),
    severityCounts,
    newCount,
    maxSeverity,
  };
}

function rowFromNode(
  findingId: string,
  node: GraphNodeDto | undefined,
  snapshot: {
    caseFindingId: string | null;
    label?: string | null;
    severity?: string | null;
    detectorType?: string | null;
    customDetectorName?: string | null;
    matchedContent?: string | null;
    note?: string | null;
  },
): BubbleRow {
  const matchState =
    node?.matchState === "NEW" || node?.matchState === "GONE" ? node.matchState : null;
  const status = node?.status ?? null;
  const missing = node?.missing === true;
  return {
    findingId,
    caseFindingId: snapshot.caseFindingId,
    typeLabel: snapshot.label ?? node?.label ?? "finding",
    value: snapshot.matchedContent ?? node?.matchedContent ?? null,
    severity: normalizeSeverity(node?.severity ?? snapshot.severity),
    detector:
      snapshot.customDetectorName ??
      node?.customDetectorName ??
      snapshot.detectorType ??
      node?.detectorType ??
      null,
    status,
    matchState,
    missing,
    state: findingVisualState({ missing, matchState, status }),
    note: snapshot.note ?? null,
  };
}

/**
 * Pure: board response → client domain. The response's `graph` is the live
 * layer (NEW/GONE, live status, deleted rows); `evidence` carries the case's
 * own snapshots, which survive deletion of the underlying rows.
 */
export function buildDomain(
  res: CaseBoardResponseDto | null,
  previews: ReadonlyMap<string, ItemPreview> = new Map(),
): BoardDomain {
  const d = emptyDomain();
  if (!res) return d;

  for (const dto of res.items) d.items.set(dto.id, toBoardItem(dto));
  for (const dto of res.links) d.links.set(dto.id, toBoardLink(dto));

  const nodes = new Map<string, GraphNodeDto>();
  for (const n of res.graph.nodes) nodes.set(nodeKey(n.type, n.id), n);
  d.truncated = res.graph.truncated;

  const evidenceById = new Map(res.evidence.map((e) => [e.id, e]));
  for (const item of d.items.values()) {
    if (item.kind !== "EVIDENCE" || !item.refId) continue;
    const ev = evidenceById.get(item.refId);
    if (!ev) {
      const preview = previews.get(item.id);
      if (preview) d.bubbles.set(item.id, placeholderBubble(item.id, preview));
      continue;
    }
    const assetNode = nodes.get(nodeKey(ev.entityType, ev.entityId));
    const attached = new Set<string>();
    const rows: BubbleRow[] = [];
    for (const cf of ev.findings ?? []) {
      attached.add(cf.findingId);
      rows.push(
        rowFromNode(cf.findingId, nodes.get(nodeKey("finding", cf.findingId)), {
          caseFindingId: cf.id,
          label: cf.findingLabel,
          severity: cf.severity,
          detectorType: cf.detectorType,
          customDetectorName: cf.customDetectorName,
          matchedContent: cf.matchedContent,
          note: cf.note,
        }),
      );
    }
    const unattached: BubbleRow[] = [];
    for (const n of res.graph.nodes) {
      if (n.type !== "finding" || n.assetId !== ev.entityId) continue;
      if (attached.has(n.id) || n.missing) continue;
      unattached.push(
        rowFromNode(n.id, n, {
          caseFindingId: null,
          label: labelOfFindingNode(n),
          severity: n.severity,
          detectorType: n.detectorType,
          customDetectorName: n.customDetectorName,
          matchedContent: n.matchedContent,
        }),
      );
    }
    const bubble = tallyBubble({
      itemId: item.id,
      evidenceId: ev.id,
      assetId: ev.entityId,
      label: ev.entity?.label ?? assetNode?.label ?? ev.entityId,
      assetType: ev.entity?.assetType ?? assetNode?.assetType ?? null,
      sourceType: ev.entity?.sourceType ?? assetNode?.sourceType ?? null,
      sourceName: assetNode?.sourceName ?? null,
      missing: assetNode?.missing === true,
      rows,
      unattached,
      severityCounts: emptyCounts(),
      newCount: 0,
      maxSeverity: null,
    });
    d.bubbles.set(item.id, bubble);
    d.itemByAsset.set(ev.entityId, item.id);
    for (const row of bubble.rows) d.itemByFinding.set(row.findingId, item.id);
    for (const row of bubble.unattached) d.itemByFinding.set(row.findingId, item.id);
  }

  for (const t of res.threads) {
    d.threads.set(t.id, {
      id: t.id,
      kind: t.kind === "DISCUSSION" ? "DISCUSSION" : "HYPOTHESIS",
      title: t.title,
      status: t.status ?? null,
      confidence: t.confidence ?? null,
      color: t.color ?? null,
      createdBy: t.createdBy ?? null,
      entryCount: t.entryCount,
      lastEntryAt: t.lastEntryAt ? iso(t.lastEntryAt) : null,
      lastAuthor: t.lastAuthor ?? null,
      lastExcerpt: t.lastExcerpt ?? null,
      supportingCount: t.supportingCount,
      contradictingCount: t.contradictingCount,
      neutralCount: t.neutralCount,
      resolvedAt: t.resolvedAt ? iso(t.resolvedAt) : null,
      resolvedBy: t.resolvedBy ?? null,
      itemId: t.itemId ?? null,
      onBoard: t.onBoard,
    });
  }
  for (const s of res.supports) {
    d.supports.set(s.id, {
      id: s.id,
      threadId: s.threadId,
      stance: s.stance,
      weight: s.weight ?? null,
      note: s.note ?? null,
      endpoint: s.endpoint
        ? { itemId: s.endpoint.itemId, findingId: s.endpoint.findingId ?? null }
        : null,
    });
  }

  for (const e of res.graph.edges) {
    const relationClass = e.relationClass ?? "REFERENCE";
    if (HIDDEN_CLASSES.has(relationClass) || e.relationType === "CONTAINS") continue;
    const edge: SystemEdge = {
      id: e.id,
      from: nodeKey(e.fromType, e.fromId),
      to: nodeKey(e.toType, e.toId),
      relationType: e.relationType,
      relationClass,
      origin: e.origin,
      confidence: e.confidence,
      method: e.method ?? null,
    };
    d.systemEdges.set(e.id, edge);
  }

  // Suggested ghosts: live assets one hop from the evidence that are not on
  // the board themselves. Never persisted until someone pins one.
  for (const edge of d.systemEdges.values()) {
    for (const [near, far] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      const owner = ownerItem(d, near);
      if (!owner || !far.startsWith("asset:")) continue;
      const assetId = far.slice("asset:".length);
      if (d.itemByAsset.has(assetId)) continue;
      const node = nodes.get(far);
      if (!node || node.missing) continue;
      const key = `sg:${assetId}`;
      const existing = d.suggested.get(key);
      if (existing) {
        if (!existing.neighbourOf.includes(owner)) existing.neighbourOf.push(owner);
        continue;
      }
      d.suggested.set(key, {
        key,
        assetId,
        label: node.label,
        assetType: node.assetType ?? null,
        sourceType: node.sourceType ?? null,
        sourceName: node.sourceName ?? null,
        neighbourOf: [owner],
      });
    }
  }
  return d;
}

/** The evidence item a graph node belongs to (the asset's bubble, or a finding's). */
export function ownerItem(d: BoardDomain, key: string): string | null {
  if (key.startsWith("asset:")) return d.itemByAsset.get(key.slice(6)) ?? null;
  if (key.startsWith("finding:")) return d.itemByFinding.get(key.slice(8)) ?? null;
  return null;
}

function labelOfFindingNode(n: GraphNodeDto): string {
  // Graph labels are "TYPE: value…"; the row shows type and value separately.
  const idx = n.label.indexOf(": ");
  return idx > 0 ? n.label.slice(0, idx) : n.label;
}

export function placeholderBubble(itemId: string, preview: ItemPreview): Bubble {
  return {
    itemId,
    evidenceId: "",
    assetId: "",
    label: preview.label ?? "…",
    assetType: preview.assetType ?? null,
    sourceType: preview.sourceType ?? null,
    sourceName: null,
    missing: false,
    rows: [],
    unattached: [],
    severityCounts: emptyCounts(),
    newCount: 0,
    maxSeverity: null,
    pending: true,
  };
}

/**
 * Add one bubble's live neighbourhood (POST /board/neighbours) as system
 * edges and suggested ghosts. Pure; the store re-applies it after refetches.
 */
export function mergeNeighbourGraph(
  d: BoardDomain,
  itemId: string,
  graph: GraphResponseDto,
): BoardDomain {
  const nodes = new Map(graph.nodes.map((n) => [nodeKey(n.type, n.id), n]));
  const systemEdges = new Map(d.systemEdges);
  const suggested = new Map(d.suggested);
  for (const e of graph.edges) {
    const relationClass = e.relationClass ?? "REFERENCE";
    if (HIDDEN_CLASSES.has(relationClass) || e.relationType === "CONTAINS") continue;
    const from = nodeKey(e.fromType, e.fromId);
    const to = nodeKey(e.toType, e.toId);
    if (!systemEdges.has(e.id)) {
      systemEdges.set(e.id, {
        id: e.id,
        from,
        to,
        relationType: e.relationType,
        relationClass,
        origin: e.origin,
        confidence: e.confidence,
        method: e.method ?? null,
      });
    }
    for (const key of [from, to]) {
      if (!key.startsWith("asset:")) continue;
      const assetId = key.slice(6);
      if (d.itemByAsset.has(assetId)) continue;
      const node = nodes.get(key);
      if (!node || node.missing) continue;
      const sgKey = `sg:${assetId}`;
      const existing = suggested.get(sgKey);
      if (existing) {
        if (!existing.neighbourOf.includes(itemId)) {
          suggested.set(sgKey, { ...existing, neighbourOf: [...existing.neighbourOf, itemId] });
        }
        continue;
      }
      suggested.set(sgKey, {
        key: sgKey,
        assetId,
        label: node.label,
        assetType: node.assetType ?? null,
        sourceType: node.sourceType ?? null,
        sourceName: node.sourceName ?? null,
        neighbourOf: [itemId],
      });
    }
  }
  return { ...d, systemEdges, suggested };
}

export const ALL_SEVERITIES = SEVERITY_KEYS;
