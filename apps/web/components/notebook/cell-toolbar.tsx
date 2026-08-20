"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import { siMarkdown, siPython } from "simple-icons";
import { simpleIconComponent } from "@workspace/ui/components/simple-icon";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";

// The cell types are Python and Markdown, so they get those marks rather
// than a generic code/text glyph.
const PythonIcon = simpleIconComponent(siPython);
const MarkdownIcon = simpleIconComponent(siMarkdown);

export interface CellToolbarProps {
  cellId: string;
  disabled?: boolean;
  deletable?: boolean;
  /** Why delete is unavailable, shown on the disabled control. */
  undeletableReason?: string;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddCodeBelow?: () => void;
  onAddMarkdownBelow?: () => void;
}

/**
 * The controls that belong to one cell.
 *
 * Permanently visible rather than revealed on hover: these are the only way to
 * reorder or extend a notebook, and a control you have to discover by hovering
 * is a control most people never find. "Add below" lives here too, so a cell's
 * actions are in one place instead of split between the cell and a row beneath
 * it.
 */
export function CellToolbar({
  cellId,
  disabled = false,
  deletable = true,
  undeletableReason,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAddCodeBelow,
  onAddMarkdownBelow,
}: CellToolbarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex shrink-0 flex-col gap-0.5 rounded-md border bg-muted/30 p-0.5"
      data-testid={`cell-toolbar-${cellId}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onMoveUp}
        disabled={disabled || !onMoveUp}
        aria-label={t("notebook.moveUp")}
        data-testid={`move-up-${cellId}`}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onMoveDown}
        disabled={disabled || !onMoveDown}
        aria-label={t("notebook.moveDown")}
        data-testid={`move-down-${cellId}`}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onDuplicate}
        disabled={disabled}
        aria-label={t("notebook.duplicateCell")}
        data-testid={`duplicate-${cellId}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        disabled={disabled || !deletable}
        title={undeletableReason}
        aria-label={undeletableReason ?? t("notebook.deleteCell")}
        data-testid={`delete-cell-${cellId}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      {(onAddCodeBelow || onAddMarkdownBelow) && (
        <>
          <div className="mx-1 my-0.5 border-t" />
          {onAddCodeBelow && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-6 w-6"
              onClick={onAddCodeBelow}
              disabled={disabled}
              aria-label={t("notebook.addCodeBelow")}
              title={t("notebook.addCodeBelow")}
              data-testid={`add-code-below-${cellId}`}
            >
              <PythonIcon className="h-3.5 w-3.5" />
              <Plus className="absolute bottom-0.5 right-0.5 h-2 w-2" />
            </Button>
          )}
          {onAddMarkdownBelow && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative h-6 w-6"
              onClick={onAddMarkdownBelow}
              disabled={disabled}
              aria-label={t("notebook.addMarkdownBelow")}
              title={t("notebook.addMarkdownBelow")}
              data-testid={`add-markdown-below-${cellId}`}
            >
              <MarkdownIcon className="h-3.5 w-3.5" />
              <Plus className="absolute bottom-0.5 right-0.5 h-2 w-2" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
