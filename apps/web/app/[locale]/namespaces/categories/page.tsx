"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Pencil,
  Plus,
  RefreshCw,
  Tags,
  Trash2,
} from "lucide-react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
  type NamespaceCategory,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { WorkspaceHeader } from "@/components/namespace/workspace-header";
import { CreateCategoryDialog } from "@/components/namespace/create-category-dialog";
import { CategoryEditDialog } from "@/components/namespace/category-edit-dialog";
import { CategoryDeleteDialog } from "@/components/namespace/category-delete-dialog";
import { useNamespaceCategories } from "@/hooks/use-namespace-categories";
import { useTranslation } from "@/hooks/use-translation";

/** Two-digit shelf number, in the manner of a printed index. */
function indexLabel(position: number): string {
  return String(position + 1).padStart(2, "0");
}

/**
 * The category index: every shelf in the workspace directory, in order, with
 * what is on it.
 *
 * Read as an index rather than a settings table — each category is a ruled
 * block with its number, its name in the display face, and the workspaces
 * filed under it listed by name. The management affordances (rename, delete)
 * stay quiet until the row is hovered or focused, so the page reads as a map
 * of the directory first and a control panel second.
 */
export default function CategoriesPage() {
  const { t } = useTranslation();
  const { categories, loading, error, reload } = useNamespaceCategories();
  const [namespaces, setNamespaces] = React.useState<Namespace[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<NamespaceCategory | null>(null);
  const [pendingDelete, setPendingDelete] =
    React.useState<NamespaceCategory | null>(null);

  // This page lives outside any workspace — keep registry calls unprefixed.
  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
  }, []);

  const loadNamespaces = React.useCallback(async () => {
    try {
      setNamespaces(await api.namespaces.list());
    } catch {
      // The counts come from the categories themselves; the names listed under
      // each shelf are a bonus and not worth failing the page for.
      setNamespaces([]);
    }
  }, []);

  React.useEffect(() => {
    void loadNamespaces();
  }, [loadNamespaces]);

  const workspacesByCategory = React.useMemo(() => {
    const map = new Map<string, Namespace[]>();
    for (const ns of namespaces ?? []) {
      for (const id of ns.categoryIds) {
        const current = map.get(id);
        if (current) current.push(ns);
        else map.set(id, [ns]);
      }
    }
    return map;
  }, [namespaces]);

  const refreshAll = React.useCallback(async () => {
    await Promise.all([reload(), loadNamespaces()]);
  }, [reload, loadNamespaces]);

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />
      <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Button variant="ghost" size="sm" asChild className="mb-7 -ml-3">
          <Link href="/">
            <ArrowLeft className="size-4" />
            {t("workspaces.all")}
          </Link>
        </Button>

        <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("categories.eyebrow")}
            </p>
            <h1 className="mt-2 font-serif text-3xl uppercase tracking-[0.04em] sm:text-4xl">
              {t("categories.title")}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {t("categories.description")}
            </p>
          </div>
          <Button variant="default" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("categories.createAction")}
          </Button>
        </header>

        {error && (
          <Card className="mb-6 border-destructive shadow-none">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-1 text-sm sm:flex-row sm:items-center">
              <span className="text-destructive">{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshAll()}
              >
                <RefreshCw className="size-3.5" />
                {t("common.retry")}
              </Button>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-8" aria-label={t("common.loading")}>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-3 border-t pt-5">
                <Skeleton className="h-6 w-48 bg-muted" />
                <Skeleton className="h-4 w-full max-w-md bg-muted" />
                <Skeleton className="h-4 w-32 bg-muted" />
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <Card className="shadow-none">
            <EmptyState
              icon={Tags}
              title={t("categories.emptyTitle")}
              description={t("categories.emptyDescription")}
              action={{
                label: t("categories.createAction"),
                onClick: () => setCreateOpen(true),
              }}
            />
          </Card>
        ) : (
          <ol className="border-t">
            {categories.map((category, position) => {
              const filed = workspacesByCategory.get(category.id) ?? [];
              const href = `/namespaces/categories/${category.id}`;
              return (
                <li
                  key={category.id}
                  className="group border-b py-6 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex items-start gap-4 sm:gap-6">
                    <span
                      aria-hidden="true"
                      className="mt-1 hidden font-mono text-xs text-muted-foreground/60 sm:block"
                    >
                      {indexLabel(position)}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 className="font-serif text-xl uppercase tracking-[0.05em]">
                          <Link
                            href={href}
                            className="underline-offset-[6px] hover:underline"
                          >
                            {category.title}
                          </Link>
                        </h2>
                        {category.isDefault && (
                          <span className="border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {t("categories.defaultBadge")}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {category.workspaceCount === 1
                            ? t("categories.workspaceCountOne")
                            : t("categories.workspaceCount", {
                                count: category.workspaceCount,
                              })}
                        </span>
                      </div>

                      {category.description && (
                        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                          {category.description}
                        </p>
                      )}

                      {filed.length > 0 && (
                        // The shelf's contents, named. A workspace is one click
                        // from here, so the index doubles as navigation.
                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                          {filed.map((ns) => (
                            <li key={ns.id}>
                              <Link
                                href={`/${ns.slug}`}
                                className="flex items-baseline gap-1.5 text-sm underline-offset-4 hover:underline"
                              >
                                {ns.name}
                                <span className="font-mono text-xs text-muted-foreground">
                                  /{ns.slug}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}

                      <Link
                        href={href}
                        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t("categories.view")}
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>

                    {/* Quiet until the row is hovered or a control is focused:
                        this page is mostly read, rarely edited. */}
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:-mr-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={() => setEditing(category)}
                        aria-label={t("categories.editAria", {
                          title: category.title,
                        })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        // The default category is the fallback every
                        // uncategorised workspace lands in; deleting it would
                        // leave nowhere to fall back to.
                        disabled={category.isDefault}
                        onClick={() => setPendingDelete(category)}
                        aria-label={t("categories.deleteAria", {
                          title: category.title,
                        })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <CreateCategoryDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => void refreshAll()}
        />
        <CategoryEditDialog
          category={editing}
          onOpenChange={(next) => !next && setEditing(null)}
          onSaved={() => void refreshAll()}
        />
        <CategoryDeleteDialog
          category={pendingDelete}
          onOpenChange={(next) => !next && setPendingDelete(null)}
          onDeleted={() => void refreshAll()}
        />
      </main>
    </div>
  );
}
