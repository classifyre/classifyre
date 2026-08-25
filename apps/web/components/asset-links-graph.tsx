"use client";

import { useNsPath } from "@/lib/ns-path";
import * as React from "react";
import { ExternalLink, Globe, Link2 } from "lucide-react";
import { api, type GraphEdgeDto, type GraphNodeDto } from "@workspace/api-client";
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
import { useTranslation } from "@/hooks/use-translation";

const EXTERNAL_DECO: NodeDecoration = { ringColor: ACCENT };

/**
 * Relationship graph for a source.
 *
 * Two kinds of edge arrive here. The old kind comes from `Asset.links`, a flat
 * list of hashes that says two assets are connected without saying how — those
 * are drawn as plain references, because that is all they claim. The new kind
 * is what a connector declared: lineage, containment, identity. They are
 * styled apart so the difference is visible, since "orders feeds this table"
 * and "this file was attached to that email" are not the same statement.
 *
 * Assets in other sources are ringed, and so are objects named by URN that no
 * scan has produced yet. Read-only.
 */
export function AssetLinksGraph({ sourceId }: { sourceId: string }) {
  const nsPath = useNsPath();
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showExternal, setShowExternal] = React.useState(true);

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

  const { dNodes, dEdges } = React.useMemo(() => {
    const visible = showExternal ? nodes : nodes.filter((n) => n.status !== "external");
    const ids = new Set(visible.map((n) => n.id));
    return {
      dNodes: visible,
      dEdges: edges.filter((e) => ids.has(e.fromId) && ids.has(e.toId)),
    };
  }, [nodes, edges, showExternal]);

  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto) =>
      n.status === "external" || n.type === "external" ? EXTERNAL_DECO : null,
    [],
  );

  /**
   * Colour and dash by relationship class, and print the flow subtype rather
   * than the stored relation type. `links_to` keeps the recessive reference
   * styling: it is the edge that says the least.
   */
  const edgeStyle = React.useCallback((edge: GraphEdgeDto): EdgeStyleOverride => {
    const style = EDGE_CLASS_STYLE[edgeClassOf(edge)] ?? EDGE_CLASS_STYLE.REFERENCE!;
    return {
      stroke: style.color,
      dash: style.dash,
      width: style.width,
      arrow: style.arrow,
      label: FLOW_SUBTYPE_LABEL[edge.relationType] ?? edge.relationType,
    };
  }, []);

  const showEmpty = !loading && !error && dNodes.length === 0;

  return (
    <GraphExplorer
      nodes={dNodes}
      edges={dEdges}
      truncated={truncated}
      onReload={load}
      focusComponentOnClick
      nodeDecorator={nodeDecorator}
      edgeStyle={edgeStyle}
      header={
        <>
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
        </>
      }
      overlay={
        loading || error || showEmpty ? (
          loading ? (
            <Spinner size="lg" label={t("links.title")} />
          ) : error ? (
            <EmptyState icon={Link2} title={t("links.loadFailed")} description={error} />
          ) : (
            <EmptyState icon={Link2} title={t("links.empty")} description={t("links.emptyDesc")} />
          )
        ) : undefined
      }
      sidebarClassName="w-[240px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3"
      sidebar={({ selectedNode }) =>
        selectedNode ? (
          <div className="space-y-3" key={keyOf(selectedNode)}>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase">
                {t("links.asset")}
              </Badge>
              {selectedNode.status === "external" && (
                <Badge className="text-[10px]">{t("links.externalBadge")}</Badge>
              )}
            </div>
            <p className="break-words font-mono text-sm font-semibold">{selectedNode.label}</p>
            <Button size="sm" variant="outline" asChild className="w-full">
              <a href={nsPath(`/assets/${selectedNode.id}`)} target="_blank" rel="noreferrer">
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
            <ul className="space-y-2 border-t border-border pt-3 text-xs">
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
          </div>
        )
      }
    />
  );
}
