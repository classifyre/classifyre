"use client";

import * as React from "react";
import {
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { GiveAccessDialog } from "@/components/access/give-access-dialog";
import {
  SortableHead,
  sortRows,
  useTableSort,
} from "@/components/sortable-table-head";
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

  const roleTitle = React.useCallback(
    (key: string) => roles.find((role) => role.key === key)?.title ?? key,
    [roles],
  );

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
  const sort = useTableSort<GrantsSortCol>("group");
  const { sortCol, sortDir } = sort;

  const rows = React.useMemo(
    () =>
      sortRows(
        grants ?? [],
        (grant) =>
          sortCol === "role"
            ? roleTitle(grant.roleKey)
            : sortCol === "scope"
              ? grant.scopeLabel
              : sortCol === "until"
                ? grant.expiresAt
                : grant.subjectLabel,
        sortDir,
      ),
    [grants, sortCol, sortDir, roleTitle],
  );

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
              sort={sort}
            />
            <SortableHead
              label={t("access.grantsTable.role")}
              column="role"
              sort={sort}
            />
            <SortableHead
              label={t("access.grantsTable.scope")}
              column="scope"
              sort={sort}
            />
            <SortableHead
              label={t("access.grantsTable.until")}
              column="until"
              sort={sort}
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
  const sort = useTableSort<"capability" | "group" | "role" | "scope">(
    "capability",
  );
  const { sortCol, sortDir } = sort;

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

  const roleTitle = React.useCallback(
    (key: string) => roles.find((role) => role.key === key)?.title ?? key,
    [roles],
  );

  const sorted = React.useMemo(
    () =>
      sortRows(
        rows ?? [],
        (row) =>
          sortCol === "group"
            ? row.grant.subjectLabel
            : sortCol === "role"
              ? roleTitle(row.grant.roleKey)
              : sortCol === "scope"
                ? row.grant.scopeLabel
                : row.capability,
        sortDir,
      ),
    [rows, sortCol, sortDir, roleTitle],
  );

  const head = (label: string, column: typeof sortCol) => (
    <SortableHead label={label} column={column} sort={sort} />
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
