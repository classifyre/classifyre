"use client";

import * as React from "react";
import { Trash2, UserPlus } from "lucide-react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { AuditEventList } from "@/components/audit-history";
import { useNamespace } from "@/components/namespace-provider";
import {
  SortableHead,
  sortRows,
  useTableSort,
} from "@/components/sortable-table-head";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { apiErrorMessage } from "@/lib/data-query";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * What a Data tab is about, and so whose access and activity it shows:
 * the whole workspace (the SQL page), one source (every table in it), or
 * one table. The one type every piece below takes, so the three places
 * never drift apart.
 */
export type DataScope =
  | { kind: "workspace" }
  | { kind: "source"; sourceId: string; name: string }
  | { kind: "asset"; assetId: string; sourceId: string; name: string };

/** The audit `resource` a scope's Activity filters on (API audit-resources.ts). */
function activityResource(scope: DataScope): string {
  if (scope.kind === "source") return `source:${scope.sourceId}`;
  if (scope.kind === "asset") return `asset:${scope.assetId}`;
  return "data";
}

const DATA_READER = "data-reader";

/**
 * Whether a grant opens this scope's rows:
 * - a table: Data reader on the table, on its source, or anything wider;
 * - a source: Data reader on the source, on one of its tables, or wider;
 * - the workspace: every Data reader grant, wherever it applies.
 */
function reaches(scope: DataScope, workspaceId: string, grant: GrantDto) {
  if (grant.roleKey !== DATA_READER) return false;
  if (scope.kind === "workspace") return true;
  const onResource = (id: string) => grant.scopeId === `${workspaceId}/${id}`;
  if (grant.scopeType === "asset") {
    return scope.kind === "asset"
      ? onResource(scope.assetId)
      : grant.sourceId === scope.sourceId;
  }
  if (grant.scopeType === "source") return onResource(scope.sourceId);
  return true;
}

export interface DataAccessGrants {
  grants: GrantDto[] | null;
  groups: TenantGroupDto[];
  reload: () => Promise<void>;
}

/**
 * The Data reader grants that reach a scope, and the tenant's groups to give
 * new ones to. Loads only for people who may see who has access.
 */
export function useDataAccessGrants(scope: DataScope): DataAccessGrants {
  const { t } = useTranslation();
  const { namespace } = useNamespace();
  const canView = useCan("access.view");
  const workspaceId = namespace?.id ?? "";
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const scopeKey = JSON.stringify(scope);

  const reload = React.useCallback(async () => {
    if (!workspaceId || !canView) return;
    const current = JSON.parse(scopeKey) as DataScope;
    try {
      const [all, tenantGroups] = await Promise.all([
        api.access.workspaceAccessControllerGrants(),
        api.access.workspaceAccessControllerGroups(),
      ]);
      setGroups(tenantGroups);
      setGrants(all.filter((grant) => reaches(current, workspaceId, grant)));
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
      setGrants([]);
    }
  }, [workspaceId, canView, scopeKey, t]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return { grants, groups, reload };
}

/** A grant this screen may take away: given here, and only data access. */
function removable(grant: GrantDto): boolean {
  return (
    !grant.inherited &&
    grant.roleKey === DATA_READER &&
    (grant.scopeType === "asset" ||
      grant.scopeType === "source" ||
      grant.scopeType === "workspace")
  );
}

type GrantsSortCol = "group" | "scope";

/** Who can read a scope's rows, as a sortable table like settings → Access. */
function DataAccessOverview({
  scope,
  access,
  canManage,
}: {
  scope: DataScope;
  access: DataAccessGrants;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const sort = useTableSort<GrantsSortCol>("group");
  const { sortCol, sortDir } = sort;
  const rows = React.useMemo(
    () =>
      sortRows(
        access.grants ?? [],
        (grant) => (sortCol === "scope" ? grant.scopeLabel : grant.subjectLabel),
        sortDir,
      ),
    [access.grants, sortCol, sortDir],
  );

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.workspaceAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await access.reload();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        {t(`dataQuery.access.description.${scope.kind}`)}
      </p>
      {access.grants !== null && rows.length === 0 ? (
        <p
          className="rounded-[4px] border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="data-access-none"
        >
          {t("dataQuery.access.none")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[4px] border border-border">
          <Table data-testid="data-access-table">
            <TableHeader>
              <TableRow>
                <SortableHead
                  label={t("access.grantsTable.group")}
                  column="group"
                  sort={sort}
                />
                <SortableHead
                  label={t("access.grantsTable.scope")}
                  column="scope"
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
                  <TableCell className="font-medium">
                    {grant.subjectLabel}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {grant.scopeLabel}
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
                    {canManage && removable(grant) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("dataQuery.access.remove")}
                        onClick={() => void remove(grant)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("dataQuery.access.viewerNote")}
      </p>
    </div>
  );
}

/**
 * Give a group the Data reader role on exactly this scope: the table on a
 * table's tab, the whole source on a source's tab, the workspace on the SQL
 * page. No scope picker — where the button sits is what it opens.
 */
export function GiveDataAccessDialog({
  scope,
  access,
}: {
  scope: DataScope;
  access: DataAccessGrants;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [groupId, setGroupId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const name = scope.kind === "workspace" ? "" : scope.name;

  const give = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId) return;
    setBusy(true);
    try {
      await api.access.workspaceAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId: groupId,
          roleKey: DATA_READER,
          ...(scope.kind === "asset"
            ? { scopeType: "asset", resourceId: scope.assetId }
            : scope.kind === "source"
              ? { scopeType: "source", resourceId: scope.sourceId }
              : { scopeType: "workspace" }),
        },
      });
      setOpen(false);
      toast.success(t("dataQuery.access.added"));
      await access.reload();
    } catch (error) {
      toast.error(await apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setGroupId("");
      }}
    >
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
            {t(`dataQuery.access.giveDescription.${scope.kind}`, { name })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void give(event)} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="data-access-group">{t("access.group")}</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="data-access-group" data-testid="data-access-group">
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
          <p className="text-xs text-muted-foreground">
            {t(`dataQuery.access.giveHint.${scope.kind}`, { name })}
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
            <Button
              type="submit"
              disabled={!groupId || busy}
              data-testid="data-access-give"
            >
              <UserPlus className="h-4 w-4" />
              {t("dataQuery.access.give")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Access and Activity for a scope, below its query: **Access** (the grants
 * that reach it, for people who may see who has access) and **Activity**
 * (what the trail recorded touching it: access given or taken away, reads
 * and exports of its tables). Activity names people, so it shows with
 * `access.view` too — never to visitors of a public workspace.
 */
export function DataAccessTabs({
  scope,
  access,
  actions,
}: {
  scope: DataScope;
  access: DataAccessGrants;
  /** Beside the tab list, e.g. Give access where no header holds it. */
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const canView = useCan("access.view");
  const canManage = useCan("access.manage");
  const canSeeActivity = useCan("activity.view");
  if (!canView) return null;

  return (
    <div className="pt-2" data-testid="data-access">
      <Tabs defaultValue="access">
        <div className="flex flex-wrap items-center gap-2">
        <TabsList>
          <TabsTrigger value="access" data-testid="data-access-tab">
            {t("dataQuery.access.open")}
          </TabsTrigger>
          {canSeeActivity && (
            <TabsTrigger value="activity" data-testid="data-activity-tab">
              {t("dataQuery.access.activity")}
            </TabsTrigger>
          )}
        </TabsList>
          {actions && <div className="ml-auto">{actions}</div>}
        </div>
        <TabsContent value="access" className="mt-2">
          <DataAccessOverview scope={scope} access={access} canManage={canManage} />
        </TabsContent>
{canSeeActivity && (
        <TabsContent value="activity" className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t(`dataQuery.access.activityHint.${scope.kind}`)}
          </p>
          <AuditEventList
            filter={{ resource: activityResource(scope) }}
            showEntity={scope.kind !== "asset"}
          />
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
