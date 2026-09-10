"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FolderOpen, Plus, RefreshCw, Tags } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { CreateNamespaceDialog } from "@/components/namespace/create-namespace-dialog";
import { useTranslation } from "@/hooks/use-translation";
import { WorkspaceHeader } from "@/components/namespace/workspace-header";
import { useActiveNamespaces } from "@/components/active-namespaces-provider";
import { useNamespaceCategories } from "@/hooks/use-namespace-categories";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import {
  WorkspaceCard,
  WorkspaceCardSkeleton,
} from "@/components/namespace/workspace-card";

/** A category heading plus the workspaces filed under it. */
interface WorkspaceGroup {
  id: string;
  title: string;
  description: string | null;
  workspaces: Namespace[];
}

/**
 * Group workspaces by category, alphabetically, dropping empty categories.
 *
 * A workspace in several categories appears under each of them — that is the
 * point of allowing several. A workspace whose categories are all unknown to
 * this listing (a category deleted in another tab, say) still has to appear
 * somewhere, so it falls into a synthetic group pinned to the end rather than
 * silently vanishing from the directory.
 */
function groupByCategory(
  namespaces: Namespace[],
  categories: NamespaceCategory[],
  uncategorizedTitle: string,
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const category of categories) {
    groups.set(category.id, {
      id: category.id,
      title: category.title,
      description: category.description,
      workspaces: [],
    });
  }

  const orphans: Namespace[] = [];
  for (const ns of namespaces) {
    const targets = ns.categoryIds.filter((id) => groups.has(id));
    if (targets.length === 0) {
      orphans.push(ns);
      continue;
    }
    for (const id of targets) groups.get(id)!.workspaces.push(ns);
  }

  const ordered = [...groups.values()]
    .filter((group) => group.workspaces.length > 0)
    .sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  if (orphans.length > 0) {
    ordered.push({
      id: "__uncategorized__",
      title: uncategorizedTitle,
      description: null,
      workspaces: orphans,
    });
  }
  return ordered;
}

export default function LandingPage() {
  const { t } = useTranslation();
  const { removeBySlug } = useActiveNamespaces();
  const open = useOpenWorkspace();
  // Categories drive the grouping below; a failure to load them degrades to a
  // single ungrouped list rather than an error page.
  const { categories, reload: reloadCategories } = useNamespaceCategories();
  const [namespaces, setNamespaces] = React.useState<Namespace[] | null>(null);
  const [stats, setStats] = React.useState<Record<string, NamespaceStats>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<Namespace | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  // The landing page is outside any namespace — clear the active slug so the
  // registry calls below are not namespace-prefixed.
  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
  }, []);

  const load = React.useCallback(async () => {
    try {
      setNamespaces(await api.namespaces.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspaces.loadFailed"));
    }
  }, [t]);

  // Source rollups are non-critical: load them separately so a stats failure
  // never blocks the directory, and index them by namespace id for the cards.
  const loadStats = React.useCallback(async () => {
    try {
      const rows = await api.namespaces.stats();
      setStats(Object.fromEntries(rows.map((row) => [row.id, row])));
    } catch {
      // Cards simply omit counts when stats are unavailable.
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadStats();
  }, [load, loadStats]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.namespaces.remove(pendingDelete.id);
      removeBySlug(pendingDelete.slug);
      toast.success(
        t("workspaces.deleteSuccess", { name: pendingDelete.name }),
      );
      setPendingDelete(null);
      await load();
      void loadStats();
      void reloadCategories();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("workspaces.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const hasWorkspaces = (namespaces?.length ?? 0) > 0;

  const groups = React.useMemo(
    () =>
      groupByCategory(
        namespaces ?? [],
        categories,
        t("categories.uncategorized"),
      ),
    [namespaces, categories, t],
  );
  // A single group is not a grouping — showing one heading over every card just
  // adds a line the reader has to skip.
  const showGroupHeadings = groups.length > 1;

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />

      <main
        className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14"
        data-testid="workspace-directory"
        data-app-state={
          namespaces !== null ? "ready" : error ? "error" : "loading"
        }
      >
        <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-serif text-3xl uppercase tracking-[0.04em] sm:text-4xl">
              {t("workspaces.title")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t("workspaces.subtitle")}
            </p>
          </div>
          {namespaces && hasWorkspaces && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/namespaces/categories">
                  <Tags className="mr-2 h-4 w-4" />
                  {t("categories.manage")}
                </Link>
              </Button>
              <Button variant="default" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("workspaces.new")}
              </Button>
            </div>
          )}
        </div>

        {error && (
          <Card className="mb-7 border-destructive shadow-none">
            <CardContent className="flex flex-col items-start justify-between gap-3 py-1 text-sm sm:flex-row sm:items-center">
              <span className="text-destructive">{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="mr-2 size-3.5" />
                {t("common.retry")}
              </Button>
            </CardContent>
          </Card>
        )}

        {namespaces === null ? (
          <div
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
            aria-label={t("workspaces.loading")}
          >
            {Array.from({ length: 6 }, (_, index) => (
              <WorkspaceCardSkeleton key={index} />
            ))}
          </div>
        ) : !hasWorkspaces ? (
          <Card
            className="bg-card/90 shadow-none"
            data-testid="workspace-empty-state"
          >
            <EmptyState
              icon={FolderOpen}
              title={t("workspaces.emptyTitle")}
              description={t("workspaces.emptyDescription")}
              action={{
                label: t("workspaces.createAction"),
                onClick: () => setCreateOpen(true),
              }}
            />
          </Card>
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section
                key={group.id}
                // Only label the section when the heading is actually rendered;
                // a dangling aria-labelledby is worse than none.
                aria-labelledby={
                  showGroupHeadings ? `group-${group.id}` : undefined
                }
              >
                {showGroupHeadings && (
                  <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2">
                    <h2
                      id={`group-${group.id}`}
                      className="font-serif text-lg uppercase tracking-[0.06em]"
                    >
                      {group.title}
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {group.workspaces.length === 1
                        ? t("workspaces.groupCountOne")
                        : t("workspaces.groupCount", {
                            count: group.workspaces.length,
                          })}
                    </span>
                    {group.description && (
                      <p className="w-full text-sm text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
                        {group.description}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {group.workspaces.map((ns) => (
                    <WorkspaceCard
                      key={ns.id}
                      namespace={ns}
                      stats={stats[ns.id]}
                      onOpen={open}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <CreateNamespaceDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(ns) => {
            void reloadCategories();
            open(ns);
          }}
        />

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(next) => !next && setPendingDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("workspaces.deleteTitle", {
                  name: pendingDelete?.name ?? "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("workspaces.deleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                {t("common.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDelete();
                }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? t("common.deleting") : t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
