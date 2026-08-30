"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Square,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { CellList } from "./cell-list";
import type { CellStatus } from "./code-cell";
import type { CellOutputValue } from "./cell-output";
import type { NotebookCell } from "@/lib/notebook-cells";
import {
  awaitExecution,
  summarizeExecution,
  useNotebookExecution,
  type ExecutionRecord,
} from "./use-notebook-execution";

// Re-exported so existing imports of the cell shape keep working.
export type { NotebookCell } from "@/lib/notebook-cells";

export interface NotebookEditorProps {
  sourceId: string;
  cells: NotebookCell[];
  revision: number;
  disabled?: boolean;
  /**
   * Lets the page reach the notebook the editor owns — the assistant applies
   * its cell edits through this. Kept imperative because the editor is the
   * source of truth for a saved notebook (it autosaves and tracks revisions),
   * so lifting the cells into a parent would mean two owners of one thing.
   */
  handleRef?: React.RefObject<NotebookEditorHandle | null>;
  /** Told when an execution starts and stops, so the page can disable its toolbar. */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Runs one cell. Supplied by the page so a cell's play button goes through
   * the same validate-then-save path as the toolbar; without it the editor runs
   * the cell itself.
   */
  onRunCell?: (cellId: string) => void;
  /** Called after a successful save so the container can track the revision. */
  onSaved?: (revision: number) => void;
  onCellsChange?: (cells: NotebookCell[]) => void;
}

const AUTOSAVE_DELAY_MS = 1500;

/**
 * The notebook, for callers that live outside the editor.
 *
 * Run is here rather than on a button inside the editor because running is not
 * a notebook-local act: the source has to be saved first, and only the page
 * knows whether the rest of the form is valid. The page's sticky toolbar
 * validates, saves, then calls `run` — which is also what a cell's own play
 * button does, so the two cannot drift.
 */
export interface NotebookEditorHandle {
  getCells: () => NotebookCell[];
  setCells: (cells: NotebookCell[]) => void;
  /** Resolves once the execution reaches a terminal state. */
  run: (
    mode: "cell" | "all" | "test_connection" | "preview_extract",
    targetCellId?: string,
  ) => Promise<ExecutionRecord | null>;
  /** The same run, rendered as text an assistant can read and act on. */
  runAndSummarize: (
    mode: "cell" | "all" | "test_connection" | "preview_extract",
    targetCellId?: string,
  ) => Promise<string>;
  cancel: () => void;
  /** Persists the notebook and resolves with the revision the server assigned. */
  save: () => Promise<number | null>;
}

export function NotebookEditor({
  sourceId,
  cells: initialCells,
  revision: initialRevision,
  disabled = false,
  handleRef,
  onBusyChange,
  onRunCell,
  onSaved,
  onCellsChange,
}: NotebookEditorProps) {
  const { t } = useTranslation();
  const [cells, setCells] = React.useState<NotebookCell[]>(initialCells);
  const [revision, setRevision] = React.useState(initialRevision);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<{
    current: number;
    yours: number;
  } | null>(null);

  const { execution, run, cancel, busy } = useNotebookExecution(sourceId);

  const cellsRef = React.useRef(cells);
  cellsRef.current = cells;
  const revisionRef = React.useRef(revision);
  revisionRef.current = revision;

  const mutate = React.useCallback(
    (next: NotebookCell[]) => {
      setCells(next);
      setDirty(true);
      onCellsChange?.(next);
    },
    [onCellsChange],
  );



  /**
   * Persist the notebook.
   *
   * Returns the new revision so a caller that needs to run immediately after
   * saving can use the revision the server actually assigned, rather than
   * assuming its own state is current.
   */
  const save = React.useCallback(async (): Promise<number | null> => {
    if (disabled) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await api.notebooks.notebookControllerUpdate({
        sourceId,
        updateNotebookDto: {
          baseRevision: revisionRef.current,
          cells: cellsRef.current,
        } as never,
      });
      const next = (response as unknown as { revision: number }).revision;
      setRevision(next);
      revisionRef.current = next;
      setDirty(false);
      setConflict(null);
      onSaved?.(next);
      return next;
    } catch (error) {
      const conflictBody = (
        error as {
          response?: {
            json?: () => Promise<{
              currentRevision?: number;
              yourRevision?: number;
            }>;
          };
        }
      )?.response;
      if (conflictBody?.json) {
        try {
          const body = await conflictBody.json();
          if (typeof body?.currentRevision === "number") {
            // Someone else saved first. Say so rather than retrying, which
            // would be the overwrite this exists to prevent.
            setConflict({
              current: body.currentRevision,
              yours: body.yourRevision ?? revisionRef.current,
            });
            return null;
          }
        } catch {
          /* fall through to the generic message */
        }
      }
      setSaveError(
        await extractApiErrorMessage(error, t("notebook.saveFailed")),
      );
      return null;
    } finally {
      setSaving(false);
    }
  }, [disabled, sourceId, onSaved, t]);

  // Autosave, debounced. Editing is continuous and saving is cheap; making the
  // author remember Cmd+S is how notebook work gets lost.
  React.useEffect(() => {
    if (!dirty || disabled || conflict) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, cells, disabled, conflict, save]);

  /**
   * Save first, then run the revision the server assigned.
   *
   * An execution names a revision, so running unsaved edits is not possible by
   * construction -- and silently running the *previous* revision would be worse
   * than making the author wait for a save.
   */
  const runMode = React.useCallback(
    async (
      mode: "cell" | "all" | "test_connection" | "preview_extract",
      targetCellId?: string,
    ): Promise<ExecutionRecord | null> => {
      const current = dirty ? await save() : revisionRef.current;
      if (current == null) return null;
      try {
        const started = await run({
          revision: current,
          mode,
          targetCellId,
          maxAssets: 10,
        });
        // The hook drives the editor's live view; this waits for the answer,
        // which is what a caller that has to react to the result needs.
        return await awaitExecution(started.id);
      } catch (error) {
        setSaveError(await extractApiErrorMessage(error, t("notebook.failed")));
        return null;
      }
    },
    [dirty, save, run, t],
  );

  React.useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      getCells: () => cellsRef.current,
      setCells: mutate,
      run: runMode,
      runAndSummarize: async (mode, targetCellId) =>
        summarizeExecution(await runMode(mode, targetCellId)),
      cancel: () => void cancel(),
      save,
    };
    return () => {
      handleRef.current = null;
    };
  }, [cancel, handleRef, mutate, runMode, save]);

  React.useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const reload = React.useCallback(async () => {
    const fresh = (await api.notebooks.notebookControllerGet({
      sourceId,
    })) as unknown as { revision: number; cells: NotebookCell[] };
    setCells(fresh.cells);
    setRevision(fresh.revision);
    revisionRef.current = fresh.revision;
    setDirty(false);
    setConflict(null);
  }, [sourceId]);

  // -- execution results ---------------------------------------------------

  const resultByCell = React.useMemo(() => {
    const map = new Map<
      string,
      { outputs: CellOutputValue[]; durationMs: number }
    >();
    for (const entry of execution?.outputs?.cells ?? []) {
      map.set(entry.cellId, {
        outputs: (entry.outputs ?? []) as CellOutputValue[],
        durationMs: entry.durationMs,
      });
    }
    return map;
  }, [execution]);

  const cellStatus = (cellId: string): CellStatus => {
    if (!execution) return "idle";
    if (execution.status === "PENDING") return "queued";
    if (execution.status === "RUNNING") {
      // In cell mode only the target is "the cell you are waiting on"; the rest
      // are being replayed to rebuild state.
      return execution.mode === "cell"
        ? execution.targetCellId === cellId
          ? "running"
          : "idle"
        : "running";
    }
    if (execution.failedCellId === cellId) return "error";
    return resultByCell.has(cellId) ? "success" : "idle";
  };

  const contract = execution?.outputs?.contract;
  const verdict = execution?.outputs?.result;
  const preview = execution?.outputs?.assets;

  return (
    <div className="space-y-4" data-testid="notebook-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Run, Test connection and Preview live in the page's sticky toolbar:
            all three need the source saved first, which is the page's job, and
            two rows of run buttons on one screen invited the wrong one. Only
            Stop stays, because it is only meaningful while this editor is
            executing. */}
        <div className="flex items-center gap-2">
          {busy && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void cancel()}
              data-testid="notebook-cancel"
            >
              <Square className="mr-2 h-4 w-4" />
              {t("notebook.cancel")}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t("notebook.revision", { revision })}</span>
          <span data-testid="notebook-save-state">
            {saving
              ? t("notebook.saving")
              : dirty
                ? t("notebook.unsaved")
                : t("notebook.saved")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.href = `${window.location.pathname.replace(/\/$/, "")}/notebook/export`;
            }}
            disabled={disabled}
          >
            <Download className="mr-2 h-3.5 w-3.5" />
            {t("notebook.exportPython")}
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("notebook.sideEffectWarning")}
      </p>

      {conflict && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium">
                {t("notebook.conflictTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("notebook.conflictBody", {
                  current: conflict.current,
                  yours: conflict.yours,
                })}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void reload()}
                data-testid="notebook-reload"
              >
                {t("notebook.conflictReload")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {saveError && (
        <p
          className="text-sm font-medium text-destructive"
          data-testid="notebook-save-error"
        >
          {saveError}
        </p>
      )}

      {contract && !contract.ok && (
        <Card className="border-amber-500/50">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("notebook.contract.title")}
              </p>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {(contract.violations as Array<{ message: string }>).map(
                  (violation, index) => (
                    <li key={index}>{violation.message}</li>
                  ),
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shown independently of `ok`: a warning never blocks a save, and the
          one it exists for — a later cell silently replacing an earlier cell's
          helper, because cells share one module namespace — leaves a notebook
          that is perfectly valid and quietly broken at runtime. */}
      {contract &&
        Array.isArray(contract.warnings) &&
        (contract.warnings as Array<{ message: string }>).length > 0 && (
          <Card className="border-amber-500/30">
            <CardContent className="flex items-start gap-3 pt-6">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("notebook.contract.warningsTitle")}
                </p>
                <ul className="space-y-0.5 text-sm text-muted-foreground">
                  {(contract.warnings as Array<{ message: string }>).map(
                    (warning, index) => (
                      <li key={index}>{warning.message}</li>
                    ),
                  )}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

      {verdict && (
        <Card
          className={cn(
            verdict.status === "SUCCESS"
              ? "border-emerald-500/50"
              : "border-destructive/50",
          )}
        >
          <CardContent className="flex items-start gap-3 pt-6">
            {verdict.status === "SUCCESS" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <p className="text-sm">{verdict.message}</p>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">
              {t("notebook.previewTitle", { count: preview.length })}
            </p>
            {preview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("notebook.previewEmpty")}
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border">
                <pre className="p-3 font-mono text-xs">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <CellList
        notebookId={sourceId}
        cells={cells}
        onChange={mutate}
        disabled={disabled}
        onSave={() => void save()}
        onRunCell={(cellId) =>
          onRunCell ? onRunCell(cellId) : void runMode("cell", cellId)
        }
        runState={(cellId) => ({
          status: cellStatus(cellId),
          outputs: resultByCell.get(cellId)?.outputs ?? [],
          durationMs: resultByCell.get(cellId)?.durationMs ?? null,
          error: execution?.failedCellId === cellId ? execution.error : null,
          blamed:
            execution?.failedCellId === cellId &&
            execution.targetCellId !== cellId,
        })}
      />
    </div>
  );
}
