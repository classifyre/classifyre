"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  CalendarClock,
  Filter,
  Loader2,
  Play,
  ScanSearch,
  Search,
  Settings,
  Square,
} from "lucide-react";
import {
  AssetListItemDtoSourceTypeEnum,
  api,
  type SearchSourcesRequestDto,
  type SearchSourcesResponseDto,
  type StartRunnerDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
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
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { getSourceIcon } from "../lib/source-type-icon";
import { DeleteSourceAction } from "./delete-source-action";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "../lib/runner-status-badge";
import { useUrlParams } from "../lib/url-filters";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterDraft = {
  search: string;
  types: SourceTypeFilter[];
  statuses: RunnerStatusFilter[];
};

type SourceFilters = NonNullable<SearchSourcesRequestDto["filters"]>;
type SourceTypeFilter = NonNullable<SourceFilters["type"]>[number];
type RunnerStatusFilter = NonNullable<SourceFilters["status"]>[number];

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  types: [],
  statuses: [],
};

const SOURCE_TYPE_OPTIONS = Object.values(
  AssetListItemDtoSourceTypeEnum,
) as SourceTypeFilter[];

const RUNNER_STATUS_OPTIONS: RunnerStatusFilter[] = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "ERROR",
];

// STATUS_LABELS is now computed inside the component using t()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms?: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function isSourceRunning(status?: string | null) {
  return status?.toUpperCase() === "RUNNING";
}

function formatCronSchedule(
  cron: string | null | undefined,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!cron) return t("sources.scheduleLabel");
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const minute = parts[0];
  const hour = parts[1];
  const dayOfWeek = parts[4];
  const isWeekdays = dayOfWeek === "1-5";
  const isWeekly = dayOfWeek === "0";
  if (isWeekdays && hour && hour !== "*" && minute && minute !== "*") {
    const h = parseInt(hour, 10);
    const suffix = h >= 12 ? "pm" : "am";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return t("sources.scheduleWeekdays", { hour: displayH, suffix });
  }
  if (isWeekly) {
    return t("sources.scheduleWeekly");
  }
  if (hour && hour !== "*" && minute && minute !== "*" && dayOfWeek === "*") {
    const h = parseInt(hour, 10);
    const suffix = h >= 12 ? "pm" : "am";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return t("sources.scheduleDaily", { hour: displayH, suffix });
  }
  return t("sources.scheduleLabel");
}

// ─── Props ────────────────────────────────────────────────────────────────────

type SourcesTableProps = {
  onTotalsChange?: (totals: SearchSourcesResponseDto["totals"] | null) => void;
};

// ─── Refresh counter helper ───────────────────────────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────

export function SourcesTable({ onTotalsChange }: SourcesTableProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlParams();

  const STATUS_LABELS: Record<RunnerStatusFilter, string> = {
    PENDING: t("sources.statusPending"),
    RUNNING: t("sources.running"),
    COMPLETED: t("sources.statusCompleted"),
    ERROR: t("sources.statusError"),
  };

  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") ?? DEFAULT_DRAFT.search,
  );
  const [draft, setDraft] = useState<FilterDraft>(() => ({
    search: searchParams.get("q") ?? DEFAULT_DRAFT.search,
    types: searchParams.getAll("type") as SourceTypeFilter[],
    statuses: searchParams.getAll("status") as RunnerStatusFilter[],
  }));
  const [pageSize, setPageSize] = useState(String(PAGE_SIZE_OPTIONS[0]));
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);

  const [data, setData] = useState<SearchSourcesResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<{
    sourceId: string;
    action: "scan" | "stop";
  } | null>(null);

  const resolvedPageSize = Number(pageSize);

  // ── Debounce search input ────────────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft((prev) =>
        prev.search === searchInput ? prev : { ...prev, search: searchInput },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Sync draft to URL ────────────────────────────────────────────────────

  const urlSynced = useRef(false);
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      return;
    }
    setParams({
      q: draft.search || null,
      type: draft.types.length > 0 ? draft.types : null,
      status: draft.statuses.length > 0 ? draft.statuses : null,
    });
  }, [draft, setParams]);

  // ── Reset page on filter change ──────────────────────────────────────────

  useEffect(() => {
    setPage(1);
  }, [draft, pageSize]);

  // ── Fetch sources ────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const skip = (page - 1) * resolvedPageSize;
        const response = await api.searchSources({
          filters: {
            search: draft.search.trim() || undefined,
            type: draft.types.length > 0 ? draft.types : undefined,
            status: draft.statuses.length > 0 ? draft.statuses : undefined,
          },
          page: { skip, limit: resolvedPageSize },
        });
        if (!active) return;
        setData(response);
        onTotalsChange?.(response.totals);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load sources:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load sources",
        );
        setData({
          items: [],
          total: 0,
          skip: 0,
          limit: resolvedPageSize,
          totals: { total: 0, healthy: 0, errors: 0, running: 0 },
        });
        onTotalsChange?.(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [draft, page, resolvedPageSize, refreshCount, onTotalsChange]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasRows = items.length > 0;
  const showInitialLoading = isLoading && data === null;
  const totalPages = Math.max(
    1,
    Math.ceil(total / Math.max(1, resolvedPageSize)),
  );
  const clampedPage = Math.min(page, totalPages);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const pageItems = useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleScan = async (sourceId: string) => {
    try {
      setActiveAction({ sourceId, action: "scan" });
      const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
      await api.runners.cliRunnerControllerStartRunner({
        sourceId,
        startRunnerDto,
      });
      setRefreshCount((n) => n + 1);
    } catch (err) {
      console.error("Failed to start scan:", err);
    } finally {
      setActiveAction((prev) => (prev?.sourceId === sourceId ? null : prev));
    }
  };

  const handleStopRunner = async (sourceId: string, runnerId?: string) => {
    if (!runnerId) return;
    try {
      setActiveAction({ sourceId, action: "stop" });
      await api.runners.cliRunnerControllerStopRunner({ runnerId });
      setRefreshCount((n) => n + 1);
    } catch (err) {
      console.error("Failed to stop runner:", err);
    } finally {
      setActiveAction((prev) => (prev?.sourceId === sourceId ? null : prev));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search sources…"
            className="h-9 pl-9 border-2 border-black rounded-[4px]"
          />
        </div>

        <MultiSelect
          values={draft.types}
          onValuesChange={(values) =>
            setDraft((prev) => ({
              ...prev,
              types: values as SourceTypeFilter[],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[200px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Source type" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("sources.searchTypes"),
              emptyMessage: t("sources.noTypesFound"),
            }}
          >
            <MultiSelectGroup>
              {SOURCE_TYPE_OPTIONS.map((type) => (
                <MultiSelectItem key={type} value={type}>
                  {formatEnumLabel(type)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={draft.statuses}
          onValuesChange={(values) =>
            setDraft((prev) => ({
              ...prev,
              statuses: values as RunnerStatusFilter[],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Runner status" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("sources.searchStatuses"),
              emptyMessage: t("sources.noStatusesFound"),
            }}
          >
            <MultiSelectGroup>
              {RUNNER_STATUS_OPTIONS.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {STATUS_LABELS[status] ?? status}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("sources.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("sources.noSources")}
            description={t("sources.noSourcesHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <TableRow>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.source")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.type")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.runner")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("sources.columns.lastRunStats")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("sources.columns.lastRunStatsDesc")}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.lastRun")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.created")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 text-right dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sources.columns.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((source) => {
                  const runner = source.latestRunner;
                  const isRunning = isSourceRunning(source.runnerStatus);
                  const isRowActionPending =
                    activeAction?.sourceId === source.id;
                  const isStopping =
                    isRowActionPending && activeAction?.action === "stop";
                  const isStarting =
                    isRowActionPending && activeAction?.action === "scan";
                  const SourceTypeIcon = getSourceIcon(source.type);

                  return (
                    <TableRow key={source.id} className="align-top">
                      {/* Source name */}
                      <TableCell className="max-w-[280px] py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto max-w-[260px] justify-start p-0 text-left"
                              onClick={() =>
                                router.push(`/sources/${source.id}`)
                              }
                            >
                              <span className="truncate text-sm font-semibold">
                                {source.name || t("sources.unnamedSource")}
                              </span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            {source.name}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>

                      {/* Type */}
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <SourceTypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Badge variant="outline" className="rounded-[4px]">
                              {formatEnumLabel(source.type)}
                            </Badge>
                          </div>
                          {source.scheduleEnabled && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-[11px] text-[#4a7c00] font-medium cursor-default">
                                  <CalendarClock className="h-3 w-3" />
                                  {formatCronSchedule(source.scheduleCron, t)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {source.scheduleCron
                                  ? `Cron: ${source.scheduleCron} (${source.scheduleTimezone ?? "UTC"})`
                                  : t("sources.scheduleEnabled")}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>

                      {/* Runner status */}
                      <TableCell className="py-3">
                        {runner?.id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto justify-start p-0 hover:bg-transparent"
                            onClick={() => router.push(`/scans/${runner.id}`)}
                          >
                            <Badge
                              className={`rounded-[4px] border ${getRunnerStatusBadgeTone(source.runnerStatus)}`}
                            >
                              {isRunnerStatusRunning(source.runnerStatus) && (
                                <Spinner
                                  size="sm"
                                  className="gap-0 [&_svg]:size-3"
                                  data-icon="inline-start"
                                />
                              )}
                              {getRunnerStatusBadgeLabel(source.runnerStatus)}
                            </Badge>
                          </Button>
                        ) : (
                          <Badge
                            className={`rounded-[4px] border ${getRunnerStatusBadgeTone(source.runnerStatus)}`}
                          >
                            {isRunnerStatusRunning(source.runnerStatus) && (
                              <Spinner
                                size="sm"
                                className="gap-0 [&_svg]:size-3"
                                data-icon="inline-start"
                              />
                            )}
                            {getRunnerStatusBadgeLabel(source.runnerStatus)}
                          </Badge>
                        )}
                        {runner?.durationMs != null && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatDuration(runner.durationMs)}
                          </p>
                        )}
                      </TableCell>

                      {/* Last run stats */}
                      <TableCell className="py-3">
                        {runner ? (
                          <div className="flex flex-wrap gap-1.5">
                            {runner.assetsCreated > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[11px]"
                              >
                                <span className="text-emerald-600">
                                  +{runner.assetsCreated}
                                </span>
                              </Badge>
                            )}
                            {runner.assetsUpdated > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[11px]"
                              >
                                <span className="text-blue-500">
                                  ~{runner.assetsUpdated}
                                </span>
                              </Badge>
                            )}
                            {runner.totalFindings > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="secondary"
                                    className="text-[11px]"
                                  >
                                    {runner.totalFindings} finding
                                    {runner.totalFindings !== 1 ? "s" : ""}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("sources.findingsLatestRun")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {runner.assetsCreated === 0 &&
                              runner.assetsUpdated === 0 &&
                              runner.totalFindings === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  {t("sources.noChanges")}
                                </span>
                              )}
                            {runner.errorMessage && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="destructive"
                                    className="text-[11px] cursor-default"
                                  >
                                    Error
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[300px] break-words">
                                  {runner.errorMessage}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>

                      {/* Last run time */}
                      <TableCell className="py-3">
                        {runner ? (
                          <>
                            <div className="text-xs">
                              {formatDate(
                                runner.completedAt ??
                                  runner.startedAt ??
                                  runner.triggeredAt,
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatRelative(
                                runner.completedAt ??
                                  runner.startedAt ??
                                  runner.triggeredAt,
                              )}
                              {formatShortUTC(
                                runner.completedAt ??
                                  runner.startedAt ??
                                  runner.triggeredAt,
                              ) && (
                                <span className="text-muted-foreground/50">
                                  {" "}
                                  ·{" "}
                                  {formatShortUTC(
                                    runner.completedAt ??
                                      runner.startedAt ??
                                      runner.triggeredAt,
                                  )}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("sources.never")}
                          </span>
                        )}
                      </TableCell>

                      {/* Created */}
                      <TableCell className="py-3">
                        <div className="text-xs">
                          {formatDate(source.createdAt)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatRelative(source.createdAt)}
                          {formatShortUTC(source.createdAt) && (
                            <span className="text-muted-foreground/50">
                              {" "}
                              · {formatShortUTC(source.createdAt)}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3">
                        <div className="flex items-center justify-end gap-2">
                          {isRunning ? (
                            <>
                              <Button
                                size="sm"
                                className="h-8 rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                                onClick={() =>
                                  runner?.id
                                    ? router.push(`/scans/${runner.id}`)
                                    : router.push("/scans")
                                }
                              >
                                <ScanSearch className="h-3.5 w-3.5" />
                                {t("sources.goToScan")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[4px] border-2 border-destructive text-destructive hover:bg-destructive/10"
                                disabled={!runner?.id || isStopping}
                                onClick={() =>
                                  handleStopRunner(source.id, runner?.id)
                                }
                              >
                                {isStopping ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Square className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              className="h-8 rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                              disabled={isStarting}
                              onClick={() => handleScan(source.id)}
                            >
                              {isStarting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-[4px] border-2 border-black"
                            onClick={() =>
                              router.push(`/sources/${source.id}/edit`)
                            }
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
                          <DeleteSourceAction
                            sourceId={source.id}
                            iconOnly
                            onDeleted={() => setRefreshCount((n) => n + 1)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {isLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("sources.updating")}
            </div>
          </div>
        )}
      </div>

      {/* Footer: page size + pagination */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("common.rowsPerPage")}</span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] border-2 border-black rounded-[4px]">
              <SelectValue placeholder="Rows" />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t("common.rows", { size })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {total > 0
              ? `${((clampedPage - 1) * resolvedPageSize + 1).toLocaleString()}–${Math.min(clampedPage * resolvedPageSize, total).toLocaleString()} of ${total.toLocaleString()}`
              : "0 sources"}
          </span>
        </div>

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (canPrev) setPage(clampedPage - 1);
                  }}
                  className={
                    !canPrev ? "pointer-events-none opacity-50" : undefined
                  }
                />
              </PaginationItem>
              {pageItems.map((pageNumber, index) => {
                const prev = pageItems[index - 1];
                const showEllipsis = prev && pageNumber - prev > 1;
                return (
                  <div key={`page-group-${pageNumber}`} className="contents">
                    {showEllipsis && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        isActive={pageNumber === clampedPage}
                        onClick={(e) => {
                          e.preventDefault();
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
                  onClick={(e) => {
                    e.preventDefault();
                    if (canNext) setPage(clampedPage + 1);
                  }}
                  className={
                    !canNext ? "pointer-events-none opacity-50" : undefined
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </div>
  );
}
