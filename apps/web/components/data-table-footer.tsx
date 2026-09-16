"use client";

import { Fragment } from "react";
import {
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
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

export interface DataTableFooterProps {
  /** 1-based current page, already clamped. */
  page: number;
  totalPages: number;
  total: number;
  pageSize: string;
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (value: string) => void;
  /** Trailing half of the range label, e.g. "42" or "42 findings". */
  totalLabel: string;
  /** Shown when there is nothing to page through, e.g. "0 findings". */
  emptyLabel: string;
}

/**
 * The rows-per-page + range + pagination footer shared by the sources,
 * findings, and custom-detector tables so all three read as one design.
 */
export function DataTableFooter({
  page,
  totalPages,
  total,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  totalLabel,
  emptyLabel,
}: DataTableFooterProps) {
  const { t } = useTranslation();
  const resolvedPageSize = Number(pageSize);
  const safePageSize =
    Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
      ? resolvedPageSize
      : (pageSizeOptions[0] ?? 20);
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const pageItems = getPageItems(page, totalPages);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("common.rowsPerPage")}
        </span>
        <Select value={pageSize} onValueChange={onPageSizeChange}>
          <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
            <SelectValue placeholder={t("common.rowsPerPage")} />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("common.rows", { size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {total > 0
            ? `${((page - 1) * safePageSize + 1).toLocaleString()}–${Math.min(page * safePageSize, total).toLocaleString()} ${t("common.of")} ${totalLabel}`
            : emptyLabel}
        </span>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                label={t("common.pagination.previous")}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (canPrev) onPageChange(page - 1);
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
                    <PaginationItem>
                      <PaginationEllipsis
                        label={t("common.pagination.morePages")}
                      />
                    </PaginationItem>
                  )}
                  <PaginationItem>
                    <PaginationLink
                      href="#"
                      isActive={pageNumber === page}
                      onClick={(e) => {
                        e.preventDefault();
                        onPageChange(pageNumber);
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
                onClick={(e) => {
                  e.preventDefault();
                  if (canNext) onPageChange(page + 1);
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
  );
}
