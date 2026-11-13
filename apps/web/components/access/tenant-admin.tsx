"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  History,
  KeyRound,
  Search,
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
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { DataTableFooter } from "@/components/data-table-footer";


import { Input } from "@workspace/ui/components/input";


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
import { GiveAccessDialog } from "@/components/access/give-access-dialog";
import { GrantsByGroup } from "@/components/access/grants-by-group";
import {
  SortableHead,
  useTableSort,
} from "@/components/sortable-table-head";
import { useIamConsole } from "@/components/iam-session";
import { useTranslation } from "@/hooks/use-translation";
import { useLocale } from "@/lib/app-path";
import { formatDate, formatRelative } from "@/lib/date";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

type ActivitySortCol = "when" | "who" | "what";

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
                  <GiveAccessDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    groups={groups}
                    roles={roles}
                    where={{ kind: "tenant", tenant, workspaces }}
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


/** All grants of the tenant, grouped by group with what each role gives — no paging, it fits. */
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
  const groupPath = React.useCallback(
    (grant: GrantDto) =>
      groups.find((group) => group.id === grant.subjectId)?.path ??
      t("access.removedGroupId", { id: grant.subjectId.slice(0, 8) }),
    [groups, t],
  );
  const scopeName = React.useCallback(
    (grant: GrantDto) => {
      const name =
        grant.scopeType === "workspace"
          ? (workspaces.find((ws) => ws.id === grant.scopeId)?.name ??
            grant.scopeLabel)
          : grant.scopeLabel;
      return grant.scopeType === "group" ||
        grant.scopeType === "source" ||
        grant.scopeType === "asset" ? (
        <>
          {name}
          <span className="ml-2 font-mono text-[11px]">
            {grant.scopeId.slice(0, 8)}
          </span>
        </>
      ) : (
        name
      );
    },
    [workspaces],
  );

  return (
    <GrantsByGroup
      grants={grants}
      roles={roles}
      groupLabel={groupPath}
      scopeLabel={scopeName}
      canRemove={() => true}
      onRemove={onRemove}
    />
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
  const locale = useLocale();
  const localePath = (path: string) =>
    locale === "en" ? path : `/${locale}${path}`;
  const [events, setEvents] = React.useState<TenantEventDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [actions, setActions] = React.useState<string[]>([]);
  const [action, setAction] = React.useState("ALL");
  const [actor, setActor] = React.useState("");
  const [search, setSearch] = React.useState("");
  const sort = useTableSort<ActivitySortCol>("when", "desc", (col) =>
    col === "when" ? "desc" : "asc",
  );
  const { sortCol, sortDir } = sort;
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

  const head = (label: string, column: ActivitySortCol) => (
    <SortableHead label={label} column={column} sort={sort} />
  );

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
