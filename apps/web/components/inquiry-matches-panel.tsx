"use client";

import * as React from "react";
import { Fragment } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import {
  api,
  InquiriesControllerListMatchesSeverityEnum,
  type InquiryMatchDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Button,
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
} from "@workspace/ui/components";
import { InquiryMatchesTable } from "./inquiry-matches-table";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const SEVERITY_OPTIONS = Object.values(InquiriesControllerListMatchesSeverityEnum);

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

export type InquiryMatchesStats = { total: number; newCount: number };

export type InquiryMatchesPanelProps = {
  inquiryId: string;
  /** Finding IDs already attached to the linked case — shown as "in case". */
  inCaseFindingIds?: Set<string>;
  /** Omit to render a read-only table without checkboxes. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Bump to force a refetch (e.g. after a re-scan). */
  reloadKey?: number;
  /** Reports the filtered total + new count to the parent header. */
  onStats?: (stats: InquiryMatchesStats) => void;
};

/**
 * Server-paginated, filterable view over an inquiry's live matches — the heavy
 * lifting (matching, filtering, paging) stays in the API so large inquiries
 * never ship thousands of rows to the browser.
 */
export function InquiryMatchesPanel({
  inquiryId,
  inCaseFindingIds,
  selected,
  onSelectedChange,
  reloadKey = 0,
  onStats,
}: InquiryMatchesPanelProps) {
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [severities, setSeverities] = React.useState<string[]>([]);
  const [onlyNew, setOnlyNew] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<InquiryMatchDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [newCount, setNewCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [initialized, setInitialized] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resolvedPageSize = Number(pageSize);

  // ── Debounce search ───────────────────────────────────────────────────────

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    setPage(1);
  }, [search, severities, onlyNew, pageSize]);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  React.useEffect(() => {
    let active = true;
    const run = async () => {
      setIsLoading(true);
      try {
        setError(null);
        const res = await api.inquiries.inquiriesControllerListMatches({
          id: inquiryId,
          search: search || undefined,
          severity:
            severities.length > 0
              ? (severities as InquiriesControllerListMatchesSeverityEnum[])
              : undefined,
          onlyNew: onlyNew || undefined,
          skip: (page - 1) * resolvedPageSize,
          limit: resolvedPageSize,
        });
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
        setNewCount(res.newCount);
        setInitialized(true);
        onStats?.({ total: res.total, newCount: res.newCount });
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load inquiry matches:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load matches",
        );
        setItems([]);
        setTotal(0);
        setNewCount(0);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId, search, severities, onlyNew, page, resolvedPageSize, reloadKey]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));
  const clampedPage = Math.min(page, totalPages);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const pageItems = React.useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );
  const showInitialLoading = isLoading && !initialized;

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search matches — finding, asset, content…"
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <MultiSelect values={severities} onValuesChange={setSeverities}>
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder="Severity" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search severities…",
              emptyMessage: "No severities found",
            }}
          >
            <MultiSelectGroup>
              {SEVERITY_OPTIONS.map((severity) => (
                <MultiSelectItem key={severity} value={severity}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[2px] border border-border/20"
                      style={{
                        backgroundColor:
                          FINDING_SEVERITY_COLOR_BY_ENUM[
                            severity as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM
                          ],
                      }}
                    />
                    {severity.charAt(0) + severity.slice(1).toLowerCase()}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <Button
          size="sm"
          variant={onlyNew ? "default" : "outline"}
          className="h-9"
          onClick={() => setOnlyNew((v) => !v)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          New only{newCount > 0 ? ` (${newCount})` : ""}
        </Button>

        {isLoading && initialized && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating…
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="relative min-h-[240px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">Loading matches…</span>
          </div>
        ) : (
          <InquiryMatchesTable
            matches={items}
            inCaseFindingIds={inCaseFindingIds}
            selected={selected}
            onSelectedChange={onSelectedChange}
          />
        )}

        {isLoading && initialized && items.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </div>
          </div>
        )}
      </div>

      {/* ── Footer: page size + pagination ── */}
      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
              <SelectValue placeholder="Rows per page" />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {total > 0
              ? `${((clampedPage - 1) * resolvedPageSize + 1).toLocaleString()}–${Math.min(clampedPage * resolvedPageSize, total).toLocaleString()} of ${total.toLocaleString()}`
              : "0 matches"}
          </span>
        </div>

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  label="Previous"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (canPrev) setPage(clampedPage - 1);
                  }}
                  className={!canPrev ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
              {pageItems.map((pageNumber, index) => {
                const prev = pageItems[index - 1];
                const showEllipsis = prev && pageNumber - prev > 1;
                return (
                  <Fragment key={`page-group-${pageNumber}`}>
                    {showEllipsis && (
                      <PaginationItem>
                        <PaginationEllipsis label="More pages" />
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
                  </Fragment>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  label="Next"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (canNext) setPage(clampedPage + 1);
                  }}
                  className={!canNext ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </div>
  );
}
