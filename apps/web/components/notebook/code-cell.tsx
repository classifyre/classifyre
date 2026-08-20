"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTheme } from "next-themes";
import { Loader2, Play } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
// Loaded client-only: monaco-editor references `window` at module-evaluation
// time, which crashes SSR if this is ever pulled into a server chunk.
const Editor = dynamic(() => import("@/components/monaco-editor-lazy"), {
  ssr: false,
});
import { CellOutputs, ErrorView, type CellOutputValue } from "./cell-output";
import { CellToolbar } from "./cell-toolbar";

export type CellStatus = "idle" | "queued" | "running" | "success" | "error";

export interface CodeCellProps {
  notebookId: string;
  cellId: string;
  index: number;
  source: string;
  status: CellStatus;
  outputs: CellOutputValue[];
  error?: {
    type?: string;
    message?: string;
    traceback?: string[];
    cellId?: string | null;
  } | null;
  durationMs?: number | null;
  /** True when another cell's failure is what stopped this one. */
  blamed?: boolean;
  disabled?: boolean;
  /** False before the source exists: there is no stored revision to run. */
  runnable?: boolean;
  deletable?: boolean;
  undeletableReason?: string;
  onChange: (source: string) => void;
  onRun: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddCodeBelow?: () => void;
  onAddMarkdownBelow?: () => void;
  onSave: () => void;
  /** Extra toolbar controls, rendered at the bottom of the strip. */
  toolbarFooter?: React.ReactNode;
}

/**
 * A cell opens at six lines and grows with its content.
 *
 * Six because a connector function plus its docstring is about that tall, so a
 * fresh cell looks like somewhere to write rather than a single-line box; and
 * because growing from a floor avoids the jitter of a box that resizes on the
 * first keystroke.
 */
const MIN_LINES = 6;
const LINE_HEIGHT = 19;
const VERTICAL_PADDING = 20;

function heightForLines(lines: number): number {
  return Math.max(MIN_LINES, lines) * LINE_HEIGHT + VERTICAL_PADDING;
}

export function CodeCell({
  notebookId,
  cellId,
  index,
  source,
  status,
  outputs,
  error,
  durationMs,
  blamed = false,
  disabled = false,
  runnable = true,
  deletable = true,
  undeletableReason,
  onChange,
  onRun,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAddCodeBelow,
  onAddMarkdownBelow,
  onSave,
  toolbarFooter,
}: CodeCellProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [height, setHeight] = React.useState(() =>
    heightForLines(source.split("\n").length),
  );

  // Read through a ref inside Monaco's command handlers: the commands are
  // registered once on mount, and a stale closure there would run an old
  // cell's source.
  const handlers = React.useRef({ onRun, onSave });
  handlers.current = { onRun, onSave };

  const handleMount = React.useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      const applyHeight = () =>
        setHeight(heightForLines(instance.getModel()?.getLineCount() ?? 1));
      applyHeight();
      instance.onDidChangeModelContent(applyHeight);

      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        handlers.current.onRun(),
      );
      instance.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () =>
        handlers.current.onRun(),
      );
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        handlers.current.onSave(),
      );
    },
    [],
  );

  const running = status === "running" || status === "queued";

  return (
    <div
      className={cn(
        "rounded-md border bg-card transition-colors",
        status === "error" && "border-destructive/50",
        blamed && "border-destructive ring-1 ring-destructive/30",
      )}
      data-testid={`cell-${cellId}`}
      data-cell-status={status}
    >
      <div className="flex items-start gap-2 p-2">
        <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1">
          {runnable && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRun}
              disabled={disabled || running}
              aria-label={t("notebook.runCell")}
              data-testid={`run-cell-${cellId}`}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            [{index + 1}]
          </span>
        </div>

        <div
          className="min-w-0 flex-1 overflow-hidden rounded border bg-background"
          style={{ height }}
        >
          <Editor
            height={height}
            defaultLanguage="python"
            // A stable per-cell model URI keeps undo history, markers and the
            // cursor attached to the cell rather than to the editor slot.
            path={`notebook://${notebookId}/${cellId}.py`}
            value={source}
            onChange={(value) => onChange(value ?? "")}
            onMount={handleMount}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
            loading={
              <Textarea
                value={source}
                onChange={(event) => onChange(event.target.value)}
                className="min-h-full rounded-none border-0 font-mono text-sm"
                disabled={disabled}
              />
            }
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 4,
              overviewRulerLanes: 0,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: { vertical: "hidden", alwaysConsumeMouseWheel: false },
              renderLineHighlight: "none",
              padding: { top: 8, bottom: 8 },
              fontSize: 13,
              tabSize: 4,
              insertSpaces: true,
              wordWrap: "on",
              readOnly: disabled,
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
              tabCompletion: "on",
              // The editor lives in a fixed-height, overflow-hidden box sized
              // to its content, so a suggestion list rendered inside it is
              // clipped at the cell boundary -- usually after one row. This
              // moves overflow widgets (suggestions, hovers, parameter hints)
              // into a body-level container so they can extend past the cell.
              fixedOverflowWidgets: true,
            }}
          />
        </div>

        <CellToolbar
          cellId={cellId}
          disabled={disabled}
          deletable={deletable}
          undeletableReason={undeletableReason}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onAddCodeBelow={onAddCodeBelow}
          onAddMarkdownBelow={onAddMarkdownBelow}
          footer={toolbarFooter}
        />
      </div>

      {(outputs.length > 0 || error || durationMs != null) && (
        <div className="space-y-2 border-t px-2 pb-2 pt-2">
          {durationMs != null && status === "success" && (
            <p className="text-[11px] text-muted-foreground">
              {t("notebook.succeeded", { duration: `${durationMs} ms` })}
            </p>
          )}
          <CellOutputs outputs={outputs} />
          {error && <ErrorView error={error} cellId={cellId} />}
        </div>
      )}
    </div>
  );
}
