"use client";

import * as React from "react";
import { Boxes, ChevronRight } from "lucide-react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { SEVERITY_COLORS } from "./graph-types";
import { clusterNodeKey, isMetaEdge, type ClusterMeta } from "./use-clustered-graph";

const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 8,
  HIGH: 4,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0.5,
};

/** Severity-weighted importance score used to rank clusters. */
export function clusterScore(meta: ClusterMeta): number {
  let score = meta.size * 0.1;
  for (const [sev, count] of Object.entries(meta.severityCounts)) {
    score += (SEVERITY_WEIGHT[sev] ?? 0.5) * count;
  }
  return score;
}

/** Thin stacked severity bar (worst-first) for list rows. */
function SeverityBar({ meta }: { meta: ClusterMeta }) {
  const total = Object.values(meta.severityCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted">
      {order
        .filter((s) => meta.severityCounts[s])
        .map((s) => (
          <div
            key={s}
            style={{
              width: `${(meta.severityCounts[s]! / total) * 100}%`,
              backgroundColor: SEVERITY_COLORS[s],
            }}
          />
        ))}
    </div>
  );
}

export interface ClusterPanelCallbacks {
  /** Zoom into a cluster (expand + fit viewport). */
  onFocusCluster: (meta: ClusterMeta) => void;
  onHoverKey?: (key: string | null) => void;
  hoverKey?: string | null;
}

/**
 * Ranked cluster list for the "nothing selected" sidebar state: worst
 * neighborhoods first, each row a one-click drill-down.
 */
export function ClusterOverviewPanel({
  clusters,
  onFocusCluster,
  onHoverKey,
  hoverKey,
}: { clusters: Map<string, ClusterMeta> } & ClusterPanelCallbacks) {
  const { t } = useTranslation();
  const ranked = React.useMemo(
    () => [...clusters.values()].sort((a, b) => clusterScore(b) - clusterScore(a)),
    [clusters],
  );
  if (ranked.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 font-serif text-sm font-black uppercase tracking-[0.06em]">
        <Boxes className="h-3.5 w-3.5" />
        {t("graphExplorer.overviewTitle")}
      </h3>
      <ul className="space-y-1.5">
        {ranked.map((meta) => {
          const key = clusterNodeKey(meta.id);
          return (
            <li key={meta.id}>
              <button
                className={`w-full space-y-1 border-2 px-2 py-1.5 text-left transition-colors ${
                  hoverKey === key
                    ? "border-foreground bg-muted"
                    : "border-border bg-card hover:border-foreground"
                }`}
                onClick={() => onFocusCluster(meta)}
                onMouseEnter={() => onHoverKey?.(key)}
                onMouseLeave={() => onHoverKey?.(null)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] font-bold">{meta.label}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("graphExplorer.clusterStats", {
                    assets: String(meta.assetCount || meta.size),
                    findings: String(meta.findingCount),
                  })}
                </span>
                <SeverityBar meta={meta} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Detail panel for a selected (still collapsed) cluster: what's inside and
 * which other clusters it links to.
 */
export function ClusterDetailPanel({
  meta,
  clusters,
  renderEdges,
  nodeByKey,
  onFocusCluster,
  onHoverKey,
  hoverKey,
}: {
  meta: ClusterMeta;
  clusters: Map<string, ClusterMeta>;
  renderEdges: GraphEdgeDto[];
  nodeByKey: (key: string) => GraphNodeDto | undefined;
} & ClusterPanelCallbacks) {
  const { t } = useTranslation();
  const selfKey = clusterNodeKey(meta.id);

  const linked = React.useMemo(() => {
    const out: Array<{ meta: ClusterMeta; linkCount: number }> = [];
    for (const e of renderEdges) {
      if (!isMetaEdge(e)) continue;
      const keys = [`${e.fromType}:${e.fromId}`, `${e.toType}:${e.toId}`];
      if (!keys.includes(selfKey)) continue;
      const otherKey = keys[0] === selfKey ? keys[1]! : keys[0]!;
      if (!otherKey.startsWith("cluster:")) continue;
      const other = clusters.get(otherKey.slice("cluster:".length));
      if (other) out.push({ meta: other, linkCount: e.meta.linkCount });
    }
    return out.sort((a, b) => b.linkCount - a.linkCount);
  }, [renderEdges, selfKey, clusters]);

  const members = React.useMemo(
    () =>
      meta.memberKeys
        .map((k) => ({ key: k, node: nodeByKey(k) }))
        .filter((m): m is { key: string; node: GraphNodeDto } => Boolean(m.node))
        .sort((a, b) => (a.node.type === b.node.type ? 0 : a.node.type === "asset" ? -1 : 1)),
    [meta.memberKeys, nodeByKey],
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("graphExplorer.clusterTitle")}
        </span>
        <p className="break-words font-mono text-sm font-semibold">{meta.label}</p>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("graphExplorer.clusterStats", {
            assets: String(meta.assetCount || meta.size),
            findings: String(meta.findingCount),
          })}
        </p>
        <SeverityBar meta={meta} />
        <button
          className="mt-1 w-full border-2 border-foreground bg-foreground px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-background transition-colors hover:bg-transparent hover:text-foreground"
          onClick={() => onFocusCluster(meta)}
        >
          {t("graphExplorer.openCluster")}
        </button>
      </div>

      {linked.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("graphExplorer.linkedClusters")}
          </h4>
          <ul className="space-y-1">
            {linked.map(({ meta: other, linkCount }) => (
              <li key={other.id}>
                <button
                  className="flex w-full items-center justify-between gap-2 border-2 border-border bg-card px-2 py-1 text-left hover:border-foreground"
                  onClick={() => onFocusCluster(other)}
                  onMouseEnter={() => onHoverKey?.(clusterNodeKey(other.id))}
                  onMouseLeave={() => onHoverKey?.(null)}
                >
                  <span className="truncate font-mono text-[11px]">{other.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    ×{linkCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <h4 className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("graphExplorer.members")}
        </h4>
        <ul className="max-h-[38vh] space-y-0.5 overflow-y-auto">
          {members.map(({ key, node }) => (
            <li
              key={key}
              className={`truncate border-l-2 px-2 py-0.5 font-mono text-[11px] ${
                hoverKey === key ? "border-foreground bg-muted" : "border-border"
              }`}
              onMouseEnter={() => onHoverKey?.(key)}
              onMouseLeave={() => onHoverKey?.(null)}
            >
              {node.type === "finding" && node.severity && (
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{
                    backgroundColor:
                      SEVERITY_COLORS[node.severity.toUpperCase()] ?? SEVERITY_COLORS.INFO,
                  }}
                />
              )}
              {node.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
