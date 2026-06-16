"use client";

import * as React from "react";
import { ExternalLink, Globe, Link2, Maximize2, RotateCw } from "lucide-react";
import { api, type GraphEdgeDto, type GraphNodeDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Spinner } from "@workspace/ui/components/spinner";
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
import { useTranslation } from "@/hooks/use-translation";

const EMPTY_MAP: Map<string, number> = new Map();
const SELECT_MODE = { kind: "select" } as const;

function focusComponent(startKey: string, edges: GraphEdgeDto[]): PathResult {
  const adj = new Map<string, Array<{ key: string; edgeId: string }>>();
  for (const e of edges) {
    const a = nodeKey(e.fromType, e.fromId);
    const b = nodeKey(e.toType, e.toId);
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ key: b, edgeId: e.id });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ key: a, edgeId: e.id });
  }
  const nodeKeys = new Set([startKey]);
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
 * Asset-link graph for a source: assets connected by their `links` (hash refs).
 * Reuses the case-graph canvas. Assets in other sources are ringed (external)
 * and can be hidden; lone assets still render. Read-only: pan/zoom/select.
 */
export function AssetLinksGraph({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showExternal, setShowExternal] = React.useState(true);
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  const [path, setPath] = React.useState<PathResult | null>(null);

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlation
      .correlationControllerLinksGraph({ sourceId })
      .then((g) => {
        if (!active) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
        setTruncated(Boolean(g.truncated));
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : t("links.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceId, t]);

  React.useEffect(() => load(), [load]);

  const externalCount = React.useMemo(
    () => nodes.filter((n) => n.status === "external").length,
    [nodes],
  );

  const { dNodes, dEdges, externalKeys } = React.useMemo(() => {
    const visible = showExternal
      ? nodes
      : nodes.filter((n) => n.status !== "external");
    const ids = new Set(visible.map((n) => n.id));
    const fe = edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId));
    const eKeys = new Set(
      visible.filter((n) => n.status === "external").map((n) => keyOf(n)),
    );
    return { dNodes: visible, dEdges: fe, externalKeys: eKeys };
  }, [nodes, edges, showExternal]);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 900, height: 520 });
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
    if (didFit.current || dNodes.length === 0) return;
    layout.onSettle(() => {
      didFit.current = true;
      zoomToFit();
    });
  }, [layout, zoomToFit, dNodes.length]);

  React.useEffect(() => {
    setPath(null);
    setSelection(null);
  }, [nodes, showExternal]);

  const nodeIndex = React.useMemo(() => {
    const m = new Map<string, GraphNodeDto>();
    dNodes.forEach((n) => m.set(keyOf(n), n));
    return m;
  }, [dNodes]);
  const selectedNode =
    selection?.type === "node" ? (nodeIndex.get(selection.key) ?? null) : null;

  const onNodeClick = React.useCallback(
    (node: GraphNodeDto) => {
      const key = keyOf(node);
      if (path && !path.nodeKeys.has(key)) return;
      setPath(focusComponent(key, dEdges));
      setSelection({ type: "node", key });
    },
    [path, dEdges],
  );

  const showEmpty = !loading && !error && dNodes.length === 0;

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-3 py-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("links.title")}
        </span>
        {externalCount > 0 && (
          <Button
            variant={showExternal ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setShowExternal((v) => !v)}
          >
            <Globe className="mr-1.5 h-3.5 w-3.5" />
            {t("links.external", { count: String(externalCount) })}
          </Button>
        )}
        {truncated && (
          <Badge variant="outline" className="text-[10px] uppercase">
            {t("links.truncated")}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={zoomToFit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={load}>
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
          <GraphCanvas
            nodes={dNodes}
            edges={dEdges}
            layout={layout}
            panZoom={panZoom}
            evidenceKeys={externalKeys}
            hypothesisColors={{}}
            attachableCounts={EMPTY_MAP}
            collapsedCounts={EMPTY_MAP}
            selection={selection}
            mode={SELECT_MODE}
            activeNodeKeys={null}
            path={path}
            onNodeClick={onNodeClick}
            onNodeContextMenu={() => undefined}
            onEdgeClick={() => undefined}
            onEdgeContextMenu={() => undefined}
            onBackgroundClick={() => {
              setSelection(null);
              setPath(null);
            }}
            onAttachBadgeClick={() => undefined}
            onToggleCollapse={() => undefined}
          />
          {(loading || error || showEmpty) && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
              {loading ? (
                <Spinner size="lg" label={t("links.title")} />
              ) : error ? (
                <EmptyState icon={Link2} title={t("links.loadFailed")} description={error} />
              ) : (
                <EmptyState
                  icon={Link2}
                  title={t("links.empty")}
                  description={t("links.emptyDesc")}
                />
              )}
            </div>
          )}
        </div>

        <aside className="w-[240px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3">
          {selectedNode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {t("links.asset")}
                </Badge>
                {selectedNode.status === "external" && (
                  <Badge className="text-[10px]">{t("links.externalBadge")}</Badge>
                )}
              </div>
              <p className="break-words font-mono text-sm font-semibold">
                {selectedNode.label}
              </p>
              <Button size="sm" variant="outline" asChild className="w-full">
                <a href={`/assets/${selectedNode.id}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {t("links.openAsset")}
                </a>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                {t("links.legend")}
              </h3>
              <p className="text-xs text-muted-foreground">{t("links.legendHint")}</p>
              <ul className="space-y-2 pt-1 text-xs">
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border border-border bg-muted" />
                  {t("links.legendAsset")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-[#b7ff00] bg-muted" />
                  {t("links.legendExternal")}
                </li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
