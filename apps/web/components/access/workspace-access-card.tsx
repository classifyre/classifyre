"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type GrantDto,
  type RoleDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { useMe, Can } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { formatDate } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type GrantsSortCol = "group" | "role" | "scope" | "until";
type SortDir = "asc" | "desc";

/** One sortable column head for the dense access tables. */
function SortableHead({
  label,
  column,
  sortCol,
  sortDir,
  onSort,
}: {
  label: string;
  column: GrantsSortCol;
  sortCol: GrantsSortCol;
  sortDir: SortDir;
  onSort: (col: GrantsSortCol) => void;
}) {
  const active = sortCol === column;
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-2.5 w-2.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5" />
          )
        ) : (
          <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * Who has access to this workspace, and why (docs/prd §12.4). Grants made
 * here can be removed here; inherited ones (from the tenant or the group that
 * owns the workspace) are shown read-only, because only a tenant admin can
 * change them. Giving access lives in a dialog opened from the card header;
 * "What I can do" lists every capability the caller holds with the group,
 * role, tenant and scope that give it.
 */
export function WorkspaceAccessCard() {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [nextGrants, nextRoles, nextGroups] = await Promise.all([
        api.access.workspaceAccessControllerGrants(),
        api.access.workspaceAccessControllerRoles(),
        api.access.workspaceAccessControllerGroups(),
      ]);
      setGrants(nextGrants);
      setRoles(nextRoles);
      setGroups(nextGroups);
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
      setGrants([]);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const roleTitle = (key: string) =>
    roles.find((role) => role.key === key)?.title ?? key;

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.workspaceAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await load();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("access.title")}
            </p>
          </div>
          <Can capability="access.manage">
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              data-testid="workspace-give-access"
            >
              <UserPlus className="h-4 w-4" />
              {t("access.add")}
            </Button>
          </Can>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          {t("access.description")}
        </p>

        <GrantsTable grants={grants} roleTitle={roleTitle} onRemove={remove} />

        <Can capability="access.manage">
          <GiveAccessDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            groups={groups}
            roles={roles.filter((role) => role.scopes.includes("workspace"))}
            onAdded={load}
          />
        </Can>

        <WhatICanDo roles={roles} />
      </CardContent>
    </Card>
  );
}

/** The grants that reach this workspace, as a dense sortable table. */
function GrantsTable({
  grants,
  roleTitle,
  onRemove,
}: {
  grants: GrantDto[] | null;
  roleTitle: (key: string) => string;
  onRemove: (grant: GrantDto) => void;
}) {
  const { t } = useTranslation();
  const [sortCol, setSortCol] = React.useState<GrantsSortCol>("group");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const onSort = (col: GrantsSortCol) => {
    if (col === sortCol) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const rows = React.useMemo(() => {
    const base = grants ?? [];
    const keyOf = (grant: GrantDto) =>
      sortCol === "role"
        ? roleTitle(grant.roleKey)
        : sortCol === "scope"
          ? grant.scopeLabel
          : sortCol === "until"
            ? (grant.expiresAt ?? "")
            : grant.subjectLabel;
    return [...base].sort((a, b) => {
      const left = keyOf(a);
      const right = keyOf(b);
      if (left instanceof Date || right instanceof Date) {
        const l = left ? new Date(left as string | Date).getTime() : NaN;
        const r = right ? new Date(right as string | Date).getTime() : NaN;
        if (Number.isNaN(l) && Number.isNaN(r)) return 0;
        if (Number.isNaN(l)) return 1;
        if (Number.isNaN(r)) return -1;
        return sortDir === "asc" ? l - r : r - l;
      }
      const cmp = String(left).localeCompare(String(right));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [grants, sortCol, sortDir, roleTitle]);

  if (grants?.length === 0) {
    return (
      <p className="rounded-[4px] border border-border px-3 py-4 text-center text-sm text-muted-foreground">
        {t("access.none")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[4px] border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label={t("access.grantsTable.group")}
              column="group"
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHead
              label={t("access.grantsTable.role")}
              column="role"
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHead
              label={t("access.grantsTable.scope")}
              column="scope"
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHead
              label={t("access.grantsTable.until")}
              column="until"
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={onSort}
            />
            <TableHead>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("access.grantsTable.origin")}
              </span>
            </TableHead>
            <TableHead className="text-right">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("access.grantsTable.actions")}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((grant) => (
            <TableRow key={grant.id}>
              <TableCell className="font-medium">{grant.subjectLabel}</TableCell>
              <TableCell>{roleTitle(grant.roleKey)}</TableCell>
              <TableCell className="text-muted-foreground">
                {grant.scopeLabel}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {grant.expiresAt
                  ? formatDate(grant.expiresAt)
                  : "—"}
              </TableCell>
              <TableCell>
                {grant.inherited ? (
                  <Badge variant="outline">{t("access.inherited")}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("access.grantsTable.here")}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {!grant.inherited && (
                  <Can capability="access.manage">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("access.remove")}
                      onClick={() => void onRemove(grant)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Can>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GiveAccessDialog({
  open,
  onOpenChange,
  groups,
  roles,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: TenantGroupDto[];
  roles: RoleDto[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("viewer");
  const [until, setUntil] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setGroupId("");
      setRoleKey("viewer");
      setUntil("");
    }
  }, [open ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId) return;
    setSaving(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey,
          expiresAt: until ? new Date(`${until}T23:59:59`) : null,
        },
      });
      toast.success(t("access.added"));
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.addFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("access.giveAccessTitle")}</DialogTitle>
          <DialogDescription>
            {t("access.giveAccessDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-1">
            <Label>{t("access.group")}</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder={t("access.pickGroup")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("access.role")}</Label>
            <Select value={roleKey} onValueChange={setRoleKey}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.key} value={role.key}>
                    {role.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="access-until">{t("access.untilOptional")}</Label>
            <Input
              id="access-until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("access.groupsHint")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("access.cancel")}
            </Button>
            <Button type="submit" disabled={!groupId || saving}>
              <Plus className="h-4 w-4" />
              {t("access.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "What I can do": every capability the caller holds here, with the group,
 * role, tenant and scope that give it — a dense sortable table instead of the
 * "pick something you can do" dropdown. One row per (capability, grant), so a
 * capability given twice shows both paths.
 */
function WhatICanDo({ roles }: { roles: RoleDto[] }) {
  const { t } = useTranslation();
  const me = useMe();
  const [rows, setRows] = React.useState<
    { capability: string; grant: GrantDto }[] | null
  >(null);
  const [sortCol, setSortCol] =
    React.useState<"capability" | "group" | "role" | "scope">("capability");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const capabilities = React.useMemo(
    () => [...(me?.capabilities ?? [])].sort(),
    [me],
  );

  React.useEffect(() => {
    let active = true;
    if (capabilities.length === 0) {
      setRows([]);
      return;
    }
    void Promise.all(
      capabilities.map(async (capability) => {
        try {
          const grants =
            await api.access.workspaceAccessControllerExplain({ capability });
          return grants.map((grant) => ({ capability, grant }));
        } catch {
          return [];
        }
      }),
    ).then((all) => {
      if (active) setRows(all.flat());
    });
    return () => {
      active = false;
    };
  }, [capabilities]);

  const roleTitle = (key: string) =>
    roles.find((role) => role.key === key)?.title ?? key;

  const onSort = (col: typeof sortCol) => {
    if (col === sortCol) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sorted = React.useMemo(() => {
    const keyOf = (row: { capability: string; grant: GrantDto }) =>
      sortCol === "group"
        ? row.grant.subjectLabel
        : sortCol === "role"
          ? roleTitle(row.grant.roleKey)
          : sortCol === "scope"
            ? row.grant.scopeLabel
            : row.capability;
    return [...(rows ?? [])].sort((a, b) => {
      const cmp = keyOf(a).localeCompare(keyOf(b));
      return sortDir === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortCol, sortDir]);

  const head = (
    label: string,
    column: typeof sortCol,
  ) => (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {sortCol === column ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-2.5 w-2.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5" />
          )
        ) : (
          <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  if ((rows ?? []).length === 0) {
    return (
      <div className="space-y-2 rounded-[4px] bg-muted/30 p-3">
        <p className="text-sm font-medium">{t("access.whyTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("access.whyDescription")}
        </p>
        <p className="py-2 text-center text-sm text-muted-foreground">
          {rows === null ? t("common.loading") : t("access.canDo.none")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[4px] bg-muted/30 p-3">
      <p className="text-sm font-medium">{t("access.whyTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {t("access.whyDescription")}
      </p>
      <div className="overflow-x-auto rounded-[4px] border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {head(t("access.canDo.capability"), "capability")}
              {head(t("access.canDo.group"), "group")}
              {head(t("access.canDo.role"), "role")}
              {head(t("access.canDo.tenant"), "scope")}
              {head(t("access.canDo.scope"), "scope")}
              <TableHead>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("access.canDo.via")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(({ capability, grant }) => (
              <TableRow key={`${capability}:${grant.id}`}>
                <TableCell className="font-mono text-xs">{capability}</TableCell>
                <TableCell className="font-medium">
                  {grant.subjectLabel}
                </TableCell>
                <TableCell>{roleTitle(grant.roleKey)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {grant.scopeType === "tenant" ? grant.scopeLabel : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {grant.scopeLabel}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t("access.becauseOf", {
                    subject: grant.subjectLabel,
                    role: roleTitle(grant.roleKey),
                    scope: grant.scopeLabel,
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
