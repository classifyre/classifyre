"use client";

import * as React from "react";
import {
  BookmarkPlus,
  Loader2,
  Play,
  Share2,
  Square,
  WandSparkles,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import type { QueryRun } from "@/lib/data-query";
import { scanSummary } from "@/lib/scan-summary";

const STATUS_TONE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "outline",
  RUNNING: "secondary",
  SUCCESS: "default",
  ERROR: "destructive",
  TIMEOUT: "destructive",
  CANCELLED: "outline",
};

function seconds(ms: number | undefined): string {
  return ms === undefined ? "–" : (ms / 1000).toFixed(ms < 10_000 ? 2 : 1);
}

/**
 * The editor's action bar: Run first (the primary action), then Format and
 * Save beside it. Export lives with the results it downloads, next to the
 * grid's search. The run's state — status, elapsed, timings — reads to the
 * right, where the eye lands after the grid.
 */
export function QueryToolbar({
  busy,
  canRun,
  run,
  elapsed,
  disabled,
  onRun,
  onStop,
  onFormat,
  onSave,
  onShare,
  shareLabel,
}: {
  busy: boolean;
  canRun: boolean;
  run: QueryRun | null;
  elapsed: number;
  disabled: boolean;
  onRun: () => void;
  onStop: () => void;
  onFormat: () => void;
  onSave: () => void;
  /** Share the query as a dataset (DQ §5.12), for whoever may. */
  onShare?: () => void;
  shareLabel?: string;
}) {
  const { t } = useTranslation();
  const timings = run?.timings ?? undefined;
  const live = scanSummary(run?.scans);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
      {busy ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={onStop}
          data-testid="cancel-query"
        >
          <Square className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.cancel")}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onRun}
          disabled={!canRun}
          data-testid="run-query"
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.run")}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onFormat}
        disabled={!canRun}
        title="⇧⌥F"
        data-testid="format-query"
      >
        <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
        {t("dataQuery.format")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onSave}
        disabled={disabled}
        data-testid="save-query"
      >
        <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
        {t("dataQuery.explorer.save")}
      </Button>
      {onShare && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onShare}
          disabled={!canRun}
          data-testid="share-dataset"
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5" />
          {shareLabel ?? t("sharedDatasets.share.button")}
        </Button>
      )}
      <span className="hidden text-[11px] text-muted-foreground lg:inline">
        {t("dataQuery.shortcut")}
      </span>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        {run && (
          <Badge variant={STATUS_TONE[run.status] ?? "outline"}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t(`dataQuery.status.${run.status}` as TranslationKey)}
          </Badge>
        )}
        {(busy || run) && (
          <span data-testid="query-elapsed" className="tabular-nums">
            {t("dataQuery.elapsed", { seconds: seconds(elapsed) })}
          </span>
        )}
        {live && !busy && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="tabular-nums" data-testid="query-live-scans">
                {t("dataQuery.liveScans.summary", {
                  tables: live.tables,
                  requests: live.requests,
                  rows: live.rows,
                })}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-md space-y-1">
              {live.details.map((d) => (
                <p key={d.table}>
                  {d.pushed
                    ? t("dataQuery.liveScans.tableFiltered", {
                        table: d.table,
                        requests: d.requests,
                        rows: d.rows,
                        filters: d.pushed,
                      })
                    : t("dataQuery.liveScans.table", {
                        table: d.table,
                        requests: d.requests,
                        rows: d.rows,
                      })}
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        )}
        {timings?.totalMs !== undefined && !busy && (
          <span className="hidden tabular-nums xl:inline">
            {t("dataQuery.timings", {
              setup: seconds(timings.setupMs),
              query: seconds(timings.executeMs),
            })}
          </span>
        )}
      </div>
    </div>
  );
}
