"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { WorkspaceHeader } from "@/components/namespace/workspace-header";
import { useTranslation } from "@/hooks/use-translation";

export default function NamespaceSettingsPage() {
  const { namespaceId } = useParams<{ namespaceId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const [namespace, setNamespace] = React.useState<Namespace | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.namespaces.get(namespaceId);
      setNamespace(result);
      setName(result.name);
      setDescription(result.description ?? "");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("workspaces.settingsLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [namespaceId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!namespace || !name.trim() || saving) return;

    setSaving(true);
    try {
      const updated = await api.namespaces.update(namespace.id, {
        name: name.trim(),
        description: description.trim(),
      });
      setNamespace(updated);
      setName(updated.name);
      setDescription(updated.description ?? "");
      toast.success(t("workspaces.settingsSaved"));
      router.refresh();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : t("workspaces.settingsSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Button variant="ghost" size="sm" asChild className="mb-7 -ml-3">
          <Link href="/">
            <ArrowLeft className="size-4" />
            {t("workspaces.all")}
          </Link>
        </Button>

        <div className="mb-8">
          <h1 className="font-serif text-3xl uppercase tracking-[0.04em]">
            {t("workspaces.settingsTitle")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("workspaces.settingsDescription")}
          </p>
        </div>

        {loading ? (
          <div className="space-y-6" aria-label={t("common.loading")}>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20 bg-muted" />
              <Skeleton className="h-9 w-full bg-muted" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 bg-muted" />
              <Skeleton className="h-24 w-full bg-muted" />
            </div>
          </div>
        ) : error ? (
          <div className="border border-destructive p-5">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void load()}
            >
              <RefreshCw className="size-4" />
              {t("common.retry")}
            </Button>
          </div>
        ) : namespace ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">{t("common.name")}</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={saving}
                autoFocus
              />
              <p className="font-mono text-xs text-muted-foreground">
                /{namespace.slug}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-description">
                {t("common.description")}
              </Label>
              <Textarea
                id="workspace-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={saving}
                rows={5}
              />
            </div>

            <div className="flex justify-end border-t pt-6">
              <Button
                type="submit"
                variant="default"
                disabled={!name.trim() || saving}
              >
                {saving
                  ? t("workspaces.savingSettings")
                  : t("workspaces.saveChanges")}
              </Button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
