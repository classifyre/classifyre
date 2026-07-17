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
  onSave: () => void;
  onTest: () => void;
  onSaveAndRun: () => void;
  saveLabel: string;
  testLabel: string;
  saveAndRunLabel: string;
  isBusy?: boolean;
  disabled?: boolean;
  className?: string;
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
  isBusy = false,
  disabled = false,
  className,
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
        <Button
          type="button"
          variant="outline"
          onClick={onSave}
          disabled={isBusy || disabled}
          data-testid="btn-save-source"
        >
          {saveLabel}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={isBusy || disabled}
            data-testid="btn-test-source"
          >
            {testIcon}
            {testLabel}
          </Button>
          <Button
            type="submit"
            onClick={onSaveAndRun}
            disabled={isBusy || disabled}
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
