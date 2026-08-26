"use client";

import { useState } from "react";
import { Eraser, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@workspace/api-client";
import { useTranslation } from "@/hooks/use-translation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";

type PurgeAssetsActionProps = {
  sourceId: string;
  className?: string;
  onPurged?: () => void;
  /** Render only the confirmation dialog, controlled by `open`/`onOpenChange` — for embedding the action in a menu that owns its own trigger. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PurgeAssetsAction({
  sourceId,
  className,
  onPurged,
  hideTrigger = false,
  open,
  onOpenChange,
}: PurgeAssetsActionProps) {
  const { t } = useTranslation();
  const [isPurging, setIsPurging] = useState(false);

  const handlePurge = async () => {
    try {
      setIsPurging(true);
      await api.sources.sourcesControllerPurgeAssets({ id: sourceId });
      toast.success(t("sources.purgeAssets.success"));
      onPurged?.();
    } catch (error) {
      console.error("Failed to purge assets:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("sources.purgeAssets.failed"),
      );
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {!hideTrigger && (
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={isPurging}
            className={cn(
              "rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10",
              className,
            )}
            data-testid="btn-purge-assets"
          >
            {isPurging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eraser className="h-4 w-4" />
            )}
            {t("sources.purgeAssets.button")}
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("sources.purgeAssets.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("sources.purgeAssets.cannotUndo")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="destructive" className="border-destructive/40">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{t("sources.purgeAssets.permanentTitle")}</AlertTitle>
          <AlertDescription>
            {t("sources.purgeAssets.permanentBody")}
          </AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPurging}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPurging}
            onClick={handlePurge}
            className="rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)]"
            data-testid="btn-purge-assets-confirm"
          >
            {t("sources.purgeAssets.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
