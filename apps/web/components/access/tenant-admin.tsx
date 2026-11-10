"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Building2,
  ChevronsUpDown,
  History,
  KeyRound,
  Search,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  TenantAccessControllerEventsSortByEnum,
  TenantAccessControllerEventsSortOrderEnum,
  type GrantDto,
  type Namespace,
  type RoleDto,
  type TenantDto,
  type TenantEventDto,
  type TenantGroupDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { DataTableFooter } from "@/components/data-table-footer";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { ActorChip } from "@/components/actor-chip";
import { useIamConsole } from "@/components/iam-session";
import { useTranslation } from "@/hooks/use-translation";
import { useLocalePath } from "@/lib/app-path";
import { formatDate, formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type ScopeType = "tenant" | "group" | "workspace";
type GrantsSortCol = "group" | "role" | "scope" | "until";
type ActivitySortCol = "when" | "who" | "what";
type SortDir = "asc" | "desc";

const TAB_TRIGGER_CLASS =
  "gap-2 px-1 text-xs font-mono uppercase tracking-[0.14em]";

const ACTIVITY_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/**
 * The tenant admin's page (docs/prd §12.4): every grant (a role on the
 * tenant, a group's workspaces or one workspace, grouped by group) and the
 * tenant's activity. Giving access lives in a dialog opened from the card
 * header; people and groups are managed in the identity server (or the
 * company directory behind it) — Classifyre reads them and decides what
 * they may do. The activity tab reuses the dense server-side table shape of
 * the workspace activity, against the tenant trail.
 */
export function TenantAdmin() {
  const { t } = useTranslation();
  const consoleOn = useIamConsole();
  const [tenant, setTenant] = React.useState<TenantDto | null>(null);
  const [grants, setGrants] = React.useState<GrantDto[]>([]);
  const [groups, setGroups] = React.useState<TenantGroupDto[]>([]);
  const [roles, setRoles] = React.useState<RoleDto[]>([]);
  const [workspaces, setWorkspaces] = React.useState<Namespace[]>([]);
  const [canAudit, setCanAudit] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const current = await api.access.tenantAccessControllerTenant();
      setTenant(current);
      if (!current.capabilities.includes("tenant.access.manage")) {
        setDenied(true);
        return;
      }
      const [nextGrants, nextGroups, nextWorkspaces, nextRoles] = await Promise.all([
        api.access.tenantAccessControllerGrants(),
        api.access.tenantAccessControllerGroups(),
        api.namespaces.list(),
        api.access.tenantAccessControllerRoles(),
      ]);
      setGrants(nextGrants);
      setGroups(nextGroups);
      setWorkspaces(nextWorkspaces);
      setRoles(nextRoles);
      setCanAudit(current.capabilities.includes("tenant.audit.view"));
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.loadFailed")));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async (grant: GrantDto) => {
    try {
      await api.access.tenantAccessControllerRemoveGrant({ id: grant.id });
      toast.success(t("access.removed", { subject: grant.subjectLabel }));
      await load();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("access.removeFailed")));
    }
  };


  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-8">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> {t("access.allWorkspaces")}
        </Link>
      </Button>
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6" />
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.06em]">
          {tenant?.name ?? t("access.tenantTitle")}
        </h1>
      </div>

      {denied ? (
        <p className="text-sm text-muted-foreground">{t("access.tenantDenied")}</p>
      ) : (
        <Tabs defaultValue="access" urlParam="tab" className="gap-5">
          <TabsList
            variant="line"
            className="h-auto w-full flex-wrap justify-start gap-x-6 gap-y-1 border-b-2 border-border pb-0"
          >
            <TabsTrigger value="access" className={TAB_TRIGGER_CLASS}>
              <KeyRound className="h-3.5 w-3.5" />
              {t("access.tabs.access")}
            </TabsTrigger>
            {canAudit && (
              <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                <History className="h-3.5 w-3.5" />
                {t("access.tabs.activity")}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="access">
            <Card className="panel-card rounded-[6px]">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-xl space-y-1">
                    <p className="text-xs font-mono uppercase tracking-[0.14em]">
                      {t("access.tenantGrants")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("access.peopleElsewhere")}{" "}
                      {!(consoleOn && tenant?.organizationId) && t("access.peopleByOperators")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {consoleOn && tenant?.organizationId && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`/auth/console/?organization=${encodeURIComponent(tenant.organizationId)}`}
                          target="_blank"
                          rel="noreferrer"
                          data-testid="tenant-identity-console"
                        >
                          <UsersRound className="h-4 w-4" />
                          {t("access.managePeople")}
                        </a>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="tenant-give-access">
                      <UserPlus className="h-4 w-4" />
                      {t("access.add")}
                    </Button>
                  </div>
                </div>
                <TenantGrantsTable
                  grants={grants}
                  groups={groups}
                  roles={roles}
                  workspaces={workspaces}
                  onRemove={remove}
                />
                {tenant && (
                  <TenantGrantDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    tenant={tenant}
                    groups={groups}
                    roles={roles}
                    workspaces={workspaces}
                    onAdded={load}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {canAudit && (
            <TabsContent value="activity">
              <Card className="panel-card rounded-[6px]">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    <p className="text-xs font-mono uppercase tracking-[0.14em]">
                      {t("access.tabs.activity")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("access.tenantActivity.description")}
                  </p>
                  <TenantActivityTable groups={groups} workspaces={workspaces} />
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

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

/** All grants of the tenant, sortable and grouped by group — no paging, it fits. */
function TenantGrantsTable({
  grants,
  groups,
  roles,
  workspaces,
  onRemove,
}: {
  grants: GrantDto[];
  groups: TenantGroupDto[];
  roles: RoleDto[];
  workspaces: Namespace[];
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

  const roleTitle = (key: string) =>
    roles.find((role) => role.key === key)?.title ?? key;
  const groupPath = (id: string) =>
    groups.find((group) => group.id === id)?.path ??
    t("access.removedGroupId", { id: id.slice(0, 8) });
  const scopeName = (grant: GrantDto) =>
    grant.scopeType === "workspace"
      ? (workspaces.find((ws) => ws.id === grant.scopeId)?.name ?? grant.scopeLabel)
      : grant.scopeLabel;

  const sorted = React.useMemo(() => {
    const keyOf = (grant: GrantDto) =>
      sortCol === "role"
        ? roleTitle(grant.roleKey)
        : sortCol === "scope"
          ? scopeName(grant)
          : sortCol === "until"
            ? (grant.expiresAt ?? "")
            : groupPath(grant.subjectId);
    return [...grants].sort((a, b) => {
      const left = keyOf(a);
      const right = keyOf(b);
      if (sortCol === "until") {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grants, sortCol, sortDir, groups, roles, workspaces]);

  const grouped = React.useMemo(() => {
    const byGroup = new Map<string, GrantDto[]>();
    for (const grant of sorted) {
      const list = byGroup.get(grant.subjectId) ?? [];
      list.push(grant);
      byGroup.set(grant.subjectId, list);
    }
    return [...byGroup.entries()].sort(([a], [b]) =>
      groupPath(a).localeCompare(groupPath(b)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  if (grants.length === 0) {
    return (
      <p className="rounded-[4px] border border-border px-3 py-4 text-center text-sm text-muted-foreground">
        {t("access.none")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([subjectId, rows]) => (
        <section key={subjectId} className="space-y-1">
          <div className="flex items-center gap-2 px-1">
            <Badge variant="outline" className="gap-1.5 py-1">
              <UsersRound className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="max-w-[320px] truncate font-medium">
                {groupPath(subjectId)}
              </span>
            </Badge>
            <span className="text-xs text-muted-foreground">
              {rows.length === 1
                ? t("access.group")
                : t("notificationAudiences.groups")}
            </span>
          </div>
          <div className="overflow-x-auto rounded-[4px] border border-border">
            <Table>
              <TableHeader>
                <TableRow>
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
                      {roleTitle(grant.roleKey)}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {grant.roleKey}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {scopeName(grant)}
                      {grant.scopeType === "group" ||
                      grant.scopeType === "source" ||
                      grant.scopeType === "asset" ? (
                        <span className="ml-2 font-mono text-[11px]">
                          {grant.scopeId.slice(0, 8)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {grant.expiresAt ? formatDate(grant.expiresAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("access.remove")}
                        onClick={() => void onRemove(grant)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}

/** What an activity entry was about: a group path, an address or a workspace. */
function eventSubject(
  event: TenantEventDto,
  groups: TenantGroupDto[],
  workspaces: Namespace[],
): string | null {
  const detail = (event.detail ?? {}) as Record<string, unknown>;
  // Grants and audience changes carry ids: render the human path/name the
  // tenant admin recognises, with the removed-group fallback from the access
  // table when the group is gone.
  for (const key of ["subjectId", "scopeId", "groupIds"]) {
    const value = detail[key];
    if (typeof value === "string" && value) {
      const group = groups.find((g) => g.id === value);
      if (group) return group.path;
      const ws = workspaces.find((w) => w.id === value);
      if (ws) return ws.name;
    }
  }
  for (const key of ["path", "to", "email", "slug"]) {
    if (typeof detail[key] === "string") return detail[key];
  }
  return null;
}

/**
 * Tenant activity as the same dense table as the workspace activity: sortable
 * by when/who/what, filterable by action, actor and free text, server-paged.
 * The where-column resolves group paths and workspace names (with links), so
 * `grant.added` answers "where" instead of showing a bare id.
 */
function TenantActivityTable({
  groups,
  workspaces,
}: {
  groups: TenantGroupDto[];
  workspaces: Namespace[];
}) {
  const { t } = useTranslation();
  const localePath = useLocalePath();
  const [events, setEvents] = React.useState<TenantEventDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [actions, setActions] = React.useState<string[]>([]);
  const [action, setAction] = React.useState("ALL");
  const [actor, setActor] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [sortCol, setSortCol] = React.useState<ActivitySortCol>("when");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<string>(String(ACTIVITY_PAGE_SIZE_OPTIONS[1]));

  const sortParam = React.useMemo(() => {
    const order =
      sortDir === "asc"
        ? TenantAccessControllerEventsSortOrderEnum.Asc
        : TenantAccessControllerEventsSortOrderEnum.Desc;
    if (sortCol === "who")
      return { sortBy: TenantAccessControllerEventsSortByEnum.Actor, sortOrder: order };
    if (sortCol === "what")
      return { sortBy: TenantAccessControllerEventsSortByEnum.Action, sortOrder: order };
    return {
      sortBy: TenantAccessControllerEventsSortByEnum.OccurredAt,
      sortOrder: order,
    };
  }, [sortCol, sortDir]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const size = Number(pageSize) || ACTIVITY_PAGE_SIZE_OPTIONS[1];
      const response = await api.access.tenantAccessControllerEvents({
        action: action === "ALL" ? undefined : action,
        actor: actor.trim() || undefined,
        search: search.trim() || undefined,
        skip: (page - 1) * size,
        limit: size,
        sortBy: sortParam.sortBy,
        sortOrder: sortParam.sortOrder,
      });
      setEvents(response.items ?? []);
      setTotal(response.total ?? 0);
      setActions((current) => {
        if (current.length > 0) return current;
        return [...new Set((response.items ?? []).map((e) => e.action))].sort();
      });
    } catch (error) {
      console.error("Failed to load tenant activity:", error);
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [action, actor, search, page, pageSize, sortParam]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    setPage(1);
  }, [action, actor, search, pageSize]);

  const onSort = (col: ActivitySortCol) => {
    if (col === sortCol) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "when" ? "desc" : "asc");
    }
  };

  const head = (label: string, column: ActivitySortCol) => {
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
  };

  const size = Number(pageSize) || ACTIVITY_PAGE_SIZE_OPTIONS[1];
  const totalPages = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);

  if (!loading && total === 0 && !search && !actor && action === "ALL") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("access.tenantActivity.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-[1.4]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("access.tenantActivity.search")}
            className="h-8 rounded-[4px] border-2 border-border pl-9 text-sm"
          />
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-8 w-[190px] text-sm">
            <SelectValue placeholder={t("access.tenantActivity.action")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("access.tenantActivity.allActions")}</SelectItem>
            {actions.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          placeholder={t("audit.table.who")}
          className="h-8 w-[190px] rounded-[4px] border-2 border-border text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-[4px] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {head(t("audit.table.when"), "when")}
              {head(t("audit.table.who"), "who")}
              {head(t("audit.table.what"), "what")}
              <TableHead>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("audit.table.where")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const detail = (event.detail ?? {}) as Record<string, unknown>;
              const scopeId =
                typeof detail.scopeId === "string" ? detail.scopeId : null;
              const namespaceId =
                typeof detail.namespaceId === "string"
                  ? detail.namespaceId
                  : scopeId;
              const ws = namespaceId
                ? workspaces.find((w) => w.id === namespaceId)
                : undefined;
              return (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    <time
                      dateTime={new Date(event.occurredAt).toISOString()}
                      title={formatDate(event.occurredAt)}
                    >
                      {formatRelative(event.occurredAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <ActorChip actorRef={event.actor} />
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">{event.action}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                    {ws ? (
                      <Link
                        href={localePath(`/${ws.slug}/settings?tab=access`)}
                        className="font-medium text-foreground hover:underline"
                      >
                        {ws.name}
                      </Link>
                    ) : (
                      (eventSubject(event, groups, workspaces) ?? "—")
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  {t("access.tenantActivity.noMatch")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTableFooter
        page={clampedPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        pageSizeOptions={[...ACTIVITY_PAGE_SIZE_OPTIONS]}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        totalLabel={`${total.toLocaleString()} ${t("audit.table.rangeOf", { total: total.toLocaleString() })}`}
        emptyLabel={t("access.tenantActivity.empty")}
      />
      {loading && (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      )}
    </div>
  );
}

function TenantGrantDialog({
  open,
  onOpenChange,
  tenant,
  groups,
  roles,
  workspaces,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: TenantDto;
  groups: TenantGroupDto[];
  roles: RoleDto[];
  workspaces: Namespace[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [subjectId, setSubjectId] = React.useState("");
  const [roleKey, setRoleKey] = React.useState("viewer");
  const [scopeType, setScopeType] = React.useState<ScopeType>("group");
  const [scopeId, setScopeId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const role = roles.find((candidate) => candidate.key === roleKey);
  const scopes = React.useMemo(
    () => (role?.scopes ?? ["tenant"]) as ScopeType[],
    [role],
  );

  React.useEffect(() => {
    if (open) {
      setSubjectId("");
      setRoleKey("viewer");
      setScopeType("group");
      setScopeId("");
      setSaving(false);
    }
  }, [open ]);

  React.useEffect(() => {
    if (!scopes.includes(scopeType)) setScopeType(scopes[0] ?? "tenant");
  }, [scopes, scopeType]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setSaving(true);
      await api.access.tenantAccessControllerAddGrant({
        createGrantDto: {
          subjectType: "group",
          subjectId,
          roleKey,
          scopeType,
          scopeId: scopeType === "tenant" ? tenant.id : scopeId,
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
          <DialogDescription>{t("access.groupsHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>{t("access.group")}</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
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
                  {roles.map((candidate) => (
                    <SelectItem key={candidate.key} value={candidate.key}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("access.scope")}</Label>
              <Select
                value={scopeType}
                onValueChange={(value) => {
                  setScopeType(value as ScopeType);
                  setScopeId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {t(`access.scopes.${scope}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {scopeType !== "tenant" && (
              <div className="grid gap-1">
                <Label>
                  {scopeType === "group" ? t("access.ownedBy") : t("access.workspace")}
                </Label>
                <Select value={scopeId} onValueChange={setScopeId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("access.pickScope")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(scopeType === "group"
                      ? groups.map((group) => ({ id: group.id, label: group.path }))
                      : workspaces.map((ws) => ({ id: ws.id, label: ws.name }))
                    ).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            <Button
              type="submit"
              disabled={!subjectId || (scopeType !== "tenant" && !scopeId) || saving}
            >
              <UserPlus className="h-4 w-4" />
              {t("access.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
