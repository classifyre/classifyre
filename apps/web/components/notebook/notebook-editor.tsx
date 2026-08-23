"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  Play,
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
import { useNotebookExecution } from "./use-notebook-execution";

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
  /** Called after a successful save so the container can track the revision. */
  onSaved?: (revision: number) => void;
  onCellsChange?: (cells: NotebookCell[]) => void;
}

const AUTOSAVE_DELAY_MS = 1500;

/** The notebook, for callers that live outside the editor. */
export interface NotebookEditorHandle {
  getCells: () => NotebookCell[];
  setCells: (cells: NotebookCell[]) => void;
}

export function NotebookEditor({
  sourceId,
  cells: initialCells,
  revision: initialRevision,
  disabled = false,
  handleRef,
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

  React.useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      getCells: () => cellsRef.current,
      setCells: mutate,
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, mutate]);

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
    ) => {
      const current = dirty ? await save() : revisionRef.current;
      if (current == null) return;
      try {
        await run({ revision: current, mode, targetCellId, maxAssets: 10 });
      } catch (error) {
        setSaveError(await extractApiErrorMessage(error, t("notebook.failed")));
      }
    },
    [dirty, save, run, t],
  );

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
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void runMode("all")}
            disabled={disabled || busy}
            data-testid="notebook-run-all"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {t("notebook.runAll")}
          </Button>
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void runMode("test_connection")}
            disabled={disabled || busy}
          >
            {t("notebook.testConnection")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void runMode("preview_extract")}
            disabled={disabled || busy}
            data-testid="notebook-preview"
          >
            {t("notebook.previewExtract")}
          </Button>
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
        onRunCell={(cellId) => void runMode("cell", cellId)}
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
