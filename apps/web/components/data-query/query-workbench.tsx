"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
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
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";
import { QueryToolbar } from "./query-toolbar";
import { ResultsGrid } from "./results-grid";
import { SaveQueryDialog } from "./save-query-dialog";

export interface QueryWorkbenchHandle {
  /** Insert at the cursor: the explorer's table and column names. */
  insert: (text: string) => void;
  /** Replace the SQL as one undoable edit (saved queries, previews). */
  setSql: (sql: string) => void;
  /**
   * Reopen a past run from history: its SQL only, never its rows — results
   * can be huge and expire after a day; Run again brings fresh ones.
   */
  showRun: (run: QueryRun) => void;
}

/**
 * One SQL editor and its result. The editor is the workbench: Run sits
 * beside it in a toolbar (Format, Save, Export alongside), the result below.
 * An explorer beside it (the SQL page, a source's Data tab) drives it
 * through the handle; a table's Data tab pre-fills that table.
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
  const editor = React.useRef<SqlEditorHandle>(null);
  const [run, setRun] = React.useState<QueryRun | null>(null);
  const [rows, setRows] = React.useState<QueryRows | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRef = React.useRef(0);

  React.useImperativeHandle(
    ref,
    () => ({
      insert: (text) => editor.current?.insert(text),
      setSql: (next) => editor.current?.replaceAll(next),
      showRun: (past) => editor.current?.replaceAll(past.sql),
    }),
    [],
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
      // Through the editor, so one Ctrl/Cmd+Z undoes the formatting.
      editor.current?.replaceAll(
        formatSql(sql, { language: "duckdb", keywordCase: "upper" }),
      );
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

  return (
    <div className="space-y-3">
      <SqlEditor
        ref={editor}
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
    </div>
  );
}
