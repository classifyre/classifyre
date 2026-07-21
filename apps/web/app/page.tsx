"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { api, setActiveNamespaceSlug, type Namespace } from "@workspace/api-client";
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

export default function LandingPage() {
  const router = useRouter();
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
      setError(e instanceof Error ? e.message : "Failed to load workspaces");
    }
  }, []);

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
      toast.success(`Workspace "${pendingDelete.name}" deleted`);
      setPendingDelete(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete workspace");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground mt-1">
            Choose a workspace to enter, or create a new one.
          </p>
        </div>
        {namespaces && namespaces.length > 0 && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New workspace
          </Button>
        )}
      </div>

      {error && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="text-destructive py-4 text-sm">
            {error}
          </CardContent>
        </Card>
      )}

      {namespaces === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-16">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspaces…
        </div>
      ) : namespaces.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No workspaces yet"
          description="Create your first workspace to start ingesting and classifying data."
          action={{
            label: "Create workspace",
            onClick: () => setCreateOpen(true),
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {namespaces.map((ns) => (
            <Card
              key={ns.id}
              clickable
              onClick={() => open(ns)}
              className="group relative"
            >
              <CardContent className="flex h-full flex-col gap-2 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{ns.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      /{ns.slug}
                      {ns.type === "remote" ? " · remote" : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive opacity-0 transition group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(ns);
                    }}
                    aria-label={`Delete ${ns.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {ns.description && (
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {ns.description}
                  </p>
                )}
                <div className="text-muted-foreground mt-auto flex items-center gap-1 pt-2 text-sm opacity-0 transition group-hover:opacity-100">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </CardContent>
            </Card>
          ))}
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
              Delete workspace “{pendingDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently drops the workspace&apos;s database schema and all
              its sources, scans and findings. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
