"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  api,
  NotificationResponseDtoSeverityEnum,
  NotificationResponseDtoTypeEnum,
  type NotificationResponseDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  Clock3,
  Loader2,
  Search,
  Star,
  StarOff,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { formatRelative, formatShortUTC } from "@/lib/date";
import { useNotificationsWebSocket } from "@/hooks/use-notifications-websocket";
import { useTranslation } from "@/hooks/use-translation";

type ListNotificationsRequest = NonNullable<
  Parameters<
    typeof api.notifications.notificationsControllerListNotifications
  >[0]
>;
type MarkAllReadDto = Parameters<
  typeof api.notifications.notificationsControllerMarkAllRead
>[0]["markAllReadDto"];

const ALL = "ALL" as const;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const SCOPE_OPTIONS = ["ALL", "UNREAD", "IMPORTANT"] as const;
type QuickFilterKey = "TOTAL" | "UNREAD" | "IMPORTANT" | "CRITICAL";
const SEVERITY_BADGE_VARIANT: Record<
  NotificationResponseDto["severity"],
  "critical" | "high" | "medium" | "low" | "info"
> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
};
const TYPE_LABELS: Record<NotificationResponseDto["type"], string> = {
  SCAN: "Scan",
  FINDING: "Finding",
  SOURCE: "Source",
  SYSTEM: "System",
};

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function toSearchIndex(notification: NotificationResponseDto) {
  return [
    notification.title,
    notification.message,
    notification.sourceName,
    notification.triggeredBy,
    notification.event,
    notification.runnerId,
    notification.findingId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);

  return Array.from(pages).sort((a, b) => a - b);
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<NotificationResponseDto[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isBulkMarking, setIsBulkMarking] = useState(false);

  const [scope, setScope] = useState<(typeof SCOPE_OPTIONS)[number]>("ALL");
  const [typeFilter, setTypeFilter] = useState<
    NotificationResponseDto["type"] | typeof ALL
  >(ALL);
  const [severityFilter, setSeverityFilter] = useState<
    NotificationResponseDto["severity"] | typeof ALL
  >(ALL);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const fetchNotifications = useCallback(async () => {
    try {
      setIsLoading(true);

      const request: ListNotificationsRequest = {
        skip: (page - 1) * pageSize,
        take: pageSize,
        type: typeFilter === ALL ? undefined : typeFilter,
        severity: severityFilter === ALL ? undefined : severityFilter,
        unreadOnly: scope === "UNREAD" ? true : undefined,
        importantOnly: scope === "IMPORTANT" ? true : undefined,
      };

      const response =
        await api.notifications.notificationsControllerListNotifications(
          request,
        );
      const nextTotal = response.total ?? 0;
      const safeTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize));

      if (page > safeTotalPages && nextTotal > 0) {
        setPage(safeTotalPages);
        return;
      }

      setNotifications(response.notifications ?? []);
      setTotal(nextTotal);
      setUnreadCount(response.unreadCount ?? 0);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
      setNotifications([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, scope, severityFilter, typeFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim().toLowerCase());
    }, 200);

    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [scope, typeFilter, severityFilter, pageSize]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useNotificationsWebSocket({
    onChange: () => {
      void fetchNotifications();
    },
  });

  const visibleNotifications = useMemo(() => {
    if (!search) return notifications;
    return notifications.filter((notification) =>
      toSearchIndex(notification).includes(search),
    );
  }, [notifications, search]);

  const criticalCount = useMemo(
    () =>
      notifications.filter(
        (item) =>
          item.severity === NotificationResponseDtoSeverityEnum.Critical,
      ).length,
    [notifications],
  );

  const importantCount = useMemo(
    () => notifications.filter((item) => item.important).length,
    [notifications],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = useMemo(
    () => getPageItems(page, totalPages),
    [page, totalPages],
  );
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd =
    total === 0
      ? 0
      : Math.min(total, (page - 1) * pageSize + notifications.length);
  const activeQuickFilter = useMemo(() => {
    if (severityFilter === NotificationResponseDtoSeverityEnum.Critical)
      return "CRITICAL";
    if (scope === "IMPORTANT") return "IMPORTANT";
    if (scope === "UNREAD") return "UNREAD";
    return "TOTAL";
  }, [scope, severityFilter]);

  const handleMarkRead = useCallback(
    async (id: string) => {
      try {
        const target = notifications.find((item) => item.id === id);
        if (!target) return;

        await api.notifications.notificationsControllerMarkRead({ id });
        setNotifications((previous) =>
          previous.map((item) =>
            item.id === id ? { ...item, read: true } : item,
          ),
        );

        if (!target.read) {
          setUnreadCount((previous) => Math.max(0, previous - 1));
        }
      } catch (error) {
        console.error("Failed to mark notification as read:", error);
      }
    },
    [notifications],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      setIsBulkMarking(true);
      const markAllReadDto: MarkAllReadDto = {
        type: typeFilter === ALL ? undefined : typeFilter,
        severity: severityFilter === ALL ? undefined : severityFilter,
        importantOnly: scope === "IMPORTANT" ? true : undefined,
      };

      await api.notifications.notificationsControllerMarkAllRead({
        markAllReadDto,
      });

      await fetchNotifications();
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
    } finally {
      setIsBulkMarking(false);
    }
  }, [fetchNotifications, scope, severityFilter, typeFilter]);

  const handleToggleImportant = useCallback(
    async (item: NotificationResponseDto) => {
      try {
        await api.notifications.notificationsControllerSetImportant({
          id: item.id,
          updateNotificationImportanceDto: {
            important: !item.important,
          },
        });

        setNotifications((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? { ...entry, important: !entry.important }
              : entry,
          ),
        );
      } catch (error) {
        console.error("Failed to toggle importance:", error);
      }
    },
    [],
  );

  const handleDismiss = useCallback(
    async (id: string) => {
      try {
        const target = notifications.find((item) => item.id === id);
        await api.notifications.notificationsControllerDeleteNotification({
          id,
        });

        setNotifications((previous) =>
          previous.filter((item) => item.id !== id),
        );
        setTotal((previous) => Math.max(0, previous - 1));

        if (target && !target.read) {
          setUnreadCount((previous) => Math.max(0, previous - 1));
        }
      } catch (error) {
        console.error("Failed to delete notification:", error);
      }
    },
    [notifications],
  );

  const handleQuickFilterClick = useCallback((filter: QuickFilterKey) => {
    setPage(1);

    if (filter === "TOTAL") {
      setScope("ALL");
      setSeverityFilter(ALL);
      return;
    }

    if (filter === "CRITICAL") {
      setScope("ALL");
      setSeverityFilter(NotificationResponseDtoSeverityEnum.Critical);
      return;
    }

    setSeverityFilter(ALL);
    setScope(filter);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("notifications.title")}
        </h1>
        <p className="text-muted-foreground">
          Operational feed for scan events, findings, source changes, and system
          signals.
        </p>
      </div>

      <div className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickFilterCard
          label={t("notifications.total")}
          value={total}
          icon={Bell}
          active={activeQuickFilter === "TOTAL"}
          onClick={() => handleQuickFilterClick("TOTAL")}
        />
        <QuickFilterCard
          label={t("notifications.unread")}
          value={unreadCount}
          icon={TriangleAlert}
          active={activeQuickFilter === "UNREAD"}
          onClick={() => handleQuickFilterClick("UNREAD")}
        />
        <QuickFilterCard
          label={t("notifications.important")}
          value={importantCount}
          icon={Star}
          active={activeQuickFilter === "IMPORTANT"}
          onClick={() => handleQuickFilterClick("IMPORTANT")}
        />
        <QuickFilterCard
          label={t("notifications.critical")}
          value={criticalCount}
          icon={TriangleAlert}
          active={activeQuickFilter === "CRITICAL"}
          onClick={() => handleQuickFilterClick("CRITICAL")}
        />

        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-background/30 backdrop-blur-[1px]" />
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {search
              ? t("notifications.searchNote")
              : `Showing ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} of ${total.toLocaleString()} notifications`}
          </div>
          <Button
            onClick={() => void handleMarkAllRead()}
            disabled={unreadCount === 0 || isBulkMarking}
            className="h-9 rounded-[4px] border-2 border-border bg-foreground px-3 text-primary-foreground hover:bg-foreground/90"
          >
            {isBulkMarking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-2 h-4 w-4" />
            )}
            Mark all read
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("notifications.search")}
              className="h-9 rounded-[4px] border-2 border-border pl-9"
            />
          </div>

          <Select
            value={scope}
            onValueChange={(value) =>
              setScope(value as (typeof SCOPE_OPTIONS)[number])
            }
          >
            <SelectTrigger className="h-9 w-[170px] rounded-[4px] border-2 border-border">
              <SelectValue placeholder={t("notifications.scope")} />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {formatEnumLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={typeFilter}
            onValueChange={(value) =>
              setTypeFilter(
                value as NotificationResponseDto["type"] | typeof ALL,
              )
            }
          >
            <SelectTrigger className="h-9 w-[180px] rounded-[4px] border-2 border-border">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {Object.values(NotificationResponseDtoTypeEnum).map((value) => (
                <SelectItem key={value} value={value}>
                  {TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={severityFilter}
            onValueChange={(value) =>
              setSeverityFilter(
                value as NotificationResponseDto["severity"] | typeof ALL,
              )
            }
          >
            <SelectTrigger className="h-9 w-[180px] rounded-[4px] border-2 border-border">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All severities</SelectItem>
              {Object.values(NotificationResponseDtoSeverityEnum).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {formatEnumLabel(value)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger className="h-9 w-[130px] rounded-[4px] border-2 border-border">
              <SelectValue placeholder={t("notifications.pageSize")} />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isLoading ? (
            <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing…
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-[6px] border-2 border-border bg-card shadow-[6px_6px_0_var(--color-border)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("notifications.loading")}</span>
          </div>
        ) : visibleNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("notifications.noNotifications")}
            description={t("notifications.noNotificationsHint")}
            className="min-h-[320px]"
          />
        ) : (
          <>
            <div className="max-h-[min(62vh,720px)] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-[10px] uppercase tracking-[0.14em]">
                      Signal
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.14em]">
                      Message
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.14em]">
                      Context
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-[0.14em]">
                      Detected
                    </TableHead>
                    <TableHead className="text-right text-[10px] uppercase tracking-[0.14em]">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleNotifications.map((item) => (
                    <TableRow
                      key={item.id}
                      className={cn(!item.read && "bg-muted/35")}
                    >
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SeverityBadge
                            severity={SEVERITY_BADGE_VARIANT[item.severity]}
                          >
                            {formatEnumLabel(item.severity)}
                          </SeverityBadge>
                          <Badge
                            variant="outline"
                            className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]"
                          >
                            {TYPE_LABELS[item.type]}
                          </Badge>
                          {!item.read && (
                            <Badge className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]">
                              Unread
                            </Badge>
                          )}
                          {item.important && (
                            <Badge
                              variant="outline"
                              className="gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]"
                            >
                              <Star className="h-3 w-3" />
                              Important
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[420px] align-top">
                        <div className="overflow-hidden">
                          <p className="break-words text-sm font-semibold leading-tight">
                            {item.title}
                          </p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {item.message}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="max-w-[220px] space-y-1 overflow-hidden text-[11px] text-muted-foreground">
                          {item.sourceName && (
                            <p className="break-words">
                              Source: {item.sourceName}
                            </p>
                          )}
                          {item.event && (
                            <p className="break-words">Event: {item.event}</p>
                          )}
                          {item.triggeredBy && (
                            <p className="break-words">
                              By: {item.triggeredBy}
                            </p>
                          )}
                          {!item.sourceName &&
                            !item.event &&
                            !item.triggeredBy && <p>System context</p>}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span>{formatRelative(item.createdAt)}</span>
                        </div>
                        {formatShortUTC(item.createdAt) && (
                          <p className="mt-1 text-[11px] text-muted-foreground/70">
                            {formatShortUTC(item.createdAt)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex justify-end gap-1">
                          {!item.read && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-[4px] border-2 border-border"
                              onClick={() => void handleMarkRead(item.id)}
                            >
                              Read
                            </Button>
                          )}

                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-[4px] border-2 border-border"
                            onClick={() => void handleToggleImportant(item)}
                          >
                            {item.important ? (
                              <StarOff className="h-3.5 w-3.5" />
                            ) : (
                              <Star className="h-3.5 w-3.5" />
                            )}
                          </Button>

                          {item.actionUrl && (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-[4px] border-2 border-border"
                              onClick={() => {
                                window.location.href = item.actionUrl ?? "/";
                              }}
                            >
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8 rounded-[4px]"
                            onClick={() => void handleDismiss(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {total > pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-border px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Page {page} of {totalPages}
                </p>

                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={page <= 1}
                        className={
                          page <= 1
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault();
                          if (page > 1) setPage(page - 1);
                        }}
                      />
                    </PaginationItem>

                    {pageItems.map((pageNumber, index) => {
                      const previousPage = pageItems[index - 1];
                      const needsEllipsis =
                        previousPage && pageNumber - previousPage > 1;

                      return (
                        <div key={pageNumber} className="flex items-center">
                          {needsEllipsis ? (
                            <PaginationItem>
                              <PaginationEllipsis />
                            </PaginationItem>
                          ) : null}
                          <PaginationItem>
                            <PaginationLink
                              href="#"
                              isActive={pageNumber === page}
                              onClick={(event) => {
                                event.preventDefault();
                                setPage(pageNumber);
                              }}
                            >
                              {pageNumber}
                            </PaginationLink>
                          </PaginationItem>
                        </div>
                      );
                    })}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={page >= totalPages}
                        className={
                          page >= totalPages
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault();
                          if (page < totalPages) setPage(page + 1);
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function QuickFilterCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group text-left transition-transform hover:-translate-y-px focus-visible:outline-none"
      onClick={onClick}
    >
      <Card
        className={cn(
          "rounded-[6px] border-2",
          active
            ? "overflow-hidden border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00]"
            : "border-border bg-card transition-all group-hover:bg-secondary/40",
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "text-[11px] font-mono uppercase tracking-[0.16em]",
                active ? "text-[#b7ff00]/80" : "text-muted-foreground",
              )}
            >
              {label}
            </p>
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                active ? "text-[#b7ff00]/80" : "text-muted-foreground",
              )}
            />
          </div>
          <p
            className="mt-1 text-3xl font-black"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {value.toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </button>
  );
}
