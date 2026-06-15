"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { CorrelationTuningPanel } from "./correlation-tuning-panel";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Dialog wrapper around the shared tuning panel — used in the asset/source
 * fingerprints contexts where a full tab isn't warranted.
 */
export function CorrelationTuningDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("correlation.tune.title")}</DialogTitle>
          <DialogDescription>{t("correlation.tune.desc")}</DialogDescription>
        </DialogHeader>
        {open && (
          <CorrelationTuningPanel
            layout="dialog"
            onSaved={() => {
              onOpenChange(false);
              onSaved?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
