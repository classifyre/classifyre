"use client";

import * as React from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  History,
  Search,
} from "lucide-react";
import {
  api,
  AuditControllerListSortByEnum,
  AuditControllerListSortOrderEnum,
  AuditEventDtoChannelEnum,
  type AuditEventDto,
  type Namespace,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { ActorChip } from "@/components/actor-chip";
import { useTranslation } from "@/hooks/use-translation";
import { useLocale } from "@/lib/app-path";
import { formatDate, formatRelative } from "@/lib/date";

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  actor?: string;
  /** Free-text search, like the table's own search box. */
  search?: string;
}

type AuditSortCol = "when" | "who" | "what" | "where" | "capability" | "channel";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const SORT_PARAM: Record<AuditSortCol, AuditControllerListSortByEnum> = {
  when: AuditControllerListSortByEnum.OccurredAt,
  who: AuditControllerListSortByEnum.Actor,
  what: AuditControllerListSortByEnum.Operation,
  where: AuditControllerListSortByEnum.EntityType,
  capability: AuditControllerListSortByEnum.Capability,
  channel: AuditControllerListSortByEnum.OccurredAt,
};

/** Sortable column head for the dense audit table. */
function SortableHead({
  label,
  column,
  sortCol,
  sortDir,
  onSort,
}: {
  label: string;
  column: AuditSortCol;
  sortCol: AuditSortCol;
  sortDir: SortDir;
  onSort: (col: AuditSortCol) => void;
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
 * Audit events for a filter, newest first. The trail is dense and server-side:
 * `filter` pins the entity (or nothing for the whole workspace), while text,
 * capability and channel narrow it; sorting and paging go to the API, so the
 * "load more" accumulation is gone in favour of offset pages. `showEntity`
 * adds the "where" column for workspace-wide views.
 */
export function useAuditEvents(filter: AuditFilter | null) {
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [capability, setCapability] = useState<string>("ALL");
  const [channel, setChannel] = useState<string>("ALL");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<AuditSortCol>("when");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<string>(String(PAGE_SIZE_OPTIONS[1]));
  const key = filter ? JSON.stringify(filter) : null;

  const load = useCallback(async () => {
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const parsed = JSON.parse(key) as AuditFilter;
      const size = Number(pageSize) || PAGE_SIZE_OPTIONS[1];
      const response = await api.identity.auditControllerList({
        ...parsed,
        search: search.trim() || parsed.search || undefined,
        capability: capability === "ALL" ? undefined : capability,
        operation: undefined,
        limit: size,
        skip: (page - 1) * size,
        sortBy: SORT_PARAM[sortCol],
        sortOrder:
          sortDir === "asc"
            ? AuditControllerListSortOrderEnum.Asc
            : AuditControllerListSortOrderEnum.Desc,
      });
      setEvents(response.items ?? []);
      setTotal(response.total ?? 0);
      setCapabilities((current) => {
        if (current.length > 0) return current;
        const seen = new Set<string>();
        for (const event of response.items ?? []) {
          if (event.capability) seen.add(event.capability);
        }
        return [...seen].sort();
      });
    } catch (error) {
      console.error("Failed to load audit events:", error);
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [key, page, pageSize, search, capability, sortCol, sortDir, channel]);

  useEffect(() => {
    setEvents([]);
    setTotal(0);
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [key, search, capability, channel, pageSize]);

  const onSort = (col: AuditSortCol) => {
    if (col === "channel") return;
    if (col === sortCol) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "when" ? "desc" : "asc");
    }
  };

  return {
    events: channel === "ALL" ? events : events.filter((e) => e.channel === channel),
    total: channel === "ALL" ? total : events.filter((e) => e.channel === channel).length,
    loading,
    search,
    setSearch,
    capability,
    setCapability,
    capabilities,
    channel,
    setChannel,
    sortCol,
    sortDir,
    onSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    reload: load,
  };
}

/** Dense audit table: sortable, filterable, server-paged. */
export function AuditEventTable({
  filter,
  showEntity = false,
  workspaceSlug,
  workspaces,
}: {
  filter: AuditFilter;
  showEntity?: boolean;
  /** Current workspace slug: renders the `workspaces` entity as a link to it. */
  workspaceSlug?: string;
  /** Resolves workspace ids to names/links when the trail spans workspaces. */
  workspaces?: Namespace[];
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const localePath = (path: string) =>
    locale === "en" ? path : `/${locale}${path}`;
  const {
    events,
    total,
    loading,
    search,
    setSearch,
    capability,
    setCapability,
    capabilities,
    channel,
    setChannel,
    sortCol,
    sortDir,
    onSort,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = useAuditEvents(filter);

  const size = Number(pageSize) || PAGE_SIZE_OPTIONS[1];
  const totalPages = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);

  if (!loading && events.length === 0 && total === 0 && !search && capability === "ALL" && channel === "ALL") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("audit.empty")}
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
            placeholder={t("audit.table.search")}
            className="h-8 rounded-[4px] border-2 border-border pl-9 text-sm"
          />
        </div>
        <Select value={capability} onValueChange={setCapability}>
          <SelectTrigger className="h-8 w-[190px] text-sm">
            <SelectValue placeholder={t("audit.table.capability")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("audit.table.allCapabilities")}</SelectItem>
            {capabilities.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-8 w-[150px] text-sm">
            <SelectValue placeholder={t("audit.table.channel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("audit.table.allChannels")}</SelectItem>
            <SelectItem value={AuditEventDtoChannelEnum.Rest}>{t("audit.table.rest")}</SelectItem>
            <SelectItem value={AuditEventDtoChannelEnum.Mcp}>{t("audit.table.mcp")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-[4px] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label={t("audit.table.when")}
                column="when"
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortableHead
                label={t("audit.table.who")}
                column="who"
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortableHead
                label={t("audit.table.what")}
                column="what"
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={onSort}
              />
              {showEntity && (
                <SortableHead
                  label={t("audit.table.where")}
                  column="where"
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              )}
              <SortableHead
                label={t("audit.table.capability")}
                column="capability"
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={onSort}
              />
              <TableHead>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("audit.table.fields")}
                </span>
              </TableHead>
              <TableHead>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("audit.table.channel")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
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
                <TableCell className="font-mono text-[11px]">
                  {event.channel === "mcp"
                    ? t("audit.mcpTool", { tool: event.operation })
                    : event.operation}
                </TableCell>
                {showEntity && (
                  <TableCell className="text-xs text-muted-foreground">
                    <WhereCell
                      event={event}
                      workspaceSlug={workspaceSlug}
                      workspaces={workspaces}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {event.capability}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                  {event.fields.length > 0 ? event.fields.join(", ") : "—"}
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground">
                  {event.channel === "mcp" ? t("audit.table.mcp") : t("audit.table.rest")}
                </TableCell>
              </TableRow>
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showEntity ? 7 : 6}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  {t("audit.table.empty")}
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
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        totalLabel={`${total.toLocaleString()} ${t("audit.table.rangeOf", { total: total.toLocaleString() })}`}
        emptyLabel={t("audit.table.empty")}
      />
      {loading && (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      )}
    </div>
  );
}

export function AuditEventList({
  filter,
  showEntity = false,
  workspaceSlug,
  workspaces,
}: {
  filter: AuditFilter;
  showEntity?: boolean;
  workspaceSlug?: string;
  workspaces?: Namespace[];
}) {
  return (
    <AuditEventTable
      filter={filter}
      showEntity={showEntity}
      workspaceSlug={workspaceSlug}
      workspaces={workspaces}
    />
  );
}

/**
 * The "where" of a change: for workspace-scoped entities a link to the
 * workspace's settings tab where it happened, so `grant.added` in the
 * tenant trail answers "where" with one click. Access grants file under
 * `workspaces` (see `routeEntity`), so the interceptor no longer leaves a
 * bare `access/grants` that links nowhere; older rows with the legacy
 * `access/grants` entity render the same link.
 */
function WhereCell({
  event,
  workspaceSlug,
  workspaces,
}: {
  event: AuditEventDto;
  workspaceSlug?: string;
  workspaces?: Namespace[];
}) {
  const locale = useLocale();
  const localePath = (path: string) =>
    locale === "en" ? path : `/${locale}${path}`;
  const { t } = useTranslation();
  const entityType = event.entityType ?? "";
  const entityId = event.entityId ?? "";

  // Workspace-scoped change: link to the workspace it happened in. When the
  // trail spans workspaces (Settings → Activity), the id resolves against
  // the workspace list; inside one workspace it is the current slug.
  if (
    entityType === "workspaces" ||
    entityType === "access/grants" ||
    entityType === "notifications/audiences"
  ) {
    const match =
      workspaces?.find((ws) => ws.id === entityId) ??
      (workspaceSlug ? { slug: workspaceSlug, name: workspaceSlug } : null);
    const slug =
      (match as { slug?: string } | null)?.slug ??
      (entityType === "workspaces" && !workspaces ? workspaceSlug : undefined);
    if (slug) {
      const label =
        (match as { name?: string } | null)?.name ?? entityId.slice(0, 8);
      return (
        <Link
          href={localePath(`/${slug}/settings?tab=access`)}
          className="font-medium text-foreground hover:underline"
        >
          {label}
        </Link>
      );
    }
    return <span>{t("audit.table.thisWorkspace")}</span>;
  }

  if (!entityType) return <span>—</span>;
  return (
    <span>
      {entityType}
      {entityId ? ` · ${entityId.slice(0, 8)}` : ""}
    </span>
  );
}

/**
 * "Created by A · Last changed by B, 2 h ago · History" under an entity's
 * title (§11.2). `createdBy` comes from the entity itself where it records
 * one; the last change and the history come from the audit trail.
 */
export function ChangedBy({
  entityType,
  entityId,
  createdBy,
  createdAt,
  className,
}: {
  entityType: string;
  entityId: string;
  createdBy?: string | null;
  createdAt?: Date | string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { events } = useAuditEvents({ entityType, entityId });
  const last = events[0];

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${className ?? ""}`}
    >
      {createdBy && (
        <span className="inline-flex items-center gap-1">
          {t("audit.createdBy")}
          <ActorChip actorRef={createdBy} />
          {createdAt && <span>· {formatRelative(createdAt)}</span>}
        </span>
      )}
      {last && (
        <span className="inline-flex items-center gap-1">
          {t("audit.lastChangedBy")}
          <ActorChip actorRef={last.actor} />
          <span>· {formatRelative(last.occurredAt)}</span>
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 gap-1 px-1.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <History className="h-3 w-3" aria-hidden />
        {t("audit.history")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("audit.historyTitle")}</SheetTitle>
            <SheetDescription>{t("audit.historyDescription")}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {open && <AuditEventTable filter={{ entityType, entityId }} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
