"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import {
  api,
  RunnerAssetStatusEnum,
  SearchFindingsFiltersInputDtoSeverityEnum,
  SearchFindingsFiltersInputDtoStatusEnum,
  SearchFindingsFiltersInputDtoDetectorTypeEnum,
  type RunnerAssetItemDto,
  type SearchRunnerAssetsResponseDto,
  type SearchRunnerAssetsSortBy,
  type SearchRunnerAssetsSortOrder,
  SearchRunnerAssetsSortByEnum,
  SearchRunnerAssetsSortOrderEnum,
  SearchAssetFindingDtoStatusEnum,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Badge,
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
  StatusBadge,
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
import { getAssetTypeIcon } from "../lib/asset-type-icon";
import { useTranslation } from "../hooks/use-translation";
import type { TranslationKey } from "../i18n";
import type { SearchAssetFindingDto } from "@workspace/api-client";

type RunnerAssetStatusValue =
  (typeof RunnerAssetStatusEnum)[keyof typeof RunnerAssetStatusEnum];

type FilterDraft = {
  search: string;
  statuses: RunnerAssetStatusValue[];
  findingSeverities: SearchFindingsFiltersInputDtoSeverityEnum[];
  findingStatuses: SearchFindingsFiltersInputDtoStatusEnum[];
  findingDetectorTypes: SearchFindingsFiltersInputDtoDetectorTypeEnum[];
};

type SortDraft = {
  by: SearchRunnerAssetsSortBy;
  order: SearchRunnerAssetsSortOrder;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const DEFAULT_SORT: SortDraft = {
  by: SearchRunnerAssetsSortByEnum.CreatedAt,
  order: SearchRunnerAssetsSortOrderEnum.Asc,
};

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  statuses: [],
  findingSeverities: [],
  findingStatuses: [],
  findingDetectorTypes: [],
};

const STATUS_COLORS: Record<RunnerAssetStatusValue, string> = {
  PENDING: "var(--muted-foreground)",
  PROCESSING: "var(--chart-4)",
  PROCESSED: "var(--accent)",
  ERROR: "var(--destructive)",
};

const FINDING_STATUS_LABELS: Record<SearchAssetFindingDtoStatusEnum, string> =
  {
    [SearchAssetFindingDtoStatusEnum.Open]: "Open",
    [SearchAssetFindingDtoStatusEnum.FalsePositive]: "False Positive",
    [SearchAssetFindingDtoStatusEnum.Resolved]: "Resolved",
    [SearchAssetFindingDtoStatusEnum.Ignored]: "Ignored",
  };

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
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

function toStatusBadgeValue(status: string) {
  switch (status.toUpperCase()) {
    case "FALSE_POSITIVE":
      return "false_positive" as const;
    case "RESOLVED":
      return "resolved" as const;
    case "IGNORED":
      return "ignored" as const;
    default:
      return "open" as const;
  }
}

const SEVERITY_DISPLAY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

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

  // Normalise keys to uppercase and filter zero/non-number counts
  const entries = SEVERITY_DISPLAY_ORDER.flatMap((sev) => {
    const count =
      (bySeverity[sev] ?? bySeverity[sev.toLowerCase()]);
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
    <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2 bg-muted/10">
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

function FindingsSubTable({
  findings,
  onFindingClick,
  t,
}: {
  findings: SearchAssetFindingDto[];
  onFindingClick: (findingId: string) => void;
  t: (key: TranslationKey) => string;
}) {
  if (findings.length === 0) {
    return (
      <div className="py-4 text-center text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t("assets.subTable.noFindings")}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("assets.subTable.detector")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("assets.subTable.type")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("common.category")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("common.severity")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("common.status")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("assets.subTable.detected")}
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            {t("assets.subTable.matchedContent")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {findings.map((finding) => (
          <TableRow
            key={finding.id}
            tabIndex={0}
            className="group cursor-pointer"
            onClick={() => onFindingClick(finding.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFindingClick(finding.id);
              }
            }}
          >
            <TableCell className="font-mono text-[11px]">
              <span className="group-hover:underline group-focus-visible:underline">
                {formatEnumLabel(finding.detectorType)}
              </span>
            </TableCell>
            <TableCell className="font-mono text-[11px]">
              <span className="group-hover:underline group-focus-visible:underline">
                {finding.findingType}
              </span>
            </TableCell>
            <TableCell className="font-mono text-[11px]">
              <span className="group-hover:underline group-focus-visible:underline">
                {finding.category}
              </span>
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className="gap-1.5 border px-2 py-0.5 text-[11px] uppercase tracking-[0.04em]"
                style={{
                  color: severityColor(finding.severity),
                  borderColor: `${severityColor(finding.severity)}55`,
                  backgroundColor: `${severityColor(finding.severity)}14`,
                }}
              >
                <span
                  className="h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: severityColor(finding.severity) }}
                />
                {formatEnumLabel(finding.severity)}
              </Badge>
            </TableCell>
            <TableCell>
              <StatusBadge status={toStatusBadgeValue(finding.status)}>
                {FINDING_STATUS_LABELS[
                  finding.status as SearchAssetFindingDtoStatusEnum
                ] ?? finding.status}
              </StatusBadge>
            </TableCell>
            <TableCell>
              <div className="text-xs">{formatDate(finding.detectedAt)}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatRelative(finding.detectedAt)}
                {formatShortUTC(finding.detectedAt) && (
                  <span className="text-muted-foreground/50">
                    {" "}
                    · {formatShortUTC(finding.detectedAt)}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="max-w-[380px]">
              <code className="line-clamp-2 break-all text-[11px] text-muted-foreground group-hover:underline group-focus-visible:underline">
                {finding.matchedContent || "-"}
              </code>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RunnerAssetsTable({ runnerId }: { runnerId: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [draft, setDraft] = useState<FilterDraft>(DEFAULT_DRAFT);
  const [sort, setSort] = useState<SortDraft>(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState("20");
  const [page, setPage] = useState(1);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

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
            findingSeverity:
              draft.findingSeverities.length > 0
                ? draft.findingSeverities
                : undefined,
            findingStatus:
              draft.findingStatuses.length > 0
                ? draft.findingStatuses
                : undefined,
            findingDetectorType:
              draft.findingDetectorTypes.length > 0
                ? draft.findingDetectorTypes
                : undefined,
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
    return () => {
      active = false;
    };
  }, [runnerId, draft, sort, page, resolvedPageSize]);

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
  const severityOptions = Object.values(
    SearchFindingsFiltersInputDtoSeverityEnum,
  );
  const findingStatusOptions = Object.values(
    SearchFindingsFiltersInputDtoStatusEnum,
  );
  const detectorTypeOptions = Object.values(
    SearchFindingsFiltersInputDtoDetectorTypeEnum,
  );

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
                      {formatEnumLabel(status)}
                    </span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <MultiSelect
            values={draft.findingSeverities}
            onValuesChange={(values) =>
              setDraft((prev) => ({
                ...prev,
                findingSeverities:
                  values as SearchFindingsFiltersInputDtoSeverityEnum[],
              }))
            }
          >
            <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
              <MultiSelectValue
                placeholder={t("scans.runnerAssets.findingSeverity")}
              />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("scans.runnerAssets.searchSeverity"),
                emptyMessage: t("scans.runnerAssets.noSeveritiesFound"),
              }}
            >
              <MultiSelectGroup>
                {severityOptions.map((sev) => (
                  <MultiSelectItem key={sev} value={sev}>
                    <span
                      className="inline-flex items-center gap-2"
                      style={{ color: severityColor(sev) }}
                    >
                      {formatEnumLabel(sev)}
                    </span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <MultiSelect
            values={draft.findingStatuses}
            onValuesChange={(values) =>
              setDraft((prev) => ({
                ...prev,
                findingStatuses:
                  values as SearchFindingsFiltersInputDtoStatusEnum[],
              }))
            }
          >
            <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
              <MultiSelectValue
                placeholder={t("scans.runnerAssets.findingStatus")}
              />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("scans.runnerAssets.searchFindingStatus"),
                emptyMessage: t("scans.runnerAssets.noFindingStatusesFound"),
              }}
            >
              <MultiSelectGroup>
                {findingStatusOptions.map((status) => (
                  <MultiSelectItem key={status} value={status}>
                    {formatEnumLabel(status)}
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <MultiSelect
            values={draft.findingDetectorTypes}
            onValuesChange={(values) =>
              setDraft((prev) => ({
                ...prev,
                findingDetectorTypes:
                  values as SearchFindingsFiltersInputDtoDetectorTypeEnum[],
              }))
            }
          >
            <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
              <MultiSelectValue
                placeholder={t("scans.runnerAssets.findingDetectorType")}
              />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("scans.runnerAssets.searchDetectorType"),
                emptyMessage: t("scans.runnerAssets.noDetectorTypesFound"),
              }}
            >
              <MultiSelectGroup>
                {detectorTypeOptions.map((dt) => (
                  <MultiSelectItem key={dt} value={dt}>
                    {formatEnumLabel(dt)}
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
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
                    <TableHead className="w-8 bg-white/95 dark:bg-card/95" />
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
                      isExpanded={expandedHash === item.assetHash}
                      onToggle={() =>
                        setExpandedHash((prev) =>
                          prev === item.assetHash ? null : item.assetHash,
                        )
                      }
                      onAssetClick={(id) => router.push(`/assets/${id}`)}
                      onFindingClick={(id) => router.push(`/findings/${id}`)}
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
                <SelectValue placeholder="Rows" />
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
                          <PaginationEllipsis />
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
  isExpanded,
  onToggle,
  onAssetClick,
  onFindingClick,
  t,
}: {
  item: RunnerAssetItemDto;
  isExpanded: boolean;
  onToggle: () => void;
  onAssetClick: (assetId: string) => void;
  onFindingClick: (findingId: string) => void;
  t: (key: TranslationKey) => string;
}) {
  const highestSeverity = getHighestSeverityFromMap(item.findingsBySeverity);
  const totalFindings = typeof item.findingsTotal === "number" ? item.findingsTotal : null;
  const AssetIcon = item.asset ? getAssetTypeIcon(item.asset.assetType) : null;

  return (
    <Fragment>
      <TableRow>
        <TableCell className="py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onToggle}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </Button>
        </TableCell>

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
          {item.asset && AssetIcon ? (
            <Badge variant="outline" className="gap-1.5">
              <AssetIcon className="h-3 w-3 text-muted-foreground" />
              {formatEnumLabel(item.asset.assetType)}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
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
            {formatEnumLabel(item.status)}
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

        {/* Total findings count */}
        <TableCell className="text-right">
          {totalFindings !== null ? (
            <span
              className="text-sm font-medium tabular-nums"
              style={
                totalFindings > 0
                  ? { color: highestSeverity ? severityColor(highestSeverity) : undefined }
                  : { color: "var(--muted-foreground)" }
              }
            >
              {totalFindings}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Severity breakdown from findingsBySeverity JSONB */}
        <TableCell className="min-w-[160px]">
          <SeverityBreakdown bySeverity={item.findingsBySeverity} />
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

      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="p-0 bg-muted/15">
            <DetectorBreakdown
              byDetector={item.findingsByDetector}
              t={t}
            />
            <FindingsSubTable
              findings={item.findings}
              onFindingClick={onFindingClick}
              t={t}
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
