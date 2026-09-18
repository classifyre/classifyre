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
import { OctagonPause, Play } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { WorkspaceHeader } from "@/components/namespace/workspace-header";
import { ThumbnailPicker } from "@/components/namespace/thumbnail-picker";
import { CategorySelect } from "@/components/namespace/category-select";
import {
  ExternalLinksEditor,
  isCompleteLink,
  isPartialLink,
  type EditableLink,
} from "@/components/namespace/external-links-editor";
import { useNamespaceCategories } from "@/hooks/use-namespace-categories";
import { useTranslation } from "@/hooks/use-translation";
import { useLocalePath } from "@/lib/app-path";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";
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
  const localePath = useLocalePath();
  const { update: updateActiveNamespace } = useActiveNamespaces();
  const {
    categories,
    loading: categoriesLoading,
    upsert: upsertCategory,
  } = useNamespaceCategories();
  const [namespace, setNamespace] = React.useState<Namespace | null>(null);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);
  const [thumbnailChanged, setThumbnailChanged] = React.useState(false);
  const [links, setLinks] = React.useState<EditableLink[]>([]);
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);
  const [paused, setPaused] = React.useState(false);
  const [pausedAt, setPausedAt] = React.useState<string | null>(null);
  const [pausedReason, setPausedReason] = React.useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = React.useState("");
  const [pauseBusy, setPauseBusy] = React.useState(false);
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
      setLinks(
        result.externalLinks.map((link) => ({
          key: link.id,
          id: link.id,
          title: link.title,
          url: link.url,
        })),
      );
      setCategoryIds(result.categoryIds);
      setPaused(result.paused);
      setPausedAt(result.pausedAt);
      setPausedReason(result.pausedReason);
      setReasonDraft(result.pausedReason ?? "");
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
    if (links.some(isPartialLink)) {
      toast.error(t("workspaces.linkIncomplete"));
      return;
    }

    setSaving(true);
    try {
      const updated = await api.namespaces.update(namespace.id, {
        name: name.trim(),
        slug: normalizedSlug,
        description: description.trim(),
        // Only send the image when it actually changed; a data URI sets it,
        // `null` clears it, `undefined` leaves it untouched.
        ...(thumbnailChanged ? { thumbnail } : {}),
        // A row still being typed (one field filled) is blocked by the submit
        // guard above; a completely empty row is simply dropped.
        externalLinks: links.filter(isCompleteLink).map((link) => ({
          id: link.id,
          title: link.title.trim(),
          url: link.url.trim(),
        })),
        categoryIds,
      });
      updateActiveNamespace(updated, namespace.slug);
      setNamespace(updated);
      setName(updated.name);
      setSlug(updated.slug);
      setDescription(updated.description ?? "");
      setThumbnail(updated.thumbnail);
      setThumbnailChanged(false);
      setLinks(
        updated.externalLinks.map((link) => ({
          key: link.id,
          id: link.id,
          title: link.title,
          url: link.url,
        })),
      );
      setCategoryIds(updated.categoryIds);
      setPaused(updated.paused);
      setPausedAt(updated.pausedAt);
      setPausedReason(updated.pausedReason);
      setReasonDraft(updated.pausedReason ?? "");
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

  const applyPauseResult = (updated: Namespace, previousSlug: string) => {
    updateActiveNamespace(updated, previousSlug);
    setNamespace(updated);
    setPaused(updated.paused);
    setPausedAt(updated.pausedAt);
    setPausedReason(updated.pausedReason);
    setReasonDraft(updated.pausedReason ?? "");
    router.refresh();
  };

  const setPauseState = async (nextPaused: boolean) => {
    if (!namespace || pauseBusy) return;
    setPauseBusy(true);
    try {
      const updated = await api.namespaces.update(namespace.id, {
        paused: nextPaused,
        // Record a fresh reason when pausing; leave the stored one alone when
        // resuming so the settings still show why it had been paused.
        ...(nextPaused
          ? { pausedReason: reasonDraft.trim() ? reasonDraft.trim() : null }
          : {}),
      });
      applyPauseResult(updated, namespace.slug);
      toast.success(
        t(
          nextPaused ? "workspaces.pauseSuccess" : "workspaces.resumeSuccess",
          { name: updated.name },
        ),
      );
    } catch (pauseError) {
      toast.error(
        pauseError instanceof Error
          ? pauseError.message
          : t("workspaces.pauseFailed"),
      );
    } finally {
      setPauseBusy(false);
    }
  };

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Button variant="ghost" size="sm" asChild className="mb-7 -ml-3">
          <Link href={localePath("/")}>
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
              <Label htmlFor="workspace-slug">{t("workspaces.urlPath")}</Label>
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
              <Label>{t("categories.label")}</Label>
              <CategorySelect
                categories={categories}
                value={categoryIds}
                onChange={setCategoryIds}
                onCategoryCreated={upsertCategory}
                loading={categoriesLoading}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("workspaces.linksLabel")}</Label>
              <ExternalLinksEditor
                links={links}
                onChange={setLinks}
                disabled={saving}
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

        {namespace && !loading && !error ? (
          <section
            aria-label={t("workspaces.pauseSectionTitle")}
            className="mt-8 space-y-4 border border-border p-5"
          >
            <div className="flex items-center gap-2">
              <OctagonPause className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h2 className="text-xs font-mono uppercase tracking-[0.14em]">
                {t("workspaces.pauseSectionTitle")}
              </h2>
              {paused && (
                <span className="rounded-sm border border-amber-600/40 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400">
                  {t("workspaces.pausedBadge")}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("workspaces.pauseSectionDescription")}
            </p>
            {paused && pausedAt ? (
              <p className="text-xs text-muted-foreground">
                {t("workspaces.pausedSince", {
                  when: new Date(pausedAt).toLocaleString(),
                })}
                {pausedReason ? ` — ${pausedReason}` : ""}
              </p>
            ) : null}
            {!paused ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="workspace-pause-reason">
                    {t("workspaces.pauseReasonLabel")}
                  </Label>
                  <Input
                    id="workspace-pause-reason"
                    value={reasonDraft}
                    onChange={(event) => setReasonDraft(event.target.value)}
                    placeholder={t("workspaces.pauseReasonPlaceholder")}
                    disabled={pauseBusy}
                    maxLength={280}
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pauseBusy}
                  onClick={() => void setPauseState(true)}
                >
                  <OctagonPause className="size-4" />
                  {pauseBusy
                    ? t("workspaces.pausingAction")
                    : t("workspaces.pauseAction")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="default"
                disabled={pauseBusy}
                onClick={() => void setPauseState(false)}
              >
                <Play className="size-4" />
                {pauseBusy
                  ? t("workspaces.resumingAction")
                  : t("workspaces.resumeAction")}
              </Button>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
