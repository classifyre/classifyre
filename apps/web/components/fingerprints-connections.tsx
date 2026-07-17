"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  RotateCw,
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
import { useTranslation } from "@/hooks/use-translation";

/** Cap the ranked list so a huge correlation graph doesn't render 1000s of rows. */
const MAX_ROWS = 50;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface SharedValueDetail {
  id: string;
  /** Detector/label the value came from (e.g. EMAIL, PHONE). */
  label: string;
  /** The (truncated on render) shared value itself. */
  value: string;
  /** How many assets in the whole graph carry this exact value. */
  fanOut: number;
}

interface ConnectionRow {
  key: string;
  assetA: { id: string; label: string };
  assetB: { id: string; label: string };
  /** Weighted match % (0-100), or null when the pair never cleared the
   *  "related" similarity threshold — they only share values found here. */
  matchPercent: number | null;
  sharedValues: SharedValueDetail[];
}

/**
 * Ranked "top connections" list — one row per asset pair, derived from the
 * same GET /correlation/graph payload the graph view uses (nodes/edges +
 * similarities). Shared-value groups are decomposed into every pairwise
 * combination of their member assets so bundles of 3+ assets still surface
 * each underlying pair, not just exact 2-asset bundles.
 */
export function FingerprintsConnections({
  onViewInGraph,
}: {
  /** Switch to the Graph tab focused on this asset pair (best-effort). */
  onViewInGraph?: (assetIds: [string, string]) => void;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [similarities, setSimilarities] = React.useState<
    { fromId: string; toId: string; weighted: number }[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlation
      .correlationControllerGraph({})
      .then((g) => {
        if (!active) return;
        setNodes(g.nodes ?? []);
        setEdges(g.edges ?? []);
        setSimilarities(g.similarities ?? []);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : t("correlation.connections.loadFailed"),
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

  const { rows, totalCount } = React.useMemo(() => {
    const assetById = new Map(
      nodes.filter((n) => n.type === "asset").map((n) => [n.id, n]),
    );
    const valueById = new Map(
      nodes.filter((n) => n.type === "finding").map((n) => [n.id, n]),
    );

    // value id -> distinct asset ids that carry it (fan-out for that value,
    // across the whole graph — not scoped to any one pair).
    const neighborsOf = new Map<string, string[]>();
    for (const e of edges) {
      if (e.fromType !== "asset" || e.toType !== "finding") continue;
      const list = neighborsOf.get(e.toId);
      if (list) list.push(e.fromId);
      else neighborsOf.set(e.toId, [e.fromId]);
    }

    // Pairwise similarity lookup (0-1), keyed by sorted asset pair.
    const simByPair = new Map<string, number>();
    for (const s of similarities) {
      const k = pairKey(s.fromId, s.toId);
      simByPair.set(k, Math.max(simByPair.get(k) ?? 0, s.weighted));
    }

    // Decompose every shared-value group into its pairwise combinations —
    // a value held by 3+ assets still contributes to each underlying pair.
    const pairs = new Map<
      string,
      { assetIds: [string, string]; values: Map<string, SharedValueDetail> }
    >();
    for (const [valueId, assetIds] of neighborsOf) {
      const unique = [...new Set(assetIds)];
      if (unique.length < 2) continue;
      const valueNode = valueById.get(valueId);
      const detail: SharedValueDetail = {
        id: valueId,
        label: valueNode?.detectorType ?? "",
        value: valueNode?.label ?? valueId,
        fanOut: unique.length,
      };
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const a = unique[i]!;
          const b = unique[j]!;
          const key = pairKey(a, b);
          let entry = pairs.get(key);
          if (!entry) {
            entry = { assetIds: [a, b], values: new Map() };
            pairs.set(key, entry);
          }
          entry.values.set(valueId, detail);
        }
      }
    }

    const built: ConnectionRow[] = [];
    for (const [key, entry] of pairs) {
      const [aId, bId] = entry.assetIds;
      const weighted = simByPair.get(key);
      built.push({
        key,
        assetA: { id: aId, label: assetById.get(aId)?.label ?? aId },
        assetB: { id: bId, label: assetById.get(bId)?.label ?? bId },
        matchPercent: weighted != null ? Math.round(weighted * 100) : null,
        sharedValues: [...entry.values.values()].sort(
          (x, y) => x.fanOut - y.fanOut || x.label.localeCompare(y.label),
        ),
      });
    }

    built.sort((x, y) => {
      const mx = x.matchPercent ?? -1;
      const my = y.matchPercent ?? -1;
      if (my !== mx) return my - mx;
      return y.sharedValues.length - x.sharedValues.length;
    });

    return { rows: built.slice(0, MAX_ROWS), totalCount: built.length };
  }, [nodes, edges, similarities]);

  const toggle = React.useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showEmpty = !loading && !error && rows.length === 0;
  const truncatedNote = totalCount > MAX_ROWS;

  return (
    <div className="flex h-full flex-col border-2 border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
            {t("correlation.connections.title")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {truncatedNote && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {t("correlation.connections.showingTopN", {
                count: String(MAX_ROWS),
                total: String(totalCount),
              })}
            </Badge>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={load}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" label={t("correlation.fingerprints.title")} />
          </div>
        ) : error ? (
          <EmptyState
            icon={Link2}
            title={t("correlation.connections.loadFailed")}
            description={error}
            action={{ label: t("correlation.fingerprints.retry"), onClick: load }}
          />
        ) : showEmpty ? (
          <EmptyState
            icon={Link2}
            title={t("correlation.connections.empty")}
            description={t("correlation.connections.emptyDesc")}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.key}
                className="rounded-[4px] border-2 border-border bg-background"
              >
                <button
                  type="button"
                  onClick={() => toggle(row.key)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                >
                  {expanded.has(row.key) ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
                    <span className="max-w-[220px] truncate font-medium" title={row.assetA.label}>
                      {row.assetA.label}
                    </span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="max-w-[220px] truncate font-medium" title={row.assetB.label}>
                      {row.assetB.label}
                    </span>
                  </span>
                  <Badge
                    variant={row.matchPercent != null ? "default" : "outline"}
                    className="shrink-0 text-[10px]"
                  >
                    {row.matchPercent != null
                      ? t("correlation.connections.matchPercent", {
                          count: String(row.matchPercent),
                        })
                      : t("correlation.connections.noScore")}
                  </Badge>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {t("correlation.connections.sharedCount", {
                      count: String(row.sharedValues.length),
                    })}
                  </Badge>
                </button>

                {expanded.has(row.key) && (
                  <div className="space-y-2 border-t border-border/60 px-3 py-2">
                    <ul className="max-h-[30vh] space-y-1 overflow-y-auto">
                      {row.sharedValues.map((v) => (
                        <li
                          key={v.id}
                          className="flex items-center gap-2 rounded-[3px] px-1.5 py-1 text-xs"
                        >
                          <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                            {v.label}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate font-mono"
                            title={v.value}
                          >
                            {v.value}
                          </span>
                          {v.fanOut > 2 && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {t("correlation.connections.fanOut", {
                                count: String(v.fanOut),
                              })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={`/assets/${row.assetA.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {row.assetA.label}
                      </a>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <a
                        href={`/assets/${row.assetB.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {row.assetB.label}
                      </a>
                      {onViewInGraph && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-7 text-xs"
                          onClick={() =>
                            onViewInGraph([row.assetA.id, row.assetB.id])
                          }
                        >
                          <ExternalLink className="mr-1.5 h-3 w-3" />
                          {t("correlation.connections.viewInGraph")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
