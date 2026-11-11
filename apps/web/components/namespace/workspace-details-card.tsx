"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderPen } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";
import { useNamespace } from "@/components/namespace-provider";
import { CategorySelect } from "@/components/namespace/category-select";
import {
  ExternalLinksEditor,
  isCompleteLink,
  isPartialLink,
  type EditableLink,
} from "@/components/namespace/external-links-editor";
import { ThumbnailPicker } from "@/components/namespace/thumbnail-picker";
import { useCan } from "@/hooks/use-me";
import { useNamespaceCategories } from "@/hooks/use-namespace-categories";
import { useTranslation } from "@/hooks/use-translation";
import { useLocalePath } from "@/lib/app-path";

const SLUG_MAX_LENGTH = 50;

/**
 * Free text as a URL-safe slug while typing: lowercase, non-alphanumerics
 * collapsed to single dashes, length-capped. A trailing dash is allowed
 * mid-typing (so "foo-bar" is reachable); it is trimmed on save.
 */
function slugifyInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH);
}

function linksOf(
  externalLinks: Array<{ id: string; title: string; url: string }>,
): EditableLink[] {
  return externalLinks.map((link) => ({
    key: link.id,
    id: link.id,
    title: link.title,
    url: link.url,
  }));
}

/**
 * The workspace itself — name, address, description, categories, links and
 * picture — first in Settings → General. Editable with `workspace.settings`;
 * a new address moves the page to it. Pausing lives under Workers.
 */
export function WorkspaceDetailsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const localePath = useLocalePath();
  const { namespace, refresh } = useNamespace();
  const { update: updateActiveNamespace } = useActiveNamespaces();
  const canEdit = useCan("workspace.settings");
  const {
    categories,
    loading: categoriesLoading,
    upsert: upsertCategory,
  } = useNamespaceCategories();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);
  const [thumbnailChanged, setThumbnailChanged] = React.useState(false);
  const [links, setLinks] = React.useState<EditableLink[]>([]);
  const [categoryIds, setCategoryIds] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  // The form follows the workspace as loaded (and as saved).
  React.useEffect(() => {
    if (!namespace) return;
    setName(namespace.name);
    setSlug(namespace.slug);
    setDescription(namespace.description ?? "");
    setThumbnail(namespace.thumbnail);
    setThumbnailChanged(false);
    setLinks(linksOf(namespace.externalLinks));
    setCategoryIds(namespace.categoryIds);
  }, [namespace]);

  const disabled = !canEdit || saving || !namespace;
  const normalizedSlug = slug.replace(/-+$/, "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
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
        // Only an image that changed: a data URI sets it, `null` clears it.
        ...(thumbnailChanged ? { thumbnail } : {}),
        externalLinks: links.filter(isCompleteLink).map((link) => ({
          id: link.id,
          title: link.title.trim(),
          url: link.url.trim(),
        })),
        categoryIds,
      });
      updateActiveNamespace(updated, namespace.slug);
      toast.success(t("workspaces.settingsSaved"));
      if (updated.slug !== namespace.slug) {
        // The workspace has a new address: its settings move with it.
        router.replace(localePath(`/${updated.slug}/settings?tab=general`));
      } else {
        await refresh();
      }
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
    <Card className="panel-card rounded-[6px]" data-testid="workspace-details">
      <CardContent className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <FolderPen className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("workspaces.settingsTitle")}
          </p>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">
          {t("workspaces.settingsDescription")}
        </p>
        <form onSubmit={(event) => void save(event)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">{t("common.name")}</Label>
            <Input
              id="workspace-name"
              data-testid="workspace-details-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={disabled}
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
                onChange={(event) => setSlug(slugifyInput(event.target.value))}
                disabled={disabled}
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
              disabled={disabled}
              rows={4}
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
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("workspaces.linksLabel")}</Label>
            <ExternalLinksEditor
              links={links}
              onChange={setLinks}
              disabled={disabled}
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
                disabled={disabled}
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end border-t pt-5">
              <Button
                type="submit"
                data-testid="workspace-details-save"
                disabled={!name.trim() || !normalizedSlug || saving}
              >
                {saving
                  ? t("workspaces.savingSettings")
                  : t("workspaces.saveChanges")}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
