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
import { NamespaceSeedPicker } from "@/components/namespace/namespace-seed-picker";
import { useTranslation } from "@/hooks/use-translation";
import { useTransferJob } from "@/hooks/use-transfer-job";
import {
  apiBaseForNamespace,
  isTerminal,
  startImport,
  uploadArchive,
  type UploadProgress,
} from "@/lib/data-transfer-api";

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
  const [seedFile, setSeedFile] = React.useState<File | null>(null);
  // Non-null only while the archive is going up, before there is a job to poll.
  const [upload, setUpload] = React.useState<UploadProgress | null>(null);
  // Set once the workspace exists and its seed import has been queued.
  const [seed, setSeed] = React.useState<{
    jobId: string;
    apiBase: string;
    namespace: Namespace;
  } | null>(null);

  const { job: seedJob } = useTransferJob(seed?.jobId ?? null, seed?.apiBase);
  const seedDone = seedJob !== null && isTerminal(seedJob.status);

  const slug = slugify(name);

  const reset = () => {
    setName("");
    setDescription("");
    setThumbnail(null);
    setSubmitting(false);
    setSeedFile(null);
    setUpload(null);
    setSeed(null);
  };

  /**
   * Load the attached archive into the freshly created workspace.
   *
   * Everything the archive holds is imported: this is a brand-new workspace, so
   * there is nothing to choose between and nothing to collide with. Failure is
   * reported but does not undo the workspace — an empty workspace the operator
   * can retry into is a better outcome than losing the one they just named.
   */
  const seedFromArchive = async (namespace: Namespace, file: File) => {
    const base = apiBaseForNamespace(namespace.id);
    setUpload({ loaded: 0, total: file.size, percent: 0, finalising: false });
    try {
      const preview = await uploadArchive(file, base, setUpload);
      const job = await startImport(
        { uploadId: preview.uploadId, scopes: preview.scopes },
        base,
      );
      setSeed({ jobId: job.id, apiBase: base, namespace });
    } finally {
      // From here the import runs on the worker and reports itself through the
      // job; the upload meter has nothing left to say.
      setUpload(null);
    }
  };

  const finish = (namespace: Namespace) => {
    window.electronAPI?.notifyNamespacesChanged();
    toast.success(t("workspaces.createSuccess", { name: namespace.name }));
    onCreated(namespace);
    onOpenChange(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Second press, once the seed import has finished: just close.
    if (seed && seedDone) {
      finish(seed.namespace);
      return;
    }
    if (!name.trim() || submitting || seed) return;

    setSubmitting(true);
    try {
      const namespace = await api.namespaces.create({
        name: name.trim(),
        description: description.trim() || undefined,
        thumbnail: thumbnail ?? undefined,
      });

      if (!seedFile) {
        finish(namespace);
        return;
      }

      try {
        await seedFromArchive(namespace, seedFile);
      } catch (seedError) {
        toast.error(
          seedError instanceof Error
            ? seedError.message
            : t("workspaces.seedFailed"),
        );
        finish(namespace);
        return;
      }

      window.electronAPI?.notifyNamespacesChanged();
      setSubmitting(false);
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
        // Dismissing after the workspace was created still has to report it —
        // the import keeps running on the server either way.
        if (!next && seed) {
          finish(seed.namespace);
          return;
        }
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
                disabled={submitting || seed !== null}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("workspaces.seedOptional")}</Label>
              <NamespaceSeedPicker
                file={seedFile}
                onFileChange={setSeedFile}
                job={seedJob}
                upload={upload}
                disabled={submitting || seed !== null}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              // Once the workspace exists, closing is "leave it running", not
              // "cancel" — the caller still has to learn the workspace is there.
              onClick={() => (seed ? finish(seed.namespace) : onOpenChange(false))}
              disabled={submitting}
            >
              {seed
                ? t("workspaces.seedContinueInBackground")
                : t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="default"
              disabled={(!name.trim() && !seed) || submitting || (seed !== null && !seedDone)}
            >
              {(submitting || (seed !== null && !seedDone)) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {seed
                ? seedDone
                  ? t("workspaces.seedOpen")
                  : t("workspaces.seedImportingShort")
                : seedFile
                  ? t("workspaces.createAndImport")
                  : t("workspaces.createAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
