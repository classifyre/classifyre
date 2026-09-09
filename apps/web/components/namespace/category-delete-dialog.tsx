"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, type NamespaceCategory } from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Delete a category. The confirmation names how many workspaces are affected
 * and says plainly that none of them is deleted — a category is a label, and
 * the fear it should not provoke is "did I just drop four workspaces?".
 */
export function CategoryDeleteDialog({
  category,
  onOpenChange,
  onDeleted,
}: {
  category: NamespaceCategory | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (category: NamespaceCategory) => void;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = React.useState(false);

  const confirm = async () => {
    if (!category) return;
    setDeleting(true);
    try {
      await api.namespaces.removeCategory(category.id);
      toast.success(t("categories.deleteSuccess", { title: category.title }));
      onDeleted(category);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("categories.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={category !== null}
      onOpenChange={(next) => !next && onOpenChange(false)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("categories.deleteTitle", { title: category?.title ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("categories.deleteConfirm", {
              count: category?.workspaceCount ?? 0,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? t("common.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
