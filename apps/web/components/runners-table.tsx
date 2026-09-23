"use client";

import { nsPath } from "@/lib/ns-path";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clock,
  Filter,
  Loader2,
  MoreVertical,
  Play,
  Search,
  ShieldAlert,
  Square,
  Trash2,
} from "lucide-react";
import {
  api,
  SearchRunnersSortByEnum,
  SearchRunnersSortOrderEnum,
  type BulkDeleteRunnersDto,
  type BulkRerunScansDto,
  type BulkRunnersSkippedDto,
  type BulkStopRunnersDto,
  type SearchRunnersFiltersInputDto,
  type SearchRunnersResponseDto,
  type SearchRunnersSortBy,
  type SearchRunnersSortOrder,
  type SearchRunnersStatus,
  type SearchRunnersTriggerType,
  type SourceListItem,
  type StartRunnerDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { RunnerStatusBadge } from "./runner-status-badge";
import { isRunnerStatusRunning } from "@/lib/runner-status-badge";
import {
  mergeRunnerWsIntoRow,
  runnerMatchesRunnersListFilters,
} from "@/lib/runner-ws-merge";
import { useRunnerWebSocket } from "@/hooks/use-runner-websocket";
import { useTranslation } from "@/hooks/use-translation";
import { toast } from "sonner";

type RunnerStatusFilterValue = SearchRunnersStatus;

type RunnersTableProps = {
  statuses?: RunnerStatusFilterValue[];
  onFiltersChange?: (filters: SearchRunnersFiltersInputDto | undefined) => void;
};

type RunnerRow = SearchRunnersResponseDto["items"][number];

export type RunnerSelectionIds = {
  type: "ids";
  runners: RunnerRow[];
  total: number;
};

export type RunnerSelectionAll = {
  type: "all";
  filters: SearchRunnersFiltersInputDto;
  total: number;
};

export type RunnerSelection = RunnerSelectionIds | RunnerSelectionAll;

/**
 * The table's filter draft only ever sets search/source/trigger/status, so it
 * is carried as the client's friendly filter type and narrowed to the
 * generated bulk-selection shape at the call sites.
 */
function toBulkRunnerFilters(
  filters: SearchRunnersFiltersInputDto,
): NonNullable<BulkStopRunnersDto["filters"]> {
  // The table never sets a triggered-at window (friendly type allows strings
  // there; the wire type wants Dates), so only the settable fields cross.
  return {
    search: filters.search,
    sourceId: filters.sourceId,
    status: filters.status as
      | NonNullable<NonNullable<BulkStopRunnersDto["filters"]>["status"]>
      | undefined,
    triggerType: filters.triggerType as
      | NonNullable<NonNullable<BulkStopRunnersDto["filters"]>["triggerType"]>
      | undefined,
    triggeredBy: filters.triggeredBy,
  };
}

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

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

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
  const [wsBump, setWsBump] = useState(0);
  const [busyRunner, setBusyRunner] = useState<{
    runnerId: string;
    action: "stop" | "rerun" | "delete";
  } | null>(null);
  const [isBulkBusy, setIsBulkBusy] = useState<
    null | "stop" | "rerun" | "delete"
  >(null);
  // A delete is always confirmed first — a single scan from its row menu or
  // the whole bulk selection (explicit IDs or a filter snapshot).
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "ids"; ids: string[] }
    | { kind: "filters"; filters: SearchRunnersFiltersInputDto; total: number }
    | null
  >(null);

  // ── Selection (mirrors sources-table) ──────────────────────────────────
  // Row checkboxes collect explicit IDs; the header checkbox means "every run
  // matching the current filters", which the bulk endpoints accept as a
  // filter snapshot.
  const [selectionMap, setSelectionMap] = useState<Map<string, RunnerRow>>(
    new Map(),
  );
  const [isAllSelected, setIsAllSelected] = useState(false);

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

  const pageRef = useRef(page);
  const sortRef = useRef(sort);
  const filtersRef = useRef(effectiveFilters);
  const safePageSizeRef = useRef(safePageSize);
  pageRef.current = page;
  sortRef.current = sort;
  filtersRef.current = effectiveFilters;
  safePageSizeRef.current = safePageSize;

  useRunnerWebSocket({
    trackRunnersList: false,
    onRunnerUpdate: (runner) => {
      setData((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((r) => r.id === runner.id);
        if (idx < 0) return prev;
        const existing = prev.items[idx];
        if (!existing) return prev;
        const nextItems = [...prev.items];
        nextItems[idx] = mergeRunnerWsIntoRow(existing, runner);
        return { ...prev, items: nextItems };
      });
    },
    onRunnerCreated: (runner) => {
      let prepended = false;
      setData((prev) => {
        if (!prev) return prev;
        const existingIdx = prev.items.findIndex((r) => r.id === runner.id);
        if (existingIdx >= 0) {
          const existing = prev.items[existingIdx];
          if (!existing) return prev;
          const nextItems = [...prev.items];
          nextItems[existingIdx] = mergeRunnerWsIntoRow(existing, runner);
          return { ...prev, items: nextItems };
        }

        const pageOk = pageRef.current === 1;
        const sortOk =
          sortRef.current.by === SearchRunnersSortByEnum.TriggeredAt &&
          sortRef.current.order === SearchRunnersSortOrderEnum.Desc;
        const filters = filtersRef.current;
        if (
          pageOk &&
          sortOk &&
          runnerMatchesRunnersListFilters(runner, filters)
        ) {
          prepended = true;
          return {
            ...prev,
            items: [runner, ...prev.items].slice(0, safePageSizeRef.current),
            total: prev.total + 1,
          };
        }
        return prev;
      });
      if (
        !prepended &&
        runnerMatchesRunnersListFilters(runner, filtersRef.current)
      ) {
        setWsBump((n) => n + 1);
      }
    },
  });

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
  }, [effectiveFilters, page, safePageSize, sort.by, sort.order, wsBump]);

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

  const currentFilters = effectiveFilters;

  const clearSelection = useCallback(() => {
    setIsAllSelected(false);
    setSelectionMap(new Map());
  }, []);

  // A new search/sort/filter changes what "all" means, so the selection goes.
  useEffect(() => {
    setSelectionMap(new Map());
    setIsAllSelected(false);
  }, [
    debouncedSearch,
    draft.sourceIds,
    draft.triggerTypes,
    statuses,
    pageSize,
  ]);

  const currentPageSelectedCount = isAllSelected
    ? rows.length
    : rows.filter((runner) => selectionMap.has(runner.id)).length;
  const headerChecked =
    isAllSelected ||
    (rows.length > 0 && currentPageSelectedCount === rows.length);
  const headerIndeterminate =
    !isAllSelected && currentPageSelectedCount > 0 && !headerChecked;
  const selectionCount = isAllSelected ? total : selectionMap.size;
  // "Select all" means every run matching the current filters — an empty
  // filter object still selects everything, exactly like sources-table.
  const selection: RunnerSelection | null =
    selectionCount === 0
      ? null
      : isAllSelected
        ? {
            type: "all",
            filters: currentFilters ?? {},
            total,
          }
        : {
            type: "ids",
            runners: Array.from(selectionMap.values()),
            total: selectionMap.size,
          };

  function handleHeaderCheckbox() {
    if (headerChecked || headerIndeterminate) clearSelection();
    else {
      setIsAllSelected(true);
      setSelectionMap(new Map());
    }
  }

  const toggleRow = useCallback((runner: RunnerRow) => {
    setIsAllSelected(false);
    setSelectionMap((previous) => {
      const next = new Map(previous);
      if (next.has(runner.id)) next.delete(runner.id);
      else next.set(runner.id, runner);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    // Refetch so rows settle even if a websocket update arrives before the
    // write it announces is readable. Creation events also prepend live.
    setWsBump((n) => n + 1);
  }, []);

  function reportBulkResult(
    action: "stop" | "rerun" | "delete",
    done: number,
    skipped: BulkRunnersSkippedDto[],
  ) {
    const keys = {
      stop: {
        done: "runners.bulkStop.stopped",
        failed: "runners.bulkStop.failed",
      },
      rerun: {
        done: "runners.bulkRerun.started",
        failed: "runners.bulkRerun.failed",
      },
      delete: {
        done: "runners.bulkDelete.deleted",
        failed: "runners.bulkDelete.failed",
      },
    } as const;
    if (done > 0) {
      toast.success(t(keys[action].done, { count: done.toLocaleString() }));
    }
    if (skipped.length > 0) {
      toast.warning(
        t("runners.bulk.skipped", {
          count: skipped.length.toLocaleString(),
        }),
        { description: skipped[0]?.reason },
      );
    }
    if (done === 0 && skipped.length === 0) {
      toast.error(t(keys[action].failed));
    }
  }

  // ── Row actions ─────────────────────────────────────────────────────────

  const handleStopRunner = async (runnerId: string) => {
    try {
      setBusyRunner({ runnerId, action: "stop" });
      await api.runners.cliRunnerControllerStopRunner({ runnerId });
      toast.success(t("scans.stopSuccess"));
      refresh();
    } catch (stopError) {
      console.error("Failed to stop runner:", stopError);
      toast.error(
        stopError instanceof Error
          ? stopError.message
          : t("scans.failedToStop"),
      );
    } finally {
      setBusyRunner((current) =>
        current?.runnerId === runnerId ? null : current,
      );
    }
  };

  const handleRerunScan = async (runner: RunnerRow) => {
    try {
      setBusyRunner({ runnerId: runner.id, action: "rerun" });
      const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
      await api.runners.cliRunnerControllerStartRunner({
        sourceId: runner.sourceId,
        startRunnerDto,
      });
      toast.success(t("scans.newRunStarted"));
      refresh();
    } catch (rerunError) {
      console.error("Failed to re-run scan:", rerunError);
      toast.error(
        rerunError instanceof Error
          ? rerunError.message
          : t("runners.rowActions.rerunFailed"),
      );
    } finally {
      setBusyRunner((current) =>
        current?.runnerId === runner.id ? null : current,
      );
    }
  };

  const handleDeleteRunner = async (runnerId: string) => {
    try {
      setBusyRunner({ runnerId, action: "delete" });
      await api.runners.cliRunnerControllerDeleteRunner({ runnerId });
      toast.success(t("runners.rowActions.deleted"));
      setSelectionMap((previous) => {
        if (!previous.has(runnerId)) return previous;
        const next = new Map(previous);
        next.delete(runnerId);
        return next;
      });
      refresh();
    } catch (deleteError) {
      console.error("Failed to delete scan:", deleteError);
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("runners.rowActions.deleteFailed"),
      );
    } finally {
      setBusyRunner((current) =>
        current?.runnerId === runnerId ? null : current,
      );
    }
  };

  // ── Bulk actions ────────────────────────────────────────────────────────

  const handleBulkStop = async () => {
    if (!selection) return;
    try {
      setIsBulkBusy("stop");
      setError(null);
      const response = await api.runners.cliRunnerControllerBulkStopRunners({
        bulkStopRunnersDto:
          selection.type === "ids"
            ? { ids: selection.runners.map((runner) => runner.id) }
            : { filters: toBulkRunnerFilters(selection.filters) },
      });
      reportBulkResult("stop", response.stoppedCount, response.skipped);
      clearSelection();
      refresh();
    } catch (bulkError) {
      console.error("Failed to stop scans:", bulkError);
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : t("runners.bulkStop.failed"),
      );
    } finally {
      setIsBulkBusy(null);
    }
  };

  const handleBulkRerun = async () => {
    if (!selection) return;
    try {
      setIsBulkBusy("rerun");
      setError(null);
      const response = await api.runners.cliRunnerControllerBulkRerunScans({
        bulkRerunScansDto:
          selection.type === "ids"
            ? { ids: selection.runners.map((runner) => runner.id) }
            : {
                filters: toBulkRunnerFilters(
                  selection.filters,
                ) as BulkRerunScansDto["filters"],
              },
      });
      reportBulkResult("rerun", response.startedCount, response.skipped);
      clearSelection();
      refresh();
    } catch (bulkError) {
      console.error("Failed to re-run scans:", bulkError);
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : t("runners.bulkRerun.failed"),
      );
    } finally {
      setIsBulkBusy(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!pendingDelete) return;
    try {
      setIsBulkBusy("delete");
      setError(null);
      const response = await api.runners.cliRunnerControllerBulkDeleteRunners({
        bulkDeleteRunnersDto:
          pendingDelete.kind === "ids"
            ? { ids: pendingDelete.ids }
            : {
                filters: toBulkRunnerFilters(
                  pendingDelete.filters,
                ) as BulkDeleteRunnersDto["filters"],
              },
      });
      reportBulkResult("delete", response.deletedCount, response.skipped);
      setPendingDelete(null);
      clearSelection();
      refresh();
    } catch (bulkError) {
      console.error("Failed to delete scans:", bulkError);
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : t("runners.bulkDelete.failed"),
      );
    } finally {
      setIsBulkBusy(null);
    }
  };

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
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
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
          <MultiSelectTrigger className="h-9 w-[220px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("common.sources")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("runners.searchSources"),
              emptyMessage: t("runners.noSourcesFound"),
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
          <MultiSelectTrigger className="h-9 w-[190px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("runners.triggerType")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("runners.searchTriggerTypes"),
              emptyMessage: t("runners.noTriggerTypesFound"),
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
            {t("runners.updating")}
          </div>
        ) : null}
      </div>

      {selection && (
        <div className="flex flex-wrap items-center gap-3 rounded-[4px] border-2 border-border bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {selection.type === "all"
              ? t("runners.bulk.allSelected", {
                  count: selectionCount.toLocaleString(),
                })
              : selectionCount === 1
                ? t("runners.bulk.selected", {
                    count: selectionCount.toLocaleString(),
                  })
                : t("runners.bulk.selectedPlural", {
                    count: selectionCount.toLocaleString(),
                  })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={isBulkBusy !== null}
            onClick={handleBulkStop}
            className="ml-auto rounded-[4px] border-2 border-destructive font-mono text-xs font-bold uppercase tracking-[0.08em] text-destructive hover:bg-destructive/10"
          >
            {isBulkBusy === "stop" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {t("runners.bulk.stopSelected")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isBulkBusy !== null}
            onClick={handleBulkRerun}
            className="rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
          >
            {isBulkBusy === "rerun" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {t("runners.bulk.rerunSelected")}
          </Button>
          <Button
            size="sm"
            disabled={isBulkBusy !== null}
            onClick={() =>
              setPendingDelete(
                selection.type === "ids"
                  ? {
                      kind: "ids",
                      ids: selection.runners.map((runner) => runner.id),
                    }
                  : {
                      kind: "filters",
                      filters: selection.filters,
                      total: selection.total,
                    },
              )
            }
            className="rounded-[4px] border-2 border-border bg-destructive font-mono text-xs font-bold uppercase tracking-[0.08em] text-white hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("runners.bulk.deleteSelected")}
          </Button>
        </div>
      )}

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
                  <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center justify-center">
                          <Checkbox
                            checked={
                              headerIndeterminate
                                ? "indeterminate"
                                : headerChecked
                            }
                            onCheckedChange={handleHeaderCheckbox}
                            aria-label={t("runners.bulk.selectAllAria")}
                            className={CHECKBOX_CLASS}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {headerChecked || headerIndeterminate
                          ? t("runners.bulk.deselectAll")
                          : t("runners.bulk.selectAll", {
                              count: total.toLocaleString(),
                            })}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("runners.columns.triggered"),
                      SearchRunnersSortByEnum.TriggeredAt,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("runners.columns.source"),
                      SearchRunnersSortByEnum.SourceName,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("runners.columns.status"),
                      SearchRunnersSortByEnum.Status,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("runners.columns.trigger")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("runners.columns.duration"),
                      SearchRunnersSortByEnum.DurationMs,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("runners.columns.assets")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("runners.columns.findings"),
                      SearchRunnersSortByEnum.TotalFindings,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 text-right dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("runners.columns.actions")}
                    </span>
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
                  // A queued scan has no process yet, but stopping it is the
                  // same operator decision: the API cancels it outright.
                  const isStoppable =
                    isRunnerStatusRunning(runner.status) ||
                    runner.status === "PENDING";
                  const isRunningRow = isRunnerStatusRunning(runner.status);
                  const isChecked =
                    isAllSelected || selectionMap.has(runner.id);
                  const rowBusy = busyRunner?.runnerId === runner.id;

                  return (
                    <TableRow
                      key={runner.id}
                      className="align-top cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(nsPath(`/scans/${runner.id}`))}
                    >
                      <TableCell
                        className="w-10 py-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="flex items-center justify-center">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleRow(runner)}
                            aria-label={t("runners.bulk.selectRowAria", {
                              id: runner.id.slice(0, 8),
                            })}
                            className={CHECKBOX_CLASS}
                          />
                        </span>
                      </TableCell>
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
                        <RunnerStatusBadge
                          status={runner.status}
                          className="font-medium"
                        />{" "}
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
                            {t(`triggerTypes.${runner.triggerType}`)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {runner.triggeredBy === "pg-boss"
                            ? t("runners.scheduler")
                            : runner.triggeredBy || t("common.none")}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        {durationMinutes !== null
                          ? `${durationMinutes} min`
                          : "—"}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5 font-mono text-[11px]">
                          <div className="font-sans text-sm font-medium">
                            {totalAssets.toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.created")}
                            </span>{" "}
                            {runner.assetsCreated.toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.updated")}
                            </span>{" "}
                            {runner.assetsUpdated.toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.unchanged")}
                            </span>{" "}
                            {runner.assetsUnchanged.toLocaleString()}
                          </div>
                          {runner.assetsDeleted > 0 && (
                            <div className="text-destructive">
                              {t("runners.delta.deleted")}{" "}
                              {runner.assetsDeleted.toLocaleString()}
                            </div>
                          )}
                          {runner.assetsSkippedCached > 0 && (
                            <div className="font-sans text-[#4a7c00]">
                              {t("runners.delta.cached")}{" "}
                              {runner.assetsSkippedCached.toLocaleString()}
                            </div>
                          )}
                          {runner.assetsWithoutText > 0 && (
                            <div className="font-sans text-amber-700 dark:text-amber-400">
                              {t("runners.delta.withoutText")}{" "}
                              {runner.assetsWithoutText.toLocaleString()}
                            </div>
                          )}
                          {runner.assetsOutOfScope > 0 && (
                            <div className="font-sans text-amber-700 dark:text-amber-400">
                              {t("runners.delta.outOfScope")}{" "}
                              {runner.assetsOutOfScope.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="space-y-0.5 font-mono text-[11px]">
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.findingsNew")}
                            </span>{" "}
                            {runner.findingsCreated.toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.findingsKept")}
                            </span>{" "}
                            {runner.findingsRetained.toLocaleString()}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("runners.delta.findingsResolved")}
                            </span>{" "}
                            {runner.findingsResolved.toLocaleString()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell
                        className="py-2 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-[4px] border-2 border-border"
                              aria-label={t("runners.rowActions.open", {
                                id: runner.id.slice(0, 8),
                              })}
                            >
                              {rowBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <MoreVertical className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isStoppable && (
                              <DropdownMenuItem
                                disabled={rowBusy}
                                onSelect={() => {
                                  void handleStopRunner(runner.id);
                                }}
                                className="text-destructive focus:text-destructive"
                              >
                                <Square className="h-3.5 w-3.5" />
                                {t("runners.rowActions.stop")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              disabled={rowBusy}
                              onSelect={() => {
                                void handleRerunScan(runner);
                              }}
                            >
                              <Play className="h-3.5 w-3.5" />
                              {t("runners.rowActions.rerun")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={rowBusy || isRunningRow}
                              title={
                                isRunningRow
                                  ? t("runners.rowActions.runningNoDelete")
                                  : undefined
                              }
                              onSelect={() => {
                                setPendingDelete({
                                  kind: "ids",
                                  ids: [runner.id],
                                });
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t("runners.rowActions.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
            <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
              <SelectValue placeholder={t("common.rows", { pageSize })} />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t("common.rows", { size })}
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
                  label={t("common.pagination.previous")}
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
                        <PaginationEllipsis
                          label={t("common.pagination.morePages")}
                        />
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
                  label={t("common.pagination.next")}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-[6px] border-2 border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("runners.bulkDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "filters"
                ? t("runners.bulkDelete.matchingFilters", {
                    count: pendingDelete.total.toLocaleString(),
                  })
                : t("runners.bulkDelete.cannotUndo")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="destructive" className="border-destructive/40">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{t("runners.bulkDelete.permanentTitle")}</AlertTitle>
            <AlertDescription>
              {t("runners.bulkDelete.permanentBody")}
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkBusy !== null}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isBulkBusy !== null}
              onClick={() => {
                if (
                  pendingDelete?.kind === "ids" &&
                  pendingDelete.ids.length === 1
                ) {
                  const runnerId = pendingDelete.ids[0];
                  if (!runnerId) return;
                  setPendingDelete(null);
                  void handleDeleteRunner(runnerId);
                } else {
                  void handleBulkDelete();
                }
              }}
              className="rounded-[4px] border-2 border-border"
            >
              {isBulkBusy === "delete"
                ? t("common.deleting")
                : t("runners.bulkDelete.deleteScans")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
