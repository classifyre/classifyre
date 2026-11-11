"use client";

import * as React from "react";
import {
  BookmarkPlus,
  Loader2,
  Play,
  Square,
  WandSparkles,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import type { QueryRun } from "@/lib/data-query";

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
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
}) {
  const { t } = useTranslation();
  const timings = run?.timings ?? undefined;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
      {busy ? (
        <Button size="sm" variant="secondary" onClick={onStop} data-testid="cancel-query">
          <Square className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.cancel")}
        </Button>
      ) : (
        <Button size="sm" onClick={onRun} disabled={!canRun} data-testid="run-query">
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
