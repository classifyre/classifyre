"use client";

import * as React from "react";
import { Database, ExternalLink, Layers } from "lucide-react";
import type { GraphNodeDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  ClusterDetailPanel,
  ClusterOverviewPanel,
} from "./graph-explorer/cluster-panels";
import { isClusterNode } from "./graph-explorer/use-clustered-graph";
import type {
  ClusterMeta,
  ClusteredGraph,
} from "./graph-explorer/use-clustered-graph";
import {
  STRENGTH_GRADIENT,
  type GraphSelection,
} from "./graph-explorer/graph-types";
import type { BundleDetail } from "./fingerprints-graph";
import { useDetailLink } from "@/hooks/use-detail-link";
import { useSourceTypeLabel } from "@/hooks/use-source-type-label";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Selection-detail content for the fingerprints graph: what's shown when a
 * node/edge/bundle is clicked. Pure, props-driven so it can be rendered
 * either inline (standalone embeds of FingerprintsGraph) or lifted into the
 * page-level workspace sidebar (the main Fingerprints page).
 */
export function FingerprintsGraphSelectionRail({
  selection,
  selectedNode,
  selectedDetail,
  clustered,
  rawNodeByKey,
  hoverKey,
  onHoverKey,
  focusCluster,
  assetLabel,
}: {
  selection: GraphSelection;
  selectedNode: GraphNodeDto | null;
  selectedDetail: BundleDetail | null;
  clustered: ClusteredGraph;
  rawNodeByKey: (key: string) => GraphNodeDto | undefined;
  hoverKey: string | null;
  onHoverKey: (key: string | null) => void;
  focusCluster: (meta: ClusterMeta) => void;
  assetLabel: (id: string) => string;
}) {
  const detailLink = useDetailLink();
  const sourceTypeLabel = useSourceTypeLabel();
  const { t } = useTranslation();
  if (!selection) return null;

  return (
    <div className="space-y-4">
      {selectedDetail ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">
              {t("correlation.fingerprints.bundleTitle", {
                count: String(selectedDetail.values.length),
              })}
            </Badge>
            {selectedDetail.matchPercent != null && (
              <Badge className="text-[10px]">
                {t("correlation.fingerprints.matchPercent", {
                  count: String(selectedDetail.matchPercent),
                })}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("correlation.fingerprints.bundleBetween")}
          </p>
          <div className="flex flex-wrap gap-1">
            {selectedDetail.assetIds.map((id) => (
              <a
                key={id}
                {...detailLink(`/assets/${id}`)}
                title={t("graphExplorer.openDocument")}
              >
                <Badge
                  variant="secondary"
                  className="max-w-[220px] truncate transition-colors hover:bg-foreground hover:text-background"
                >
                  {assetLabel(id)}
                </Badge>
              </a>
            ))}
          </div>
          <div className="space-y-1 border-t border-border/60 pt-2">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {t("graphExplorer.sharedValues")}
            </p>
            {/* Every shared value is a finding; the row links to its page. */}
            <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto">
              {selectedDetail.values.map((v, i) => (
                <li key={`${v.id}-${i}`}>
                  <a
                    {...detailLink(`/findings/${v.id}`)}
                    className="group flex items-center gap-2 rounded-[3px] px-1.5 py-1 text-xs transition-colors hover:bg-muted"
                    title={`${v.value} — ${t("graphExplorer.openFinding")}`}
                  >
                    <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                      {v.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono underline-offset-2 group-hover:underline">
                      {v.value}
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : selectedNode && isClusterNode(selectedNode) ? (
        <ClusterDetailPanel
          meta={selectedNode.cluster}
          clusters={clustered.clusters}
          renderEdges={clustered.renderEdges}
          nodeByKey={rawNodeByKey}
          onFocusCluster={focusCluster}
          hoverKey={hoverKey}
          onHoverKey={onHoverKey}
        />
      ) : selectedNode && selectedNode.type === "asset" ? (
        <div className="space-y-3">
          <Badge variant="outline" className="text-[10px] uppercase">
            {t("correlation.fingerprints.asset")}
          </Badge>
          <p className="break-words font-mono text-sm font-semibold">
            {selectedNode.label}
          </p>
          {/* Which source this document came from, by its real name. */}
          {selectedNode.sourceName && (
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {[selectedNode.sourceName, sourceTypeLabel(selectedNode.sourceType)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <Button size="sm" variant="outline" asChild className="w-full">
            <a {...detailLink(`/assets/${selectedNode.id}`)}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t("correlation.fingerprints.openAsset")}
            </a>
          </Button>
          {selectedNode.sourceId && (
            <Button size="sm" variant="outline" asChild className="w-full">
              <a {...detailLink(`/sources/${selectedNode.sourceId}`)}>
                <Database className="mr-1.5 h-3.5 w-3.5" />
                {t("graphExplorer.openSource")}
              </a>
            </Button>
          )}
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
          {/* Bundle stand-ins carry no finding row of their own. */}
          {selectedNode.detectorType !== "BUNDLE" && (
            <Button size="sm" variant="outline" asChild className="w-full">
              <a {...detailLink(`/findings/${selectedNode.id}`)}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                {t("graphExplorer.openFinding")}
              </a>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Nothing selected" content: cluster hotspots and the colour legend. Case
 * actions live on the graph toolbar ("Use focused/visible in case") — one
 * clear path instead of parallel rail buttons.
 */
export function FingerprintsGraphOverviewFooter({
  clustered,
  focusCluster,
  hoverKey,
  onHoverKey,
  visibleAssetIds,
  unconnectedCount,
  valueCount,
}: {
  clustered: ClusteredGraph;
  focusCluster: (meta: ClusterMeta) => void;
  hoverKey: string | null;
  onHoverKey: (key: string | null) => void;
  visibleAssetIds: string[];
  unconnectedCount: number;
  valueCount: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {clustered.hasCollapsedClusters && (
        <ClusterOverviewPanel
          clusters={clustered.clusters}
          onFocusCluster={focusCluster}
          hoverKey={hoverKey}
          onHoverKey={onHoverKey}
        />
      )}
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          {t("correlation.fingerprints.focusHelp")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("correlation.fingerprints.excludeHelp")}
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
        </ul>
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{t("correlation.fingerprints.strengthWeak")}</span>
            <span>{t("correlation.fingerprints.strengthStrong")}</span>
          </div>
          <div
            className="h-2 w-full rounded-full"
            style={{ background: STRENGTH_GRADIENT }}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("correlation.fingerprints.strengthHint")}
          </p>
        </div>
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
  );
}
