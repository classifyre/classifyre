"use client";

import * as React from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type { GrantDto, RoleDto, TenantGroupDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";




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
import {
  GiveAccessDialog,
  type GrantTarget,
} from "@/components/access/give-access-dialog";
import { AuditEventList } from "@/components/audit-history";
import { useNamespace } from "@/components/namespace-provider";
import {
  SortableHead,
  sortRows,
  useTableSort,
} from "@/components/sortable-table-head";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import { formatDate } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

/**
 * What a Data tab is about, and so whose access it shows: one source (every
 * table in it) or one table. Access given on the whole workspace, a group's
 * workspaces or other scopes is managed in Settings → Access.
 */
export type DataScope =
  | { kind: "source"; sourceId: string; name: string }
  | { kind: "asset"; assetId: string; sourceId: string; name: string };

const DATA_READER = "data-reader";

/**
 * Whether a grant opens this scope's rows:
 * - a table: Data reader on the table, on its source, or anything wider;
 * - a source: Data reader on the source, on one of its tables, or wider.
 */
function reaches(scope: DataScope, workspaceId: string, grant: GrantDto) {
  if (grant.roleKey !== DATA_READER) return false;
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
  roles: RoleDto[];
  reload: () => Promise<void>;
}

/**
 * The Data reader grants that reach a scope, with the tenant's groups and
 * the workspace's roles for giving new ones. Loads only for people who may
 * see who has access.
 */
export function useDataAccessGrants(scope: DataScope): DataAccessGrants {
  const { t } = useTranslation();
  const { namespace } = useNamespace();
  const canView = useCan("access.view");
  const workspaceId = namespace?.id ?? "";
  const [grants, setGrants] = React.useState<GrantDto[] | null>(null);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const scopeKey = JSON.stringify(scope);

  const reload = React.useCallback(async () => {
    if (!workspaceId || !canView) return;
    const current = JSON.parse(scopeKey) as DataScope;
    try {
      const [all, tenantGroups, workspaceRoles] = await Promise.all([
        api.access.workspaceAccessControllerGrants(),
        api.access.workspaceAccessControllerGroups(),
        api.access.workspaceAccessControllerRoles(),
      ]);
      setGroups(tenantGroups);
      setRoles(workspaceRoles);
      setGrants(all.filter((grant) => reaches(current, workspaceId, grant)));
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
      setGrants([]);
    }
  }, [workspaceId, canView, scopeKey, t]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return { grants, groups, roles, reload };
}

/** A grant this screen may take away: given here, and only data access. */
function removable(grant: GrantDto): boolean {
  return (
    !grant.inherited &&
    grant.roleKey === DATA_READER &&
    (grant.scopeType === "asset" || grant.scopeType === "source")
  );
}

type GrantsSortCol = "group" | "scope" | "until";

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
        (grant) =>
          sortCol === "scope"
            ? grant.scopeLabel
            : sortCol === "until"
              ? grant.expiresAt
              : grant.subjectLabel,
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
                  <TableCell className="font-medium">
                    {grant.subjectLabel}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {grant.scopeLabel}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {grant.expiresAt ? formatDate(grant.expiresAt) : "—"}
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
 * "Give access" on a Data tab: the one Give access dialog (as in Settings →
 * Access) with the role fixed to Data reader and the target fixed to this
 * source or table — the group and an optional end date are left to choose.
 */
export function GiveDataAccessButton({
  scope,
  access,
}: {
  scope: DataScope;
  access: DataAccessGrants;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const target: GrantTarget =
    scope.kind === "asset"
      ? { kind: "asset", id: scope.assetId, name: scope.name }
      : { kind: "source", id: scope.sourceId, name: scope.name };
  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="data-access-dialog-trigger"
      >
        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
        {t("dataQuery.access.give")}
      </Button>
      <GiveAccessDialog
        open={open}
        onOpenChange={setOpen}
        groups={access.groups}
        roles={access.roles}
        fixed={{ roleKey: DATA_READER, target }}
        onAdded={access.reload}
      />
    </>
  );
}

/**
 * Who can query this source or table, below its query, for people who may
 * see who has access. A table's tab also has its **Activity** (reads,
 * exports and access changes touching it); the workspace-wide trail is in
 * Settings → Activity.
 */
export function DataAccessSection({
  scope,
  access,
}: {
  scope: DataScope;
  access: DataAccessGrants;
}) {
  const { t } = useTranslation();
  const canView = useCan("access.view");
  const canManage = useCan("access.manage");
  const canSeeActivity = useCan("activity.view");
  if (!canView) return null;

  const overview = (
    <DataAccessOverview scope={scope} access={access} canManage={canManage} />
  );
  if (scope.kind !== "asset" || !canSeeActivity) {
    return (
      <div className="space-y-2 pt-2" data-testid="data-access">
        <p className="text-xs font-mono uppercase tracking-[0.14em]">
          {t("dataQuery.access.open")}
        </p>
        {overview}
      </div>
    );
  }
  return (
    <div className="pt-2" data-testid="data-access">
      <Tabs defaultValue="access">
        <TabsList>
          <TabsTrigger value="access" data-testid="data-access-tab">
            {t("dataQuery.access.open")}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="data-activity-tab">
            {t("dataQuery.access.activity")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="access" className="mt-2">
          {overview}
        </TabsContent>
        <TabsContent value="activity" className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t("dataQuery.access.activityHint.asset")}
          </p>
          <AuditEventList
            filter={{ resource: `asset:${scope.assetId}` }}
            showEntity={false}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
