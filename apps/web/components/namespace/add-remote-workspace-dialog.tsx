"use client";

import * as React from "react";
import { toast } from "sonner";
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
import { useTranslation } from "@/hooks/use-translation";

function isValidRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname) ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function AddRemoteWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspace: ElectronNamespace) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [remoteUrl, setRemoteUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [urlError, setUrlError] = React.useState(false);

  const reset = () => {
    setName("");
    setRemoteUrl("");
    setSubmitting(false);
    setUrlError(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const electron = window.electronAPI;
    const trimmedName = name.trim();
    const trimmedUrl = remoteUrl.trim().replace(/\/+$/, "");
    if (!electron || !trimmedName || submitting) return;
    if (!isValidRemoteUrl(trimmedUrl)) {
      setUrlError(true);
      return;
    }

    setSubmitting(true);
    try {
      const verified = await electron.verifyRemoteInstance(trimmedUrl);
      const workspace = await electron.createNamespace(
        trimmedName,
        verified.normalizedUrl,
      );
      onCreated(workspace);
      toast.success(
        t("workspaces.remoteCreateSuccess", { name: workspace.name }),
      );
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("workspaces.remoteCreateFailed"),
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
            <DialogTitle>{t("workspaces.remoteCreateTitle")}</DialogTitle>
            <DialogDescription>
              {t("workspaces.remoteCreateDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="remote-workspace-name">
                {t("common.name")}
              </Label>
              <Input
                id="remote-workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("workspaces.remoteNamePlaceholder")}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remote-workspace-url">
                {t("workspaces.remoteUrl")}
              </Label>
              <Input
                id="remote-workspace-url"
                type="url"
                value={remoteUrl}
                onChange={(event) => {
                  setRemoteUrl(event.target.value);
                  setUrlError(false);
                }}
                placeholder="https://classifyre.example.com"
                aria-invalid={urlError}
              />
              {urlError && (
                <p className="text-xs text-destructive">
                  {t("workspaces.remoteUrlInvalid")}
                </p>
              )}
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
              disabled={!name.trim() || !remoteUrl.trim() || submitting}
            >
              {submitting
                ? t("workspaces.remoteAdding")
                : t("workspaces.addRemote")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
