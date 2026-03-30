"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import {
  api,
  AssetListItemDtoStatusEnum,
  SearchAssetsFiltersDtoStatusEnum,
  SearchAssetFindingDtoDetectorTypeEnum,
  SearchAssetFindingDtoStatusEnum,
  SearchFindingsFiltersDtoDetectorTypeEnum,
  SearchFindingsFiltersDtoSeverityEnum,
  SearchAssetsSortByEnum,
  SearchAssetsSortOrderEnum,
  type SearchAssetFindingDto,
  type SearchAssetsRequestInputDto,
  type SearchAssetsResponseDto,
  type SearchAssetsSortBy,
  type SearchAssetsSortOrder,
  type SourceListItem,
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
  SeverityBadge,
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
  TooltipTrigger,
} from "@workspace/ui/components";
import { getSourceIcon } from "../lib/source-type-icon";
import { getAssetTypeIcon } from "../lib/asset-type-icon";
import { useUrlParams } from "../lib/url-filters";
import {
  DetectorSummaryBadges,
  TopFindingsBadges,
} from "./finding-summary-badges";

type AssetsTableScope = {
  sourceId?: string;
  runnerId?: string;
};

type AssetStatusFilterValue =
  (typeof SearchAssetsFiltersDtoStatusEnum)[keyof typeof SearchAssetsFiltersDtoStatusEnum];

type AssetsTableProps = {
  scope?: AssetsTableScope;
  initialPageSize?: number;
  assetStatuses?: AssetStatusFilterValue[];
  onAssetStatusesChange?: (values: AssetStatusFilterValue[]) => void;
};

type FilterDraft = {
  search: string;
  sourceId: string;
  detectorTypes: Array<
    (typeof SearchFindingsFiltersDtoDetectorTypeEnum)[keyof typeof SearchFindingsFiltersDtoDetectorTypeEnum]
  >;
  findingSeverities: Array<
    (typeof SearchFindingsFiltersDtoSeverityEnum)[keyof typeof SearchFindingsFiltersDtoSeverityEnum]
  >;
};

type SortDraft = {
  by: SearchAssetsSortBy;
  order: SearchAssetsSortOrder;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const ALL = "ALL";
const DEFAULT_SORT: SortDraft = {
  by: SearchAssetsSortByEnum.LastScannedAt,
  order: SearchAssetsSortOrderEnum.Desc,
};

const STATUS_LABELS: Record<SearchAssetFindingDtoStatusEnum, string> = {
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

function computeDetectorCounts(findings: SearchAssetFindingDto[]) {
  const counts = new Map<SearchAssetFindingDtoDetectorTypeEnum, number>();
  for (const f of findings) {
    counts.set(f.detectorType, (counts.get(f.detectorType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([detector, count]) => ({ detector, count }))
    .sort((a, b) => b.count - a.count);
}

function computeTopFindingTypes(findings: SearchAssetFindingDto[]) {
  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.findingType, (counts.get(f.findingType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
}

function computeStatusCounts(findings: SearchAssetFindingDto[]) {
  const counts = new Map<SearchAssetFindingDtoStatusEnum, number>();
  for (const f of findings) {
    counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function getHighestSeverity(findings: SearchAssetFindingDto[]): string | null {
  const firstFinding = findings[0];
  if (!firstFinding) return null;
  return findings.reduce((highest, f) => {
    const currentOrder = SEVERITY_ORDER[f.severity.toUpperCase()] ?? 0;
    const highestOrder = SEVERITY_ORDER[highest.toUpperCase()] ?? 0;
    return currentOrder > highestOrder ? f.severity : highest;
  }, firstFinding.severity);
}

const statusVariant: Record<
  AssetListItemDtoStatusEnum,
  "default" | "secondary" | "outline" | "destructive"
> = {
  NEW: "default",
  UPDATED: "secondary",
  UNCHANGED: "outline",
  DELETED: "destructive",
};

const EMPTY_ASSET_STATUSES: AssetStatusFilterValue[] = [];

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  sourceId: ALL,
  detectorTypes: [],
  findingSeverities: [],
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

function getPageItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);

  return Array.from(pages).sort((a, b) => a - b);
}

function buildRequest({
  draft,
  sort,
  skip,
  limit,
  scope,
  assetStatuses,
}: {
  draft: FilterDraft;
  sort: SortDraft;
  skip: number;
  limit: number;
  scope?: AssetsTableScope;
  assetStatuses: AssetStatusFilterValue[];
}): SearchAssetsRequestInputDto {
  const assetsFilters: NonNullable<SearchAssetsRequestInputDto["assets"]> = {
    search: draft.search.trim() || undefined,
    sourceId:
      scope?.sourceId || (draft.sourceId !== ALL ? draft.sourceId : undefined),
    runnerId: scope?.runnerId,
    status: assetStatuses.length > 0 ? assetStatuses : undefined,
  };

  const findingsFilters: NonNullable<SearchAssetsRequestInputDto["findings"]> =
    {
      detectorType:
        draft.detectorTypes.length > 0 ? draft.detectorTypes : undefined,
      severity:
        draft.findingSeverities.length > 0
          ? draft.findingSeverities
          : undefined,
      // Show all findings including resolved — users can filter by status explicitly
      includeResolved: true,
    };

  const hasActiveFindingFilters = Boolean(
    findingsFilters.detectorType?.length || findingsFilters.severity?.length,
  );

  return {
    assets: assetsFilters,
    findings: findingsFilters,
    page: {
      skip,
      limit,
      sortBy: sort.by,
      sortOrder: sort.order,
    },
    options: {
      excludeFindings: false,
      includeAssetsWithoutFindings: !hasActiveFindingFilters,
    },
  };
}

function getSortIcon({
  active,
  order,
}: {
  active: boolean;
  order: SearchAssetsSortOrder;
}) {
  if (!active) {
    return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  if (order === SearchAssetsSortOrderEnum.Asc) {
    return <ArrowUp className="h-3.5 w-3.5" />;
  }

  return <ArrowDown className="h-3.5 w-3.5" />;
}

function nextSort(current: SortDraft, field: SearchAssetsSortBy): SortDraft {
  if (current.by === field) {
    return {
      by: field,
      order:
        current.order === SearchAssetsSortOrderEnum.Asc
          ? SearchAssetsSortOrderEnum.Desc
          : SearchAssetsSortOrderEnum.Asc,
    };
  }

  const defaultOrder =
    field === SearchAssetsSortByEnum.LastScannedAt ||
    field === SearchAssetsSortByEnum.UpdatedAt ||
    field === SearchAssetsSortByEnum.CreatedAt
      ? SearchAssetsSortOrderEnum.Desc
      : SearchAssetsSortOrderEnum.Asc;

  return {
    by: field,
    order: defaultOrder,
  };
}

function FindingsSubTable({
  findings,
  onFindingClick,
}: {
  findings: SearchAssetFindingDto[];
  onFindingClick: (findingId: string) => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="py-4 text-center text-xs uppercase tracking-[0.14em] text-muted-foreground">
        No findings returned for this asset
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Detector
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Type
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Category
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Severity
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Status
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Detected
          </TableHead>
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            Matched Content
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
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
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
              <StatusBadge status={toStatusBadgeValue(finding.status)} />
            </TableCell>
            <TableCell>
              <div className="text-xs group-hover:underline group-focus-visible:underline">
                {formatDate(finding.detectedAt)}
              </div>
              <div className="text-[11px] text-muted-foreground group-hover:underline group-focus-visible:underline">
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

export function AssetsTable({
  scope,
  initialPageSize = 20,
  assetStatuses = EMPTY_ASSET_STATUSES,
  onAssetStatusesChange,
}: AssetsTableProps) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlParams();

  const [draft, setDraft] = useState<FilterDraft>(() => ({
    search: searchParams.get("q") ?? DEFAULT_DRAFT.search,
    sourceId: searchParams.get("source") ?? DEFAULT_DRAFT.sourceId,
    detectorTypes: searchParams.getAll(
      "detector",
    ) as FilterDraft["detectorTypes"],
    findingSeverities: searchParams.getAll(
      "findingSeverity",
    ) as FilterDraft["findingSeverities"],
  }));
  const [sort, setSort] = useState<SortDraft>(() => {
    const by = searchParams.get("sortBy") as SearchAssetsSortBy | null;
    const order = searchParams.get("sortOrder") as SearchAssetsSortOrder | null;
    return {
      by:
        by && (Object.values(SearchAssetsSortByEnum) as string[]).includes(by)
          ? by
          : DEFAULT_SORT.by,
      order:
        order &&
        (Object.values(SearchAssetsSortOrderEnum) as string[]).includes(order)
          ? order
          : DEFAULT_SORT.order,
    };
  });
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") ?? DEFAULT_DRAFT.search,
  );
  const [pageSize, setPageSize] = useState(String(initialPageSize));
  const [page, setPage] = useState(1);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);

  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [data, setData] = useState<SearchAssetsResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedPageSize = Number(pageSize);

  const sourceIndex = useMemo(() => {
    return new Map(
      sources
        .filter(
          (source): source is SourceListItem & { id: string } =>
            typeof source.id === "string" && source.id.length > 0,
        )
        .map((source) => [source.id, source.name || source.id]),
    );
  }, [sources]);

  const scopedSourceId = scope?.sourceId;
  const scopedRunnerId = scope?.runnerId;
  const sortBy = sort.by;
  const sortOrder = sort.order;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft((previous) => {
        if (previous.search === searchInput) {
          return previous;
        }
        return {
          ...previous,
          search: searchInput,
        };
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Sync draft + sort to URL ───────────────────────────────────────────────

  const urlSynced = useRef(false);
  useEffect(() => {
    if (!urlSynced.current) {
      urlSynced.current = true;
      return;
    }
    setParams({
      q: draft.search || null,
      source: draft.sourceId !== ALL ? draft.sourceId : null,
      detector: draft.detectorTypes.length > 0 ? draft.detectorTypes : null,
      findingSeverity:
        draft.findingSeverities.length > 0 ? draft.findingSeverities : null,
      sortBy: sort.by !== DEFAULT_SORT.by ? sort.by : null,
      sortOrder: sort.order !== DEFAULT_SORT.order ? sort.order : null,
    });
  }, [draft, sort, setParams]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        setIsFilterLoading(true);
        const list = await api.sources.sourcesControllerListSources();
        if (!active) return;
        setSources((list ?? []) as unknown as SourceListItem[]);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load sources:", loadError);
        setSources([]);
      } finally {
        if (active) {
          setIsFilterLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [draft, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const skip = (page - 1) * resolvedPageSize;
        const request = buildRequest({
          draft,
          sort: {
            by: sortBy,
            order: sortOrder,
          },
          skip,
          limit: resolvedPageSize,
          scope: {
            sourceId: scopedSourceId,
            runnerId: scopedRunnerId,
          },
          assetStatuses,
        });

        const response = await api.searchAssets(request);

        if (!active) return;
        setData(response);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load assets:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load assets",
        );
        setData({
          items: [],
          total: 0,
          skip: 0,
          limit: resolvedPageSize,
        });
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [
    draft,
    page,
    resolvedPageSize,
    scopedRunnerId,
    scopedSourceId,
    assetStatuses,
    sortBy,
    sortOrder,
  ]);

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

  const sourceOptions = useMemo(() => {
    return sources
      .filter(
        (source): source is SourceListItem & { id: string } =>
          typeof source.id === "string" && source.id.length > 0,
      )
      .map((source) => ({
        id: source.id,
        name: source.name || source.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources]);

  const detectorOptions = useMemo(
    () => Object.values(SearchFindingsFiltersDtoDetectorTypeEnum),
    [],
  );

  const findingSeverityOptions = useMemo(
    () => Object.values(SearchFindingsFiltersDtoSeverityEnum),
    [],
  );

  const assetStatusOptions = useMemo(
    () => Object.values(SearchAssetsFiltersDtoStatusEnum),
    [],
  );
  const canExpandFindings = true;
  const renderSortableHead = (label: string, field: SearchAssetsSortBy) => {
    const active = sort.by === field;

    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-1.5 font-medium"
        onClick={() => setSort((current) => nextSort(current, field))}
      >
        <span>{label}</span>
        {getSortIcon({
          active,
          order: sort.order,
        })}
      </Button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search assets"
            className="h-9 pl-9 border-2 border-black rounded-[4px]"
          />
        </div>

        {!scopedSourceId && (
          <Select
            value={draft.sourceId}
            onValueChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                sourceId: value,
              }))
            }
          >
            <SelectTrigger className="h-9 w-[200px] border-2 border-black rounded-[4px]">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {sourceOptions.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <MultiSelect
          values={draft.findingSeverities}
          onValuesChange={(values) =>
            setDraft((previous) => ({
              ...previous,
              findingSeverities: values as FilterDraft["findingSeverities"],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Severity" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search severities...",
              emptyMessage: "No severities found",
            }}
          >
            <MultiSelectGroup>
              {findingSeverityOptions.map((severity) => (
                <MultiSelectItem key={severity} value={severity}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[2px] border border-black/20"
                      style={{
                        backgroundColor:
                          FINDING_SEVERITY_COLOR_BY_ENUM[severity],
                      }}
                    />
                    {formatEnumLabel(severity)}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={draft.detectorTypes}
          onValuesChange={(values) =>
            setDraft((previous) => ({
              ...previous,
              detectorTypes: values as FilterDraft["detectorTypes"],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[220px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Detector types" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search detector types...",
              emptyMessage: "No detector types found",
            }}
          >
            <MultiSelectGroup>
              {detectorOptions.map((detector) => (
                <MultiSelectItem key={detector} value={detector}>
                  {formatEnumLabel(detector)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={assetStatuses}
          onValuesChange={(values) =>
            onAssetStatusesChange?.(values as AssetStatusFilterValue[])
          }
        >
          <MultiSelectTrigger className="h-9 w-[170px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Asset status" />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search statuses...",
              emptyMessage: "No statuses found",
            }}
          >
            <MultiSelectGroup>
              {assetStatusOptions.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: `var(--${status === "NEW" ? "accent" : status === "UPDATED" ? "chart-4" : "muted-foreground"})`,
                      }}
                    />
                    {formatEnumLabel(status)}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {isFilterLoading ? (
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sources
          </div>
        ) : null}
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
            <span className="ml-2 text-sm">Loading assets...</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title="No assets found"
            description="Adjust the filters and run the search again."
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="w-8 bg-white/95 dark:bg-card/95" />
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead("Asset", SearchAssetsSortByEnum.Name)}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Source",
                      SearchAssetsSortByEnum.SourceId,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Source Type
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        The type of data source this asset belongs to
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Asset Type",
                      SearchAssetsSortByEnum.AssetType,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Status",
                      SearchAssetsSortByEnum.Status,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Detectors
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Active detectors that fired on this asset and their
                        finding counts
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Top Findings
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Most frequent finding types on this asset
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Severity
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Highest severity finding and total findings count
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Status Mix
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Breakdown of finding statuses on this asset
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Last Scanned",
                      SearchAssetsSortByEnum.LastScannedAt,
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      "Updated",
                      SearchAssetsSortByEnum.UpdatedAt,
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const asset = item.asset;
                  const assetName =
                    asset.name || asset.externalUrl || asset.hash;
                  const sourceName =
                    sourceIndex.get(asset.sourceId) || "Unknown source";
                  const SourceTypeIcon = getSourceIcon(asset.sourceType);
                  const isExpanded = expandedAssetId === asset.id;
                  const canExpand = canExpandFindings;

                  const detectorCounts = computeDetectorCounts(item.findings);
                  const topDetectors = detectorCounts.slice(0, 3);
                  const topFindingTypes = computeTopFindingTypes(item.findings);
                  const statusCounts = computeStatusCounts(item.findings);
                  const highestSeverity = getHighestSeverity(item.findings);
                  const totalFindings = item.findings.length;

                  return (
                    <Fragment key={asset.id}>
                      <TableRow>
                        <TableCell className="py-2">
                          {canExpand ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() =>
                                setExpandedAssetId((previous) =>
                                  previous === asset.id ? null : asset.id,
                                )
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>

                        <TableCell className="max-w-[320px]">
                          <div className="min-w-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto max-w-[280px] justify-start p-0 text-left"
                                  onClick={() =>
                                    router.push(`/assets/${asset.id}`)
                                  }
                                >
                                  <span className="truncate text-sm font-medium inline-block max-w-[280px]">
                                    {assetName}
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={6}>
                                {assetName}
                              </TooltipContent>
                            </Tooltip>
                            {asset.externalUrl && (
                              <p className="truncate text-xs text-muted-foreground max-w-[280px]">
                                {asset.externalUrl}
                              </p>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <SourceTypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto justify-start p-0 text-left text-sm"
                              onClick={() =>
                                router.push(`/sources/${asset.sourceId}`)
                              }
                            >
                              {sourceName}
                            </Button>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline">
                            {formatEnumLabel(asset.sourceType)}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          {(() => {
                            const AssetIcon = getAssetTypeIcon(asset.assetType);
                            return (
                              <Badge variant="outline" className="gap-1.5">
                                <AssetIcon className="h-3 w-3 text-muted-foreground" />
                                {formatEnumLabel(asset.assetType)}
                              </Badge>
                            );
                          })()}
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant={statusVariant[asset.status] || "outline"}
                          >
                            {asset.status}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <DetectorSummaryBadges
                            items={topDetectors.map((entry) => ({
                              detector: String(entry.detector),
                              count: entry.count,
                            }))}
                            maxVisible={3}
                          />
                        </TableCell>

                        <TableCell>
                          <TopFindingsBadges
                            items={topFindingTypes}
                            maxVisible={2}
                          />
                        </TableCell>

                        <TableCell>
                          {highestSeverity ? (
                            <div className="flex items-center gap-2">
                              <SeverityBadge
                                severity={
                                  highestSeverity.toLowerCase() as
                                    | "critical"
                                    | "high"
                                    | "medium"
                                    | "low"
                                    | "info"
                                }
                              >
                                {formatEnumLabel(highestSeverity)}
                              </SeverityBadge>
                              <span className="text-xs text-muted-foreground">
                                {totalFindings}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>

                        <TableCell>
                          {statusCounts.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {statusCounts.slice(0, 2).map((entry) => (
                                <StatusBadge
                                  key={entry.status}
                                  status={toStatusBadgeValue(entry.status)}
                                >
                                  {STATUS_LABELS[entry.status] ?? entry.status}{" "}
                                  · {entry.count}
                                </StatusBadge>
                              ))}
                              {statusCounts.length > 2 && (
                                <Badge
                                  variant="outline"
                                  className="text-[11px]"
                                >
                                  +{statusCounts.length - 2} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="text-xs">
                            {formatDate(asset.lastScannedAt)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatRelative(asset.lastScannedAt)}
                            {formatShortUTC(asset.lastScannedAt) && (
                              <span className="text-muted-foreground/50">
                                {" "}
                                · {formatShortUTC(asset.lastScannedAt)}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="text-xs">
                            {formatDate(asset.updatedAt)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatRelative(asset.updatedAt)}
                            {formatShortUTC(asset.updatedAt) && (
                              <span className="text-muted-foreground/50">
                                {" "}
                                · {formatShortUTC(asset.updatedAt)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {isExpanded && canExpand && (
                        <TableRow>
                          <TableCell colSpan={13} className="p-0 bg-muted/15">
                            <FindingsSubTable
                              findings={item.findings}
                              onFindingClick={(findingId) =>
                                router.push(`/findings/${findingId}`)
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {isLoading && hasRows ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating assets...
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] border-2 border-black rounded-[4px]">
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
                  onClick={(event) => {
                    event.preventDefault();
                    if (canPrev) {
                      setPage(clampedPage - 1);
                    }
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
                        onClick={(event) => {
                          event.preventDefault();
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
                  onClick={(event) => {
                    event.preventDefault();
                    if (canNext) {
                      setPage(clampedPage + 1);
                    }
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

export type { AssetsTableScope };
