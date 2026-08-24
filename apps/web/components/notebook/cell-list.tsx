"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { siMarkdown, siPython } from "simple-icons";
import { simpleIconComponent } from "@workspace/ui/components/simple-icon";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import {
  addCell,
  appendCells,
  deleteCell,
  duplicateCell,
  moveCell,
  protectedCellIds,
  updateCellSource,
  type NotebookCell,
} from "@/lib/notebook-cells";
import { CodeCell, type CellStatus } from "./code-cell";
import { MarkdownCell } from "./markdown-cell";
import { TemplatePicker } from "./template-picker";
import type { CellOutputValue } from "./cell-output";

export interface CellRunState {
  status: CellStatus;
  outputs: CellOutputValue[];
  durationMs?: number | null;
  error?: {
    type?: string;
    message?: string;
    traceback?: string[];
    cellId?: string | null;
  } | null;
  blamed?: boolean;
}

export interface CellListProps {
  notebookId: string;
  cells: NotebookCell[];
  onChange: (cells: NotebookCell[]) => void;
  disabled?: boolean;
  onSave?: () => void;
  /** Absent while drafting: there is no stored revision to execute yet. */
  onRunCell?: (cellId: string) => void;
  runState?: (cellId: string) => CellRunState;
}

const IDLE: CellRunState = { status: "idle", outputs: [] };

const PythonIcon = simpleIconComponent(siPython);
const MarkdownIcon = simpleIconComponent(siMarkdown);

/**
 * The notebook's cells, plus the controls that reorder them.
 *
 * Shared by the saved editor and the pre-creation draft so the two cannot drift:
 * before this existed the draft had no add, no move and a dead duplicate button,
 * because it was a second implementation that nobody kept in step.
 */
export function CellList({
  notebookId,
  cells,
  onChange,
  disabled = false,
  onSave,
  onRunCell,
  runState,
}: CellListProps) {
  const { t } = useTranslation();
  const locked = React.useMemo(() => protectedCellIds(cells), [cells]);
  const noop = React.useCallback(() => undefined, []);

  return (
    <div className="space-y-3" data-testid="notebook-cells">
      {cells.map((cell, index) => {
        const shared = {
          cellId: cell.id,
          index,
          source: cell.source,
          disabled,
          // The last cell defining a required function cannot go, or the
          // notebook stops being a connector.
          deletable: !locked.has(cell.id) && cells.length > 1,
          undeletableReason: locked.has(cell.id)
            ? t("notebook.cellRequired")
            : undefined,
          onChange: (source: string) =>
            onChange(updateCellSource(cells, cell.id, source)),
          onDelete: () => onChange(deleteCell(cells, cell.id)),
          onDuplicate: () => onChange(duplicateCell(cells, index)),
          onMoveUp:
            index > 0 ? () => onChange(moveCell(cells, index, -1)) : undefined,
          onMoveDown:
            index < cells.length - 1
              ? () => onChange(moveCell(cells, index, 1))
              : undefined,
          onAddCodeBelow: () => onChange(addCell(cells, "code", index)),
          onAddMarkdownBelow: () => onChange(addCell(cells, "markdown", index)),
          onSave: onSave ?? noop,
        };

        const state = runState?.(cell.id) ?? IDLE;

        return (
          <div key={cell.id} className="space-y-2">
            {cell.type === "markdown" ? (
              <MarkdownCell {...shared} />
            ) : (
              <CodeCell
                {...shared}
                notebookId={notebookId}
                status={state.status}
                outputs={state.outputs}
                durationMs={state.durationMs}
                error={state.error}
                blamed={state.blamed}
                runnable={Boolean(onRunCell)}
                onRun={() => onRunCell?.(cell.id)}
              />
            )}
          </div>
        );
      })}

      {/* Appending at the end still needs a control of its own: the per-cell
          "add below" buttons only reach as far as the last cell. */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addCell(cells, "code"))}
          disabled={disabled}
          data-testid="notebook-add-code"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          <PythonIcon className="mr-1.5 h-3.5 w-3.5" />
          {t("notebook.addCode")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(addCell(cells, "markdown"))}
          disabled={disabled}
          data-testid="notebook-add-markdown"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          <MarkdownIcon className="mr-1.5 h-3.5 w-3.5" />
          {t("notebook.addMarkdown")}
        </Button>
        <TemplatePicker
          disabled={disabled}
          onInsert={(incoming) => onChange(appendCells(cells, incoming))}
        />
      </div>
    </div>
  );
}
