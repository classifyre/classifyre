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

type PurgeFindingsActionProps = {
  sourceId: string;
  className?: string;
  onPurged?: () => void;
};

export function PurgeFindingsAction({
  sourceId,
  className,
  onPurged,
}: PurgeFindingsActionProps) {
  const { t } = useTranslation();
  const [isPurging, setIsPurging] = useState(false);

  const handlePurge = async () => {
    try {
      setIsPurging(true);
      await api.sources.sourcesControllerPurgeFindings({ id: sourceId });
      toast.success(t("sources.purgeFindings.success"));
      onPurged?.();
    } catch (error) {
      console.error("Failed to purge findings:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("sources.purgeFindings.failed"),
      );
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={isPurging}
          className={cn(
            "rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10",
            className,
          )}
          data-testid="btn-purge-findings"
        >
          {isPurging ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eraser className="h-4 w-4" />
          )}
          {t("sources.purgeFindings.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("sources.purgeFindings.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("sources.purgeFindings.cannotUndo")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="destructive" className="border-destructive/40">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{t("sources.purgeFindings.permanentTitle")}</AlertTitle>
          <AlertDescription>
            {t("sources.purgeFindings.permanentBody")}
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
            data-testid="btn-purge-findings-confirm"
          >
            {t("sources.purgeFindings.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
