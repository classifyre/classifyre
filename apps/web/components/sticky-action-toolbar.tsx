"use client";

import type { ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { Card } from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";

type StickyActionToolbarProps = {
  onSave: () => void;
  onTest: () => void;
  onSaveAndRun: () => void;
  saveLabel: string;
  testLabel: string;
  saveAndRunLabel: string;
  isBusy?: boolean;
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
  className,
  saveAndRunTestId,
  testIcon,
  runIcon,
}: StickyActionToolbarProps) {
  return (
    <Card className={cn("sticky bottom-0 z-30 p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onSave}
          disabled={isBusy}
          data-testid="btn-save-source"
        >
          {saveLabel}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={isBusy}
            data-testid="btn-test-source"
          >
            {testIcon}
            {testLabel}
          </Button>
          <Button
            type="submit"
            onClick={onSaveAndRun}
            disabled={isBusy}
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
