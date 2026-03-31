"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clock,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import {
  api,
  SearchRunnersSortByEnum,
  SearchRunnersSortOrderEnum,
  type SearchRunnersFiltersInputDto,
  type SearchRunnersResponseDto,
  type SearchRunnersSortBy,
  type SearchRunnersSortOrder,
  type SearchRunnersStatus,
  type SearchRunnersTriggerType,
  type SourceListItem,
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
} from "@workspace/ui/components";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "../lib/runner-status-badge";
import { useTranslation } from "@/hooks/use-translation";

type RunnerStatusFilterValue = SearchRunnersStatus;

type RunnersTableProps = {
  statuses?: RunnerStatusFilterValue[];
  onFiltersChange?: (filters: SearchRunnersFiltersInputDto | undefined) => void;
};

type FilterDraft = {
  sourceIds: string[];
  triggerTypes: SearchRunnersTriggerType[];
};

type SortDraft = {
  by: SearchRunnersSortBy;
  order: SearchRunnersSortOrder;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_DRAFT: FilterDraft = {
  sourceIds: [],
  triggerTypes: [],
};
const DEFAULT_SORT: SortDraft = {
  by: SearchRunnersSortByEnum.TriggeredAt,
  order: SearchRunnersSortOrderEnum.Desc,
};

const TRIGGER_TYPE_OPTIONS: SearchRunnersTriggerType[] = [
  "MANUAL",
  "SCHEDULED",
  "WEBHOOK",
  "API",
];

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function computeDurationMinutes(
  durationMs?: number | null,
  startedAt?: Date | string | null,
  completedAt?: Date | string | null,
) {
  if (typeof durationMs === "number" && durationMs > 0) {
    return Math.round(durationMs / 60000);
  }
  if (!startedAt || !completedAt) return null;
  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(completed) || completed <= started)
    return null;
  return Math.round((completed - started) / 60000);
}

function getSortIcon({
  active,
  order,
}: {
  active: boolean;
  order: SearchRunnersSortOrder;
}) {
  if (!active) {
    return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  if (order === SearchRunnersSortOrderEnum.Asc) {
    return <ArrowUp className="h-3.5 w-3.5" />;
  }

  return <ArrowDown className="h-3.5 w-3.5" />;
}

function nextSort(current: SortDraft, field: SearchRunnersSortBy): SortDraft {
  if (current.by === field) {
    return {
      by: field,
      order:
        current.order === SearchRunnersSortOrderEnum.Desc
          ? SearchRunnersSortOrderEnum.Asc
          : SearchRunnersSortOrderEnum.Desc,
    };
  }

  return {
    by: field,
    order:
      field === SearchRunnersSortByEnum.TriggeredAt
        ? SearchRunnersSortOrderEnum.Desc
        : SearchRunnersSortOrderEnum.Asc,
  };
}

export function RunnersTable({
  statuses = [],
  onFiltersChange,
}: RunnersTableProps = {}) {
  const router = useRouter();
  const { t } = useTranslation();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [draft, setDraft] = useState<FilterDraft>(DEFAULT_DRAFT);
  const [sort, setSort] = useState<SortDraft>(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [data, setData] = useState<SearchRunnersResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [draft.sourceIds, draft.triggerTypes, statuses, pageSize]);

  useEffect(() => {
    let active = true;

    const fetchSources = async () => {
      try {
        const sourceList = await api.sources.sourcesControllerListSources();
        if (!active) return;
        setSources((sourceList ?? []) as unknown as SourceListItem[]);
      } catch (sourceError) {
        console.error(
          "Failed to load source options for runners:",
          sourceError,
        );
      }
    };

    void fetchSources();
    return () => {
      active = false;
    };
  }, []);

  const effectiveFilters = useMemo<
    SearchRunnersFiltersInputDto | undefined
  >(() => {
    const filters: SearchRunnersFiltersInputDto = {
      search: debouncedSearch || undefined,
      sourceId: draft.sourceIds.length > 0 ? draft.sourceIds : undefined,
      triggerType:
        draft.triggerTypes.length > 0 ? draft.triggerTypes : undefined,
      status: statuses.length > 0 ? statuses : undefined,
    };

    return Object.values(filters).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
      ? filters
      : undefined;
  }, [debouncedSearch, draft.sourceIds, draft.triggerTypes, statuses]);

  useEffect(() => {
    onFiltersChange?.(effectiveFilters);
  }, [effectiveFilters, onFiltersChange]);

  const resolvedPageSize = Number(pageSize);
  const safePageSize =
    Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
      ? resolvedPageSize
      : DEFAULT_PAGE_SIZE;

  useEffect(() => {
    let active = true;

    const fetchRunners = async () => {
      const showInitial = data === null;
      if (showInitial) {
        setIsLoading(true);
      } else {
        setIsFilterLoading(true);
      }

      try {
        setError(null);
        const response = await api.searchRunners({
          filters: effectiveFilters,
          page: {
            skip: (page - 1) * safePageSize,
            limit: safePageSize,
            sortBy: sort.by,
            sortOrder: sort.order,
          },
        });
        if (!active) return;
        setData(response);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load runners:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load runners",
        );
        setData({
          items: [],
          total: 0,
          skip: 0,
          limit: safePageSize,
        });
      } finally {
        if (active) {
          setIsLoading(false);
          setIsFilterLoading(false);
        }
      }
    };

    void fetchRunners();
    return () => {
      active = false;
    };
  }, [effectiveFilters, page, safePageSize, sort.by, sort.order]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, safePageSize)));
  const clampedPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== clampedPage) {
      setPage(clampedPage);
    }
  }, [clampedPage, page]);

  const pageItems = useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const showInitialLoading = isLoading && data === null;
  const hasRows = rows.length > 0;

  const renderSortableHead = (label: string, field: SearchRunnersSortBy) => {
    const active = sort.by === field;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-1.5 font-medium"
        onClick={() => {
          setSort((current) => nextSort(current, field));
          setPage(1);
        }}
      >
        <span>{label}</span>
        {getSortIcon({ active, order: sort.order })}
      </Button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("runners.search")}
            className="h-9 pl-9 border-2 border-black rounded-[4px]"
          />
        </div>

        <MultiSelect
          values={draft.sourceIds}
          onValuesChange={(values) =>
            setDraft((previous) => ({
              ...previous,
              sourceIds: values as string[],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[220px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Sources" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search sources...",
              emptyMessage: "No sources found",
            }}
          >
            <MultiSelectGroup>
              {sources
                .filter(
                  (source): source is SourceListItem & { id: string } =>
                    typeof source.id === "string",
                )
                .map((source) => (
                  <MultiSelectItem key={source.id} value={source.id}>
                    {source.name || source.id}
                  </MultiSelectItem>
                ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={draft.triggerTypes}
          onValuesChange={(values) =>
            setDraft((previous) => ({
              ...previous,
              triggerTypes: values as SearchRunnersTriggerType[],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[190px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder={t("runners.triggerType")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search trigger types...",
              emptyMessage: "No trigger types found",
            }}
          >
            <MultiSelectGroup>
              {TRIGGER_TYPE_OPTIONS.map((triggerType) => (
                <MultiSelectItem key={triggerType} value={triggerType}>
                  {formatEnumLabel(triggerType)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {isFilterLoading ? (
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating
          </div>
        ) : null}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("runners.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("runners.noRuns")}
            description={t("runners.noRunsHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Triggered",
                      SearchRunnersSortByEnum.TriggeredAt,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Source",
                      SearchRunnersSortByEnum.SourceName,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Status",
                      SearchRunnersSortByEnum.Status,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Trigger
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Duration",
                      SearchRunnersSortByEnum.DurationMs,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Assets
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Findings",
                      SearchRunnersSortByEnum.TotalFindings,
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((runner) => {
                  const durationMinutes = computeDurationMinutes(
                    runner.durationMs,
                    runner.startedAt,
                    runner.completedAt,
                  );
                  const totalAssets =
                    (runner.assetsCreated ?? 0) +
                    (runner.assetsUpdated ?? 0) +
                    (runner.assetsUnchanged ?? 0);

                  return (
                    <TableRow
                      key={runner.id}
                      className="align-top cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/scans/${runner.id}`)}
                    >
                      <TableCell className="py-2">
                        <div className="text-sm">
                          {formatDate(runner.triggeredAt)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelative(runner.triggeredAt)}
                          {formatShortUTC(runner.triggeredAt) && (
                            <span className="text-muted-foreground/50">
                              {" "}
                              · {formatShortUTC(runner.triggeredAt)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="text-sm">
                          {runner.source?.name || "Unknown source"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {runner.source?.type || "Unknown"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          className={`rounded-[4px] border font-medium ${getRunnerStatusBadgeTone(runner.status)}`}
                        >
                          {isRunnerStatusRunning(runner.status) && (
                            <Spinner
                              size="sm"
                              className="gap-0 [&_svg]:size-3"
                              data-icon="inline-start"
                            />
                          )}
                          {getRunnerStatusBadgeLabel(runner.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1.5 text-sm">
                          {runner.triggerType === "SCHEDULED" && (
                            <Clock className="h-3.5 w-3.5 text-[#4a7c00] shrink-0" />
                          )}
                          <span
                            className={
                              runner.triggerType === "SCHEDULED"
                                ? "font-medium text-[#4a7c00]"
                                : ""
                            }
                          >
                            {formatEnumLabel(runner.triggerType)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {runner.triggeredBy === "pg-boss"
                            ? "Scheduler"
                            : runner.triggeredBy || "System"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        {durationMinutes !== null
                          ? `${durationMinutes} min`
                          : "—"}
                      </TableCell>
                      <TableCell className="py-2">
                        {totalAssets.toLocaleString()}
                      </TableCell>
                      <TableCell className="py-2">
                        {(runner.totalFindings ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("common.rowsPerPage")}
          </span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] border-2 border-black rounded-[4px]">
              <SelectValue placeholder={t("common.rows")} />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} {t("common.rows")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
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
                  <Fragment key={`page-group-${pageNumber}`}>
                    {showEllipsis && (
                      <PaginationItem key={`ellipsis-${pageNumber}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}
                    <PaginationItem key={`page-${pageNumber}`}>
                      <PaginationLink
                        href="#"
                        isActive={pageNumber === clampedPage}
                        onClick={(event) => {
                          event.preventDefault();
                          setPage(pageNumber);
                        }}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  </Fragment>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
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
