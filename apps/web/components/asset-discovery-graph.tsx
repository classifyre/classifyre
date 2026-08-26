"use client";

import { useNsPath } from "@/lib/ns-path";
import * as React from "react";
import { ExternalLink, Globe, Search, Telescope } from "lucide-react";
import {
  api,
  type AssetFindingSummaryDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type RelationTypeDto,
  type SourceResponseDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Spinner } from "@workspace/ui/components/spinner";
import { formatRelative } from "@/lib/date";
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

function toSeverityBadgeValue(
  severity?: string | null,
): "critical" | "high" | "medium" | "low" | "info" {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

/**
 * Every asset in the namespace, connected by their link references and the
 * typed relationships connectors declare (lineage, containment, identity) —
 * the same edge classes {@link AssetLinksGraph} draws for one source, but
 * unscoped. Fetched once per mount and left to the shared graph shell's
 * clustering worker to keep dense corpora navigable; selecting a node lazily
 * pulls its findings summary rather than shipping that with every node up
 * front.
 */
export function AssetDiscoveryGraph() {
  const nsPath = useNsPath();
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showExternal, setShowExternal] = React.useState(true);

  const [sources, setSources] = React.useState<SourceResponseDto[]>([]);
  const [relationTypes, setRelationTypes] = React.useState<RelationTypeDto[]>(
    [],
  );
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [relationFilter, setRelationFilter] = React.useState<string[]>([]);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    api.sources
      .sourcesControllerListSources()
      .then(setSources)
      .catch(() => setSources([]));
    api.graph
      .graphControllerRelationTypes()
      .then((r) => setRelationTypes(r.classified ?? []))
      .catch(() => setRelationTypes([]));
  }, []);

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlation
      .correlationControllerAssetMap()
      .then((g) => {
        if (!active) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
        setTruncated(Boolean(g.truncated));
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : t("assetDiscovery.loadFailed"),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  React.useEffect(() => load(), [load]);

  const externalCount = React.useMemo(
    () => nodes.filter((n) => n.status === "external").length,
    [nodes],
  );

  const { dNodes, dEdges } = React.useMemo(() => {
    const query = search.toLowerCase();
    let visible = showExternal
      ? nodes
      : nodes.filter((n) => n.status !== "external");
    if (sourceIds.length > 0) {
      visible = visible.filter(
        (n) =>
          (n.sourceId && sourceIds.includes(n.sourceId)) ||
          n.status === "external",
      );
    }
    if (query) {
      visible = visible.filter((n) => n.label?.toLowerCase().includes(query));
    }
    const ids = new Set(visible.map((n) => n.id));
    let visibleEdges = edges.filter(
      (e) => ids.has(e.fromId) && ids.has(e.toId),
    );
    if (relationFilter.length > 0) {
      visibleEdges = visibleEdges.filter((e) =>
        relationFilter.includes(e.relationType),
      );
    }
    return { dNodes: visible, dEdges: visibleEdges };
  }, [nodes, edges, showExternal, sourceIds, relationFilter, search]);

  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto) =>
      n.status === "external" || n.type === "external" ? EXTERNAL_DECO : null,
    [],
  );

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
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Telescope className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("assetDiscovery.title")}
          </span>
          <Badge variant="outline" className="text-[10px] font-mono">
            {t("assetDiscovery.assetCount", { count: String(dNodes.length) })}
          </Badge>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("assetDiscovery.searchPlaceholder")}
              className="h-8 w-[180px] rounded-[4px] border-2 border-border pl-7 text-xs"
            />
          </div>

          <MultiSelect values={sourceIds} onValuesChange={setSourceIds}>
            <MultiSelectTrigger className="h-8 w-[160px] rounded-[4px] border-2 border-border text-xs">
              <MultiSelectValue
                placeholder={t("assetDiscovery.allSources")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {sources.map((s) => (
                  <MultiSelectItem key={s.id} value={s.id}>
                    {s.name}
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <MultiSelect values={relationFilter} onValuesChange={setRelationFilter}>
            <MultiSelectTrigger className="h-8 w-[180px] rounded-[4px] border-2 border-border text-xs">
              <MultiSelectValue
                placeholder={t("assetDiscovery.allRelations")}
                overflowBehavior="cutoff"
              />
            </MultiSelectTrigger>
            <MultiSelectContent>
              <MultiSelectGroup>
                {relationTypes.map((r) => (
                  <MultiSelectItem key={r.type} value={r.type}>
                    {FLOW_SUBTYPE_LABEL[r.type] ?? r.type}
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          {externalCount > 0 && (
            <Button
              variant={showExternal ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => setShowExternal((v) => !v)}
            >
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              {t("assetDiscovery.external", { count: String(externalCount) })}
            </Button>
          )}
        </div>
      }
      overlay={
        loading || error || showEmpty ? (
          loading ? (
            <Spinner size="lg" label={t("assetDiscovery.title")} />
          ) : error ? (
            <EmptyState
              icon={Telescope}
              title={t("assetDiscovery.loadFailed")}
              description={error}
            />
          ) : (
            <EmptyState
              icon={Telescope}
              title={t("assetDiscovery.empty")}
              description={t("assetDiscovery.emptyDesc")}
            />
          )
        ) : undefined
      }
      sidebarClassName="w-[260px] shrink-0 space-y-4 overflow-y-auto border-l-2 border-border bg-background p-3"
      sidebar={({ selectedNode }) =>
        selectedNode ? (
          <AssetDiscoverySidebar
            key={keyOf(selectedNode)}
            node={selectedNode}
            nsPath={nsPath}
            t={t}
          />
        ) : (
          <div className="space-y-2">
            <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
              {t("assetDiscovery.legend")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("assetDiscovery.legendHint")}
            </p>
            <ul className="space-y-2 pt-1 text-xs">
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border border-border bg-muted" />
                {t("assetDiscovery.legendAsset")}
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-[#b7ff00] bg-muted" />
                {t("assetDiscovery.legendExternal")}
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

/** Drill-down panel for the selected node: core fields plus a lazily-fetched
 * findings summary, so the graph payload itself never carries per-asset
 * finding counts. */
function AssetDiscoverySidebar({
  node,
  nsPath,
  t,
}: {
  node: GraphNodeDto;
  nsPath: (path: string) => string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [summary, setSummary] = React.useState<AssetFindingSummaryDto | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (node.type !== "asset") {
      setSummary(null);
      return;
    }
    let active = true;
    setLoading(true);
    api.findings
      .findingsControllerListAssetSummaries({ assetId: node.id, limit: 1 })
      .then((res) => {
        if (active) setSummary(res.items?.[0] ?? null);
      })
      .catch(() => {
        if (active) setSummary(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [node.id, node.type]);

  const isExternal = node.status === "external" || node.type === "external";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">
          {node.type === "external"
            ? t("assetDiscovery.unresolved")
            : t("assetDiscovery.asset")}
        </Badge>
        {isExternal && (
          <Badge className="text-[10px]">
            {t("assetDiscovery.externalBadge")}
          </Badge>
        )}
      </div>
      <p className="break-words font-mono text-sm font-semibold">
        {node.label}
      </p>
      {node.sourceName && (
        <p className="text-xs text-muted-foreground">
          {t("assetDiscovery.sourceLabel")}: {node.sourceName}
        </p>
      )}
      {node.assetType && (
        <p className="text-xs text-muted-foreground">
          {t("assetDiscovery.typeLabel")}: {node.assetType}
        </p>
      )}

      {node.type === "asset" &&
        (loading ? (
          <Spinner size="sm" />
        ) : summary ? (
          <div className="space-y-1.5 rounded-[4px] border-2 border-border bg-card px-2.5 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t("assetDiscovery.findingsLabel")}
              </span>
              <span className="font-semibold text-foreground">
                {summary.totalFindings}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t("assetDiscovery.highestSeverity")}
              </span>
              <SeverityBadge severity={toSeverityBadgeValue(summary.highestSeverity)}>
                {summary.highestSeverity}
              </SeverityBadge>
            </div>
            {summary.lastDetectedAt && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {t("assetDiscovery.lastDetected")}
                </span>
                <span>{formatRelative(summary.lastDetectedAt)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("assetDiscovery.noFindings")}
          </p>
        ))}

      {node.type === "asset" && !isExternal && (
        <Button size="sm" variant="outline" asChild className="w-full">
          <a href={nsPath(`/assets/${node.id}`)} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {t("assetDiscovery.openAsset")}
          </a>
        </Button>
      )}
    </div>
  );
}
