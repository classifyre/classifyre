"use client";

import * as React from "react";
import { ExternalLink, FolderPlus, Layers } from "lucide-react";
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
  targetAssetIds,
  onClearFocus,
  onUseInCase,
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
  targetAssetIds: string[];
  onClearFocus: () => void;
  onUseInCase: () => void;
}) {
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
          onClick={onUseInCase}
        >
          <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
          {t("correlation.fingerprints.useInCase")}
        </Button>
        <Button size="sm" variant="ghost" className="w-full" onClick={onClearFocus}>
          {t("correlation.fingerprints.clearFocus")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Nothing selected" content: cluster hotspots, whole-graph case actions and
 * the colour legend. Shown as a persistent footer under whichever workspace
 * panel (Connections / Near-duplicates / Tune) is active, so the graph's
 * visual language stays explained without needing a dedicated tab.
 */
export function FingerprintsGraphOverviewFooter({
  clustered,
  focusCluster,
  hoverKey,
  onHoverKey,
  visibleAssetIds,
  unconnectedCount,
  valueCount,
  onUseInCase,
}: {
  clustered: ClusteredGraph;
  focusCluster: (meta: ClusterMeta) => void;
  hoverKey: string | null;
  onHoverKey: (key: string | null) => void;
  visibleAssetIds: string[];
  unconnectedCount: number;
  valueCount: number;
  onUseInCase: () => void;
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
          onClick={onUseInCase}
        >
          <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
          {t("correlation.fingerprints.useInCase")}
        </Button>
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
