"use client";

import * as React from "react";
import {
  ArrowLeft,
  FolderInput,
  LogOut,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserMinus,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { PasswordDialog } from "@/components/access/tenant-people";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type Password = { person: string; value: string };

/** What a typed name becomes as an alias: lowercase letters, digits and dashes. */
export function aliasFrom(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * The operator's page (docs/prd/TEN §4.7): every tenant with its admins and
 * counts, and creating, suspending, resuming and deleting tenants. Operators
 * see tenants, never what is inside their workspaces.
 */
export function PlatformAdmin() {
  const { t } = useTranslation();
  const [tenants, setTenants] = React.useState<PlatformTenantDto[] | null>(null);
  const [local, setLocal] = React.useState<LocalWorkspaceDto[]>([]);
  const [denied, setDenied] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [admins, setAdmins] = React.useState<PlatformTenantDto | null>(null);
  const [importing, setImporting] = React.useState<PlatformTenantDto | null>(null);
  const [suspending, setSuspending] = React.useState<PlatformTenantDto | null>(null);
  const [deleting, setDeleting] = React.useState<PlatformTenantDto | null>(null);
  const [password, setPassword] = React.useState<Password | null>(null);

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
      </div>

      {denied ? (
        <p className="text-sm text-muted-foreground">{t("platform.denied")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("platform.tenants")}
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t("platform.create")}
            </Button>
          </div>

          <ul className="divide-y divide-border rounded-[4px] border border-border">
            {(tenants ?? []).map((tenant) => (
              <TenantRow
                key={tenant.id}
                tenant={tenant}
                canImport={local.length > 0}
                onAdmins={() => setAdmins(tenant)}
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

      <CreateTenantDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (name, value) => {
          if (value) setPassword({ person: name, value });
          await load();
        }}
      />
      <AdminsDialog
        tenant={admins}
        onClose={() => setAdmins(null)}
        onPassword={setPassword}
        onChanged={async () => {
          await load();
        }}
      />
      <ImportDialog
        tenant={importing}
        workspaces={local}
        onClose={() => setImporting(null)}
        onImported={load}
      />
      <SuspendDialog tenant={suspending} onClose={() => setSuspending(null)} onDone={load} />
      <DeleteDialog tenant={deleting} onClose={() => setDeleting(null)} onDone={load} />
      <PasswordDialog password={password} onClose={() => setPassword(null)} />
    </div>
  );
}

function TenantRow({
  tenant,
  canImport,
  onAdmins,
  onImport,
  onSuspend,
  onResume,
  onDelete,
}: {
  tenant: PlatformTenantDto;
  canImport: boolean;
  onAdmins: () => void;
  onImport: () => void;
  onSuspend: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const deleted = tenant.status === "deleted";
  const healthy = !deleted && tenant.problem !== "ORGANIZATION_MISSING" && tenant.problem !== "ORGANIZATION_REPLACED";
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
        </p>
      </div>
      {healthy && (
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
            {tenant.problem !== "NO_ADMINS_GROUP" && (
              <DropdownMenuItem onSelect={onAdmins}>
                <ShieldCheck className="h-4 w-4" />
                {t("platform.admins")}
              </DropdownMenuItem>
            )}
            {canImport && (
              <DropdownMenuItem onSelect={onImport}>
                <FolderInput className="h-4 w-4" />
                {t("platform.import")}
              </DropdownMenuItem>
            )}
            {tenant.status === "active" ? (
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
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="h-4 w-4" />
              {t("platform.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function CreateTenantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (adminName: string, temporaryPassword: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [aliasTouched, setAliasTouched] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setAlias("");
    setAliasTouched(false);
    setEmail("");
    setFirstName("");
    setLastName("");
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await api.platform.platformControllerCreate({
        createTenantDto: {
          name,
          alias,
          adminEmail: email,
          adminFirstName: firstName,
          adminLastName: lastName,
        },
      });
      toast.success(t("platform.createdToast", { name: created.tenant.name }));
      onOpenChange(false);
      await onCreated(`${firstName} ${lastName}`.trim(), created.temporaryPassword ?? null);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.createFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[6px] border-2 border-border">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("platform.createTitle")}</DialogTitle>
            <DialogDescription>{t("platform.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="tenant-name">{t("platform.name")}</Label>
              <Input
                id="tenant-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!aliasTouched) setAlias(aliasFrom(event.target.value));
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tenant-alias">{t("platform.alias")}</Label>
              <Input
                id="tenant-alias"
                required
                maxLength={40}
                pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
                className="font-mono"
                value={alias}
                onChange={(event) => {
                  setAliasTouched(true);
                  setAlias(event.target.value.toLowerCase());
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("platform.aliasHint")}</p>
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("platform.firstAdmin")}
          </p>
          <div className="grid gap-1">
            <Label htmlFor="tenant-admin-email">{t("access.people.email")}</Label>
            <Input
              id="tenant-admin-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="tenant-admin-first">{t("access.people.firstName")}</Label>
              <Input
                id="tenant-admin-first"
                required
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tenant-admin-last">{t("access.people.lastName")}</Label>
              <Input
                id="tenant-admin-last"
                required
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {t("platform.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminsDialog({
  tenant,
  onClose,
  onPassword,
  onChanged,
}: {
  tenant: PlatformTenantDto | null;
  onClose: () => void;
  onPassword: (password: Password) => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [current, setCurrent] = React.useState(tenant);

  React.useEffect(() => {
    setCurrent(tenant);
    setEmail("");
    setFirstName("");
    setLastName("");
  }, [tenant]);

  const refresh = async () => {
    await onChanged();
    if (!current) return;
    const tenants = await api.platform.platformControllerTenants();
    setCurrent(tenants.find((candidate) => candidate.id === current.id) ?? null);
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!current) return;
    setBusy(true);
    try {
      const added = await api.platform.platformControllerAddAdmin({
        tenantId: current.id,
        addTenantAdminDto: { email, firstName, lastName },
      });
      toast.success(t("platform.adminAdded", { email }));
      if (added.temporaryPassword) {
        onPassword({
          person: `${firstName} ${lastName}`.trim() || email,
          value: added.temporaryPassword,
        });
      }
      setEmail("");
      setFirstName("");
      setLastName("");
      await refresh();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("platform.failed")));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string, name: string) => {
    if (!current) return;
    setBusy(true);
    try {
      await api.platform.platformControllerRemoveAdmin({ tenantId: current.id, userId });
      toast.success(t("platform.adminRemoved", { name }));
      await refresh();
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
          <DialogTitle>{t("platform.adminsTitle", { name: current?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("platform.adminsDescription")}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-[4px] border border-border text-sm">
          {(current?.admins ?? []).map((admin) => (
            <li key={admin.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{admin.name}</p>
                {admin.email && (
                  <p className="truncate text-xs text-muted-foreground">{admin.email}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || (current?.admins.length ?? 0) <= 1}
                aria-label={t("platform.removeAdmin", { name: admin.name })}
                onClick={() => void remove(admin.id, admin.name)}
              >
                <UserMinus className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={(event) => void add(event)} className="space-y-3">
          <p className="text-xs font-mono uppercase tracking-[0.14em]">{t("platform.addAdmin")}</p>
          <div className="grid gap-1">
            <Label htmlFor="admin-email">{t("access.people.email")}</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="admin-first">{t("access.people.firstName")}</Label>
              <Input
                id="admin-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="admin-last">{t("access.people.lastName")}</Label>
              <Input
                id="admin-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("platform.addAdminHint")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("platform.addAdmin")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      const { moved } = await api.platform.platformControllerImportWorkspaces({
        tenantId: tenant.id,
        importWorkspacesDto: { slugs: [...chosen] },
      });
      toast.success(t("platform.imported", { count: moved.length, name: tenant.name }));
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

  const hasWorkspaces = (tenant?.workspaces ?? 0) > 0;
  return (
    <AlertDialog open={tenant !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="rounded-[6px] border-2 border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("platform.deleteTitle", { name: tenant?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {hasWorkspaces
              ? t("platform.deleteHasWorkspaces", { count: tenant?.workspaces ?? 0 })
              : t("platform.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!hasWorkspaces && (
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
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || hasWorkspaces || typed !== tenant?.alias}
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
