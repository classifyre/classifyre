"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import {
  apiErrorMessage,
  cancelQuery,
  createSavedQuery,
  downloadExport,
  fetchRows,
  runErrorMessage,
  startQuery,
  waitForRun,
  type QueryCatalog,
  type QueryRows,
  type QueryRun,
} from "@/lib/data-query";
import { SqlEditor } from "./sql-editor";
import { QueryToolbar } from "./query-toolbar";
import { ResultsGrid } from "./results-grid";
import { SaveQueryDialog } from "./save-query-dialog";

export interface QueryWorkbenchHandle {
  /** Insert at the cursor — the explorer writes through the editor itself. */
  insert: (text: string) => void;
  setSql: (sql: string) => void;
}

/**
 * One SQL editor and its result. The editor is the workbench: Run sits
 * beside it in a toolbar (Format, Save, Export alongside), the result below.
 * The SQL page puts the explorer beside it; an asset's Data tab pre-fills
 * that table.
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
  onSaved,
  ref,
}: {
  catalog: QueryCatalog | null;
  initialSql: string;
  editorPath: string;
  editorHeight?: number;
  resultHeight?: number;
  disabled?: boolean;
  onRunFinished?: (run: QueryRun) => void;
  onSaved?: () => void;
  ref?: React.Ref<QueryWorkbenchHandle>;
}) {
  const { t } = useTranslation();
  const [sql, setSql] = React.useState(initialSql);
  // `setSql` from outside (history, saved, open-in-SQL) goes through here so
  // the editor's own undo stack records it like a typed edit — Ctrl/Cmd+Z
  // steps back through reopened queries, not just keystrokes.
  const setActiveEditorSql = React.useCallback(
    (next: string) => {
      (SqlEditor as { replaceAll?: (text: string) => void }).replaceAll?.(
        next,
      ) ?? setSql(next);
    },
    [],
  );
  const [run, setRun] = React.useState<QueryRun | null>(null);
  const [rows, setRows] = React.useState<QueryRows | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRef = React.useRef(0);

  // The explorer beside the editor inserts at the cursor through the
  // editor's own context; this imperative escape stays for "open in SQL"
  // and pages that set SQL from outside. Everything funnels into the
  // editor model, so undo (Ctrl/Cmd+Z) treats it like a typed edit.
  React.useImperativeHandle(
    ref,
    () => ({
      insert: (text) =>
        setSql((current) =>
          current.trim() ? `${current.trimEnd()}\n${text}` : text,
        ),
      setSql: setActiveEditorSql,
    }),
    [setActiveEditorSql],
  );

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Date.now() - startedRef.current),
      200,
    );
    return () => clearInterval(timer);
  }, [busy]);

  const execute = React.useCallback(
    async (text?: string) => {
      const statement = (text ?? sql).trim();
      if (busy || disabled || !statement) return;
      if (text !== undefined && text !== sql) setSql(text);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setRows(null);
      startedRef.current = Date.now();
      setElapsed(0);
      try {
        const created = await startQuery(statement);
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
    },
    [busy, disabled, sql, onRunFinished],
  );

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
   * own, up to the workspace's export row limit (Excel: 1,048,575). Lives
   * beside the grid's search — it downloads what the grid shows.
   */
  const exportAs = React.useCallback(
    async (fileFormat: "xlsx" | "csv" | "parquet") => {
      if (disabled || !sql.trim()) return;
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
      }
    },
    [disabled, sql, t],
  );

  const format = React.useCallback(async () => {
    const { format: formatSql } = await import("sql-formatter");
    try {
      setSql(formatSql(sql, { language: "duckdb", keywordCase: "upper" }));
    } catch {
      /* leave unparseable text as it is */
    }
  }, [sql]);

  const save = React.useCallback(
    async (name: string) => {
      if (saving || disabled || !sql.trim()) return;
      setSaving(true);
      try {
        await createSavedQuery(name, sql);
        setSaveOpen(false);
        onSaved?.();
        toast.success(t("dataQuery.explorer.saved"));
      } catch (caught) {
        toast.error(await apiErrorMessage(caught));
      } finally {
        setSaving(false);
      }
    },
    [saving, disabled, sql, onSaved, t],
  );

  /**
   * History reopens the SQL only — never the rows. Results can be huge and
   * they expire after a day; the query itself is what the person wants back.
   * They press Run again when they want fresh rows.
   */
  const runSql = React.useCallback((next: QueryRun) => {
    setActiveEditorSql(next.sql);
  }, []);

  return (
    <div className="space-y-3">
      <SqlEditor
        value={sql}
        onChange={setSql}
        onRun={() => void execute()}
        onFormat={() => void format()}
        catalog={catalog}
        height={editorHeight}
        path={editorPath}
      />
      <QueryToolbar
        busy={busy}
        canRun={!disabled && Boolean(sql.trim())}
        run={run}
        elapsed={elapsed}
        disabled={disabled}
        onRun={() => void execute()}
        onStop={() => void stop()}
        onFormat={() => void format()}
        onSave={() => setSaveOpen(true)}
      />

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
          {run?.truncated && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {run.truncatedReason === "bytes"
                ? t("dataQuery.truncatedBytes", { count: rows.rows.length })
                : t("dataQuery.truncatedRows", { count: rows.rows.length })}
            </p>
          )}
          {rows.rows.length ? (
            <ResultsGrid
              result={rows}
              height={resultHeight}
              canExport
              onExport={(fileFormat) => void exportAs(fileFormat)}
            />
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

      <SaveQueryDialog
        open={saveOpen}
        defaultName={sql.split("\n")[0]?.slice(0, 60) ?? ""}
        busy={saving}
        onClose={() => setSaveOpen(false)}
        onSave={(name) => void save(name)}
      />

      <RunLoader runSql={runSql} />
    </div>
  );
}

/**
 * Lets the page ask the workbench to show a run (from history) without
 * threading callbacks: the page sets `QueryWorkbench.showRun`, the loader
 * below picks it up. Kept deliberately tiny — a full store would be
 * over-engineering for one editor.
 */
function RunLoader({ runSql }: { runSql: (run: QueryRun) => void }) {
  const ref = React.useRef(runSql);
  ref.current = runSql;
  React.useEffect(() => {
    (QueryWorkbench as { showRun?: (run: QueryRun) => void }).showRun = (
      run: QueryRun,
    ) => ref.current(run);
  }, []);
  return null;
}

export namespace QueryWorkbench {
  /** Show a past run's SQL and rows in the workbench (from history). */
  export let showRun: ((run: QueryRun) => void) | undefined;
}
