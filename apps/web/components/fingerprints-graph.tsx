"use client";

import * as React from "react";
import {
  ExternalLink,
  Fingerprint,
  FolderPlus,
  Layers,
  Maximize2,
  RotateCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  api,
  type GraphEdgeDto,
  type GraphNodeDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { GraphCanvas } from "./case-graph/graph-canvas";
import { useForceLayout } from "./case-graph/use-force-layout";
import { usePanZoom } from "./case-graph/use-pan-zoom";
import { nodesBBox } from "./case-graph/graph-utils";
import {
  keyOf,
  nodeKey,
  type GraphSelection,
  type PathResult,
} from "./case-graph/graph-types";
import { CorrelationTuningDialog } from "./correlation-tuning-dialog";
import { FingerprintsCaseDialog } from "./fingerprints-case-dialog";
import { useTranslation } from "@/hooks/use-translation";

const EMPTY_MAP: Map<string, number> = new Map();
const EMPTY_SET: Set<string> = new Set();
const SELECT_MODE = { kind: "select" } as const;
/** Collapse a group of shared-value nodes when it exceeds this many. */
const COLLAPSE_THRESHOLD = 5;
const BUNDLE_NODE_PREFIX = "bundle-node:";
const BUNDLE_EDGE_PREFIX = "bundle-edge:";

interface BundleDetail {
  assetIds: string[];
  values: Array<{ label: string; value: string }>;
}

/**
 * The connected component (transitive neighbourhood) of a node — "everything
 * connected to this thing". Clicking any node focuses its component; the rest of
 * the graph dims and goes non-interactive, cutting cross-cluster noise.
 */
function focusComponent(
  startKey: string,
  edges: GraphEdgeDto[],
): PathResult {
  const adj = new Map<string, Array<{ key: string; edgeId: string }>>();
  for (const e of edges) {
    const a = nodeKey(e.fromType, e.fromId);
    const b = nodeKey(e.toType, e.toId);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ key: b, edgeId: e.id });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ key: a, edgeId: e.id });
  }
  const nodeKeys = new Set<string>([startKey]);
  const edgeIds = new Set<string>();
  const queue = [startKey];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const { key, edgeId } of adj.get(cur) ?? []) {
      edgeIds.add(edgeId);
      if (!nodeKeys.has(key)) {
        nodeKeys.add(key);
        queue.push(key);
      }
    }
  }
  return { nodeKeys, edgeIds };
}

/**
 * The correlation ("evidence fingerprints") graph. Reuses the case-graph canvas
 * to render the bipartite Asset ↔ shared-value ↔ Asset structure from
 * GET /correlation/graph. Pure-UI conveniences on top: source/label filtering,
 * a tuning dialog, case actions, and bundling of dense shared-value groups into
 * a single clickable "N shared values" element to cut visual noise.
 */
export function FingerprintsGraph({ assetId }: { assetId?: string }) {
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [sourceFilter, setSourceFilter] = React.useState<string[]>([]);
  const [labelFilter, setLabelFilter] = React.useState<string[]>([]);
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  // Focused component ("path") around the last-clicked node; dims everything else.
  const [path, setPath] = React.useState<PathResult | null>(null);
  const [tuneOpen, setTuneOpen] = React.useState(false);
  const [caseOpen, setCaseOpen] = React.useState(false);

  const clearFocus = React.useCallback(() => {
    setPath(null);
    setSelection(null);
  }, []);

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlation
      .correlationControllerGraph(assetId ? { assetId } : {})
      .then((g) => {
        if (!active) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
        setTruncated(Boolean(g.truncated));
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : t("correlation.fingerprints.loadFailed"),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assetId, t]);

  React.useEffect(() => load(), [load]);

  // ── Filter options ──────────────────────────────────────────────────────────
  const sourceOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "asset" && n.sourceType)
        counts.set(n.sourceType, (counts.get(n.sourceType) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [nodes]);

  const labelOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      if (n.type === "finding" && n.detectorType)
        counts.set(n.detectorType, (counts.get(n.detectorType) ?? 0) + 1);
    });
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [nodes]);

  // ── Filter → collapse → drop isolated assets ────────────────────────────────
  const {
    dNodes,
    dEdges,
    bundleDetails,
    visibleAssetIds,
    unconnectedCount,
    valueCount,
  } = React.useMemo(() => {
    // 1) filter
    const q = search.trim().toLowerCase();
    const srcSet = new Set(sourceFilter);
    const labelSet = new Set(labelFilter);
    const matches = (n: GraphNodeDto) =>
      !q ||
      [n.label, n.detectorType, n.sourceType, n.assetType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    const assetOk = (n: GraphNodeDto) =>
      n.type === "asset" &&
      (srcSet.size === 0 || (n.sourceType && srcSet.has(n.sourceType))) &&
      matches(n);
    const valueOk = (n: GraphNodeDto) =>
      n.type === "finding" &&
      (labelSet.size === 0 || (n.detectorType && labelSet.has(n.detectorType))) &&
      matches(n);

    const passAssets = new Set(nodes.filter(assetOk).map((n) => n.id));
    const passValues = new Set(nodes.filter(valueOk).map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => passAssets.has(e.fromId) && passValues.has(e.toId),
    );
    const valueById = new Map(nodes.filter((n) => n.type === "finding").map((n) => [n.id, n]));
    const assetById = new Map(nodes.filter((n) => n.type === "asset").map((n) => [n.id, n]));

    // 2) collapse: group surviving value nodes by the exact asset-set they bind
    const valueNeighbors = new Map<string, string[]>();
    for (const e of filteredEdges) {
      const arr = valueNeighbors.get(e.toId) ?? [];
      arr.push(e.fromId);
      valueNeighbors.set(e.toId, arr);
    }
    const groups = new Map<string, string[]>(); // assetSetKey → valueIds
    for (const [valueId, neighbors] of valueNeighbors) {
      const key = [...new Set(neighbors)].sort().join("|");
      const arr = groups.get(key) ?? [];
      arr.push(valueId);
      groups.set(key, arr);
    }

    const outNodes: GraphNodeDto[] = [...passAssets].map((id) => assetById.get(id)!);
    const outEdges: GraphEdgeDto[] = [];
    const details = new Map<string, BundleDetail>();

    for (const [key, valueIds] of groups) {
      const assetIds = key ? key.split("|") : [];
      const collapse = valueIds.length > COLLAPSE_THRESHOLD && assetIds.length >= 2;
      if (!collapse) {
        // keep individual value nodes + their edges
        for (const vId of valueIds) {
          const vn = valueById.get(vId);
          if (vn) outNodes.push(vn);
        }
        for (const e of filteredEdges) {
          if (valueIds.includes(e.toId)) outEdges.push(e);
        }
        continue;
      }
      const detail: BundleDetail = {
        assetIds,
        values: valueIds
          .map((vId) => valueById.get(vId))
          .filter((v): v is GraphNodeDto => Boolean(v))
          .map((v) => ({ label: v.detectorType ?? "", value: v.label })),
      };
      const countLabel = t("correlation.fingerprints.sharedValuesN", {
        count: String(valueIds.length),
      });
      if (assetIds.length === 2) {
        // a single special asset↔asset edge (amber via MANUAL origin)
        const id = `${BUNDLE_EDGE_PREFIX}${key}`;
        outEdges.push({
          id,
          fromType: "asset",
          fromId: assetIds[0]!,
          toType: "asset",
          toId: assetIds[1]!,
          relationType: countLabel,
          confidence: 1,
          origin: "MANUAL",
        });
        details.set(id, detail);
      } else {
        // hyper-group (>2 assets): one bundle node linking all of them
        const nodeId = `${BUNDLE_NODE_PREFIX}${key}`;
        outNodes.push({
          id: nodeId,
          type: "finding",
          label: countLabel,
          depth: 1,
          detectorType: "BUNDLE",
        });
        for (const aId of assetIds) {
          outEdges.push({
            id: `${nodeId}->${aId}`,
            fromType: "asset",
            fromId: aId,
            toType: "finding",
            toId: nodeId,
            relationType: "shared",
            confidence: 1,
            origin: "INFERRED",
          });
        }
        details.set(nodeId, detail);
      }
    }

    // 3) drop isolated assets (no incident edge) — surface the count instead
    const connected = new Set<string>();
    for (const e of outEdges) {
      if (e.fromType === "asset") connected.add(e.fromId);
      if (e.toType === "asset") connected.add(e.toId);
    }
    const keptNodes = outNodes.filter(
      (n) => n.type !== "asset" || connected.has(n.id),
    );
    const unconnected = [...passAssets].filter((id) => !connected.has(id)).length;
    const values = keptNodes.filter((n) => n.type === "finding").length;

    return {
      dNodes: keptNodes,
      dEdges: outEdges,
      bundleDetails: details,
      visibleAssetIds: [...connected],
      unconnectedCount: unconnected,
      valueCount: values,
    };
  }, [nodes, edges, search, sourceFilter, labelFilter, t]);

  // ── Layout / viewport ──────────────────────────────────────────────────────
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 900, height: 600 });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) =>
          Math.abs(prev.width - rect.width) > 1 || Math.abs(prev.height - rect.height) > 1
            ? { width: rect.width, height: rect.height }
            : prev,
        );
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useForceLayout(dNodes, dEdges, size);
  const panZoom = usePanZoom();

  const zoomToFit = React.useCallback(() => {
    const bbox = nodesBBox(layout.simNodes.values());
    if (bbox) panZoom.fitBBox(bbox);
  }, [layout.simNodes, panZoom]);

  const didFit = React.useRef(false);
  React.useEffect(() => {
    didFit.current = false;
  }, [assetId]);
  React.useEffect(() => {
    if (didFit.current || dNodes.length === 0) return;
    layout.onSettle(() => {
      didFit.current = true;
      zoomToFit();
    });
  }, [layout, zoomToFit, dNodes.length]);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    dNodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [dNodes]);
  const assetLabel = React.useCallback(
    (id: string) => nodes.find((n) => n.id === id)?.label ?? id,
    [nodes],
  );

  // A change in the underlying/filtered graph invalidates the focused path
  // (its node keys may no longer exist → would dim everything).
  React.useEffect(() => {
    clearFocus();
  }, [nodes, search, sourceFilter, labelFilter, clearFocus]);

  // ── Click = focus this node's component (path); greyed nodes are inert ───────
  const onNodeClick = React.useCallback(
    (node: GraphNodeDto) => {
      const key = keyOf(node);
      if (path && !path.nodeKeys.has(key)) return; // dimmed → non-clickable
      setPath(focusComponent(key, dEdges));
      setSelection({ type: "node", key });
    },
    [path, dEdges],
  );
  const onEdgeClick = React.useCallback(
    (edge: GraphEdgeDto) => {
      if (path && !path.edgeIds.has(edge.id)) return;
      setPath(focusComponent(nodeKey(edge.fromType, edge.fromId), dEdges));
      setSelection({ type: "edge", id: edge.id });
    },
    [path, dEdges],
  );

  // When a path is focused, case actions pull exactly its assets.
  const targetAssetIds = React.useMemo(() => {
    if (!path) return visibleAssetIds;
    const ids: string[] = [];
    for (const key of path.nodeKeys) {
      if (key.startsWith("asset:")) ids.push(key.slice("asset:".length));
    }
    return ids;
  }, [path, visibleAssetIds]);

  const selectedNode =
    selection?.type === "node" ? (nodeIndex.get(selection.key) ?? null) : null;
  const selectedDetail: BundleDetail | null =
    selection?.type === "edge"
      ? (bundleDetails.get(selection.id) ?? null)
      : selectedNode
        ? (bundleDetails.get(selectedNode.id) ?? null)
        : null;

  const showEmpty = !loading && !error && dNodes.length === 0;

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("correlation.fingerprints.search")}
            className="h-8 w-48 pl-7 text-sm"
          />
        </div>

        {sourceOptions.length > 0 && (
          <MultiSelect values={sourceFilter} onValuesChange={setSourceFilter}>
            <MultiSelectTrigger className="h-8 w-40 rounded-[2px] border-2 text-xs">
              <MultiSelectValue
                placeholder={t("correlation.fingerprints.filterSource")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {sourceOptions.map((o) => (
                  <MultiSelectItem key={o.value} value={o.value}>
                    <span className="font-mono text-xs uppercase">{o.value}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
        )}

        {labelOptions.length > 0 && (
          <MultiSelect values={labelFilter} onValuesChange={setLabelFilter}>
            <MultiSelectTrigger className="h-8 w-40 rounded-[2px] border-2 text-xs">
              <MultiSelectValue
                placeholder={t("correlation.fingerprints.filterLabel")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {labelOptions.map((o) => (
                  <MultiSelectItem key={o.value} value={o.value}>
                    <span className="text-xs">{o.value}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">({o.count})</span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
        )}

        {truncated && (
          <Badge variant="outline" className="text-[10px] uppercase">
            {t("correlation.fingerprints.truncated")}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setTuneOpen(true)}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            {t("correlation.fingerprints.tune")}
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomToFit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={load}>
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas is always mounted (so pan/zoom binds); states overlay it. */}
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
          <GraphCanvas
            nodes={dNodes}
            edges={dEdges}
            layout={layout}
            panZoom={panZoom}
            evidenceKeys={EMPTY_SET}
            hypothesisColors={{}}
            attachableCounts={EMPTY_MAP}
            collapsedCounts={EMPTY_MAP}
            selection={selection}
            mode={SELECT_MODE}
            activeNodeKeys={null}
            path={path}
            onNodeClick={onNodeClick}
            onNodeContextMenu={() => undefined}
            onEdgeClick={onEdgeClick}
            onEdgeContextMenu={() => undefined}
            onBackgroundClick={clearFocus}
            onAttachBadgeClick={() => undefined}
            onToggleCollapse={() => undefined}
          />
          {(loading || error || showEmpty) && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
              {loading ? (
                <Spinner size="lg" label={t("correlation.fingerprints.title")} />
              ) : error ? (
                <EmptyState
                  icon={Fingerprint}
                  title={t("correlation.fingerprints.loadFailed")}
                  description={error}
                  action={{ label: t("correlation.fingerprints.retry"), onClick: load }}
                />
              ) : (
                <EmptyState
                  icon={Fingerprint}
                  title={t("correlation.fingerprints.empty")}
                  description={t("correlation.fingerprints.emptyDesc")}
                />
              )}
            </div>
          )}
        </div>

        {/* ── Detail / actions rail ── */}
        <aside className="w-[260px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3">
          {selection ? (
            <div className="space-y-4">
              {selectedDetail ? (
                <div className="space-y-3">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {t("correlation.fingerprints.bundleTitle", {
                      count: String(selectedDetail.values.length),
                    })}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {t("correlation.fingerprints.bundleBetween")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedDetail.assetIds.map((id) => (
                      <a key={id} href={`/assets/${id}`} target="_blank" rel="noreferrer">
                        <Badge variant="secondary" className="max-w-[220px] truncate">
                          {assetLabel(id)}
                        </Badge>
                      </a>
                    ))}
                  </div>
                  <div className="max-h-[40vh] space-y-1 overflow-y-auto border-t border-border/60 pt-2">
                    {selectedDetail.values.map((v, i) => (
                      <div
                        key={`${v.value}-${i}`}
                        className="flex items-center gap-2 rounded-[3px] px-1.5 py-1 text-xs"
                      >
                        <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                          {v.label}
                        </span>
                        <span className="truncate font-mono" title={v.value}>
                          {v.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedNode && selectedNode.type === "asset" ? (
                <div className="space-y-3">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {t("correlation.fingerprints.asset")}
                  </Badge>
                  <p className="break-words font-mono text-sm font-semibold">
                    {selectedNode.label}
                  </p>
                  <Button size="sm" variant="outline" asChild className="w-full">
                    <a href={`/assets/${selectedNode.id}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      {t("correlation.fingerprints.openAsset")}
                    </a>
                  </Button>
                </div>
              ) : selectedNode ? (
                <div className="space-y-3">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {t("correlation.fingerprints.sharedValue")}
                  </Badge>
                  <p className="break-words font-mono text-sm font-semibold">
                    {selectedNode.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("correlation.fingerprints.sharedValueHint")}
                  </p>
                </div>
              ) : null}

              {/* Focused-path actions: pull exactly the connected assets. */}
              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-xs text-muted-foreground">
                  {t("correlation.fingerprints.focusedHint", {
                    count: String(targetAssetIds.length),
                  })}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={targetAssetIds.length === 0}
                  onClick={() => setCaseOpen(true)}
                >
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                  {t("correlation.fingerprints.useInCase")}
                </Button>
                <Button size="sm" variant="ghost" className="w-full" onClick={clearFocus}>
                  {t("correlation.fingerprints.clearFocus")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                  {t("correlation.fingerprints.actions")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("correlation.fingerprints.actionsHint", {
                    count: String(visibleAssetIds.length),
                  })}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={visibleAssetIds.length === 0}
                  onClick={() => setCaseOpen(true)}
                >
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                  {t("correlation.fingerprints.useInCase")}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  {t("correlation.fingerprints.focusHelp")}
                </p>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-3">
                <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                  {t("correlation.fingerprints.legend")}
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full border border-border bg-muted" />
                    {t("correlation.fingerprints.legendAsset", {
                      count: String(visibleAssetIds.length),
                    })}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-foreground/70" />
                    {t("correlation.fingerprints.legendValue", { count: String(valueCount) })}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block h-0.5 w-4 bg-amber-600" />
                    {t("correlation.fingerprints.legendBundle")}
                  </li>
                </ul>
                {unconnectedCount > 0 && (
                  <p className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground">
                    <Layers className="mt-0.5 h-3 w-3 shrink-0" />
                    {t("correlation.fingerprints.unconnected", {
                      count: String(unconnectedCount),
                    })}
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <CorrelationTuningDialog open={tuneOpen} onOpenChange={setTuneOpen} onSaved={load} />
      <FingerprintsCaseDialog
        open={caseOpen}
        onOpenChange={setCaseOpen}
        assetIds={targetAssetIds}
      />
    </div>
  );
}
