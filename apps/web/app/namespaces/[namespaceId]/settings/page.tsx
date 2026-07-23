"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ThumbnailPicker } from "@/components/namespace/thumbnail-picker";
import { useTranslation } from "@/hooks/use-translation";
import { useStaticRouteParam } from "@/lib/use-route-id";

const SLUG_MAX_LENGTH = 50;

/**
 * Sanitize free text into a URL-safe slug as the user types: lowercase,
 * non-alphanumerics collapsed to single dashes, length-capped. A trailing dash
 * is allowed mid-typing (so "foo-bar" is reachable); it is trimmed on submit.
 */
function slugifyInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH);
}

export default function NamespaceSettingsPage() {
  const namespaceId = useStaticRouteParam("namespaceId", "namespaces");
  const router = useRouter();
  const { t } = useTranslation();
  const [namespace, setNamespace] = React.useState<Namespace | null>(null);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);
  const [thumbnailChanged, setThumbnailChanged] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
  }, []);

  const load = React.useCallback(async () => {
    if (!namespaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.namespaces.get(namespaceId);
      setNamespace(result);
      setName(result.name);
      setSlug(result.slug);
      setDescription(result.description ?? "");
      setThumbnail(result.thumbnail);
      setThumbnailChanged(false);
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
    const normalizedSlug = slug.replace(/-+$/, "");
    if (!namespace || !name.trim() || !normalizedSlug || saving) return;

    setSaving(true);
    try {
      const updated = await api.namespaces.update(namespace.id, {
        name: name.trim(),
        slug: normalizedSlug,
        description: description.trim(),
        // Only send the image when it actually changed; a data URI sets it,
        // `null` clears it, `undefined` leaves it untouched.
        ...(thumbnailChanged ? { thumbnail } : {}),
      });
      setNamespace(updated);
      setName(updated.name);
      setSlug(updated.slug);
      setDescription(updated.description ?? "");
      setThumbnail(updated.thumbnail);
      setThumbnailChanged(false);
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspace-slug">
                {t("workspaces.urlPath")}
              </Label>
              <div className="flex items-center">
                <span className="select-none rounded-l border border-r-0 border-input bg-muted px-2.5 py-2 font-mono text-sm text-muted-foreground">
                  /
                </span>
                <Input
                  id="workspace-slug"
                  className="rounded-l-none font-mono"
                  value={slug}
                  onChange={(event) =>
                    setSlug(slugifyInput(event.target.value))
                  }
                  disabled={saving}
                  maxLength={SLUG_MAX_LENGTH}
                  inputMode="url"
                  spellCheck={false}
                  autoCapitalize="none"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("workspaces.urlPathHint")}
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

            <div className="space-y-2">
              <Label>{t("workspaces.thumbnailLabel")}</Label>
              <div className="max-w-md">
                <ThumbnailPicker
                  value={thumbnail}
                  onChange={(next) => {
                    setThumbnail(next);
                    setThumbnailChanged(true);
                  }}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="flex justify-end border-t pt-6">
              <Button
                type="submit"
                variant="default"
                disabled={!name.trim() || !slug.replace(/-+$/, "") || saving}
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
