"use client";

import * as React from "react";
import {
  AlertCircle,
  Download,
  Loader2,
  Play,
  Square,
  WandSparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-me";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { useTranslation } from "@/hooks/use-translation";
import {
  apiErrorMessage,
  cancelQuery,
  downloadExport,
  type ExportFormat,
  fetchRows,
  runErrorMessage,
  startQuery,
  waitForRun,
  type QueryCatalog,
  type QueryRows,
  type QueryRun,
} from "@/lib/data-query";
import type { TranslationKey } from "@/i18n";
import { SqlEditor } from "./sql-editor";
import { ResultsGrid } from "./results-grid";

export interface QueryWorkbenchHandle {
  /** Put text at the end of the query (a table name from the catalog). */
  insert: (text: string) => void;
  setSql: (sql: string) => void;
}

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
 * One SQL editor and its result. Used by the SQL page (with the catalog
 * beside it) and by an asset's Data tab (prefilled with that table).
 *
 * React 19: `ref` arrives as a prop, not via `forwardRef`.
 */
export function QueryWorkbench({
  catalog,
  initialSql,
  editorPath,
  editorHeight = 200,
  resultHeight = 440,
  disabled = false,
  onRunFinished,
  ref,
}: {
  catalog: QueryCatalog | null;
  initialSql: string;
  editorPath: string;
  editorHeight?: number;
  resultHeight?: number;
  disabled?: boolean;
  onRunFinished?: (run: QueryRun) => void;
  ref?: React.Ref<QueryWorkbenchHandle>;
}) {
  const { t } = useTranslation();
  const [sql, setSql] = React.useState(initialSql);
  const [run, setRun] = React.useState<QueryRun | null>(null);
  const [rows, setRows] = React.useState<QueryRows | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [exporting, setExporting] = React.useState<ExportFormat | null>(null);
  const canExport = useCan("data.export");
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRef = React.useRef(0);

  React.useImperativeHandle(ref, () => ({
    insert: (text) =>
      setSql((current) =>
        current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text,
      ),
    setSql,
  }));

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Date.now() - startedRef.current),
      200,
    );
    return () => clearInterval(timer);
  }, [busy]);

  const execute = React.useCallback(async () => {
    if (busy || disabled || !sql.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setRows(null);
    startedRef.current = Date.now();
    setElapsed(0);
    try {
      const created = await startQuery(sql);
      setRun(created);
      const finished = await waitForRun(created.id, setRun, controller.signal);
      if (finished.status === "SUCCESS") {
        setRows(await fetchRows(finished));
      } else {
        setError(runErrorMessage(finished));
      }
      onRunFinished?.(finished);
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError") {
        setError(await apiErrorMessage(caught));
      }
    } finally {
      setElapsed(Date.now() - startedRef.current);
      setBusy(false);
    }
  }, [busy, disabled, sql, onRunFinished]);

  const stop = React.useCallback(async () => {
    if (!run) return;
    abortRef.current?.abort();
    try {
      setRun(await cancelQuery(run.id));
    } finally {
      setBusy(false);
    }
  }, [run]);

  /**
   * The whole result as a file, not just the rows on screen: a job of its
   * own, up to the workspace's export row limit (Excel: 1,048,575).
   */
  const exportAs = React.useCallback(
    async (fileFormat: ExportFormat) => {
      if (exporting || disabled || !sql.trim()) return;
      setExporting(fileFormat);
      try {
        const created = await startQuery(sql, fileFormat);
        const finished = await waitForRun(created.id, () => undefined);
        if (finished.status !== "SUCCESS") {
          toast.error(
            runErrorMessage(finished) ?? t("dataQuery.export.failed"),
          );
          return;
        }
        await downloadExport(finished);
        toast.success(
          finished.truncated
            ? t("dataQuery.export.truncated", {
                count: finished.rowCount ?? 0,
              })
            : t("dataQuery.export.done", { count: finished.rowCount ?? 0 }),
        );
      } catch (caught) {
        toast.error(await apiErrorMessage(caught));
      } finally {
        setExporting(null);
      }
    },
    [exporting, disabled, sql, t],
  );

  const format = React.useCallback(async () => {
    const { format: formatSql } = await import("sql-formatter");
    try {
      setSql(formatSql(sql, { language: "duckdb", keywordCase: "upper" }));
    } catch {
      /* leave unparseable text as it is */
    }
  }, [sql]);

  const timings = run?.timings ?? undefined;

  return (
    <div className="space-y-3">
      <SqlEditor
        value={sql}
        onChange={setSql}
        onRun={() => void execute()}
        catalog={catalog}
        height={editorHeight}
        path={editorPath}
      />
      <div className="flex flex-wrap items-center gap-2">
        {busy ? (
          <Button size="sm" variant="secondary" onClick={() => void stop()}>
            <Square className="mr-1.5 h-3.5 w-3.5" />
            {t("dataQuery.cancel")}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void execute()}
            disabled={disabled || !sql.trim()}
            data-testid="run-query"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t("dataQuery.run")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void format()}
          disabled={!sql.trim()}
        >
          <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.format")}
        </Button>
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || !sql.trim() || exporting !== null}
                data-testid="export-query"
              >
                {exporting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                {exporting
                  ? t("dataQuery.export.running")
                  : t("dataQuery.export.button")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                data-testid="export-xlsx"
                onSelect={() => void exportAs("xlsx")}
              >
                {t("dataQuery.export.xlsx")}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="export-csv"
                onSelect={() => void exportAs("csv")}
              >
                {t("dataQuery.export.csv")}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="export-parquet"
                onSelect={() => void exportAs("parquet")}
              >
                {t("dataQuery.export.parquet")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <span className="text-xs text-muted-foreground">
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
            <span data-testid="query-elapsed">
              {t("dataQuery.elapsed", { seconds: seconds(elapsed) })}
            </span>
          )}
          {timings?.totalMs !== undefined && !busy && (
            <span>
              {t("dataQuery.timings", {
                setup: seconds(timings.setupMs),
                query: seconds(timings.executeMs),
              })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-testid="query-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            {run?.error?.code && (
              <div className="font-mono text-xs text-muted-foreground">
                {run.error.code}
              </div>
            )}
            <div className="whitespace-pre-wrap font-mono text-xs">{error}</div>
          </div>
        </div>
      )}

      {rows && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span data-testid="query-row-count">
              {t("dataQuery.rows", { count: rows.rows.length })}
            </span>
            <span>
              {t("dataQuery.columns", { count: rows.columns.length })}
            </span>
            {run?.truncated && (
              <span className="text-amber-600 dark:text-amber-400">
                {run.truncatedReason === "bytes"
                  ? t("dataQuery.truncatedBytes", { count: rows.rows.length })
                  : t("dataQuery.truncatedRows", { count: rows.rows.length })}
              </span>
            )}
          </div>
          {rows.rows.length ? (
            <ResultsGrid result={rows} height={resultHeight} />
          ) : (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              {t("dataQuery.emptyResult")}
            </div>
          )}
        </div>
      )}

      {!rows && !error && !busy && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("dataQuery.noResult")}
        </div>
      )}
    </div>
  );
}
