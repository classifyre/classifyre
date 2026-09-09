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
 * Minimal "new category" dialog. Deliberately just a title and a description:
 * a category is a shelf label, and anything more would be a second workspace
 * settings page. Nested inside the workspace create/edit forms, so it never
 * takes the operator away from what they were actually doing.
 */
export function CreateCategoryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: NamespaceCategory) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setSubmitting(false);
  };

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const category = await api.namespaces.createCategory({
        title: title.trim(),
        description: description.trim() || null,
      });
      toast.success(t("categories.createSuccess", { title: category.title }));
      onCreated(category);
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("categories.createFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("categories.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("categories.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="category-title">{t("common.name")}</Label>
            <Input
              id="category-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("categories.titlePlaceholder")}
              maxLength={60}
              autoFocus
              // The dialog is opened from inside another <form>; Enter here must
              // create the category, never submit the workspace behind it.
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category-description">
              {t("workspaces.descriptionOptional")}
            </Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("categories.descriptionPlaceholder")}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => void submit()}
            disabled={!title.trim() || submitting}
          >
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t("categories.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
