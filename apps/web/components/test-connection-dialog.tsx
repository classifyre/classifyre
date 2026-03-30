"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export type TestConnectionStatus = "loading" | "success" | "error";

interface TestConnectionDialogProps {
  open: boolean;
  status: TestConnectionStatus;
  message: string;
  onOpenChange: (open: boolean) => void;
}

export function TestConnectionDialog({
  open,
  status,
  message,
  onOpenChange,
}: TestConnectionDialogProps) {
  const { t } = useTranslation();
  const isLocked = status === "loading";

  const titleByStatus: Record<TestConnectionStatus, string> = {
    loading: t("sources.testConnection.titleTesting"),
    success: t("sources.testConnection.titleOk"),
    error: t("sources.testConnection.titleError"),
  };

  const descriptionByStatus: Record<TestConnectionStatus, string> = {
    loading: t("sources.testConnection.descTesting"),
    success: t("sources.testConnection.descOk"),
    error: t("sources.testConnection.descError"),
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isLocked && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000] sm:max-w-md"
        showCloseButton={!isLocked}
        onEscapeKeyDown={(event) => {
          if (isLocked) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (isLocked) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isLocked) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="gap-3 text-left">
          <div className="flex items-center gap-2">
            {status === "loading" ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : status === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            <DialogTitle>{titleByStatus[status]}</DialogTitle>
          </div>
          <DialogDescription>{descriptionByStatus[status]}</DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "rounded-[4px] border-2 border-black/15 bg-muted/30 p-3 text-sm",
            status === "error" && "border-destructive/30 bg-destructive/5",
          )}
        >
          {message}
        </div>

        <DialogFooter className="sm:justify-end">
          {isLocked ? (
            <div className="text-xs text-muted-foreground">{t("sources.testConnection.wait")}</div>
          ) : (
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
            >
              {t("sources.testConnection.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
