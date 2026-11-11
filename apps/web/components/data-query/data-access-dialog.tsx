"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { GrantDto, TenantGroupDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
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
import { Can } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage } from "@/lib/data-query";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type GrantsSortCol = "group" | "scope";
type SortDir = "asc" | "desc";

/** One sortable column head, like the settings access table. */
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

export interface TableAccessGrants {
  grants: GrantDto[] | null;
  groups: TenantGroupDto[];
  reload: () => Promise<void>;
}

/**
 * The Data reader grants that reach one table or its source: this table, its
 * whole source, or anything wider (workspace, group workspaces, tenant).
 * Shared by the overview below the query and the give-access dialog, so both
 * always show the same rows.
 */
export function useTableAccessGrants(
  workspaceId: string,
  assetId: string,
  sourceId: string,
): TableAccessGrants {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);

  const reload = React.useCallback(async () => {
    try {
      const [all, tenantGroups] = await Promise.all([
        api.access.workspaceAccessControllerGrants(),
        api.access.workspaceAccessControllerGroups(),
      ]);
      setGroups(tenantGroups);
      setGrants(
        all.filter(
          (grant) =>
            (grant.scopeType === "asset" &&
              grant.scopeId === `${workspaceId}/${assetId}`) ||
            (grant.scopeType === "source" &&
              grant.scopeId === `${workspaceId}/${sourceId}`) ||
            (grant.roleKey === "data-reader" &&
              grant.scopeType !== "asset" &&
              grant.scopeType !== "source"),
        ),
      );
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
      setGrants([]);
    }
  }, [workspaceId, assetId, sourceId, t]);

  return { grants, groups, reload };
}

/** The name a scope reads as: this table, its whole source, or the label. */
export function accessScopeLabel(
  t: (key: "dataQuery.access.thisTable" | "dataQuery.access.wholeSource") => string,
  grant: GrantDto,
): string {
  if (grant.scopeType === "asset") return t("dataQuery.access.thisTable");
  if (grant.scopeType === "source") return t("dataQuery.access.wholeSource");
  return grant.scopeLabel;
}
export function TableAccessOverview({
  access,
  onRemove,
}: {
  access: TableAccessGrants;
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
    const keyOf = (grant: GrantDto) =>
      sortCol === "scope"
        ? accessScopeLabel(t, grant)
        : grant.subjectLabel;
    return [...(access.grants ?? [])].sort((a, b) => {
      const cmp = keyOf(a).localeCompare(keyOf(b));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [access.grants, sortCol, sortDir, t]);

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("dataQuery.access.description")}
      </p>
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
                label={t("access.grantsTable.scope")}
                column="scope"
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
                <TableCell className="font-medium">
                  {grant.subjectLabel}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {accessScopeLabel(t, grant)}
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
                  {(grant.scopeType === "asset" ||
                    grant.scopeType === "source") &&
                    !grant.inherited && (
                      <Can capability="access.manage">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("dataQuery.access.remove")}
                          onClick={() => onRemove(grant)}
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
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("dataQuery.access.viewerNote")}
      </p>
    </div>
  );
}

/**
 * Give a group the Data reader role on this table or its whole source.
 * A primary "Give access" button; the dialog holds only the give form.
 */
export function GiveTableAccessDialog({
  access,
  assetId,
  sourceId,
  sourceName,
  tableName,
  onChanged,
}: {
  access: TableAccessGrants;
  assetId: string;
  sourceId: string;
  sourceName: string;
  tableName: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [groupId, setGroupId] = React.useState<string>("");
  const [scope, setScope] = React.useState<"asset" | "source">("asset");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setGroupId("");
      setScope("asset");
    }
  }, [open ]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId) return;
    setBusy(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey: "data-reader",
          scopeType: scope,
          resourceId: scope === "asset" ? assetId : sourceId,
        },
      });
      setOpen(false);
      onChanged();
      toast.success(t("dataQuery.access.added"));
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="data-access-dialog-trigger">
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.access.give")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid="data-access-dialog">
        <DialogHeader>
          <DialogTitle>{t("dataQuery.access.giveTitle")}</DialogTitle>
          <DialogDescription>
            {t("dataQuery.access.giveDescription", {
              table: tableName,
              source: sourceName,
            })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void add(event)} className="grid gap-3">
          <div className="grid gap-1">
            <Label>{t("access.group")}</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder={t("dataQuery.access.pickGroup")} />
              </SelectTrigger>
              <SelectContent>
                {access.groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("access.scope")}</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as "asset" | "source")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asset">
                  {t("dataQuery.access.thisTableName", { name: tableName })}
                </SelectItem>
                <SelectItem value="source">
                  {t("dataQuery.access.wholeSourceName", { name: sourceName })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("access.groupsHint")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t("access.cancel")}
            </Button>
            <Button type="submit" disabled={!groupId || busy}>
              <UserPlus className="h-4 w-4" />
              {t("dataQuery.access.give")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
