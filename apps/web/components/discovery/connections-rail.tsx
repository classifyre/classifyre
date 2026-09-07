"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GitBranch, Copy as CopyIcon } from "lucide-react";
import type {
  ConstellationResponseDto,
  FindingsDiscoveryTopAssetDto,
  GraphEdgeDto,
  GraphNodeDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { EDGE_CLASS_STYLE } from "@/components/graph-explorer/graph-types";
import { isClusterNode } from "@/components/graph-explorer/use-clustered-graph";
import { microLabelClass } from "@/components/panel-card";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { BusiestAssets } from "./busiest-assets";
import { CLASS_FIELD, CLASS_ORDER, type ClassName } from "./connections-canvas";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * The panel beside the map.
 *
 * With nothing selected it is the legend plus the assets carrying the most
 * findings — the ranking that used to have a card of its own titled "where risk
 * clusters". It reads better here: the map is about where material is, and this
 * is the list form of the same question.
 */
export function ConnectionsRail({
  map,
  topAssets,
  selectedNode,
  selectedEdge,
  expandedSources,
  activeClasses,
  onExpandSource,
}: {
  map: ConstellationResponseDto | null;
  topAssets?: FindingsDiscoveryTopAssetDto[];
  selectedNode: GraphNodeDto | null;
  selectedEdge: GraphEdgeDto | null;
  expandedSources: Map<string, unknown>;
  activeClasses: Set<ClassName>;
  onExpandSource: (sourceId: string) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const source =
    selectedNode && isClusterNode(selectedNode)
      ? map?.sources.find((s) => s.id === selectedNode.id)
      : undefined;

  const link =
    selectedEdge?.id.startsWith("link:") && map
      ? map.links.find(
          (l) =>
            `link:${l.sourceAId}|${l.sourceBId}` === selectedEdge.id,
        )
      : undefined;

  const nameOf = (id: string) =>
    map?.sources.find((s) => s.id === id)?.name ?? id;

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-l-2 border-border p-3 lg:flex">
      {source ? (
        <>
          <span className={microLabelClass}>{t("connections.source")}</span>
          <h4 className="mt-1 truncate font-serif text-base font-black text-foreground">
            {source.name}
          </h4>
          <div className="mt-3 space-y-0.5">
            <Row
              label={t("connections.connectedAssets")}
              value={source.connectedAssetCount.toLocaleString()}
            />
            <Row
              label={t("connections.unconnected")}
              value={source.isolatedAssetCount.toLocaleString()}
            />
            <Row
              label={t("connections.internalEdges")}
              value={source.internalEdgeCount.toLocaleString()}
            />
            <Row
              label={t("discovery.findingsLabel")}
              value={source.findingCount.toLocaleString()}
            />
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="rounded-[4px] border-2 font-mono text-[10px] uppercase tracking-[0.1em]"
              onClick={() => onExpandSource(source.id)}
            >
              {expandedSources.has(source.id)
                ? t("connections.collapse")
                : t("connections.expand")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="justify-start rounded-[4px] font-mono text-[10px] uppercase tracking-[0.1em]"
              onClick={() => router.push(nsPath(`/sources/${source.id}`))}
            >
              {t("connections.openSource")} <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </>
      ) : link ? (
        <>
          <span className={microLabelClass}>{t("connections.pairing")}</span>
          <h4 className="mt-1 font-serif text-base font-black leading-tight text-foreground">
            {nameOf(link.sourceAId)} ↔ {nameOf(link.sourceBId)}
          </h4>
          <div className="mt-3 space-y-0.5">
            {CLASS_ORDER.filter((cls) => (link.byClass[CLASS_FIELD[cls]] ?? 0) > 0).map(
              (cls) => (
                <div
                  key={cls}
                  className="flex items-center justify-between gap-3 py-0.5"
                >
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-[1px]"
                      style={{
                        backgroundColor: activeClasses.has(cls)
                          ? EDGE_CLASS_STYLE[cls]?.color
                          : "transparent",
                        border: `1px solid ${EDGE_CLASS_STYLE[cls]?.color}`,
                      }}
                    />
                    {t(`connections.class.${cls}` as TranslationKey)}
                  </span>
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {(link.byClass[CLASS_FIELD[cls]] ?? 0).toLocaleString()}
                  </span>
                </div>
              ),
            )}
            <Row
              label={t("connections.assetsInvolved")}
              value={link.assetCount.toLocaleString()}
            />
          </div>
          {link.duplicatePairCount > 0 && (
            <div className="mt-3 rounded-[4px] border-2 border-border p-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <CopyIcon className="h-3 w-3" />
                {t("connections.duplicatePairs", {
                  count: link.duplicatePairCount,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full rounded-[4px] border-2 font-mono text-[10px] uppercase tracking-[0.1em]"
                onClick={() =>
                  router.push(
                    nsPath(
                      `/duplicates?sourceIds=${link.sourceAId},${link.sourceBId}`,
                    ),
                  )
                }
              >
                {t("connections.reviewDuplicates")}
              </Button>
            </div>
          )}
        </>
      ) : selectedNode?.type === "asset" && selectedNode.assetId ? (
        <>
          <span className={microLabelClass}>{t("connections.asset")}</span>
          <h4 className="mt-1 break-words font-serif text-base font-black leading-tight text-foreground">
            {selectedNode.assetName ?? selectedNode.label}
          </h4>
          {selectedNode.sourceName && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {selectedNode.sourceName}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="rounded-[4px] border-2 font-mono text-[10px] uppercase tracking-[0.1em]"
              onClick={() =>
                router.push(nsPath(`/assets/${selectedNode.assetId}`))
              }
            >
              {t("connections.openAsset")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="justify-start rounded-[4px] font-mono text-[10px] uppercase tracking-[0.1em]"
              onClick={() =>
                router.push(
                  nsPath(`/assets/${selectedNode.assetId}?tab=lineage`),
                )
              }
            >
              <GitBranch className="mr-1 h-3 w-3" />
              {t("connections.traceLineage")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className={microLabelClass}>{t("connections.legend")}</span>
          <div className="mt-2 space-y-1">
            {CLASS_ORDER.map((cls) => (
              <div key={cls} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-0.5 w-5 shrink-0"
                  style={{ backgroundColor: EDGE_CLASS_STYLE[cls]?.color }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  {t(`connections.class.${cls}` as TranslationKey)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed tracking-[0.02em] text-muted-foreground/70">
            {t("connections.hint")}
          </p>
          {topAssets && topAssets.length > 0 && (
            <div className="mt-4 border-t-2 border-border pt-3">
              <span className={microLabelClass}>
                {t("discovery.whereRiskClusters")}
              </span>
              <div className="mt-2">
                <BusiestAssets assets={topAssets} limit={5} emptyAction={false} />
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
