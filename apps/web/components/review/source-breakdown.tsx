"use client";

import * as React from "react";
import { ArrowLeftRight, RotateCcw, X } from "lucide-react";
import type { ReviewSourceGraphDto } from "@workspace/api-client";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { Button } from "@workspace/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { fmt, pct } from "./review-format";

/**
 * Where the duplicates sit — and a filter, not just a picture.
 *
 * Reading that 94% of pairs run between two systems is only useful if the next
 * click is "show me those". So each row is a toggle that narrows the queue, and
 * the numbers that used to need a separate page (assets, share, kind) live in
 * the tooltip where they are one hover away instead of one navigation.
 *
 * The two kinds are never summed: pairs inside one system are that system's own
 * ingest or deduplication problem, pairs between two are a problem with the
 * integration between them.
 */
export function SourceBreakdown({
  graph,
  selected,
  onToggle,
}: {
  graph: ReviewSourceGraphDto;
  selected: string[];
  onToggle: (sourceId: string) => void;
}) {
  const { t } = useTranslation();

  const byId = React.useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );
  const total = graph.edges.reduce((a, e) => a + e.pairCount, 0);
  const rows = React.useMemo(
    () =>
      [...graph.edges]
        .sort((x, y) => y.pairCount - x.pairCount)
        .slice(0, 8)
        .map((e) => ({
          ...e,
          a: byId.get(e.sourceAId),
          b: byId.get(e.sourceBId),
          internal: e.sourceAId === e.sourceBId,
        })),
    [graph.edges, byId],
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className={panelHeadingClass}>{t("review.sources.title")}</h3>
        <p className="text-[11px] text-muted-foreground">
          {t("review.sources.none")}
        </p>
      </div>
    );
  }

  const heaviest = rows[0]!;
  const verdict =
    graph.topShare < 0.6
      ? t("review.sources.spread")
      : heaviest.internal
        ? t("review.sources.withinOne", {
            percent: pct(graph.topShare),
            source: heaviest.a?.name ?? "",
          })
        : t("review.sources.concentrated", { percent: pct(graph.topShare) });

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={panelHeadingClass}>{t("review.sources.title")}</h3>
        {selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.1em]"
            onClick={() => selected.forEach(onToggle)}
          >
            <X className="h-3 w-3" aria-hidden />
            {t("review.sources.clearFilter")}
          </Button>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {rows.map((row) => {
          const share = total > 0 ? row.pairCount / total : 0;
          const ids = row.internal
            ? [row.sourceAId]
            : [row.sourceAId, row.sourceBId];
          const active = ids.every((id) => selected.includes(id));

          return (
            <li key={`${row.sourceAId}-${row.sourceBId}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => ids.forEach(onToggle)}
                    aria-pressed={active}
                    className={`w-full space-y-1 rounded-[3px] border-2 px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "border-accent bg-accent/10"
                        : "border-transparent hover:border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <SourceIcon
                        source={row.a?.type ?? "filesystem"}
                        size="sm"
                        className="shrink-0"
                      />
                      {row.internal ? (
                        <RotateCcw
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : (
                        <>
                          <ArrowLeftRight
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <SourceIcon
                            source={row.b?.type ?? "filesystem"}
                            size="sm"
                            className="shrink-0"
                          />
                        </>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                        {row.internal
                          ? (row.a?.name ?? "")
                          : `${row.a?.name ?? ""} ↔ ${row.b?.name ?? ""}`}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmt(row.pairCount)}
                      </span>
                    </span>
                    <span className="ml-6 block h-1.5 overflow-hidden rounded-[2px] bg-muted">
                      <span
                        className={`block h-full ${row.internal ? "bg-foreground" : "bg-accent"}`}
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                  </button>
                </TooltipTrigger>
                {/* Everything the separate page used to hold, one hover away. */}
                <TooltipContent className="max-w-[300px] space-y-1">
                  <p className="font-semibold">
                    {row.internal
                      ? t("review.sources.kindInternal")
                      : t("review.sources.kindCross")}
                  </p>
                  <p className="text-muted-foreground">
                    {row.internal
                      ? t("review.sources.kindInternalHint")
                      : t("review.sources.kindCrossHint")}
                  </p>
                  <p className="font-mono text-[11px]">
                    {t("review.sources.tooltipStats", {
                      pairs: fmt(row.pairCount),
                      assets: fmt(row.assetCount),
                      share: pct(share),
                    })}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    {active
                      ? t("review.sources.clickToClear")
                      : t("review.sources.clickToFilter")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-muted-foreground">{verdict}</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {t("review.sources.caption")}
      </p>
    </div>
  );
}
