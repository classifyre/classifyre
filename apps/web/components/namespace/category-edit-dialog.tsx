"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type NamespaceCategory } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Rename / re-describe a category. Shared by the category index and a single
 * category's page, because a rename is felt in both places and they must not
 * disagree about what the form allows.
 */
export function CategoryEditDialog({
  category,
  onOpenChange,
  onSaved,
}: {
  /** The category being edited; `null` closes the dialog. */
  category: NamespaceCategory | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (category: NamespaceCategory) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Re-seed the form whenever a different category is opened.
  React.useEffect(() => {
    setTitle(category?.title ?? "");
    setDescription(category?.description ?? "");
  }, [category]);

  const save = async () => {
    if (!category || !title.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await api.namespaces.updateCategory(category.id, {
        title: title.trim(),
        description: description.trim() || null,
      });
      toast.success(t("categories.updateSuccess"));
      onSaved(updated);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("categories.updateFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={category !== null}
      onOpenChange={(next) => !next && onOpenChange(false)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("categories.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("categories.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-category-title">{t("common.name")}</Label>
            <Input
              id="edit-category-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={60}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-category-description">
              {t("common.description")}
            </Label>
            <Textarea
              id="edit-category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => void save()}
            disabled={!title.trim() || saving}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
