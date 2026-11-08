"use client";

import * as React from "react";
import {
  ArrowLeft,
  FolderInput,
  LogOut,
  MoreHorizontal,
  Pause,
  Play,
  Server,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type LocalWorkspaceDto,
  type PlatformTenantDto,
} from "@workspace/api-client";
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
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useIamConsole } from "@/components/iam-session";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * The operator's page (docs/prd/TEN §4.7): every tenant with its admins and
 * counts, read from the identity server, where tenants, people and groups are
 * made. Here operators suspend and resume tenants, bring in workspaces made
 * without sign-in, and remove a tenant whose organization was deleted. They
 * see tenants, never what is inside their workspaces.
 */
export function PlatformAdmin() {
  const { t } = useTranslation();
  const consoleOn = useIamConsole();
  const [tenants, setTenants] = React.useState<PlatformTenantDto[] | null>(null);
  const [local, setLocal] = React.useState<LocalWorkspaceDto[]>([]);
  const [denied, setDenied] = React.useState(false);
  const [importing, setImporting] = React.useState<PlatformTenantDto | null>(null);
  const [suspending, setSuspending] = React.useState<PlatformTenantDto | null>(null);
  const [deleting, setDeleting] = React.useState<PlatformTenantDto | null>(null);

  const load = React.useCallback(async () => {
    try {
      await api.platform.platformControllerMe();
    } catch {
      setDenied(true);
      return;
    }
    try {
      const [nextTenants, nextLocal] = await Promise.all([
        api.platform.platformControllerTenants(),
        api.platform.platformControllerLocalWorkspaces(),
      ]);
      setTenants(nextTenants);
      setLocal(nextLocal);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.loadFailed")));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const resume = async (tenant: PlatformTenantDto) => {
    try {
      await api.platform.platformControllerResume({ tenantId: tenant.id });
      toast.success(t("platform.resumed", { name: tenant.name }));
      await load();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.failed")));
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <a href="/">
            <ArrowLeft className="h-4 w-4" /> {t("access.allWorkspaces")}
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="/auth/logout/">
            <LogOut className="h-4 w-4" /> {t("account.signOut")}
          </a>
        </Button>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Server className="h-6 w-6" />
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.06em]">
            {t("platform.title")}
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("platform.description")}</p>
        {consoleOn && !denied && (
          <Button variant="outline" size="sm" asChild>
            <a
              href="/auth/console/"
              target="_blank"
              rel="noreferrer"
              data-testid="platform-identity-console"
            >
              <UsersRound className="h-4 w-4" />
              {t("platform.openConsole")}
            </a>
          </Button>
        )}
      </div>

      {denied ? (
        <p className="text-sm text-muted-foreground">{t("platform.denied")}</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("platform.tenants")}
            </p>
            <p className="text-xs text-muted-foreground">{t("platform.managedInIdentityServer")}</p>
          </div>

          <ul className="divide-y divide-border rounded-[4px] border border-border">
            {(tenants ?? []).map((tenant) => (
              <TenantRow
                key={tenant.id}
                tenant={tenant}
                canImport={local.length > 0}
                onImport={() => setImporting(tenant)}
                onSuspend={() => setSuspending(tenant)}
                onResume={() => void resume(tenant)}
                onDelete={() => setDeleting(tenant)}
              />
            ))}
            {tenants?.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("platform.none")}
              </li>
            )}
          </ul>
          {local.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("platform.localWaiting", { count: local.length })}
            </p>
          )}
        </>
      )}

      <ImportDialog
        tenant={importing}
        workspaces={local}
        onClose={() => setImporting(null)}
        onImported={load}
      />
      <SuspendDialog tenant={suspending} onClose={() => setSuspending(null)} onDone={load} />
      <DeleteDialog tenant={deleting} onClose={() => setDeleting(null)} onDone={load} />
    </div>
  );
}

function TenantRow({
  tenant,
  canImport,
  onImport,
  onSuspend,
  onResume,
  onDelete,
}: {
  tenant: PlatformTenantDto;
  canImport: boolean;
  onImport: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const consoleOn = useIamConsole();
  const deleted = tenant.status === "deleted";
  // Gone from the identity server: its data can only be removed.
  const orphaned =
    tenant.problem === "ORGANIZATION_MISSING" || tenant.problem === "ORGANIZATION_REPLACED";
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className={deleted ? "text-muted-foreground line-through" : undefined}>
            {tenant.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{tenant.alias}</span>
          {tenant.status !== "active" && (
            <Badge variant="secondary">{t(`platform.status.${tenant.status}`)}</Badge>
          )}
          {tenant.problem && (
            <Badge variant="destructive">{t(`platform.problem.${tenant.problem}`)}</Badge>
          )}
        </p>
        {!deleted && (
          <p className="text-xs text-muted-foreground">
            {t("platform.counts", { workspaces: tenant.workspaces, members: tenant.members })}
            {" · "}
            {tenant.admins.length > 0
              ? t("platform.adminsAre", {
                  names: tenant.admins.map((admin) => admin.name).join(", "),
                })
              : t("platform.noAdmins")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {tenant.lastActivityAt
            ? t("platform.lastActivity", { when: formatRelative(tenant.lastActivityAt) })
            : t("platform.created", { when: formatRelative(tenant.createdAt) })}
          {tenant.database && (
            <>
              {" · "}
              {t("platform.database")}{" "}
              <span className="font-mono">{tenant.database}</span>
            </>
          )}
        </p>
        {tenant.upgradeError && (
          <p className="text-xs text-destructive break-words">
            {t("platform.upgradeError", { error: tenant.upgradeError })}
          </p>
        )}
      </div>
      {!deleted && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("platform.actions", { name: tenant.name })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {consoleOn && tenant.organizationId && (
              <DropdownMenuItem asChild>
                <a
                  href={`/auth/console/?organization=${encodeURIComponent(tenant.organizationId)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <UsersRound className="h-4 w-4" />
                  {t("platform.openInConsole")}
                </a>
              </DropdownMenuItem>
            )}
            {orphaned ? (
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 className="h-4 w-4" />
                {t("platform.delete")}
              </DropdownMenuItem>
            ) : null}
            {!orphaned && canImport && (
              <DropdownMenuItem onSelect={onImport}>
                <FolderInput className="h-4 w-4" />
                {t("platform.import")}
              </DropdownMenuItem>
            )}
            {orphaned ? null : tenant.status === "active" ? (
              <DropdownMenuItem onSelect={onSuspend}>
                <Pause className="h-4 w-4" />
                {t("platform.suspend")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={onResume}>
                <Play className="h-4 w-4" />
                {t("platform.resume")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function ImportDialog({
  tenant,
  workspaces,
  onClose,
  onImported,
}: {
  tenant: PlatformTenantDto | null;
  workspaces: LocalWorkspaceDto[];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setChosen(new Set()), [tenant]);

  const submit = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      const { copied } = await api.platform.platformControllerImportWorkspaces({
        tenantId: tenant.id,
        importWorkspacesDto: { slugs: [...chosen] },
      });
      toast.success(t("platform.imported", { count: copied.length, name: tenant.name }));
      onClose();
      await onImported();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={tenant !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <DialogHeader>
          <DialogTitle>{t("platform.importTitle", { name: tenant?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("platform.importDescription")}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-[4px] border border-border text-sm">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                <Checkbox
                  checked={chosen.has(workspace.slug)}
                  onCheckedChange={(checked) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (checked === true) next.add(workspace.slug);
                      else next.delete(workspace.slug);
                      return next;
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{workspace.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    /{workspace.slug}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || chosen.size === 0} onClick={() => void submit()}>
            {t("platform.importConfirm", { count: chosen.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuspendDialog({
  tenant,
  onClose,
  onDone,
}: {
  tenant: PlatformTenantDto | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = React.useState(false);

  const suspend = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      await api.platform.platformControllerSuspend({ tenantId: tenant.id });
      toast.success(t("platform.suspended", { name: tenant.name }));
      onClose();
      await onDone();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={tenant !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platform.suspendTitle", { name: tenant?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t("platform.suspendDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void suspend();
            }}
          >
            {t("platform.suspend")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteDialog({
  tenant,
  onClose,
  onDone,
}: {
  tenant: PlatformTenantDto | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setTyped(""), [tenant]);

  const remove = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      await api.platform.platformControllerRemove({ tenantId: tenant.id, confirm: typed });
      toast.success(t("platform.deleted", { name: tenant.name }));
      onClose();
      await onDone();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={tenant !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platform.deleteTitle", { name: tenant?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("platform.deleteDescription", { count: tenant?.workspaces ?? 0 })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="delete-alias">
            {t("platform.deleteType", { alias: tenant?.alias ?? "" })}
          </Label>
          <Input
            id="delete-alias"
            autoComplete="off"
            className="font-mono"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || typed !== tenant?.alias}
            onClick={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            {t("platform.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
