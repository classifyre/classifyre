"use client";

import { nsPath } from "@/lib/ns-path";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative } from "@/lib/date";
import { Filter, Loader2, Search } from "lucide-react";
import {
  api,
  RunnerAssetStatusEnum,
  type RunnerAssetItemDto,
  type SearchRunnerAssetsResponseDto,
  type SearchRunnerAssetsSortBy,
  type SearchRunnerAssetsSortOrder,
  SearchRunnerAssetsSortByEnum,
  SearchRunnerAssetsSortOrderEnum,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Button,
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
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components";
import { AssetKindBadge } from "./asset-kind-badge";
import { CsvExportButton, filtersToSearchParams } from "./csv-export-button";
import { useTranslation } from "../hooks/use-translation";
import type { TranslationKey } from "../i18n";

type RunnerAssetStatusValue =
  (typeof RunnerAssetStatusEnum)[keyof typeof RunnerAssetStatusEnum];

type FilterDraft = {
  search: string;
  statuses: RunnerAssetStatusValue[];
};

type SortDraft = {
  by: SearchRunnerAssetsSortBy;
  order: SearchRunnerAssetsSortOrder;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const DEFAULT_SORT: SortDraft = {
  by: SearchRunnerAssetsSortByEnum.StatusPriority,
  order: SearchRunnerAssetsSortOrderEnum.Asc,
};

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  statuses: [],
};

const STATUS_COLORS: Record<RunnerAssetStatusValue, string> = {
  PENDING: "var(--muted-foreground)",
  PROCESSING: "var(--chart-4)",
  PROCESSED: "var(--accent)",
  ERROR: "var(--destructive)",
};

const SEVERITY_DISPLAY_ORDER = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
] as const;

const RUNNER_ASSET_STATUS_LABELS: Record<string, TranslationKey> = {
  PENDING: "scans.runnerAssets.status.pending",
  PROCESSING: "scans.runnerAssets.status.processing",
  PROCESSED: "scans.runnerAssets.status.processed",
  ERROR: "scans.runnerAssets.status.error",
};

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function severityColor(severity: string) {
  const key =
    severity.toUpperCase() as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM;
  return (
    FINDING_SEVERITY_COLOR_BY_ENUM[key] ?? FINDING_SEVERITY_COLOR_BY_ENUM.INFO
  );
}

function getHighestSeverityFromMap(
  bySeverity: Record<string, number> | null | undefined,
): string | null {
  if (!bySeverity || typeof bySeverity !== "object") return null;
  for (const sev of SEVERITY_DISPLAY_ORDER) {
    const count = bySeverity[sev] ?? bySeverity[sev.toLowerCase()];
    if (typeof count === "number" && count > 0) return sev;
  }
  return null;
}

function SeverityBreakdown({
  bySeverity,
}: {
  bySeverity: Record<string, number> | null | undefined;
}) {
  if (!bySeverity || typeof bySeverity !== "object") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const entries = SEVERITY_DISPLAY_ORDER.flatMap((sev) => {
    const count = bySeverity[sev] ?? bySeverity[sev.toLowerCase()];
    if (typeof count !== "number" || count <= 0) return [];
    return [{ sev, count }];
  });

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(({ sev, count }) => (
        <span
          key={sev}
          className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.06em]"
          style={{
            color: severityColor(sev),
            borderColor: `${severityColor(sev)}55`,
            backgroundColor: `${severityColor(sev)}10`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: severityColor(sev) }}
          />
          {count} {sev.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

function DetectorBreakdown({
  byDetector,
  t,
}: {
  byDetector: Record<string, Record<string, number>> | null | undefined;
  t: (key: TranslationKey) => string;
}) {
  if (!byDetector || typeof byDetector !== "object") return null;

  const detectors = Object.entries(byDetector).filter(
    ([, counts]) => counts && typeof counts === "object",
  );
  if (detectors.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
        {t("scans.runnerAssets.columns.byDetector")}
      </span>
      {detectors.map(([detector, counts]) => {
        const total =
          typeof counts["total"] === "number"
            ? counts["total"]
            : Object.values(counts).reduce<number>(
                (sum, v) => sum + (typeof v === "number" ? v : 0),
                0,
              );
        const severityChips = SEVERITY_DISPLAY_ORDER.flatMap((sev) => {
          const count = counts[sev] ?? counts[sev.toLowerCase()];
          if (typeof count !== "number" || count <= 0) return [];
          return [{ sev, count }];
        });
        return (
          <span
            key={detector}
            className="inline-flex items-center gap-1.5 rounded-[3px] border border-border/60 bg-background px-2 py-0.5 text-[11px]"
          >
            <span className="font-mono font-medium">{detector}</span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums text-muted-foreground">{total}</span>
            {severityChips.map(({ sev, count }) => (
              <span
                key={sev}
                className="tabular-nums text-[10px]"
                style={{ color: severityColor(sev) }}
              >
                {count} {sev.toLowerCase().slice(0, 3)}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

const POLL_INTERVAL_MS = 4000;

export function RunnerAssetsTable({
  runnerId,
  runnerStatus,
}: {
  runnerId: string;
  runnerStatus?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [draft, setDraft] = useState<FilterDraft>(DEFAULT_DRAFT);
  const [sort, setSort] = useState<SortDraft>(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState("20");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SearchRunnerAssetsResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedPageSize = Number(pageSize);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput };
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const prevFilterRef = useRef({ draft, sort, pageSize });
  useEffect(() => {
    const prev = prevFilterRef.current;
    if (
      prev.draft !== draft ||
      prev.sort !== sort ||
      prev.pageSize !== pageSize
    ) {
      setPage(1);
      prevFilterRef.current = { draft, sort, pageSize };
    }
  }, [draft, sort, pageSize]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await api.searchRunnerAssets({
          filters: {
            runnerId,
            status: draft.statuses.length > 0 ? draft.statuses : undefined,
            search: draft.search.trim() || undefined,
          },
          page: {
            skip: (page - 1) * resolvedPageSize,
            limit: resolvedPageSize,
            sortBy: sort.by,
            sortOrder: sort.order,
          },
        });

        if (!active) return;
        setData(response);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load runner assets",
        );
        setData({ items: [], total: 0, skip: 0, limit: resolvedPageSize });
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void run();

    const isActive =
      runnerStatus === "RUNNING" || runnerStatus === "PENDING";
    const interval = isActive
      ? setInterval(() => void run(), POLL_INTERVAL_MS)
      : undefined;

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [runnerId, runnerStatus, draft, sort, page, resolvedPageSize]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasRows = items.length > 0;
  const showInitialLoading = isLoading && data === null;
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

  const statusOptions = Object.values(
    RunnerAssetStatusEnum,
  ) as RunnerAssetStatusValue[];

  return (
    <TooltipProvider>
      <div className="space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("scans.runnerAssets.searchPlaceholder")}
              className="h-9 pl-9 border-2 border-border rounded-[4px]"
            />
          </div>

          <MultiSelect
            values={draft.statuses}
            onValuesChange={(values) =>
              setDraft((prev) => ({
                ...prev,
                statuses: values as RunnerAssetStatusValue[],
              }))
            }
          >
            <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
              <MultiSelectValue
                placeholder={t("scans.runnerAssets.processingStatus")}
              />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("scans.runnerAssets.searchStatus"),
                emptyMessage: t("scans.runnerAssets.noStatusesFound"),
              }}
            >
              <MultiSelectGroup>
                {statusOptions.map((status) => (
                  <MultiSelectItem key={status} value={status}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[status] }}
                      />
                      {RUNNER_ASSET_STATUS_LABELS[status]
                        ? t(RUNNER_ASSET_STATUS_LABELS[status]!)
                        : formatEnumLabel(status)}
                    </span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <div className="ml-auto">
            <CsvExportButton
              exportPath="search/runner-assets/export"
              total={total}
              entityLabel="assets"
              buildQuery={() =>
                filtersToSearchParams({
                  runnerId,
                  search: draft.search.trim() || undefined,
                  status: draft.statuses.length > 0 ? draft.statuses : undefined,
                })
              }
            />
          </div>
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
              <span className="ml-2 text-sm">
                {t("scans.runnerAssets.loading")}
              </span>
            </div>
          ) : !hasRows ? (
            <EmptyState
              icon={Filter}
              title={t("scans.runnerAssets.noAssets")}
              description={t("scans.runnerAssets.noAssetsHint")}
            />
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
    <TableRow>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("scans.runnerAssets.columns.asset")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("scans.runnerAssets.columns.type")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("scans.runnerAssets.columns.processingStatus")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground text-right">
                      {t("scans.runnerAssets.columns.findingsTotal")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("scans.runnerAssets.columns.findings")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("scans.runnerAssets.columns.completed")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <RunnerAssetRow
                      key={`${item.runnerId}-${item.assetHash}`}
                      item={item}
                      onAssetClick={(id) => router.push(nsPath(`/assets/${id}`))}
                      t={t}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {isLoading && hasRows && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("scans.runnerAssets.updating")}
              </div>
            </div>
          )}
        </div>

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
                    {size} rows
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
                  const previous = pageItems[index - 1];
                  const showEllipsis = previous && pageNumber - previous > 1;
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
    </TooltipProvider>
  );
}

function RunnerAssetRow({
  item,
  onAssetClick,
  t,
}: {
  item: RunnerAssetItemDto;
  onAssetClick: (assetId: string) => void;
  t: (key: TranslationKey) => string;
}) {
  const highestSeverity = getHighestSeverityFromMap(item.findingsBySeverity);
  const totalFindings =
    typeof item.findingsTotal === "number" ? item.findingsTotal : null;

  return (
    <TableRow data-testid="asset-row">
      <TableCell className="max-w-[280px]">
        {item.asset ? (
          <div className="min-w-0">
            <Button
              variant="link"
              size="sm"
              className="h-auto max-w-[260px] justify-start p-0 text-left"
              onClick={() => onAssetClick(item.asset!.id)}
            >
              <span className="truncate text-sm font-medium inline-block max-w-[260px]">
                {item.asset.name || item.asset.externalUrl || item.assetHash}
              </span>
            </Button>
            {item.asset.externalUrl && (
              <p className="truncate text-xs text-muted-foreground max-w-[260px]">
                {item.asset.externalUrl}
              </p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {t("scans.runnerAssets.assetPending")}
          </span>
        )}
      </TableCell>

      <TableCell>
        <AssetKindBadge kind={item.asset?.assetType} />
      </TableCell>

      <TableCell>
        <span
          className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[11px] font-mono uppercase tracking-[0.08em]"
          style={{
            color: STATUS_COLORS[item.status as keyof typeof STATUS_COLORS],
            borderColor: `${STATUS_COLORS[item.status as keyof typeof STATUS_COLORS]}55`,
            backgroundColor: `${STATUS_COLORS[item.status as keyof typeof STATUS_COLORS]}14`,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                STATUS_COLORS[item.status as keyof typeof STATUS_COLORS],
            }}
          />
          {RUNNER_ASSET_STATUS_LABELS[item.status]
            ? t(RUNNER_ASSET_STATUS_LABELS[item.status]!)
            : formatEnumLabel(item.status)}
        </span>
        {item.errorMessage && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mt-1 cursor-help text-[10px] text-destructive truncate max-w-[200px]">
                {item.errorMessage}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[360px] break-words text-xs"
            >
              <p className="font-medium mb-1">
                {t("scans.runnerAssets.errorDetails")}
              </p>
              {item.errorMessage}
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>

      <TableCell className="text-right">
        {totalFindings !== null ? (
          <span
            className="text-sm font-medium tabular-nums"
            style={
              totalFindings > 0
                ? {
                    color: highestSeverity
                      ? severityColor(highestSeverity)
                      : undefined,
                  }
                : { color: "var(--muted-foreground)" }
            }
          >
            {totalFindings}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="min-w-[160px]">
        <SeverityBreakdown bySeverity={item.findingsBySeverity} />
        <DetectorBreakdown byDetector={item.findingsByDetector} t={t} />
      </TableCell>

      <TableCell>
        {item.completedAt ? (
          <>
            <div className="text-xs">{formatDate(item.completedAt)}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatRelative(item.completedAt)}
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
