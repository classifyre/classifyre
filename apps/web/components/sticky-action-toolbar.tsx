"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { Card } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";

/**
 * While a sticky bottom toolbar is mounted, publish its height so floating
 * elements (the assistant FAB) can raise themselves above it instead of
 * covering Save/Test/Run.
 */
function useAssistantFabOffset(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") {
      return;
    }
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty(
        "--assistant-fab-offset",
        `${element.offsetHeight + 8}px`,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--assistant-fab-offset");
    };
  }, [ref]);
}

type StickyActionToolbarProps = {
  /** Secondary "save without running" action — omitted when a flow has none. */
  onSave?: () => void;
  /** Secondary "dry run" action — omitted when a flow has none. */
  onTest?: () => void;
  onSaveAndRun: () => void;
  saveLabel?: string;
  testLabel?: string;
  saveAndRunLabel: string;
  /** Left-most escape hatch (back / cancel). */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Small muted note rendered next to the secondary actions. */
  hint?: ReactNode;
  isBusy?: boolean;
  disabled?: boolean;
  /** Disables only the primary action (e.g. a required field is still empty). */
  saveAndRunDisabled?: boolean;
  className?: string;
  saveTestId?: string;
  testTestId?: string;
  saveAndRunTestId?: string;
  testIcon?: ReactNode;
  runIcon?: ReactNode;
};

export function StickyActionToolbar({
  onSave,
  onTest,
  onSaveAndRun,
  saveLabel,
  testLabel,
  saveAndRunLabel,
  onCancel,
  cancelLabel,
  hint,
  isBusy = false,
  disabled = false,
  saveAndRunDisabled = false,
  className,
  saveTestId = "btn-save-source",
  testTestId = "btn-test-source",
  saveAndRunTestId,
  testIcon,
  runIcon,
}: StickyActionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  useAssistantFabOffset(toolbarRef);

  return (
    <Card
      ref={toolbarRef}
      className={cn("sticky bottom-0 z-30 p-4", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {onCancel && cancelLabel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isBusy}
              data-testid="btn-cancel"
            >
              {cancelLabel}
            </Button>
          )}
          {onSave && saveLabel && (
            <Button
              type="button"
              variant="outline"
              onClick={onSave}
              disabled={isBusy || disabled}
              data-testid={saveTestId}
            >
              {saveLabel}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {hint && (
            <span className="text-muted-foreground hidden text-[11px] sm:block">
              {hint}
            </span>
          )}
          {onTest && testLabel && (
            <Button
              type="button"
              variant="outline"
              onClick={onTest}
              disabled={isBusy || disabled}
              data-testid={testTestId}
            >
              {testIcon}
              {testLabel}
            </Button>
          )}
          <Button
            type="submit"
            onClick={onSaveAndRun}
            disabled={isBusy || disabled || saveAndRunDisabled}
            data-testid={saveAndRunTestId}
          >
            {runIcon}
            {saveAndRunLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
