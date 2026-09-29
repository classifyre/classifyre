"use client";

import * as React from "react";
import { Filter, History, Loader2, Search } from "lucide-react";
import {
  api,
  CasesControllerListSeverityEnum,
  CasesControllerListStatusEnum,
  type CaseResponseDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
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
} from "@workspace/ui/components";
import { useOptionalNamespace } from "@/components/namespace-provider";
import { SectionHeading } from "@/components/section-heading";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { forgetOpened, recentCasesList, useRecentlyOpened } from "@/lib/recently-opened";
import { CaseCard, CaseCardSkeleton } from "./case-card";

const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;
const DEFAULT_PAGE_SIZE = 12;
/** One row of the grid on a desktop. */
const RECENT_COUNT = 3;

const STATUS_OPTIONS = Object.values(CasesControllerListStatusEnum);
const SEVERITY_OPTIONS = Object.values(CasesControllerListSeverityEnum);
type StatusFilter = (typeof CasesControllerListStatusEnum)[keyof typeof CasesControllerListStatusEnum];
type SeverityFilter = (typeof CasesControllerListSeverityEnum)[keyof typeof CasesControllerListSeverityEnum];

/**
 * One card per row on a phone, two on a narrow pane, three on a desktop.
 * Measured on the grid's own width (a container query), because the sidebar,
 * not the window, decides how much room the page has.
 */
const GRID = "grid grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:grid-cols-3";

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

/**
 * The investigations page's cases: the filter bar, the cases this browser
 * opened last in a row of their own, then every other case, a page at a time.
 * While a search or filter is on there is one list of matches, recent or not.
 */
export function CasesGrid() {
  const { t } = useTranslation();
  // Not fixed ids: the router keeps the previous page mounted while hidden.
  const headingId = React.useId();

  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [severities, setSeverities] = React.useState<string[]>([]);
  const [pageSize, setPageSize] = React.useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<CaseResponseDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resolvedPageSize = Number(pageSize);
  const filtering = search !== "" || statuses.length > 0 || severities.length > 0;

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    setPage(1);
  }, [search, statuses, severities, pageSize]);

  // ── Recently opened ──────────────────────────────────────────────────────

  const slug = useOptionalNamespace()?.slug;
  const recentList = slug ? recentCasesList(slug) : null;
  const recent = useRecentlyOpened(recentList);
  const recentIds = React.useMemo(
    () => (filtering ? [] : recent.slice(0, RECENT_COUNT).map((r) => r.id)),
    [filtering, recent],
  );
  const recentKey = recentIds.join(",");
  const [recentCases, setRecentCases] = React.useState<CaseResponseDto[] | null>(null);

  React.useEffect(() => {
    const ids = recentKey ? recentKey.split(",") : [];
    if (ids.length === 0) {
      setRecentCases([]);
      return;
    }
    let active = true;
    api.cases
      .casesControllerList({ ids, limit: ids.length, withCardDetails: true })
      .then((res) => {
        if (!active) return;
        const byId = new Map(res.items.map((c) => [c.id, c]));
        // Deleted since: out of the row, so the next one moves up.
        if (recentList) forgetOpened(recentList, ids.filter((id) => !byId.has(id)));
        setRecentCases(ids.flatMap((id) => byId.get(id) ?? []));
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        console.error("Failed to load recent cases:", loadError);
        setRecentCases([]);
      });
    return () => {
      active = false;
    };
  }, [recentKey, recentList]);

  // ── Everything else ──────────────────────────────────────────────────────

  React.useEffect(() => {
    let active = true;
    setIsUpdating(true);
    const ids = recentKey ? recentKey.split(",") : [];
    api.cases
      .casesControllerList({
        search: search || undefined,
        status: statuses.length > 0 ? (statuses as StatusFilter[]) : undefined,
        severity: severities.length > 0 ? (severities as SeverityFilter[]) : undefined,
        excludeIds: ids.length > 0 ? ids : undefined,
        withCardDetails: true,
        skip: (page - 1) * resolvedPageSize,
        limit: resolvedPageSize,
      })
      .then((res) => {
        if (!active) return;
        setError(null);
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        console.error("Failed to load cases:", loadError);
        setError(loadError instanceof Error ? loadError.message : "Failed to load cases");
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!active) return;
        setLoaded(true);
        setIsUpdating(false);
      });
    return () => {
      active = false;
    };
  }, [search, statuses, severities, page, resolvedPageSize, recentKey]);

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));
  const clampedPage = Math.min(page, totalPages);
  // Cases went away (or into the recent row) while on the last page.
  React.useEffect(() => {
    if (loaded && page > totalPages) setPage(totalPages);
  }, [loaded, page, totalPages]);
  const pageItems = React.useMemo(() => getPageItems(clampedPage, totalPages), [clampedPage, totalPages]);
  const openedAt = React.useMemo(() => new Map(recent.map((r) => [r.id, r.at])), [recent]);
  const showRecent = !filtering && (recentCases === null ? recentIds.length > 0 : recentCases.length > 0);
  const nothingAtAll = loaded && !filtering && total === 0 && !showRecent;
  // Every case is in the recent row: no second, empty list under it.
  const showRest = !loaded || filtering || total > 0 || !showRecent;

  return (
    <div className="space-y-6">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("cases.search")}
            className="h-9 rounded-[4px] border-2 border-border pl-9"
          />
        </div>

        <MultiSelect values={statuses} onValuesChange={setStatuses}>
          <MultiSelectTrigger className="h-9 w-[180px] rounded-[4px] border-2 border-border">
            <MultiSelectValue placeholder={t("common.status")} />
          </MultiSelectTrigger>
          <MultiSelectContent search={{ placeholder: "Search statuses…", emptyMessage: "No statuses found" }}>
            <MultiSelectGroup>
              {STATUS_OPTIONS.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {t(`cases.statusLabels.${status}` as TranslationKey)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect values={severities} onValuesChange={setSeverities}>
          <MultiSelectTrigger className="h-9 w-[180px] rounded-[4px] border-2 border-border">
            <MultiSelectValue placeholder={t("common.severity")} />
          </MultiSelectTrigger>
          <MultiSelectContent search={{ placeholder: "Search severities…", emptyMessage: "No severities found" }}>
            <MultiSelectGroup>
              {SEVERITY_OPTIONS.map((severity) => (
                <MultiSelectItem key={severity} value={severity}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[2px] border border-border/20"
                      style={{ backgroundColor: FINDING_SEVERITY_COLOR_BY_ENUM[severity] }}
                    />
                    {t(`cases.severityLabels.${severity}` as TranslationKey)}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {isUpdating && loaded && (
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

      {nothingAtAll ? (
        <EmptyState icon={Filter} title={t("cases.noInvestigations")} description={t("cases.grid.emptyHint")} />
      ) : (
        <>
          {showRecent && (
            <section aria-labelledby={`${headingId}-recent`} className="space-y-3">
              <SectionHeading id={`${headingId}-recent`} icon={History} title={t("common.recentlyOpened")} />
              <div className="@container">
                <div className={GRID}>
                  {recentCases === null
                    ? recentIds.map((id) => <CaseCardSkeleton key={id} />)
                    : recentCases.map((c) => <CaseCard key={c.id} item={c} openedAt={openedAt.get(c.id)} />)}
                </div>
              </div>
            </section>
          )}

          {showRest && (
          <section aria-labelledby={`${headingId}-all`} className={showRecent ? "space-y-3 pt-4" : "space-y-3"}>
            <SectionHeading
              id={`${headingId}-all`}
              title={filtering ? t("cases.grid.results") : showRecent ? t("cases.grid.rest") : t("cases.grid.all")}
              count={loaded ? total : undefined}
            />
            <div className="@container relative min-h-[240px]">
              {!loaded ? (
                <div className={GRID}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <CaseCardSkeleton key={i} />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={Filter}
                  title={t("cases.noInvestigations")}
                  description={t("cases.noInvestigationsHint")}
                />
              ) : (
                <div className={GRID} aria-busy={isUpdating}>
                  {items.map((c) => (
                    <CaseCard key={c.id} item={c} openedAt={openedAt.get(c.id)} />
                  ))}
                </div>
              )}
              {isUpdating && loaded && items.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-background/45 backdrop-blur-[1px]" />
              )}
            </div>
          </section>
          )}
        </>
      )}

      {/* ── Footer: page size + pagination ── */}
      {loaded && total > 0 && (
        <div className="flex flex-col gap-3 border-t-2 border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("cases.grid.perPage")}</span>
            <Select value={pageSize} onValueChange={setPageSize}>
              <SelectTrigger className="h-8 w-[90px] rounded-[4px] border-2 border-border">
                <SelectValue placeholder={t("cases.grid.perPage")} />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("cases.grid.range", {
                from: ((clampedPage - 1) * resolvedPageSize + 1).toLocaleString(),
                to: Math.min(clampedPage * resolvedPageSize, total).toLocaleString(),
                total: total.toLocaleString(),
              })}
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
                      if (clampedPage > 1) setPage(clampedPage - 1);
                    }}
                    className={clampedPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                  />
                </PaginationItem>
                {pageItems.map((pageNumber, index) => {
                  const prev = pageItems[index - 1];
                  const gap = prev !== undefined && pageNumber - prev > 1;
                  return (
                    <React.Fragment key={pageNumber}>
                      {gap && (
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
                    </React.Fragment>
                  );
                })}
                <PaginationItem>
                  <PaginationNext
                    label={t("common.pagination.next")}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (clampedPage < totalPages) setPage(clampedPage + 1);
                    }}
                    className={clampedPage >= totalPages ? "pointer-events-none opacity-50" : undefined}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
