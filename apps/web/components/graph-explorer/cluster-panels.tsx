"use client";

import * as React from "react";
import {
  Boxes,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Flag,
} from "lucide-react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { useDetailLink } from "@/hooks/use-detail-link";
import { useTranslation } from "@/hooks/use-translation";
import { SEVERITY_COLORS } from "./graph-types";
import { useClusterCaption } from "./use-cluster-label";
import { clusterNodeKey, isMetaEdge, type ClusterMeta } from "./use-clustered-graph";

/** Worst-first, the order severities are banded and stacked in. */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

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
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-muted">
      {SEVERITY_ORDER
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
 * Synthetic "N shared values" nodes stand in for a bundle of real findings;
 * their id addresses no row, so they must never become a link.
 */
function isLinkableMember(node: GraphNodeDto): boolean {
  return node.type === "asset" || node.detectorType !== "BUNDLE";
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
  const clusterCaption = useClusterCaption();
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
          const { title, caption, extraSourceCount } = clusterCaption(meta);
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
                  <span className="truncate text-[12px] font-semibold">{title}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                </span>
                {(caption || extraSourceCount > 0) && (
                  <span className="block truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {[
                      caption,
                      extraSourceCount > 0
                        ? t("graphExplorer.clusterSourcePlusMore", {
                            count: String(extraSourceCount),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
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

/** One clickable cluster member — a document or a finding. */
function MemberRow({
  node,
  memberKey,
  hoverKey,
  onHoverKey,
  memberHref,
}: {
  node: GraphNodeDto;
  memberKey: string;
  memberHref?: (node: GraphNodeDto) => string | null;
} & Pick<ClusterPanelCallbacks, "hoverKey" | "onHoverKey">) {
  const { t } = useTranslation();
  const detailLink = useDetailLink();
  const isAsset = node.type === "asset";
  const severity = node.severity?.toUpperCase();
  const hovered = hoverKey === memberKey;
  const href = memberHref
    ? memberHref(node)
    : isLinkableMember(node)
      ? isAsset
        ? `/assets/${node.id}`
        : `/findings/${node.id}`
      : null;

  const body = (
    <>
      {isAsset ? (
        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: SEVERITY_COLORS[severity ?? "INFO"] ?? SEVERITY_COLORS.INFO,
          }}
        />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={node.label}>
        {node.label}
      </span>
    </>
  );

  const shared = `flex w-full items-center gap-1.5 border-l-2 px-2 py-1 text-left ${
    hovered ? "border-foreground bg-muted" : "border-border"
  }`;

  if (!href) {
    return (
      <li
        className={shared}
        onMouseEnter={() => onHoverKey?.(memberKey)}
        onMouseLeave={() => onHoverKey?.(null)}
      >
        {body}
      </li>
    );
  }

  return (
    <li>
      <a
        {...detailLink(href)}
        className={`${shared} group transition-colors hover:border-foreground hover:bg-muted`}
        title={t(isAsset ? "graphExplorer.openDocument" : "graphExplorer.openFinding")}
        onMouseEnter={() => onHoverKey?.(memberKey)}
        onMouseLeave={() => onHoverKey?.(null)}
      >
        {body}
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </a>
    </li>
  );
}

/** A titled, counted run of member rows (Documents, or one severity band). */
function MemberGroup({
  label,
  swatch,
  members,
  hoverKey,
  onHoverKey,
  memberHref,
}: {
  label: string;
  /** Colour chip for severity bands; omitted for the Documents group. */
  swatch?: string;
  members: Array<{ key: string; node: GraphNodeDto }>;
  memberHref?: (node: GraphNodeDto) => string | null;
} & Pick<ClusterPanelCallbacks, "hoverKey" | "onHoverKey">) {
  if (members.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1">
        {swatch && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: swatch }}
          />
        )}
        <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {members.length}
        </span>
      </div>
      <ul>
        {members.map(({ key, node }) => (
          <MemberRow
            key={key}
            node={node}
            memberKey={key}
            hoverKey={hoverKey}
            onHoverKey={onHoverKey}
            memberHref={memberHref}
          />
        ))}
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
  memberHref,
}: {
  meta: ClusterMeta;
  clusters: Map<string, ClusterMeta>;
  renderEdges: GraphEdgeDto[];
  nodeByKey: (key: string) => GraphNodeDto | undefined;
  /** Override member navigation for graphs whose synthetic node ids do not
   * address real finding rows. Return null to render a non-link member. */
  memberHref?: (node: GraphNodeDto) => string | null;
} & ClusterPanelCallbacks) {
  const { t } = useTranslation();
  const detailLink = useDetailLink();
  const clusterCaption = useClusterCaption();
  const { title, caption, soleSource, extraSourceCount } = clusterCaption(meta);
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

  // Documents first, then findings banded by severity (worst first) — a
  // cluster's members are a mix of the two and reading them interleaved tells
  // you nothing about either.
  const { documents, findingBands } = React.useMemo(() => {
    const resolved = meta.memberKeys
      .map((k) => ({ key: k, node: nodeByKey(k) }))
      .filter((m): m is { key: string; node: GraphNodeDto } => Boolean(m.node));

    const documents = resolved
      .filter((m) => m.node.type === "asset")
      .sort((a, b) => a.node.label.localeCompare(b.node.label));

    const bySeverity = new Map<string, Array<{ key: string; node: GraphNodeDto }>>();
    for (const m of resolved) {
      if (m.node.type === "asset") continue;
      const sev = (m.node.severity ?? "INFO").toUpperCase();
      const band = bySeverity.get(sev);
      if (band) band.push(m);
      else bySeverity.set(sev, [m]);
    }
    const known = SEVERITY_ORDER.filter((s) => bySeverity.has(s));
    // Any severity the constant doesn't know about still gets a band.
    const extra = [...bySeverity.keys()].filter((s) => !SEVERITY_ORDER.includes(s)).sort();
    const findingBands = [...known, ...extra].map((severity) => ({
      severity,
      members: bySeverity.get(severity)!,
    }));

    return { documents, findingBands };
  }, [meta.memberKeys, nodeByKey]);

  const findingMemberCount = findingBands.reduce((n, b) => n + b.members.length, 0);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("graphExplorer.clusterTitle")}
        </span>
        <p className="break-words text-sm font-semibold">{title}</p>
        {(caption || extraSourceCount > 0) && (
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {[
              caption,
              extraSourceCount > 0
                ? t("graphExplorer.clusterSourcePlusMore", {
                    count: String(extraSourceCount),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
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
        {/* Only offered when the cluster is unambiguously one source —
            otherwise there is no single page to send the operator to. */}
        {soleSource?.id && (
          <a
            {...detailLink(`/sources/${soleSource.id}`)}
            className="group flex w-full items-center gap-1.5 border-2 border-border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors hover:border-foreground hover:bg-muted"
          >
            <Database className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t("graphExplorer.openSource")}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        )}
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
        <h4 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <Flag className="h-3 w-3" />
          {t("graphExplorer.members")}
        </h4>
        {documents.length === 0 && findingMemberCount === 0 ? (
          <p className="px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {t("graphExplorer.membersEmpty")}
          </p>
        ) : (
          <div className="max-h-[38vh] space-y-2 overflow-y-auto">
            <MemberGroup
              label={t("graphExplorer.membersDocuments")}
              members={documents}
              hoverKey={hoverKey}
              onHoverKey={onHoverKey}
              memberHref={memberHref}
            />
            {findingBands.length > 0 && (
              <div>
                <div className="px-2 py-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t("graphExplorer.membersFindings")}
                  </span>{" "}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {findingMemberCount}
                  </span>
                </div>
                <div className="space-y-1 pl-1.5">
                  {findingBands.map(({ severity, members }) => (
                    <MemberGroup
                      key={severity}
                      label={severity}
                      swatch={SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.INFO}
                      members={members}
                      hoverKey={hoverKey}
                      onHoverKey={onHoverKey}
                      memberHref={memberHref}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
