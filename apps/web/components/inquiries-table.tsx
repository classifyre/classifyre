"use client";

import { nsPath } from "@/lib/ns-path";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Sparkles,
} from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import {
  api,
  InquiriesControllerListStatusEnum,
  type InquiryResponseDto,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { Filter, Search } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS = Object.values(InquiriesControllerListStatusEnum);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function inquiryScope(
  q: InquiryResponseDto,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const sources = q.matchAllSources
    ? t("investigations.inquiries.scopeAllSources")
    : t("investigations.inquiries.scopeSources", { count: q.sourceIds.length });
  const matcherCount =
    q.detectorTypes.length +
    q.customDetectorKeys.length +
    q.findingTypes.length +
    q.findingTypeRegex.length;
  const matchers =
    matcherCount === 0
      ? t("investigations.inquiries.scopeAnyFinding")
      : t("investigations.inquiries.scopeMatchers", { count: matcherCount });
  return `${sources} · ${matchers}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InquiriesTable() {
  const router = useRouter();
  const { t } = useTranslation();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([
    InquiriesControllerListStatusEnum.Active,
  ]);
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  const [data, setData] = useState<InquiryResponseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const resolvedPageSize = Number(pageSize);

  // ── Debounce search ───────────────────────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Reset page on filter/size change ─────────────────────────────────────

  useEffect(() => {
    setPage(1);
  }, [search, statuses, pageSize]);

  // ── Fetch inquiries ───────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!initialized) {
        setIsLoading(true);
      } else {
        setIsFilterLoading(true);
      }

      try {
        setError(null);
        const res = await api.inquiries.inquiriesControllerList({
          search: search || undefined,
          status:
            statuses.length > 0
              ? (statuses as InquiriesControllerListStatusEnum[])
              : undefined,
          skip: (page - 1) * resolvedPageSize,
          limit: resolvedPageSize,
        });
        if (!active) return;
        setData(res.items);
        setTotal(res.total);
        setInitialized(true);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load inquiries:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("investigations.inquiries.loadFailed"),
        );
        setData([]);
        setTotal(0);
      } finally {
        if (active) {
          setIsLoading(false);
          setIsFilterLoading(false);
        }
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [search, statuses, page, resolvedPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────

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
  const hasRows = data.length > 0;
  const showInitialLoading = isLoading && !initialized;

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("investigations.inquiries.searchPlaceholder")}
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <MultiSelect values={statuses} onValuesChange={setStatuses}>
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
            <MultiSelectValue
              placeholder={t("investigations.inquiries.statusPlaceholder")}
            />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("investigations.inquiries.searchStatuses"),
              emptyMessage: t("investigations.inquiries.noStatusesFound"),
            }}
          >
            <MultiSelectGroup>
              {STATUS_OPTIONS.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {isFilterLoading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("investigations.inquiries.updating")}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">
              {t("investigations.inquiries.loading")}
            </span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={search || statuses.length > 0 ? Filter : Sparkles}
            title={t("investigations.inquiries.emptyTitle")}
            description={
              search
                ? t("investigations.inquiries.emptyFiltered")
                : t("investigations.inquiries.emptyDescription")
            }
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("investigations.inquiries.colInquiry")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("investigations.inquiries.colInquiryHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95 text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("investigations.inquiries.colMatches")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("investigations.inquiries.colMatchesHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("investigations.inquiries.colCases")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("investigations.inquiries.colCasesHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("common.status")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("common.updated")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95 text-right">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("common.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((q) => {
                  const archived = q.status === "ARCHIVED";
                  return (
                    <Fragment key={q.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/40 ${archived ? "opacity-60" : ""}`}
                        onClick={() =>
                          router.push(
                            nsPath(`/investigations/inquiries/${q.id}`),
                          )
                        }
                      >
                        <TableCell className="max-w-[420px]">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-amber-600,#d97706)]" />
                            <span className="truncate font-medium">
                              {q.title}
                            </span>
                            {isAiActor(q.createdBy) && <AiActorBadge />}
                          </div>
                          <p className="text-muted-foreground mt-0.5 pl-[22px] text-[11px]">
                            {inquiryScope(q, t)}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center justify-end gap-2">
                            {q.newMatchCount > 0 && (
                              <Badge
                                variant="outline"
                                className="border-[color:var(--color-amber-600,#d97706)]/50 text-[10px] text-[color:var(--color-amber-600,#d97706)]"
                              >
                                {t("investigations.inquiries.newCount", {
                                  count: q.newMatchCount,
                                })}
                              </Badge>
                            )}
                            <span className="font-mono text-sm tabular-nums">
                              {q.matchCount}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          {q.cases.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(
                                  nsPath(
                                    q.cases.length === 1
                                      ? `/investigations/${q.cases[0]!.id}`
                                      : `/investigations/inquiries/${q.id}`,
                                  ),
                                );
                              }}
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                              {q.cases.length === 1
                                ? t("investigations.inquiries.case")
                                : t("investigations.inquiries.casesCount", {
                                    count: q.cases.length,
                                  })}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wide"
                          >
                            {archived
                              ? t("investigations.inquiries.statusArchived")
                              : t("investigations.inquiries.statusActive")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-muted-foreground cursor-default">
                                {formatRelative(q.updatedAt)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <div>{formatDate(q.updatedAt)}</div>
                              {formatShortUTC(q.updatedAt) && (
                                <div className="text-muted-foreground/70">
                                  {formatShortUTC(q.updatedAt)}
                                </div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right">
                          {!archived && (
                            <span className="inline-flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label={t(
                                      "investigations.inquiries.openCaseFromInquiry",
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(
                                        nsPath(
                                          `/investigations/cases/new?inquiryId=${q.id}`,
                                        ),
                                      );
                                    }}
                                  >
                                    <FolderPlus className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("investigations.inquiries.openCase")}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    aria-label={t(
                                      "investigations.inquiries.editInquiry",
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      router.push(
                                        nsPath(
                                          `/investigations/inquiries/${q.id}/edit`,
                                        ),
                                      );
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("investigations.inquiries.editQuery")}
                                </TooltipContent>
                              </Tooltip>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {isFilterLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("investigations.inquiries.updating")}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer: page size + pagination ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("common.rowsPerPage")}
          </span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] border-2 border-border rounded-[4px]">
              <SelectValue placeholder={t("common.rowsPerPage")} />
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
              ? `${((clampedPage - 1) * resolvedPageSize + 1).toLocaleString()}–${Math.min(clampedPage * resolvedPageSize, total).toLocaleString()} ${t("common.of")} ${total.toLocaleString()}`
              : t("investigations.inquiries.noInquiries")}
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
                  label={t("common.pagination.next")}
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
