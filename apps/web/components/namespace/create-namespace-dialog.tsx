"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api, type Namespace } from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { ThumbnailPicker } from "@/components/namespace/thumbnail-picker";
import { useTranslation } from "@/hooks/use-translation";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

export function CreateNamespaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (namespace: Namespace) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const slug = slugify(name);

  const reset = () => {
    setName("");
    setDescription("");
    setThumbnail(null);
    setSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const namespace = await api.namespaces.create({
        name: name.trim(),
        description: description.trim() || undefined,
        thumbnail: thumbnail ?? undefined,
      });
      toast.success(t("workspaces.createSuccess", { name: namespace.name }));
      onCreated(namespace);
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspaces.createFailed"),
      );
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
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("workspaces.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("workspaces.createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ns-name">{t("common.name")}</Label>
              <Input
                id="ns-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspaces.namePlaceholder")}
                autoFocus
              />
              {slug && (
                <p className="text-muted-foreground text-xs">
                  {t("workspaces.url")}: <span className="font-mono">/{slug}</span>
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns-description">
                {t("workspaces.descriptionOptional")}
              </Label>
              <Textarea
                id="ns-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("workspaces.descriptionPlaceholder")}
                rows={2}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("workspaces.thumbnailOptional")}</Label>
              <ThumbnailPicker
                value={thumbnail}
                onChange={setThumbnail}
                disabled={submitting}
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
              type="submit"
              variant="default"
              disabled={!name.trim() || submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("workspaces.createAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
