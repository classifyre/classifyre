"use client";

import { nsPath } from "@/lib/ns-path";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatDate,
  formatRelative,
  formatShortUTC,
  formatDateUTC,
} from "@/lib/date";
import {
  ArrowUpRight,
  BrainCircuit,
  ListFilter,
  Filter,
  Loader2,
  Search,
} from "lucide-react";
import {
  api,
  SearchFindingsFiltersInputDtoDetectorTypeEnum,
  SearchFindingsFiltersInputDtoSeverityEnum,
  SearchFindingsFiltersInputDtoStatusEnum,
  type FindingResponseDto,
  type SearchFindingsRequestDto,
  type SearchFindingsResponseDto,
  type SourceListItem,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Badge,
  Button,
  Checkbox,
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
  StatusBadge,
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
import { getSourceIcon } from "../lib/source-type-icon";
import { CsvExportButton, filtersToSearchParams } from "./csv-export-button";
import { useUrlParams } from "../lib/url-filters";
import { toFindingStatusBadgeValue } from "../lib/finding-status-badge";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

type SeverityValue =
  (typeof SearchFindingsFiltersInputDtoSeverityEnum)[keyof typeof SearchFindingsFiltersInputDtoSeverityEnum];

type FilterDraft = {
  search: string;
  detectorTypes: Array<
    (typeof SearchFindingsFiltersInputDtoDetectorTypeEnum)[keyof typeof SearchFindingsFiltersInputDtoDetectorTypeEnum]
  >;
  statuses: Array<
    (typeof SearchFindingsFiltersInputDtoStatusEnum)[keyof typeof SearchFindingsFiltersInputDtoStatusEnum]
  >;
  sourceIds: string[];
  severity: SeverityValue[];
  customDetectorKeys: string[];
};

type RankingReason = {
  code: string;
  label: string;
  impact: "up" | "down" | "neutral";
};

type RankedFinding = FindingResponseDto & {
  ranking?: {
    importance: number | null;
    quality: number | null;
    similarCount: number;
    duplicateGroupHash: string | null;
    reasons: RankingReason[];
    coverage: "analyzed" | "pending";
    semanticSimilarity?: number;
  };
};

type RankedFindingsResponse = Omit<SearchFindingsResponseDto, "findings"> & {
  findings: RankedFinding[];
};

type SearchMode = "hybrid" | "off";
type RankingMode = "importance" | "newest" | "severity";

// Selection is either explicit IDs or a filter snapshot (select-all mode).
export type FindingSelectionIds = {
  type: "ids";
  findings: FindingResponseDto[];
  total: number;
};

export type FindingSelectionAll = {
  type: "all";
  filters: SearchFindingsRequestDto["filters"];
  total: number;
};

export type FindingSelection = FindingSelectionIds | FindingSelectionAll;

type FindingsTableProps = {
  severities?: SeverityValue[];
  onSeveritiesChange?: (v: SeverityValue[]) => void;
  onSelectionChange?: (selection: FindingSelection | null) => void;
  onBulkUpdate?: () => void;
  onFiltersChange?: (filters: SearchFindingsRequestDto["filters"]) => void;
  lockedFilters?: SearchFindingsRequestDto["filters"];
  /** When true the table skips URL read/write — safe to embed in dialogs. */
  disableUrlSync?: boolean;
  /**
   * Finding IDs (FindingResponseDto.id) to hide from the table.
   * Applied client-side after fetch — useful to exclude already-attached rows
   * without requiring a backend filter. Pagination counts may be slightly off.
   */
  excludedFindingIds?: string[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  detectorTypes: [],
  statuses: [],
  sourceIds: [],
  severity: [],
  customDetectorKeys: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function buildRequest({
  draft,
  skip,
  limit,
  lockedFilters,
  searchMode,
  rankingMode,
}: {
  draft: FilterDraft;
  skip: number;
  limit: number;
  lockedFilters?: SearchFindingsRequestDto["filters"];
  searchMode: SearchMode;
  rankingMode: RankingMode;
}): SearchFindingsRequestDto {
  const filters: SearchFindingsRequestDto["filters"] = {
    ...(lockedFilters ?? {}),
  };

  if (lockedFilters?.search === undefined) {
    filters.search = draft.search.trim() || undefined;
  }
  if (lockedFilters?.sourceId === undefined) {
    filters.sourceId = draft.sourceIds.length > 0 ? draft.sourceIds : undefined;
  }
  if (lockedFilters?.detectorType === undefined) {
    filters.detectorType =
      draft.detectorTypes.length > 0 ? draft.detectorTypes : undefined;
  }
  if (lockedFilters?.customDetectorKey === undefined) {
    filters.customDetectorKey =
      draft.customDetectorKeys.length > 0
        ? draft.customDetectorKeys
        : undefined;
  }
  if (lockedFilters?.severity === undefined) {
    filters.severity = draft.severity.length > 0 ? draft.severity : undefined;
  }
  if (lockedFilters?.status === undefined) {
    if (draft.statuses.length > 0) {
      filters.status = draft.statuses;
    } else {
      // No status filter selected — show all findings including resolved
      filters.includeResolved = true;
    }
  }

  return {
    filters,
    page: { skip, limit },
    semantic:
      searchMode === "hybrid" && draft.search.trim()
        ? { query: draft.search.trim(), mode: "hybrid" }
        : undefined,
    ranking: { sort: rankingMode },
  };
}

const CONFIDENCE_VAR: (pct: number) => string = (pct) =>
  pct >= 80
    ? "var(--accent)"
    : pct >= 60
      ? "var(--chart-4)"
      : pct >= 40
        ? "var(--muted-foreground)"
        : "var(--destructive)";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const segments = 5;
  const filled = Math.round((pct / 100) * segments);
  const color = CONFIDENCE_VAR(pct);

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-[3px]">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-[2px]"
            style={
              i < filled
                ? {
                    backgroundColor: color,
                    border: `1.5px solid color-mix(in srgb, ${color} 85%, black 15%)`,
                  }
                : {
                    border:
                      "1.5px solid color-mix(in srgb, var(--border) 100%, black 15%)",
                  }
            }
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-foreground">{pct}%</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

export function FindingsTable({
  severities,
  onSeveritiesChange,
  onSelectionChange,
  onBulkUpdate,
  onFiltersChange,
  lockedFilters,
  disableUrlSync = false,
  excludedFindingIds,
}: FindingsTableProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { searchParams, setParams } = useUrlParams();

  const [searchInput, setSearchInput] = useState(() =>
    disableUrlSync
      ? DEFAULT_DRAFT.search
      : (searchParams.get("q") ?? DEFAULT_DRAFT.search),
  );
  const [draft, setDraft] = useState<FilterDraft>(() => ({
    search: disableUrlSync
      ? DEFAULT_DRAFT.search
      : (searchParams.get("q") ?? DEFAULT_DRAFT.search),
    detectorTypes: disableUrlSync
      ? DEFAULT_DRAFT.detectorTypes
      : (searchParams.getAll("detector") as FilterDraft["detectorTypes"]),
    statuses: disableUrlSync
      ? DEFAULT_DRAFT.statuses
      : (searchParams.getAll("status") as FilterDraft["statuses"]),
    sourceIds: disableUrlSync
      ? DEFAULT_DRAFT.sourceIds
      : searchParams.getAll("source"),
    customDetectorKeys: disableUrlSync
      ? DEFAULT_DRAFT.customDetectorKeys
      : searchParams.getAll("customDetector"),
    // Prefer externally-supplied severities (panel cards); fall back to URL
    severity: disableUrlSync
      ? ((severities ?? DEFAULT_DRAFT.severity) as SeverityValue[])
      : ((severities ?? searchParams.getAll("severity")) as SeverityValue[]),
  }));

  // When the parent panel cards change the severity prop, sync into draft
  useEffect(() => {
    if (severities === undefined) return;
    setDraft((prev) => ({ ...prev, severity: severities }));
  }, [severities]);
  const [pageSize, setPageSize] = useState(String(PAGE_SIZE_OPTIONS[0]));
  const [page, setPage] = useState(1);
  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
  const [rankingMode, setRankingMode] = useState<RankingMode>("importance");

  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [customDetectorOptions, setCustomDetectorOptions] = useState<
    Array<{ key: string; name: string; count: number }>
  >([]);
  const [data, setData] = useState<RankedFindingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explicit row selection
  const [selectionMap, setSelectionMap] = useState<
    Map<string, FindingResponseDto>
  >(() => new Map());
  // "Select all matching filter" mode — no fetch, just snapshot the current filter
  const [isAllSelected, setIsAllSelected] = useState(false);

  const resolvedPageSize = Number(pageSize);

  // ── Notify parent on selection change ─────────────────────────────────────

  const notifySelection = useCallback(
    (
      map: Map<string, FindingResponseDto>,
      allSelected: boolean,
      currentFilters: SearchFindingsRequestDto["filters"],
      currentTotal: number,
    ) => {
      if (allSelected) {
        onSelectionChange?.({
          type: "all",
          filters: currentFilters,
          total: currentTotal,
        });
      } else if (map.size > 0) {
        onSelectionChange?.({
          type: "ids",
          findings: Array.from(map.values()),
          total: map.size,
        });
      } else {
        onSelectionChange?.(null);
      }
    },
    [onSelectionChange],
  );

  // ── Debounce text inputs into draft ──────────────────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => {
      setDraft((prev) =>
        prev.search === searchInput ? prev : { ...prev, search: searchInput },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Sync draft to URL ─────────────────────────────────────────────────────

  useEffect(() => {
    if (disableUrlSync) return;
    setParams({
      q: draft.search || null,
      detector: draft.detectorTypes.length > 0 ? draft.detectorTypes : null,
      customDetector:
        draft.customDetectorKeys.length > 0 ? draft.customDetectorKeys : null,
      status: draft.statuses.length > 0 ? draft.statuses : null,
      source: draft.sourceIds.length > 0 ? draft.sourceIds : null,
      severity: draft.severity.length > 0 ? draft.severity : null,
    });
  }, [draft, setParams, disableUrlSync]);

  // ── Load sources ──────────────────────────────────────────────────────────

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
        if (active) setIsFilterLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const request = buildRequest({
          draft: { ...draft, customDetectorKeys: [] },
          skip: 0,
          limit: 1,
          lockedFilters: {
            ...(lockedFilters ?? {}),
            customDetectorKey: undefined,
            detectorType: [
              SearchFindingsFiltersInputDtoDetectorTypeEnum.Custom,
            ],
          },
          searchMode: "off",
          rankingMode,
        });
        const options =
          await api.assets.searchAssetsControllerSearchFindingsCustomDetectors({
            searchFindingsRequestDto: request,
          });
        if (!active) return;
        setCustomDetectorOptions(
          Array.isArray(options)
            ? options.map((option) => ({
                key: String(option.key),
                name: String(option.name),
                count: Number(option.count ?? 0),
              }))
            : [],
        );
      } catch {
        if (!active) return;
        setCustomDetectorOptions([]);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [draft, lockedFilters, rankingMode]);

  // ── Reset page on filter/size change ─────────────────────────────────────

  useEffect(() => {
    setPage(1);
  }, [draft, pageSize, searchMode, rankingMode]);

  // ── Fetch findings ────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const skip = (page - 1) * resolvedPageSize;
        const response = await api.assets.searchAssetsControllerSearchFindings({
          searchFindingsRequestDto: buildRequest({
            draft,
            skip,
            limit: resolvedPageSize,
            lockedFilters,
            searchMode,
            rankingMode,
          }),
        });
        if (!active) return;
        setData(response as RankedFindingsResponse);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load findings:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load findings",
        );
        setData({ findings: [], total: 0, skip: 0, limit: resolvedPageSize });
      } finally {
        if (active) setIsLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [draft, page, resolvedPageSize, lockedFilters, searchMode, rankingMode]);

  // ── Selection helpers ─────────────────────────────────────────────────────

  const currentFindings = data?.findings ?? [];
  const currentTotal = data?.total ?? 0;

  // Clear all selection when filter changes
  useEffect(() => {
    setSelectionMap(new Map());
    setIsAllSelected(false);
    onSelectionChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const currentFilters = useMemo(
    () =>
      buildRequest({
        draft,
        skip: 0,
        limit: 1,
        lockedFilters,
        searchMode,
        rankingMode,
      }).filters,
    [draft, lockedFilters, searchMode, rankingMode],
  );

  useEffect(() => {
    onFiltersChange?.(currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilters]);

  const toggleRow = useCallback(
    (finding: FindingResponseDto) => {
      setIsAllSelected(false);
      setSelectionMap((prev) => {
        const next = new Map(prev);
        if (next.has(finding.id)) {
          next.delete(finding.id);
        } else {
          next.set(finding.id, finding);
        }
        // Defer the parent notification outside the state-updater callback.
        // Calling onSelectionChange (a parent setState) inside a state-updater
        // triggers the React "Cannot update a component while rendering a
        // different component" warning.
        queueMicrotask(() =>
          notifySelection(next, false, currentFilters, currentTotal),
        );
        return next;
      });
    },
    [notifySelection, currentFilters, currentTotal],
  );

  const selectAll = useCallback(() => {
    setIsAllSelected(true);
    setSelectionMap(new Map());
    notifySelection(new Map(), true, currentFilters, currentTotal);
  }, [notifySelection, currentFilters, currentTotal]);

  const clearSelection = useCallback(() => {
    setIsAllSelected(false);
    setSelectionMap(new Map());
    onSelectionChange?.(null);
  }, [onSelectionChange]);

  // ── Header checkbox state ─────────────────────────────────────────────────

  const currentPageSelectedCount = isAllSelected
    ? currentFindings.length
    : currentFindings.filter((f) => selectionMap.has(f.id)).length;
  const headerChecked =
    isAllSelected ||
    (currentFindings.length > 0 &&
      currentPageSelectedCount === currentFindings.length);
  const headerIndeterminate =
    !isAllSelected && currentPageSelectedCount > 0 && !headerChecked;

  function handleHeaderCheckbox() {
    if (headerChecked || headerIndeterminate) {
      clearSelection();
    } else {
      selectAll();
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  // Apply client-side exclusion (already-attached findings in dialog mode)
  const visibleFindings =
    excludedFindingIds && excludedFindingIds.length > 0
      ? currentFindings.filter((f) => !excludedFindingIds.includes(f.id))
      : currentFindings;
  const duplicateGroups = new Set<string>();
  const findings = visibleFindings.filter((finding) => {
    const group = finding.ranking?.duplicateGroupHash;
    if (!group) return true;
    if (duplicateGroups.has(group)) return false;
    duplicateGroups.add(group);
    return true;
  });
  const analyzedCount = findings.filter(
    (finding) => finding.ranking?.coverage === "analyzed",
  ).length;
  const groupedCount = findings.reduce(
    (total, finding) => total + (finding.ranking?.similarCount ?? 0),
    0,
  );
  const total = data?.total ?? 0;
  const hasRows = findings.length > 0;
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
  const selectionCount = isAllSelected ? currentTotal : selectionMap.size;

  const sourceOptions = useMemo(
    () =>
      sources
        .filter((s): s is SourceListItem & { id: string } => Boolean(s.id))
        .map((s) => ({ id: s.id, label: s.name || s.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [sources],
  );

  const detectorOptions = useMemo(
    () => Object.values(SearchFindingsFiltersInputDtoDetectorTypeEnum),
    [],
  );
  const severityOptions = useMemo(
    () => Object.values(SearchFindingsFiltersInputDtoSeverityEnum),
    [],
  );
  const statusOptions = useMemo(
    () => Object.values(SearchFindingsFiltersInputDtoStatusEnum),
    [],
  );

  const detectorBadgeLabel = useCallback((finding: FindingResponseDto) => {
    if (
      finding.detectorType ===
      SearchFindingsFiltersInputDtoDetectorTypeEnum.Custom
    ) {
      const customName =
        typeof finding.customDetectorName === "string"
          ? finding.customDetectorName.trim()
          : "";
      if (customName.length > 0) {
        return customName;
      }
    }
    return formatEnumLabel(finding.detectorType);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("findings.search")}
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <div className="flex h-9 overflow-hidden rounded-[4px] border-2 border-border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={searchMode === "hybrid" ? "default" : "ghost"}
                size="sm"
                className="h-full rounded-none px-2.5"
                onClick={() => setSearchMode("hybrid")}
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                Semantic
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Hybrid semantic and exact text ranking
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={searchMode === "off" ? "default" : "ghost"}
                size="sm"
                className="h-full rounded-none border-l border-border px-2.5"
                onClick={() => setSearchMode("off")}
              >
                <Search className="h-3.5 w-3.5" />
                Exact
              </Button>
            </TooltipTrigger>
            <TooltipContent>Exact field and full-text matching</TooltipContent>
          </Tooltip>
        </div>

        <Select
          value={rankingMode}
          onValueChange={(value) => setRankingMode(value as RankingMode)}
        >
          <SelectTrigger className="h-9 w-[170px] rounded-[4px] border-2 border-border">
            <ListFilter className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="importance">Importance</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="severity">Severity</SelectItem>
          </SelectContent>
        </Select>

        <MultiSelect
          values={draft.severity}
          onValuesChange={(values) => {
            const sevValues = values as SeverityValue[];
            setDraft((prev) => ({ ...prev, severity: sevValues }));
            onSeveritiesChange?.(sevValues);
          }}
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
              {severityOptions.map((severity) => (
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
            setDraft((prev) => ({
              ...prev,
              detectorTypes: values as FilterDraft["detectorTypes"],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[200px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("findings.detectorTypes")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search detectors…",
              emptyMessage: "No detectors found",
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
          values={draft.customDetectorKeys}
          onValuesChange={(values) =>
            setDraft((prev) => ({ ...prev, customDetectorKeys: values }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[220px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("findings.customDetectors")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search custom detectors…",
              emptyMessage: "No custom detectors found",
            }}
          >
            <MultiSelectGroup>
              {customDetectorOptions.map((option) => (
                <MultiSelectItem key={option.key} value={option.key}>
                  <span>
                    {option.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({option.count})
                    </span>
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={draft.statuses}
          onValuesChange={(values) =>
            setDraft((prev) => ({
              ...prev,
              statuses: values as FilterDraft["statuses"],
            }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[170px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("common.status")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search statuses…",
              emptyMessage: "No statuses found",
            }}
          >
            <MultiSelectGroup>
              {statusOptions.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {formatEnumLabel(status)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={draft.sourceIds}
          onValuesChange={(values) =>
            setDraft((prev) => ({ ...prev, sourceIds: values }))
          }
        >
          <MultiSelectTrigger className="h-9 w-[200px] border-2 border-border rounded-[4px]">
            <MultiSelectValue placeholder={t("common.sources")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search sources…",
              emptyMessage: "No sources found",
            }}
          >
            <MultiSelectGroup>
              {sourceOptions.map((source) => (
                <MultiSelectItem key={source.id} value={source.id}>
                  {source.label}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <div className="ml-auto flex items-center gap-2">
          {isFilterLoading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </span>
          )}
          <CsvExportButton
            exportPath="search/findings/export"
            total={total}
            entityLabel="findings"
            buildQuery={() =>
              filtersToSearchParams({
                ...(buildRequest({
                  draft,
                  skip: 0,
                  limit: 0,
                  lockedFilters,
                  searchMode,
                  rankingMode,
                }).filters ?? {}),
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
        <span>
          {analyzedCount}/{findings.length} visible results ranked
        </span>
        {groupedCount > 0 && (
          <span>
            +{groupedCount.toLocaleString()} identical findings grouped
          </span>
        )}
        {searchMode === "hybrid" && draft.search && (
          <span>Hybrid semantic ranking active</span>
        )}
      </div>

      {/* ── Selection banner ── */}
      {selectionCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5">
          <span className="font-mono text-xs text-accent">
            {isAllSelected
              ? t("findings.selection.allSelected", {
                  count: selectionCount.toLocaleString(),
                })
              : selectionCount !== 1
                ? t("findings.selection.selectedPlural", {
                    count: selectionCount.toLocaleString(),
                  })
                : t("findings.selection.selected", {
                    count: selectionCount.toLocaleString(),
                  })}
          </span>

          {onBulkUpdate && (
            <Button
              size="sm"
              onClick={onBulkUpdate}
              className="ml-auto bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs uppercase tracking-[0.08em] font-bold rounded-[4px] border-0"
            >
              {selectionCount !== 1
                ? t("findings.bulkUpdate.updateFindings", {
                    count: selectionCount.toLocaleString(),
                  })
                : t("findings.bulkUpdate.updateFinding", {
                    count: selectionCount.toLocaleString(),
                  })}
            </Button>
          )}
        </div>
      )}

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
            <span className="ml-2 text-sm">{t("findings.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("findings.noFindings")}
            description={t("findings.noFindingsHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center justify-center">
                          <Checkbox
                            checked={
                              headerIndeterminate
                                ? "indeterminate"
                                : headerChecked
                            }
                            onCheckedChange={handleHeaderCheckbox}
                            aria-label="Select all findings matching current filter"
                            className={CHECKBOX_CLASS}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {headerChecked || headerIndeterminate
                          ? "Deselect all"
                          : `Select all ${currentTotal.toLocaleString()} matching current filters`}
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Importance
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Evidence rank, separate from detector severity
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.category")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Detector type that fired on this finding
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.finding")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Finding type and detection identity
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.asset")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        The asset where this finding was detected
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.source")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        The data source this finding originates from
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.matchedContent")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Detected content that triggered this finding
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.severity")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Risk level assigned to this finding
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.status")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Current review status of this finding
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.confidence")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Detection confidence score from the detector model
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("findings.columns.detected")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        First and last detection timestamps
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 text-right dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("findings.columns.action")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((finding) => {
                  const isSelected = selectionMap.has(finding.id);
                  const SourceTypeIcon = getSourceIcon(finding.source?.type);
                  const assetLabel =
                    finding.asset?.name ||
                    finding.asset?.externalUrl ||
                    finding.assetId;
                  const sourceLabel = finding.source?.name || finding.sourceId;
                  return (
                    <Fragment key={finding.id}>
                      <TableRow
                        className={isSelected ? "bg-accent/5" : undefined}
                        data-testid="finding-row"
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRow(finding)}
                              aria-label={`Select finding ${finding.findingType}`}
                              className={CHECKBOX_CLASS}
                            />
                          </div>
                        </TableCell>

                        <TableCell>
                          {finding.ranking?.importance != null ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="min-w-[150px] cursor-default space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-xs font-semibold">
                                      {Math.round(
                                        finding.ranking.importance * 100,
                                      )}
                                    </span>
                                    {finding.ranking.similarCount > 0 && (
                                      <Badge
                                        variant="outline"
                                        className="rounded-[3px] px-1.5 py-0 text-[10px]"
                                      >
                                        +{finding.ranking.similarCount} similar
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-[2px] bg-muted">
                                    <div
                                      className="h-full bg-accent"
                                      style={{
                                        width: `${Math.round(finding.ranking.importance * 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {finding.ranking.reasons[0]?.label ??
                                      "Ranked evidence"}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[320px] space-y-1">
                                {finding.ranking.reasons.map((reason) => (
                                  <div key={reason.code}>
                                    {reason.impact === "up"
                                      ? "+"
                                      : reason.impact === "down"
                                        ? "-"
                                        : "·"}{" "}
                                    {reason.label}
                                  </div>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              Pending
                            </span>
                          )}
                        </TableCell>

                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto justify-start p-0 hover:bg-transparent"
                            onClick={() =>
                              router.push(nsPath(`/findings/${finding.id}`))
                            }
                          >
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
                                style={{
                                  backgroundColor: severityColor(
                                    finding.severity,
                                  ),
                                }}
                              />
                              {detectorBadgeLabel(finding)}
                            </Badge>
                          </Button>
                        </TableCell>

                        <TableCell className="max-w-[320px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto max-w-[280px] justify-start p-0 text-left"
                                onClick={() =>
                                  router.push(nsPath(`/findings/${finding.id}`))
                                }
                                data-testid="finding-type"
                              >
                                <span className="truncate text-sm font-medium">
                                  {finding.findingType}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>
                              {finding.findingType}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>

                        <TableCell className="max-w-[260px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto max-w-[220px] justify-start p-0 text-left"
                                onClick={() =>
                                  router.push(nsPath(`/assets/${finding.assetId}`))
                                }
                              >
                                <span className="truncate text-sm">
                                  {assetLabel}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>
                              {assetLabel}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>

                        <TableCell className="max-w-[240px]">
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-[220px] justify-start p-0 text-left"
                            onClick={() =>
                              router.push(nsPath(`/sources/${finding.sourceId}`))
                            }
                          >
                            <div className="flex items-center gap-1.5">
                              <SourceTypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="truncate text-sm">
                                  {sourceLabel}
                                </div>
                              </div>
                            </div>
                          </Button>
                        </TableCell>

                        <TableCell className="max-w-[220px]">
                          {finding.matchedContent ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate max-w-[200px] font-mono text-[11px] text-muted-foreground cursor-default">
                                  {finding.matchedContent}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={6}
                                className="max-w-[360px] break-all font-mono"
                              >
                                {finding.matchedContent}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                          {finding.ranking?.reasons &&
                            finding.ranking.reasons.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {finding.ranking.reasons
                                  .slice(0, 2)
                                  .map((reason) => (
                                    <span
                                      key={reason.code}
                                      className={
                                        reason.impact === "down"
                                          ? "rounded-[3px] border border-destructive/30 bg-destructive/5 px-1.5 py-0 text-[10px] text-destructive/80"
                                          : "rounded-[3px] border border-border px-1.5 py-0 text-[10px] text-muted-foreground"
                                      }
                                    >
                                      {reason.label}
                                    </span>
                                  ))}
                              </div>
                            )}
                        </TableCell>

                        <TableCell>
                          <SeverityBadge
                            severity={
                              finding.severity.toLowerCase() as
                                | "critical"
                                | "high"
                                | "medium"
                                | "low"
                                | "info"
                            }
                          >
                            {t(
                              `findings.severityLabels.${finding.severity.toUpperCase()}` as TranslationKey,
                            )}
                          </SeverityBadge>
                        </TableCell>

                        <TableCell>
                          <StatusBadge
                            status={toFindingStatusBadgeValue(finding.status)}
                          >
                            {t(
                              `findings.statusLabels.${finding.status}` as TranslationKey,
                            )}
                          </StatusBadge>
                        </TableCell>

                        <TableCell>
                          <ConfidenceBar value={finding.confidence} />
                        </TableCell>

                        <TableCell>
                          {(() => {
                            const first =
                              finding.firstDetectedAt || finding.detectedAt;
                            const last =
                              finding.lastDetectedAt || finding.detectedAt;
                            const sameDate = first.getTime() === last.getTime();
                            return sameDate ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs cursor-default">
                                    {formatRelative(first)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  <div>{formatDate(first)}</div>
                                  {formatShortUTC(first) && (
                                    <div className="text-muted-foreground/70">
                                      {formatDateUTC(first)}
                                    </div>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[9px] text-muted-foreground w-4 shrink-0">
                                    ↑
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[11px] text-muted-foreground cursor-default">
                                        {formatRelative(first)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                      <div>First: {formatDate(first)}</div>
                                      {formatShortUTC(first) && (
                                        <div className="text-muted-foreground/70">
                                          {formatDateUTC(first)}
                                        </div>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-[9px] text-muted-foreground w-4 shrink-0">
                                    ↓
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-xs font-medium cursor-default">
                                        {formatRelative(last)}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                      <div>Last: {formatDate(last)}</div>
                                      {formatShortUTC(last) && (
                                        <div className="text-muted-foreground/70">
                                          {formatDateUTC(last)}
                                        </div>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-[4px] border-2 border-border"
                            onClick={() =>
                              router.push(nsPath(`/findings/${finding.id}`))
                            }
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            {t("findings.detail.details")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {isLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("findings.selection.updating")}
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
              : "0 findings"}
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
