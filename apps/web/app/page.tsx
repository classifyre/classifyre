"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  FolderOpen,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Skeleton } from "@workspace/ui/components/skeleton";
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

function WorkspaceSkeleton() {
  return (
    <Card
      aria-hidden="true"
      className="gap-0 overflow-hidden py-0 shadow-none"
    >
      <Skeleton className="aspect-[16/8.5] w-full rounded-none bg-muted" />
      <CardContent className="space-y-4 p-5">
        <Skeleton className="h-5 w-2/3 bg-muted" />
        <Skeleton className="h-3 w-1/2 bg-muted" />
        <Skeleton className="h-10 w-full bg-muted" />
        <Skeleton className="ml-auto h-4 w-16 bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [namespaces, setNamespaces] = React.useState<Namespace[] | null>(null);
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

  React.useEffect(() => {
    void load();
  }, [load]);

  const open = (ns: Namespace) => {
    if (ns.type === "remote" && ns.remoteUrl) {
      window.location.href = ns.remoteUrl;
      return;
    }
    router.push(`/${ns.slug}`);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.namespaces.remove(pendingDelete.id);
      toast.success(t("workspaces.deleteSuccess", { name: pendingDelete.name }));
      setPendingDelete(null);
      await load();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("workspaces.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-svh bg-background">
      <WorkspaceHeader />

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-serif text-3xl uppercase tracking-[0.04em] sm:text-4xl">
              {t("workspaces.title")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {t("workspaces.subtitle")}
            </p>
          </div>
          {namespaces && namespaces.length > 0 && (
            <Button variant="default" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("workspaces.new")}
            </Button>
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
              <WorkspaceSkeleton key={index} />
            ))}
          </div>
        ) : namespaces.length === 0 ? (
          <Card className="bg-card/90 shadow-none">
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
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {namespaces.map((ns) => {
              const initial = ns.name.trim().charAt(0).toUpperCase() || "?";
              return (
                <Card
                  key={ns.id}
                  clickable
                  role="button"
                  tabIndex={0}
                  onClick={() => open(ns)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open(ns);
                    }
                  }}
                  aria-label={t("workspaces.openAria", { name: ns.name })}
                  className="group gap-0 overflow-hidden bg-card/95 py-0 shadow-none hover:translate-x-0 hover:translate-y-0 hover:shadow-none"
                >
                  <div className="relative aspect-[16/8.5] overflow-hidden border-b bg-muted">
                    {ns.thumbnail ? (
                      <Image
                        src={ns.thumbnail}
                        alt=""
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover object-top transition duration-200 group-hover:scale-[1.01]"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                        <span className="font-serif text-6xl text-muted-foreground/25">
                          {initial}
                        </span>
                      </div>
                    )}
                  </div>

                  <CardContent className="flex min-h-40 flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold uppercase tracking-[0.06em]">
                          {ns.name}
                        </h2>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          /{ns.slug}
                        </p>
                      </div>
                      <div className="-mr-2 -mt-2 flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          className="text-muted-foreground"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Link
                            href={`/namespaces/${ns.id}/settings`}
                            aria-label={t("workspaces.settingsAria", {
                              name: ns.name,
                            })}
                          >
                            <Settings className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingDelete(ns);
                          }}
                          aria-label={t("workspaces.deleteAria", {
                            name: ns.name,
                          })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                      {ns.description || t("workspaces.noDescription")}
                    </p>
                    <div className="mt-auto flex justify-end pt-4">
                      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors group-hover:text-foreground">
                        {t("common.open")} <ArrowRight className="size-3.5" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <CreateNamespaceDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(ns) => open(ns)}
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
