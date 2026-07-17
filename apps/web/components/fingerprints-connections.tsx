"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  RotateCw,
  Search,
} from "lucide-react";
import type { AssetSimilarityDto, GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "@/hooks/use-translation";

/** Rows rendered per "show more" batch. */
const BATCH_SIZE = 50;

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
 * similarities), passed down from the page so both panels always agree.
 * Shared-value groups are decomposed into every pairwise combination of
 * their member assets so bundles of 3+ assets still surface each underlying
 * pair, not just exact 2-asset bundles.
 */
export function FingerprintsConnections({
  nodes,
  edges,
  similarities,
  loading,
  error,
  onReload,
  onFocusPair,
  focusedPair,
}: {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  similarities: AssetSimilarityDto[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Focus this pair on the graph canvas. */
  onFocusPair?: (assetIds: [string, string]) => void;
  /** The pair currently focused on the graph, if any — highlights its row. */
  focusedPair?: [string, string];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [visibleCount, setVisibleCount] = React.useState(BATCH_SIZE);

  const { rows } = React.useMemo(() => {
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

    return { rows: built };
  }, [nodes, edges, similarities]);

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (row.assetA.label.toLowerCase().includes(q)) return true;
      if (row.assetB.label.toLowerCase().includes(q)) return true;
      return row.sharedValues.some((v) => v.value.toLowerCase().includes(q));
    });
  }, [rows, search]);

  // Reset the visible window whenever the filtered set changes shape.
  React.useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [search]);

  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasMore = filteredRows.length > visibleRows.length;

  // Row click both expands/collapses the detail and focuses the pair on the
  // graph; the explicit "View in graph" button just re-focuses without
  // toggling collapse state.
  const focusRow = React.useCallback(
    (row: ConnectionRow) => {
      onFocusPair?.([row.assetA.id, row.assetB.id]);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      });
    },
    [onFocusPair],
  );

  const refocusRow = React.useCallback(
    (row: ConnectionRow) => onFocusPair?.([row.assetA.id, row.assetB.id]),
    [onFocusPair],
  );

  const showEmpty = !loading && !error && rows.length === 0;
  const showNoMatches = !loading && !error && rows.length > 0 && filteredRows.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
            {t("correlation.connections.title")}
          </h3>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={onReload}>
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("correlation.connections.searchPlaceholder")}
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

      <div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" label={t("correlation.fingerprints.title")} />
          </div>
        ) : error ? (
          <EmptyState
            icon={Link2}
            title={t("correlation.connections.loadFailed")}
            description={error}
            action={{ label: t("correlation.fingerprints.retry"), onClick: onReload }}
          />
        ) : showEmpty ? (
          <EmptyState
            icon={Link2}
            title={t("correlation.connections.empty")}
            description={t("correlation.connections.emptyDesc")}
          />
        ) : showNoMatches ? (
          <EmptyState icon={Search} title={t("correlation.connections.noMatches")} description="" />
        ) : (
          <>
            <ul className="space-y-2">
              {visibleRows.map((row) => {
                const isFocused =
                  focusedPair &&
                  ((focusedPair[0] === row.assetA.id && focusedPair[1] === row.assetB.id) ||
                    (focusedPair[0] === row.assetB.id && focusedPair[1] === row.assetA.id));
                return (
                  <li
                    key={row.key}
                    className={`rounded-[4px] border-2 bg-background ${
                      isFocused ? "border-foreground" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => focusRow(row)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                    >
                      {expanded.has(row.key) ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm">
                        <span className="max-w-[140px] truncate font-medium" title={row.assetA.label}>
                          {row.assetA.label}
                        </span>
                        <span className="text-muted-foreground">↔</span>
                        <span className="max-w-[140px] truncate font-medium" title={row.assetB.label}>
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
                    </button>

                    {expanded.has(row.key) && (
                      <div className="space-y-2 border-t border-border/60 px-3 py-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {t("correlation.connections.sharedCount", {
                            count: String(row.sharedValues.length),
                          })}
                        </Badge>
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto h-7 text-xs"
                            onClick={() => refocusRow(row)}
                          >
                            <ExternalLink className="mr-1.5 h-3 w-3" />
                            {t("correlation.connections.viewInGraph")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-2 pt-3 text-[11px] text-muted-foreground">
              <span>
                {t("correlation.connections.countSummary", {
                  shown: String(visibleRows.length),
                  total: String(filteredRows.length),
                })}
              </span>
              {hasMore && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setVisibleCount((c) => c + BATCH_SIZE)}
                >
                  {t("correlation.connections.showMore", {
                    count: String(Math.min(BATCH_SIZE, filteredRows.length - visibleRows.length)),
                  })}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
