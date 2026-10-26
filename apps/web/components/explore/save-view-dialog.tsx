"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
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

/** Name a view to save, save it as a new one, or rename the one open. */
export function SaveViewDialog({
  open,
  onOpenChange,
  title,
  initialName = "",
  initialDescription = "",
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName?: string;
  initialDescription?: string;
  onSave: (input: { name: string; description: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(initialDescription);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
  }, [initialDescription, initialName, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("explore.saved.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="explore-view-name">{t("explore.saved.name")}</Label>
            <Input
              id="explore-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder={t("explore.saved.namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="explore-view-description">{t("explore.saved.description")}</Label>
            <Textarea
              id="explore-view-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("explore.saved.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
