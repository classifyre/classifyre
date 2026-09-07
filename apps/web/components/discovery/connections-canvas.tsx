"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Maximize2, RotateCw } from "lucide-react";
import {
  api,
  type ConstellationLinkDto,
  type ConstellationResponseDto,
  type FindingsDiscoveryTopAssetDto,
  type GraphEdgeDto,
  type GraphNodeDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { GraphCanvas } from "@/components/graph-explorer/graph-canvas";
import { useForceLayout } from "@/components/graph-explorer/use-force-layout";
import { usePanZoom } from "@/components/graph-explorer/use-pan-zoom";
import { useContainerSize } from "@/components/graph-explorer/use-container-size";
import { fanPositions, nodesBBox } from "@/components/graph-explorer/graph-utils";
import {
  isClusterNode,
  type ClusterMeta,
  type ClusterNode,
  type MetaEdge,
} from "@/components/graph-explorer/use-clustered-graph";
import {
  EDGE_CLASS_STYLE,
  keyOf,
  nodeKey,
  type GraphSelection,
} from "@/components/graph-explorer/graph-types";
import { PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { ConnectionsRail } from "./connections-rail";

const SELECT_MODE = { kind: "select" } as const;

/**
 * The five edge classes, in the order they answer questions about a corpus:
 * where did this come from, what is it part of, what is it the same as, what
 * mentions it, who touched it.
 */
export const CLASS_ORDER = [
  "FLOW",
  "CONTAINMENT",
  "IDENTITY",
  "REFERENCE",
  "USAGE",
] as const;
export type ClassName = (typeof CLASS_ORDER)[number];

/**
 * Class name → the field carrying its count.
 *
 * The DTO uses lowercase field names because the OpenAPI generator lower-cases
 * only a property's first letter, which turns `FLOW` into `fLOW`.
 */
export const CLASS_FIELD: Record<
  ClassName,
  keyof ConstellationLinkDto["byClass"]
> = {
  FLOW: "flow",
  CONTAINMENT: "containment",
  IDENTITY: "identity",
  REFERENCE: "reference",
  USAGE: "usage",
};

const CLASS_LABEL_KEY: Record<ClassName, TranslationKey> = {
  FLOW: "connections.class.FLOW" as TranslationKey,
  CONTAINMENT: "connections.class.CONTAINMENT" as TranslationKey,
  IDENTITY: "connections.class.IDENTITY" as TranslationKey,
  REFERENCE: "connections.class.REFERENCE" as TranslationKey,
  USAGE: "connections.class.USAGE" as TranslationKey,
};

/** The class carrying the most edges on a link — what colours the line. */
function dominantClass(link: ConstellationLinkDto, active: Set<ClassName>): ClassName | null {
  let best: ClassName | null = null;
  let bestCount = 0;
  for (const cls of CLASS_ORDER) {
    if (!active.has(cls)) continue;
    const count = link.byClass[CLASS_FIELD[cls]] ?? 0;
    if (count > bestCount) {
      best = cls;
      bestCount = count;
    }
  }
  return best;
}

function activeTotal(link: ConstellationLinkDto, active: Set<ClassName>): number {
  return CLASS_ORDER.reduce(
    (sum, cls) => (active.has(cls) ? sum + (link.byClass[CLASS_FIELD[cls]] ?? 0) : sum),
    0,
  );
}

/**
 * A source bubble.
 *
 * The canvas already knows how to draw one of these: `ClusterNode` is a
 * `GraphNodeDto` with `type: "cluster"` and a `ClusterMeta`, and GraphCanvas
 * sizes it by member count, rings it with the severity mix, and keeps its label
 * legible at every zoom. The only difference from the Louvain path is who did
 * the clustering — here the server did, by source, so the client never receives
 * the assets it would have grouped.
 */
function sourceBubble(
  source: ConstellationResponseDto["sources"][number],
  label: string,
): ClusterNode {
  const meta: ClusterMeta = {
    id: source.id,
    memberKeys: [],
    size: source.connectedAssetCount,
    assetCount: source.connectedAssetCount,
    findingCount: source.findingCount,
    severityCounts: {
      CRITICAL: source.severityCounts.critical,
      HIGH: source.severityCounts.high,
      MEDIUM: source.severityCounts.medium,
      LOW: source.severityCounts.low,
      INFO: source.severityCounts.info,
    },
    topSeverity:
      source.severityCounts.critical > 0
        ? "CRITICAL"
        : source.severityCounts.high > 0
          ? "HIGH"
          : source.severityCounts.medium > 0
            ? "MEDIUM"
            : source.severityCounts.low > 0
              ? "LOW"
              : "INFO",
    sources: [{ id: source.id, name: source.name, type: source.type, assetCount: source.assetCount }],
    dominantSourceType: source.type,
    label,
  };
  return {
    id: source.id,
    type: "cluster",
    label,
    depth: 0,
    sourceId: source.id,
    sourceType: source.type,
    cluster: meta,
  } as ClusterNode;
}

export function ConnectionsCanvas({
  topAssets,
}: {
  /**
   * The assets carrying the most findings. Rendered in the rail rather than in
   * a card of its own — the map answers "where is the material" spatially, and
   * this is the same question as a list.
   */
  topAssets?: FindingsDiscoveryTopAssetDto[];
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const [map, setMap] = React.useState<ConstellationResponseDto | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [activeClasses, setActiveClasses] = React.useState<Set<ClassName>>(
    () => new Set(CLASS_ORDER),
  );
  const [expanded, setExpanded] = React.useState<
    Map<string, { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }>
  >(new Map());
  const [expanding, setExpanding] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<GraphSelection>(null);
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef, { width: 900, height: 460 });
  const seedOverrides = React.useRef(new Map<string, { x: number; y: number }>());

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await api.graph.graphControllerConstellationMap();
        if (!cancelled) setMap(response);
      } catch (err) {
        console.error("Failed to load the connection map:", err);
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const sourceById = React.useMemo(
    () => new Map((map?.sources ?? []).map((s) => [s.id, s])),
    [map],
  );

  // ── Build what the canvas draws ─────────────────────────────────────────
  const { nodes, edges } = React.useMemo(() => {
    if (!map) return { nodes: [] as GraphNodeDto[], edges: [] as GraphEdgeDto[] };

    const nodes: GraphNodeDto[] = [];
    const edges: GraphEdgeDto[] = [];

    for (const source of map.sources) {
      const open = expanded.get(source.id);
      if (open) {
        nodes.push(...open.nodes);
        edges.push(...open.edges);
        continue;
      }
      // A source with nothing in it at all would be a bubble labelled zero;
      // still drawn, because "this source has produced nothing" is worth seeing.
      nodes.push(sourceBubble(source, source.name));
    }

    // Boundary assets sit between the bubbles they join, unless their own source
    // is expanded, in which case the real node is already on the canvas.
    for (const asset of map.boundaryAssets) {
      if (expanded.has(asset.sourceId)) continue;
      const relevant = asset.edges.filter((e) =>
        activeClasses.has(e.relationClass as ClassName),
      );
      if (relevant.length === 0) continue;
      nodes.push({
        id: asset.assetId,
        type: "asset",
        label: asset.assetName,
        depth: 1,
        assetId: asset.assetId,
        assetName: asset.assetName,
        assetType: asset.assetType,
        sourceId: asset.sourceId,
        sourceName: sourceById.get(asset.sourceId)?.name,
      } as GraphNodeDto);

      edges.push({
        id: `tether:${asset.assetId}`,
        fromType: "cluster",
        fromId: asset.sourceId,
        toType: "asset",
        toId: asset.assetId,
        relationType: "belongs_to",
        confidence: 1,
        origin: "INFERRED",
        relationClass: "CONTAINMENT",
      } as GraphEdgeDto);

      for (const edge of relevant) {
        if (!edge.peerSourceId) continue;
        edges.push({
          id: `reach:${asset.assetId}:${edge.peerSourceId}:${edge.relationClass}`,
          fromType: "asset",
          fromId: asset.assetId,
          toType: expanded.has(edge.peerSourceId) ? "asset" : "cluster",
          toId: edge.peerSourceId,
          relationType: edge.relationClass,
          confidence: 1,
          origin: "SOURCE_DERIVED",
          relationClass: edge.relationClass,
        } as GraphEdgeDto);
      }
    }

    // Bundles: a pairing carrying too many boundary assets to draw one by one.
    for (const bundle of map.bundles) {
      if (!bundle.sourceBId) continue;
      const meta: ClusterMeta = {
        id: bundle.id,
        memberKeys: [],
        size: bundle.assetCount,
        assetCount: bundle.assetCount,
        findingCount: 0,
        severityCounts: {},
        sources: [],
        label: t("connections.bundleLabel", { count: bundle.assetCount }),
      };
      nodes.push({
        id: bundle.id,
        type: "cluster",
        label: meta.label,
        depth: 1,
        cluster: meta,
      } as ClusterNode);
      for (const side of [bundle.sourceAId, bundle.sourceBId]) {
        edges.push({
          id: `bundle-edge:${bundle.id}:${side}`,
          fromType: "cluster",
          fromId: side,
          toType: "cluster",
          toId: bundle.id,
          relationType: "bundled",
          confidence: 1,
          origin: "INFERRED",
          relationClass: "REFERENCE",
        } as GraphEdgeDto);
      }
    }

    // One line per source pairing, thickness by edge count.
    for (const link of map.links) {
      const cls = dominantClass(link, activeClasses);
      if (!cls) continue;
      const total = activeTotal(link, activeClasses);
      if (total === 0) continue;
      if (expanded.has(link.sourceAId) || expanded.has(link.sourceBId)) continue;
      const metaEdge: MetaEdge = {
        id: `link:${link.sourceAId}|${link.sourceBId}`,
        fromType: "cluster",
        fromId: link.sourceAId,
        toType: "cluster",
        toId: link.sourceBId,
        relationType: `×${total}`,
        confidence: 1,
        origin: "SOURCE_DERIVED",
        relationClass: cls,
        meta: { linkCount: total, maxConfidence: 1 },
      } as MetaEdge;
      edges.push(metaEdge);
    }

    // Drop edges whose endpoints are not on the canvas — an expanded source
    // replaces its bubble, and a line to a bubble that no longer exists would
    // be drawn at the origin.
    const present = new Set(nodes.map(keyOf));
    return {
      nodes,
      edges: edges.filter(
        (e) =>
          present.has(nodeKey(e.fromType, e.fromId)) &&
          present.has(nodeKey(e.toType, e.toId)),
      ),
    };
  }, [map, expanded, activeClasses, sourceById, t]);

  const panZoom = usePanZoom();
  const layout = useForceLayout(nodes, edges, size, seedOverrides.current);

  const zoomToFit = React.useCallback(() => {
    const bbox = nodesBBox(layout.simNodes.values());
    if (bbox) panZoom.fitBBox(bbox);
  }, [layout.simNodes, panZoom]);

  React.useEffect(() => {
    layout.onSettle(zoomToFit);
  }, [layout, zoomToFit]);

  /**
   * Expand a source into its own assets.
   *
   * Server-driven, so this cannot reuse the Louvain expand in
   * `useClusteredGraph`: the members were never sent. The per-source graph is
   * fetched on demand, which is also what keeps the dashboard's first paint
   * independent of how much any one source contains.
   */
  const expandSource = React.useCallback(
    async (sourceId: string) => {
      if (expanded.has(sourceId)) {
        setExpanded((prev) => {
          const next = new Map(prev);
          next.delete(sourceId);
          return next;
        });
        return;
      }
      setExpanding(sourceId);
      try {
        const graph = await api.correlation.correlationControllerLinksGraph({
          sourceId,
        });
        const center = layout.simNodes.get(nodeKey("cluster", sourceId));
        if (center) {
          const positions = fanPositions(center, graph.nodes.length, 130);
          graph.nodes.forEach((n, i) => {
            const p = positions[i];
            if (p) seedOverrides.current.set(keyOf(n), p);
          });
        }
        setExpanded((prev) => {
          const next = new Map(prev);
          next.set(sourceId, { nodes: graph.nodes, edges: graph.edges });
          return next;
        });
      } catch (err) {
        console.error("Failed to expand source:", err);
      } finally {
        setExpanding(null);
      }
    },
    [expanded, layout.simNodes],
  );

  const selectedNode = React.useMemo(
    () =>
      selection?.type === "node"
        ? (nodes.find((n) => keyOf(n) === selection.key) ?? null)
        : null,
    [selection, nodes],
  );
  const selectedEdge = React.useMemo(
    () =>
      selection?.type === "edge"
        ? (edges.find((e) => e.id === selection.id) ?? null)
        : null,
    [selection, edges],
  );

  const toggleClass = (cls: ClassName) =>
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls) && next.size > 1) next.delete(cls);
      else next.add(cls);
      return next;
    });

  const isBuilding = map?.stats.source === "live";

  return (
    <PanelCard className="flex h-[560px] flex-col overflow-hidden p-0 sm:col-span-2 sm:p-0 xl:col-span-12">
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-black uppercase leading-none tracking-[0.06em] text-foreground">
            {t("connections.title")}
          </h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {map
              ? t("connections.subtitle", {
                  sources: map.totals.sources,
                  connected: map.totals.connectedAssets.toLocaleString(),
                  isolated: map.totals.isolatedAssets.toLocaleString(),
                })
              : t("connections.loading")}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {CLASS_ORDER.map((cls) => {
            const on = activeClasses.has(cls);
            return (
              <button
                key={cls}
                type="button"
                onClick={() => toggleClass(cls)}
                aria-pressed={on}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                  on
                    ? "border-border bg-secondary/40 text-foreground"
                    : "border-border/40 text-muted-foreground/60 hover:text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-[1px]"
                  style={{
                    backgroundColor: on
                      ? EDGE_CLASS_STYLE[cls]?.color
                      : "transparent",
                    border: `1px solid ${EDGE_CLASS_STYLE[cls]?.color}`,
                  }}
                />
                {t(CLASS_LABEL_KEY[cls])}
              </button>
            );
          })}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t("connections.fit")}
            onClick={zoomToFit}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t("connections.reload")}
            onClick={() => setReloadToken((n) => n + 1)}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative min-w-0 flex-1">
          {(isLoading || expanding || isBuilding || error) && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
              <span className="pointer-events-auto flex items-center gap-2 rounded-[4px] border-2 border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                {(isLoading || expanding || isBuilding) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {error
                  ? t("connections.error")
                  : isLoading
                    ? t("connections.loading")
                    : expanding
                      ? t("connections.expanding")
                      : t("connections.building")}
              </span>
            </div>
          )}
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            layout={layout}
            panZoom={panZoom}
            selection={selection}
            mode={SELECT_MODE}
            activeNodeKeys={null}
            path={null}
            hoverKey={hoverKey}
            onNodeHover={(n) => setHoverKey(n ? keyOf(n) : null)}
            onNodeClick={(node) =>
              setSelection({ type: "node", key: keyOf(node) })
            }
            onNodeDoubleClick={(node) => {
              if (isClusterNode(node) && sourceById.has(node.id)) {
                void expandSource(node.id);
              } else if (node.type === "asset" && node.assetId) {
                router.push(`/assets/${node.assetId}`);
              }
            }}
            onNodeContextMenu={(node) => {
              if (isClusterNode(node) && sourceById.has(node.id)) {
                void expandSource(node.id);
              }
            }}
            onEdgeClick={(edge) => setSelection({ type: "edge", id: edge.id })}
            onEdgeContextMenu={() => undefined}
            onBackgroundClick={() => setSelection(null)}
          />
        </div>

        <ConnectionsRail
          map={map}
          topAssets={topAssets}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          expandedSources={expanded}
          activeClasses={activeClasses}
          onExpandSource={(id) => void expandSource(id)}
        />
      </div>
    </PanelCard>
  );
}
