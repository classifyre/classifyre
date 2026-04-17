"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import {
  type CustomDetectorTrainingRunDto,
  type CustomDetectorTrainingStatus,
} from "@workspace/api-client";
import {
  Badge,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { formatDate } from "@/lib/date";
import { detectorTrainingStatusToRunnerStatus } from "@/lib/custom-detector-badge";
import { getRunnerStatusBadgeTone } from "@/lib/runner-status-badge";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

type SortBy =
  | "startedAt"
  | "status"
  | "strategy"
  | "trainedExamples"
  | "durationMs";
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

function compareNullableNumber(
  left?: number | null,
  right?: number | null,
): number {
  return (left ?? 0) - (right ?? 0);
}

function sortRows(
  rows: CustomDetectorTrainingRunDto[],
  sortBy: SortBy,
  sortOrder: SortOrder,
) {
  const ordered = [...rows].sort((a, b) => {
    switch (sortBy) {
      case "status":
        return a.status.localeCompare(b.status);
      case "strategy":
        return (a.strategy ?? "").localeCompare(b.strategy ?? "");
      case "trainedExamples":
        return compareNullableNumber(a.trainedExamples, b.trainedExamples);
      case "durationMs":
        return compareNullableNumber(a.durationMs, b.durationMs);
      case "startedAt":
      default:
        return (
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        );
    }
  });

  if (sortOrder === "desc") {
    ordered.reverse();
  }

  return ordered;
}

function renderDuration(run: CustomDetectorTrainingRunDto): string {
  if (typeof run.durationMs !== "number") {
    return "-";
  }

  if (run.durationMs < 1000) {
    return `${run.durationMs}ms`;
  }

  return `${(run.durationMs / 1000).toFixed(1)}s`;
}

type CustomDetectorTrainingHistoryTableProps = {
  history: CustomDetectorTrainingRunDto[];
};

export function CustomDetectorTrainingHistoryTable({
  history,
}: CustomDetectorTrainingHistoryTableProps) {
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    CustomDetectorTrainingStatus | "ALL"
  >("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("startedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [pageSize, setPageSize] = useState<string>(
    String(PAGE_SIZE_OPTIONS[0]),
  );
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = searchInput.trim().toLowerCase();

    const rows = history.filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        row.status,
        row.strategy ?? "",
        row.errorMessage ?? "",
        row.configHash ?? "",
        row.modelArtifactPath ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });

    return sortRows(rows, sortBy, sortOrder);
  }, [history, searchInput, sortBy, sortOrder, statusFilter]);

  const resolvedPageSize = Number(pageSize);
  const safePageSize =
    Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
      ? resolvedPageSize
      : 10;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, safePageSize)));
  const clampedPage = Math.min(page, totalPages);

  const pagedRows = useMemo(() => {
    const start = (clampedPage - 1) * safePageSize;
    return filtered.slice(start, start + safePageSize);
  }, [clampedPage, filtered, safePageSize]);

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
    setSortOrder(field === "status" || field === "strategy" ? "asc" : "desc");
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
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 px-1.5 text-left text-xs font-medium hover:text-foreground"
      onClick={() => onSort(field)}
    >
      <span>{label}</span>
      {renderSortIcon(field)}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.8]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            placeholder="Search status, strategy, or error"
            className="h-9 rounded-[4px] border-2 border-black pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as CustomDetectorTrainingStatus | "ALL");
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 min-w-[180px] border-2 border-black rounded-[4px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING">PENDING</SelectItem>
            <SelectItem value="RUNNING">RUNNING</SelectItem>
            <SelectItem value="SUCCEEDED">SUCCEEDED</SelectItem>
            <SelectItem value="FAILED">FAILED</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-[6px] border-2 border-black bg-background shadow-[6px_6px_0_#000]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{renderSortHead("Started", "startedAt")}</TableHead>
              <TableHead>{renderSortHead("Status", "status")}</TableHead>
              <TableHead>{renderSortHead("Strategy", "strategy")}</TableHead>
              <TableHead>
                {renderSortHead("Examples", "trainedExamples")}
              </TableHead>
              <TableHead>{renderSortHead("Duration", "durationMs")}</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    title="No training runs match current filters"
                    description="Run training or change filters to see history rows."
                  />
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((run) => (
                <TableRow key={run.id} data-testid="training-history-row" data-status={run.status} data-strategy={run.strategy ?? ""}>
                  <TableCell>{formatDate(run.startedAt)}</TableCell>
                  <TableCell>
                    <Badge
                      data-testid="training-run-status"
                      className={`rounded-[4px] border text-[10px] ${getRunnerStatusBadgeTone(
                        detectorTrainingStatusToRunnerStatus(run.status),
                      )}`}
                    >
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell data-testid="training-run-strategy">{run.strategy ?? "-"}</TableCell>
                  <TableCell>{run.trainedExamples ?? "-"}</TableCell>
                  <TableCell>{renderDuration(run)}</TableCell>
                  <TableCell className="max-w-[360px] truncate text-xs text-muted-foreground">
                    {run.errorMessage ?? "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-black/20 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Showing <strong>{pagedRows.length}</strong> of{" "}
          <strong>{total}</strong> training runs
        </span>
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select
            value={String(safePageSize)}
            onValueChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
          >
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
