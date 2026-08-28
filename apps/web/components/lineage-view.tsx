"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ExternalLink,
  Globe,
  Layers,
  Waypoints,
} from "lucide-react";
import {
  api,
  type GraphEdgeDto,
  type GraphNodeDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Spinner } from "@workspace/ui/components/spinner";
import { GraphExplorer } from "./graph-explorer/graph-explorer";
import {
  ACCENT,
  EDGE_CLASS_STYLE,
  FLOW_SUBTYPE_LABEL,
  edgeClassOf,
  keyOf,
} from "./graph-explorer/graph-types";
import type {
  EdgeStyleOverride,
  NodeDecoration,
} from "./graph-explorer/explorer-types";
import { useNsPath } from "@/lib/ns-path";

/**
 * Everything this asset is connected to: where its data came from, what
 * breaks if it changes, its link references, and any cross-source identity
 * match — the same full picture the namespace-wide asset map and a source's
 * links view draw, scoped to one asset. Containment can still collapse tables
 * into their schemas, and identity nodes can still be merged instead of drawn
 * as an edge, but both are opt-in controls now rather than the default.
 */

type Direction = "up" | "down" | "both";

/** An endpoint naming an object no scan has produced yet. */
const EXTERNAL_DECO: NodeDecoration = { ringColor: ACCENT };

export function LineageView({ assetId }: { assetId: string }) {
  const nsPath = useNsPath();
  const [direction, setDirection] = React.useState<Direction>("both");
  const [collapse, setCollapse] = React.useState(false);
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.graph
      .graphControllerLineage({
        lineageGraphDto: {
          assetId,
          direction,
          depth: 3,
          collapseContainers: collapse,
          // Left off: a cross-source SAME_AS match is exactly what this view
          // exists to surface, and merging would fold it away instead of
          // drawing it as a visible edge.
          mergeIdentity: false,
        },
      })
      .then((g) => {
        if (!active) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
        setTruncated(Boolean(g.truncated));
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load lineage");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assetId, direction, collapse]);

  React.useEffect(() => load(), [load]);

  const externalCount = React.useMemo(
    () => nodes.filter((n) => n.type === "external").length,
    [nodes],
  );

  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto) => (n.type === "external" ? EXTERNAL_DECO : null),
    [],
  );

  /**
   * Style by class, and print the subtype rather than the stored relation type.
   *
   * Parallel edges are bowed apart: two tables can be joined by more than one
   * class at once, and drawn straight they land on top of each other and read
   * as a single relationship.
   */
  const edgeStyle = React.useCallback(
    (edge: GraphEdgeDto): EdgeStyleOverride => {
      const cls = edgeClassOf(edge);
      const style = EDGE_CLASS_STYLE[cls] ?? EDGE_CLASS_STYLE.REFERENCE!;
      const parallel = edges.filter(
        (other) =>
          other.fromId === edge.fromId &&
          other.toId === edge.toId &&
          other.id !== edge.id,
      );
      const index = parallel.length
        ? [edge, ...parallel].sort((a, b) => a.id.localeCompare(b.id)).findIndex((e) => e.id === edge.id)
        : 0;
      return {
        stroke: style.color,
        dash: style.dash,
        width: style.width,
        arrow: style.arrow,
        label: FLOW_SUBTYPE_LABEL[edge.relationType] ?? edge.relationType,
        curvature: index === 0 ? 0 : (index % 2 === 1 ? 0.12 : -0.12) * Math.ceil(index / 2),
      };
    },
    [edges],
  );

  const showEmpty = !loading && !error && nodes.length <= 1;

  return (
    <GraphExplorer
      nodes={nodes}
      edges={edges}
      truncated={truncated}
      onReload={load}
      nodeDecorator={nodeDecorator}
      edgeStyle={edgeStyle}
      header={
        <>
          <Waypoints className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Lineage
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                ["up", "Upstream", ArrowLeftRight],
                ["down", "Downstream", ArrowRight],
                ["both", "Both", Waypoints],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={direction === value ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => setDirection(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            variant={collapse ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setCollapse((v) => !v)}
            title="Roll each table up into whatever contains it"
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Collapse
          </Button>
          {externalCount > 0 && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Globe className="h-3 w-3" />
              {externalCount} not yet scanned
            </Badge>
          )}
        </>
      }
      overlay={
        loading || error || showEmpty ? (
          loading ? (
            <Spinner size="lg" label="Lineage" />
          ) : error ? (
            <EmptyState
              icon={Waypoints}
              title="Could not load lineage"
              description={error}
            />
          ) : (
            <EmptyState
              icon={Waypoints}
              title="No lineage yet"
              description={
                "Nothing connects this asset to anything else yet — no data flow, " +
                "link reference, or cross-source match. This fills in as sources are scanned."
              }
            />
          )
        ) : undefined
      }
      sidebarClassName="w-[260px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3"
      sidebar={({ selectedNode }) =>
        selectedNode ? (
          <div className="space-y-3" key={keyOf(selectedNode)}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase">
                {selectedNode.assetType ?? "asset"}
              </Badge>
              {selectedNode.type === "external" && (
                <Badge className="text-[10px]">Not yet scanned</Badge>
              )}
            </div>
            <p className="break-words font-mono text-sm font-semibold">
              {selectedNode.label}
            </p>
            {selectedNode.sourceName && (
              <p className="text-xs text-muted-foreground">
                in {selectedNode.sourceName}
              </p>
            )}
            {selectedNode.urn && (
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                {selectedNode.urn}
              </p>
            )}
            {selectedNode.type === "external" ? (
              <p className="text-xs text-muted-foreground">
                Another source named this object but nothing has scanned it yet.
                Add a source for it and this node fills itself in.
              </p>
            ) : (
              <Button size="sm" variant="outline" asChild className="w-full">
                <a
                  href={nsPath(`/assets/${selectedNode.id}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open asset
                </a>
              </Button>
            )}
          </div>
        ) : (
          <EdgeClassLegend />
        )
      }
    />
  );
}

/**
 * What the line styles mean.
 *
 * Worth the space because the distinction is the feature: someone looking at
 * this graph needs to know that the solid arrow is the only one answering
 * "what breaks if I change this".
 */
function EdgeClassLegend() {
  return (
    <div className="space-y-2">
      <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
        Legend
      </h3>
      <p className="text-xs text-muted-foreground">
        Arrows follow the data: upstream points at what it feeds.
      </p>
      <ul className="space-y-2 pt-1 text-xs">
        {Object.entries(EDGE_CLASS_STYLE).map(([cls, style]) => (
          <li key={cls} className="flex items-center gap-2">
            <span
              className="inline-block h-0 w-6 shrink-0 border-t-2"
              style={{
                borderColor: style.color,
                borderTopStyle: style.dash ? "dashed" : "solid",
              }}
            />
            {style.label}
          </li>
        ))}
      </ul>
      <p className="pt-1 text-xs text-muted-foreground">
        A ringed node is named by another source but not scanned here yet.
      </p>
    </div>
  );
}
