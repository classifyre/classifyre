"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderOpen, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
  type NamespaceCategory,
  type NamespaceStats,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { WorkspaceHeader } from "@/components/namespace/workspace-header";
import { CategoryEditDialog } from "@/components/namespace/category-edit-dialog";
import { CategoryDeleteDialog } from "@/components/namespace/category-delete-dialog";
import {
  WorkspaceCard,
  WorkspaceCardSkeleton,
} from "@/components/namespace/workspace-card";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { useTranslation } from "@/hooks/use-translation";
import { useStaticRouteParam } from "@/lib/use-route-id";

/**
 * One category: its own page, listing every workspace filed under it.
 *
 * There is no single-category endpoint — the registry's category list is a
 * handful of rows — so the page reads the list and picks its row out of it,
 * which also gives it the live workspace count for free.
 */
export default function CategoryDetailPage() {
  const categoryId = useStaticRouteParam("categoryId", "categories");
  const router = useRouter();
  const { t } = useTranslation();
  const openWorkspace = useOpenWorkspace();

  const [category, setCategory] = React.useState<NamespaceCategory | null>(
    null,
  );
  const [namespaces, setNamespaces] = React.useState<Namespace[] | null>(null);
  const [stats, setStats] = React.useState<Record<string, NamespaceStats>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  // Outside any workspace — keep the registry calls unprefixed.
  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
  }, []);


  const load = React.useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    setError(null);
    try {
      const [categories, allNamespaces] = await Promise.all([
        api.namespaces.listCategories(),
        api.namespaces.list(),
      ]);
      setCategory(categories.find((item) => item.id === categoryId) ?? null);
      setNamespaces(allNamespaces);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("categories.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [categoryId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Source rollups are decoration on the cards: never let them block the page.
  React.useEffect(() => {
    void api.namespaces
      .stats()
      .then((rows) =>
        setStats(Object.fromEntries(rows.map((row) => [row.id, row]))),
      )
      .catch(() => undefined);
  }, []);

  const filed = React.useMemo(
    () =>
      (namespaces ?? []).filter((ns) => ns.categoryIds.includes(categoryId)),
    [namespaces, categoryId],
  );

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <Button variant="ghost" size="sm" asChild className="mb-7 -ml-3">
          <Link href="/namespaces/categories">
            <ArrowLeft className="size-4" />
            {t("categories.backToIndex")}
          </Link>
        </Button>

        {error ? (
          <Card className="border-destructive shadow-none">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-1 text-sm sm:flex-row sm:items-center">
              <span className="text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-3.5" />
                {t("common.retry")}
              </Button>
            </CardContent>
          </Card>
        ) : loading || !categoryId ? (
          <div className="space-y-8" aria-label={t("common.loading")}>
            <div className="space-y-3">
              <Skeleton className="h-4 w-24 bg-muted" />
              <Skeleton className="h-10 w-80 max-w-full bg-muted" />
              <Skeleton className="h-4 w-full max-w-md bg-muted" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <WorkspaceCardSkeleton key={index} />
              ))}
            </div>
          </div>
        ) : !category ? (
          <Card className="shadow-none">
            <EmptyState
              icon={FolderOpen}
              title={t("categories.notFoundTitle")}
              description={t("categories.notFoundDescription")}
              action={{
                label: t("categories.backToIndex"),
                onClick: () => router.push("/namespaces/categories"),
              }}
            />
          </Card>
        ) : (
          <>
            <header className="mb-10 border-b pb-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {t("categories.eyebrowSingular")}
                    </p>
                    {category.isDefault && (
                      <span className="border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {t("categories.defaultBadge")}
                      </span>
                    )}
                  </div>
                  <h1 className="mt-2 font-serif text-3xl uppercase tracking-[0.04em] sm:text-4xl">
                    {category.title}
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {category.description || t("categories.noDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    className="text-muted-foreground hover:text-destructive"
                    // The default category is the fallback for every workspace
                    // that has no other; it cannot be removed.
                    disabled={category.isDefault}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    <Trash2 className="size-4" />
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            </header>

            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="font-serif text-lg uppercase tracking-[0.06em]">
                {t("categories.workspacesHeading")}
              </h2>
              <span className="text-xs text-muted-foreground">
                {filed.length === 1
                  ? t("categories.workspaceCountOne")
                  : t("categories.workspaceCount", { count: filed.length })}
              </span>
            </div>

            {filed.length === 0 ? (
              <Card className="shadow-none">
                <EmptyState
                  icon={FolderOpen}
                  title={t("categories.emptyWorkspacesTitle")}
                  description={t("categories.emptyWorkspacesDescription")}
                  action={{
                    label: t("workspaces.all"),
                    onClick: () => router.push("/"),
                  }}
                />
              </Card>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filed.map((ns) => (
                  <WorkspaceCard
                    key={ns.id}
                    namespace={ns}
                    stats={stats[ns.id]}
                    onOpen={openWorkspace}
                  />
                ))}
              </div>
            )}

            <CategoryEditDialog
              category={editing ? category : null}
              onOpenChange={(next) => !next && setEditing(false)}
              onSaved={(updated) => setCategory(updated)}
            />
            <CategoryDeleteDialog
              category={confirmingDelete ? category : null}
              onOpenChange={(next) => !next && setConfirmingDelete(false)}
              onDeleted={() => router.push("/namespaces/categories")}
            />
          </>
        )}
      </main>
    </div>
  );
}
