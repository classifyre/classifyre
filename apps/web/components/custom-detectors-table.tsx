"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Filter,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  api,
  type CustomDetectorMethod,
  type CustomDetectorResponseDto,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { formatDate, formatRelative } from "@/lib/date";
import {
  detectorCatalogStatusLabel,
  detectorCatalogStatusToRunnerStatus,
} from "@/lib/custom-detector-badge";
import { getRunnerStatusBadgeTone } from "@/lib/runner-status-badge";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const METHOD_OPTIONS: CustomDetectorMethod[] = [
  "RULESET",
  "CLASSIFIER",
  "ENTITY",
];

type SortBy =
  | "updatedAt"
  | "name"
  | "method"
  | "status"
  | "findingsCount"
  | "sourcesUsingCount"
  | "sourcesWithFindingsCount"
  | "lastTrainedAt";

type SortOrder = "asc" | "desc";

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function methodTone(
  method: CustomDetectorMethod,
): "default" | "secondary" | "outline" {
  if (method === "CLASSIFIER") return "default";
  if (method === "ENTITY") return "secondary";
  return "outline";
}

function compareNullableDate(
  left?: string | null,
  right?: string | null,
): number {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return leftTime - rightTime;
}

function sortRows(
  rows: CustomDetectorResponseDto[],
  sortBy: SortBy,
  sortOrder: SortOrder,
): CustomDetectorResponseDto[] {
  const ordered = [...rows].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "method":
        return a.method.localeCompare(b.method);
      case "findingsCount":
        return a.findingsCount - b.findingsCount;
      case "status":
        return Number(a.isActive) - Number(b.isActive);
      case "sourcesUsingCount":
        return a.sourcesUsingCount - b.sourcesUsingCount;
      case "sourcesWithFindingsCount":
        return a.sourcesWithFindingsCount - b.sourcesWithFindingsCount;
      case "lastTrainedAt":
        return compareNullableDate(a.lastTrainedAt, b.lastTrainedAt);
      case "updatedAt":
      default:
        return compareNullableDate(a.updatedAt, b.updatedAt);
    }
  });

  if (sortOrder === "desc") {
    ordered.reverse();
  }

  return ordered;
}

export function CustomDetectorsTable() {
  const router = useRouter();
  const { t } = useTranslation();

  const [rows, setRows] = useState<CustomDetectorResponseDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [methods, setMethods] = useState<CustomDetectorMethod[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ACTIVE" | "INACTIVE"
  >("ALL");
  const [usageFilter, setUsageFilter] = useState<
    "ALL" | "USED" | "WITH_RESULTS"
  >("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [pageSize, setPageSize] = useState<string>(
    String(PAGE_SIZE_OPTIONS[0]),
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [methods, statusFilter, usageFilter, pageSize]);

  const load = async (refresh = false) => {
    try {
      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      const payload = await api.listCustomDetectors({ includeInactive: true });
      setRows(payload ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load detectors",
      );
      setRows([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const filtered = useMemo(() => {
    const methodSet = new Set(methods);

    const searched = rows.filter((row) => {
      if (methodSet.size > 0 && !methodSet.has(row.method)) {
        return false;
      }

      if (statusFilter === "ACTIVE" && !row.isActive) {
        return false;
      }
      if (statusFilter === "INACTIVE" && row.isActive) {
        return false;
      }

      if (usageFilter === "USED" && row.sourcesUsingCount <= 0) {
        return false;
      }
      if (usageFilter === "WITH_RESULTS" && row.sourcesWithFindingsCount <= 0) {
        return false;
      }

      if (!debouncedSearch) {
        return true;
      }

      const haystack = [
        row.name,
        row.key,
        row.description ?? "",
        row.method,
        ...row.recentSourceNames,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(debouncedSearch);
    });

    return sortRows(searched, sortBy, sortOrder);
  }, [
    rows,
    methods,
    statusFilter,
    usageFilter,
    debouncedSearch,
    sortBy,
    sortOrder,
  ]);

  const resolvedPageSize = Number(pageSize);
  const safePageSize =
    Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
      ? resolvedPageSize
      : 20;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, safePageSize)));
  const clampedPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== clampedPage) {
      setPage(clampedPage);
    }
  }, [page, clampedPage]);

  const pagedRows = useMemo(() => {
    const start = (clampedPage - 1) * safePageSize;
    return filtered.slice(start, start + safePageSize);
  }, [filtered, clampedPage, safePageSize]);

  const pageItems = useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;

  const onSort = (field: SortBy) => {
    setPage(1);
    if (sortBy === field) {
      setSortOrder((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(field);
    setSortOrder(field === "name" || field === "method" ? "asc" : "desc");
  };

  const renderSortIcon = (field: SortBy) => {
    if (sortBy !== field) {
      return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" />
    );
  };

  const renderSortHead = (label: string, field: SortBy) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-1.5 font-medium"
      onClick={() => onSort(field)}
    >
      <span>{label}</span>
      {renderSortIcon(field)}
    </Button>
  );

  if (isLoading && rows.length === 0) {
    return (
      <div className="rounded-[6px] border-2 border-black bg-background p-12 shadow-[6px_6px_0_#000]">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-[1.8]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("detectors.search")}
            className="h-9 rounded-[4px] border-2 border-black pl-9"
          />
        </div>

        <MultiSelect
          values={methods}
          onValuesChange={(values) =>
            setMethods(values as CustomDetectorMethod[])
          }
        >
          <MultiSelectTrigger className="h-9 min-w-[220px] border-2 border-black rounded-[4px]">
            <Filter className="mr-1 h-4 w-4" />
            <MultiSelectValue placeholder={t("detectors.allMethods")} />
          </MultiSelectTrigger>
          <MultiSelectContent>
            <MultiSelectGroup>
              {METHOD_OPTIONS.map((method) => (
                <MultiSelectItem key={method} value={method}>
                  {method}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as typeof statusFilter)
          }
        >
          <SelectTrigger className="h-9 min-w-[150px] border-2 border-black rounded-[4px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={usageFilter}
          onValueChange={(value) => setUsageFilter(value as typeof usageFilter)}
        >
          <SelectTrigger className="h-9 min-w-[170px] border-2 border-black rounded-[4px]">
            <SelectValue placeholder="Usage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All usage</SelectItem>
            <SelectItem value="USED">Used in sources</SelectItem>
            <SelectItem value="WITH_RESULTS">Has findings</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-[4px] border-2 border-black"
          onClick={() => void load(true)}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-1.5 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {error ? (
        <EmptyState
          title={t("detectors.loadError")}
          description={error}
          action={{
            label: t("common.retry"),
            onClick: () => void load(true),
          }}
        />
      ) : (
        <div className="overflow-hidden rounded-[6px] border-2 border-black bg-background shadow-[6px_6px_0_#000]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{renderSortHead("Detector", "name")}</TableHead>
                <TableHead>
                  {renderSortHead(t("common.method"), "method")}
                </TableHead>
                <TableHead>
                  {renderSortHead(t("common.status"), "status")}
                </TableHead>
                <TableHead>
                  {renderSortHead(t("common.sources"), "sourcesUsingCount")}
                </TableHead>
                <TableHead>
                  {renderSortHead("Results", "findingsCount")}
                </TableHead>
                <TableHead>
                  {renderSortHead(t("detectors.lastTrained"), "lastTrainedAt")}
                </TableHead>
                <TableHead>
                  {renderSortHead(t("common.updated"), "updatedAt")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      title={t("detectors.noDetectors")}
                      description={t("detectors.noDetectorsHint")}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/detectors/${row.id}`)}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium leading-tight">{row.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {row.key}
                        </p>
                        {row.description ? (
                          <p className="line-clamp-2 max-w-[420px] text-xs text-muted-foreground">
                            {row.description}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={methodTone(row.method)}
                        className="font-mono text-[10px] uppercase"
                      >
                        {row.method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`rounded-[4px] border text-[10px] ${getRunnerStatusBadgeTone(
                          detectorCatalogStatusToRunnerStatus(row.isActive),
                        )}`}
                      >
                        {detectorCatalogStatusLabel(row.isActive)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {row.sourcesUsingCount}
                        </p>
                        {row.recentSourceNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.recentSourceNames.slice(0, 2).map((name) => (
                              <Badge
                                key={`${row.id}-${name}`}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {name}
                              </Badge>
                            ))}
                            {row.recentSourceNames.length > 2 ? (
                              <Badge variant="outline" className="text-[10px]">
                                +{row.recentSourceNames.length - 2}
                              </Badge>
                            ) : null}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No source binding yet
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {row.findingsCount}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.sourcesWithFindingsCount} source
                          {row.sourcesWithFindingsCount === 1 ? "" : "s"} with
                          findings
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.lastTrainedAt ? (
                        <div className="space-y-0.5">
                          <p className="text-sm">
                            {formatDate(row.lastTrainedAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatRelative(row.lastTrainedAt)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t("detectors.never")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-sm">{formatDate(row.updatedAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatRelative(row.updatedAt)}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-black/20 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Showing <strong>{pagedRows.length}</strong> of{" "}
          <strong>{total}</strong> detectors
        </span>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select value={String(safePageSize)} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[88px] rounded-[4px] border border-black/30 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={!canPrev}
              tabIndex={canPrev ? 0 : -1}
              className={!canPrev ? "pointer-events-none opacity-50" : ""}
              onClick={(event) => {
                event.preventDefault();
                if (!canPrev) return;
                setPage((current) => Math.max(1, current - 1));
              }}
            />
          </PaginationItem>

          {pageItems.map((item, index) => {
            const previous = pageItems[index - 1];
            const showEllipsis = previous !== undefined && item - previous > 1;

            return (
              <Fragment key={item}>
                {showEllipsis ? (
                  <PaginationItem>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : null}
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    isActive={item === clampedPage}
                    onClick={(event) => {
                      event.preventDefault();
                      setPage(item);
                    }}
                  >
                    {item}
                  </PaginationLink>
                </PaginationItem>
              </Fragment>
            );
          })}

          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={!canNext}
              tabIndex={canNext ? 0 : -1}
              className={!canNext ? "pointer-events-none opacity-50" : ""}
              onClick={(event) => {
                event.preventDefault();
                if (!canNext) return;
                setPage((current) => Math.min(totalPages, current + 1));
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
