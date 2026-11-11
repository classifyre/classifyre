"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useCan } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";
import type { ExportFormat } from "@/lib/data-query";
import type { QueryRows } from "@/lib/data-query";

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function getPageItems(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * The rows of a result on the shared table, like assets: a filter bar with
 * the search and the export beside it, a count, sortable headers, plain
 * frontend pagination below. The result is already bounded by the workspace
 * row limit, so client-side paging keeps all ten thousand rows reachable
 * without virtualization.
 */
export function ResultsGrid({
  result,
  height = 420,
  canExport = false,
  onExport,
}: {
  result: QueryRows;
  height?: number;
  /** Export beside the search — only when there are rows to download. */
  canExport?: boolean;
  onExport?: (format: ExportFormat) => void;
}) {
  const { t } = useTranslation();
  const showExport = useCan("data.export");
  const [query, setQuery] = React.useState("");
  const [column, setColumn] = React.useState<number | null>(null);
  const [descending, setDescending] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(String(PAGE_SIZE_OPTIONS[1]));
  const [page, setPage] = React.useState(1);

  const needle = query.trim().toLowerCase();

  // Search across every column, or one column when the header's filter picked
  // it. Numbers, booleans and nulls match through their display text.
  const filtered = React.useMemo(() => {
    if (!needle) return result.rows;
    return result.rows.filter((row) =>
      row.some((value, index) => {
        if (column !== null && index !== column) return false;
        return display(value).toLowerCase().includes(needle);
      }),
    );
  }, [result.rows, needle, column]);

  const sorted = React.useMemo(() => {
    if (column === null) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const x = a[column];
      const y = b[column];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return x - y;
      const order = display(x).localeCompare(display(y), undefined, {
        numeric: true,
      });
      return descending ? -order : order;
    });
    return copy;
  }, [filtered, column, descending]);

  const resolvedPageSize = Number(pageSize);
  const totalPages = Math.max(
    1,
    Math.ceil(sorted.length / Math.max(1, resolvedPageSize)),
  );
  const clampedPage = Math.min(page, totalPages);
  const pageRows = sorted.slice(
    (clampedPage - 1) * resolvedPageSize,
    clampedPage * resolvedPageSize,
  );
  const pageItems = getPageItems(clampedPage, totalPages);

  // A new result, a new search or a new sort starts back on page one.
  React.useEffect(() => {
    setPage(1);
  }, [result, needle, column, descending, pageSize]);

  const toggleSort = (index: number) => {
    if (column !== index) {
      setColumn(index);
      setDescending(false);
    } else if (!descending) {
      setDescending(true);
    } else {
      setColumn(null);
      setDescending(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dataQuery.results.search")}
              className="h-9 border-2 border-border rounded-[4px] pl-9"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className="text-xs text-muted-foreground"
              data-testid="query-row-count"
            >
              {t("dataQuery.results.count", {
                shown: pageRows.length,
                total: sorted.length,
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("dataQuery.columns", { count: result.columns.length })}
            </span>
            {canExport && showExport && onExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    data-testid="export-query"
                  >
                    <Download className="h-4 w-4" />
                    {t("dataQuery.export.button")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem data-testid="export-xlsx" onSelect={() => onExport("xlsx")}>
                    {t("dataQuery.export.xlsx")}
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="export-csv" onSelect={() => onExport("csv")}>
                    {t("dataQuery.export.csv")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="export-parquet"
                    onSelect={() => onExport("parquet")}
                  >
                    {t("dataQuery.export.parquet")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div
          className="overflow-auto rounded-[4px] bg-white dark:bg-card"
          style={{ maxHeight: height }}
          data-testid="query-results"
        >
          <Table className="font-mono text-xs">
            <TableHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur dark:bg-card/95 supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
              <TableRow>
                <TableHead className="w-12 text-right font-normal text-muted-foreground">
                  #
                </TableHead>
                {result.columns.map((col, index) => {
                  const active = column === index;
                  return (
                    <TableHead key={`${index}:${col.name}`} className="p-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-medium hover:text-foreground"
                            onClick={() => toggleSort(index)}
                            title={col.type || col.name}
                          >
                            <span className="min-w-0 truncate">{col.name}</span>
                            {active && !descending && (
                              <ArrowUp className="h-3 w-3 shrink-0" />
                            )}
                            {active && descending && (
                              <ArrowDown className="h-3 w-3 shrink-0" />
                            )}
                            {!active && (
                              <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="font-mono text-xs">
                          {col.type
                            ? `${col.name} · ${col.type}`
                            : t("dataQuery.results.sortHint", {
                                name: col.name,
                              })}
                        </TooltipContent>
                      </Tooltip>
                      {col.type && (
                        <span className="block px-2 pb-1 text-[10px] font-normal text-muted-foreground">
                          {col.type}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row, rowIndex) => {
                const absolute = (clampedPage - 1) * resolvedPageSize + rowIndex;
                return (
                  <TableRow key={absolute}>
                    <TableCell className="w-12 text-right text-muted-foreground">
                      {absolute + 1}
                    </TableCell>
                    {row.map((value, colIndex) => {
                      const text = display(value);
                      return (
                        <TableCell
                          key={colIndex}
                          className={cn(
                            "max-w-[28rem] truncate",
                            value === null && "italic text-muted-foreground",
                            typeof value === "number" &&
                              "text-right tabular-nums",
                          )}
                          title={text.length > 40 ? text : undefined}
                        >
                          {value === null ? "null" : text}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
              {!pageRows.length && (
                <TableRow>
                  <TableCell
                    colSpan={result.columns.length + 1}
                    className="py-6 text-center font-sans text-xs text-muted-foreground"
                  >
                    {t("dataQuery.results.noMatch")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("common.rowsPerPage")}
            </span>
            <Select value={pageSize} onValueChange={setPageSize}>
              <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
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

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    label={t("common.pagination.previous")}
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (clampedPage > 1) setPage(clampedPage - 1);
                    }}
                    className={
                      clampedPage <= 1
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                  />
                </PaginationItem>
                {pageItems.map((pageNumber, index) => {
                  const previous = pageItems[index - 1];
                  const showEllipsis =
                    previous !== undefined && pageNumber - previous > 1;
                  return (
                    <React.Fragment key={`page-${pageNumber}`}>
                      {showEllipsis && (
                        <PaginationItem>
                          <PaginationEllipsis
                            label={t("common.pagination.morePages")}
                          />
                        </PaginationItem>
                      )}
                      <PaginationItem>
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
                    </React.Fragment>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    label={t("common.pagination.next")}
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (clampedPage < totalPages) setPage(clampedPage + 1);
                    }}
                    className={
                      clampedPage >= totalPages
                        ? "pointer-events-none opacity-50"
                        : undefined
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
