"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import { Filter, Loader2, Search } from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import {
  api,
  CasesControllerListStatusEnum,
  CasesControllerListSeverityEnum,
  type CaseResponseDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
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
  SeverityBadge,
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
import { CaseStatusBadge } from "./case-status-badge";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS = Object.values(CasesControllerListStatusEnum);
const SEVERITY_OPTIONS = Object.values(CasesControllerListSeverityEnum);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CasesTable() {
  const { t } = useTranslation();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  const [data, setData] = useState<CaseResponseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [search, statuses, severities, pageSize]);

  // ── Fetch cases ───────────────────────────────────────────────────────────

  const [initialized, setInitialized] = useState(false);

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
        const res = await api.cases.casesControllerList({
          search: search || undefined,
          status:
            statuses.length > 0
              ? (statuses as typeof CasesControllerListStatusEnum[keyof typeof CasesControllerListStatusEnum][])
              : undefined,
          severity:
            severities.length > 0
              ? (severities as typeof CasesControllerListSeverityEnum[keyof typeof CasesControllerListSeverityEnum][])
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
        console.error("Failed to load cases:", loadError);
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load cases",
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
  }, [search, statuses, severities, page, resolvedPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));
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
            placeholder={t("cases.search")}
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <MultiSelect
          values={statuses}
          onValuesChange={setStatuses}
        >
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("common.status")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search statuses…",
              emptyMessage: "No statuses found",
            }}
          >
            <MultiSelectGroup>
              {STATUS_OPTIONS.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {t(`cases.statusLabels.${status}` as TranslationKey)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={severities}
          onValuesChange={setSeverities}
        >
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("common.severity")} />
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
                    {t(`cases.severityLabels.${severity}` as TranslationKey)}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {isFilterLoading && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("runners.updating")}
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
            <span className="ml-2 text-sm">{t("cases.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("cases.noInvestigations")}
            description={t("cases.noInvestigationsHint")}
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
                          {t("cases.columns.title")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Investigation title</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.columns.status")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Current investigation status</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.columns.severity")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Risk level assigned to this investigation</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95 text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.columns.inquiries")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Number of linked inquiries</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.columns.updated")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Last updated timestamp</TooltipContent>
                    </Tooltip>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <Fragment key={c.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => router.push(`/investigations/${c.id}`)}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {c.title}
                          {isAiActor(c.createdBy) && <AiActorBadge />}
                        </span>
                      </TableCell>
                      <TableCell>
                        <CaseStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <SeverityBadge
                          severity={
                            c.severity.toLowerCase() as
                              | "critical"
                              | "high"
                              | "medium"
                              | "low"
                              | "info"
                          }
                        >
                          {t(`cases.severityLabels.${c.severity}` as TranslationKey)}
                        </SeverityBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.inquiryCount}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-default">
                              {formatRelative(c.updatedAt)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            <div>{formatDate(c.updatedAt)}</div>
                            {formatShortUTC(c.updatedAt) && (
                              <div className="text-muted-foreground/70">
                                {formatShortUTC(c.updatedAt)}
                              </div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isFilterLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("runners.updating")}
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
              ? `${((clampedPage - 1) * resolvedPageSize + 1).toLocaleString()}–${Math.min(clampedPage * resolvedPageSize, total).toLocaleString()} of ${total.toLocaleString()}`
              : "0 investigations"}
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
                        <PaginationEllipsis label={t("common.pagination.morePages")} />
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
