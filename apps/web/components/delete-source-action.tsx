"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
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

type DeleteSourceActionProps = {
  sourceId: string;
  className?: string;
  iconOnly?: boolean;
  onDeleted?: () => void;
};

export function DeleteSourceAction({
  sourceId,
  className,
  iconOnly = false,
  onDeleted,
}: DeleteSourceActionProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await api.sources.sourcesControllerDeleteSource({ id: sourceId });
      toast.success(t("sources.deleted"));
      if (onDeleted) {
        onDeleted();
      } else {
        router.push("/sources");
      }
    } catch (error) {
      console.error("Failed to delete source:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete source",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {iconOnly ? (
          <Button
            size="sm"
            variant="outline"
            disabled={isDeleting}
            className={cn(
              "h-8 rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10",
              className,
            )}
            data-testid="btn-delete-source"
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={isDeleting}
            className={cn(
              "rounded-[4px] border-2 border-black bg-[#ff2b2b] text-white shadow-[3px_3px_0_#000] hover:bg-[#e62626]",
              className,
            )}
            data-testid="btn-delete-source"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Source
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-[6px] border-2 border-black">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete source?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert variant="destructive" className="border-destructive/40">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Permanent removal</AlertTitle>
          <AlertDescription>
            Deleting this source will permanently remove the source, all related
            assets, and all findings.
          </AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isDeleting}
            onClick={handleDelete}
            className="rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
            data-testid="btn-delete-confirm"
          >
            {isDeleting ? "Deleting..." : "Delete Source"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
