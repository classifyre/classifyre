"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  formatDate,
  formatRelative,
  formatShortUTC,
  formatDateUTC,
} from "@/lib/date";
import { MatchedContentBlock } from "@/components/matched-content-block";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
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
import { useUrlParams } from "../lib/url-filters";
import {
  formatFindingStatusLabel,
  toFindingStatusBadgeValue,
} from "../lib/finding-status-badge";
import { useTranslation } from "@/hooks/use-translation";

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
}: {
  draft: FilterDraft;
  skip: number;
  limit: number;
  lockedFilters?: SearchFindingsRequestDto["filters"];
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

// ─── Expanded row ─────────────────────────────────────────────────────────────

function FindingExpandedRow({ finding }: { finding: FindingResponseDto }) {
  const severityKey = (finding.severity || "INFO").toLowerCase() as
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "info";
  const runnerHref = finding.runnerId ? `/scans/${finding.runnerId}` : null;

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Scanned
          </p>
          {runnerHref ? (
            <Link
              href={runnerHref}
              className="font-mono text-xs underline-offset-4 hover:underline"
            >
              {formatRelative(finding.lastDetectedAt || finding.detectedAt)}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">Manual</p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Location
          </p>
          <p className="font-mono text-xs">
            {finding.location?.path || "-"}
            {typeof finding.location?.line === "number"
              ? `:${finding.location.line}`
              : ""}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Source
          </p>
          <p className="text-xs">{finding.source?.name || finding.sourceId}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {finding.source?.type || "UNKNOWN"}
          </p>
        </div>
        {finding.comment && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Notes
            </p>
            <p className="text-xs">{finding.comment}</p>
          </div>
        )}
      </div>
      <MatchedContentBlock
        severity={severityKey}
        matchedContent={finding.matchedContent}
        redactedContent={finding.redactedContent}
        contextBefore={finding.contextBefore}
        contextAfter={finding.contextAfter}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-[#b7ff00] data-[state=checked]:border-[#b7ff00] data-[state=checked]:text-black data-[state=indeterminate]:bg-[#b7ff00] data-[state=indeterminate]:border-[#b7ff00] data-[state=indeterminate]:text-black";

export function FindingsTable({
  severities,
  onSeveritiesChange,
  onSelectionChange,
  onBulkUpdate,
  onFiltersChange,
  lockedFilters,
}: FindingsTableProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { searchParams, setParams } = useUrlParams();

  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") ?? DEFAULT_DRAFT.search,
  );
  const [draft, setDraft] = useState<FilterDraft>(() => ({
    search: searchParams.get("q") ?? DEFAULT_DRAFT.search,
    detectorTypes: searchParams.getAll(
      "detector",
    ) as FilterDraft["detectorTypes"],
    statuses: searchParams.getAll("status") as FilterDraft["statuses"],
    sourceIds: searchParams.getAll("source"),
    customDetectorKeys: searchParams.getAll("customDetector"),
    // Prefer externally-supplied severities (panel cards); fall back to URL
    severity: (severities ??
      searchParams.getAll("severity")) as SeverityValue[],
  }));

  // When the parent panel cards change the severity prop, sync into draft
  useEffect(() => {
    if (severities === undefined) return;
    setDraft((prev) => ({ ...prev, severity: severities }));
  }, [severities]);
  const [pageSize, setPageSize] = useState(String(PAGE_SIZE_OPTIONS[0]));
  const [page, setPage] = useState(1);
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(
    null,
  );

  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [customDetectorOptions, setCustomDetectorOptions] = useState<
    Array<{ key: string; name: string; count: number }>
  >([]);
  const [data, setData] = useState<SearchFindingsResponseDto | null>(null);
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
    setParams({
      q: draft.search || null,
      detector: draft.detectorTypes.length > 0 ? draft.detectorTypes : null,
      customDetector:
        draft.customDetectorKeys.length > 0 ? draft.customDetectorKeys : null,
      status: draft.statuses.length > 0 ? draft.statuses : null,
      source: draft.sourceIds.length > 0 ? draft.sourceIds : null,
      severity: draft.severity.length > 0 ? draft.severity : null,
    });
  }, [draft, setParams]);

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
  }, [draft, lockedFilters]);

  // ── Reset page on filter/size change ─────────────────────────────────────

  useEffect(() => {
    setPage(1);
    setExpandedFindingId(null);
  }, [draft, pageSize]);

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
          }),
        });
        if (!active) return;
        setData(response);
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
  }, [draft, page, resolvedPageSize, lockedFilters]);

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
      }).filters,
    [draft, lockedFilters],
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
        notifySelection(next, false, currentFilters, currentTotal);
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

  const findings = currentFindings;
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
            className="h-9 pl-9 border-2 border-black rounded-[4px]"
          />
        </div>

        <MultiSelect
          values={draft.severity}
          onValuesChange={(values) => {
            const sevValues = values as SeverityValue[];
            setDraft((prev) => ({ ...prev, severity: sevValues }));
            onSeveritiesChange?.(sevValues);
          }}
        >
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Severity" />
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
                      className="h-2.5 w-2.5 rounded-[2px] border border-black/20"
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
          <MultiSelectTrigger className="h-9 w-[200px] border-2 border-black rounded-[4px]">
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
          <MultiSelectTrigger className="h-9 w-[220px] border-2 border-black rounded-[4px]">
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
          <MultiSelectTrigger className="h-9 w-[170px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Status" />
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
          <MultiSelectTrigger className="h-9 w-[200px] border-2 border-black rounded-[4px]">
            <MultiSelectValue placeholder="Sources" />
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

        {isFilterLoading && (
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        )}
      </div>

      {/* ── Selection banner ── */}
      {selectionCount > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] border-2 border-[#b7ff00]/30 bg-[#0b0f0a] px-4 py-2.5">
          <span className="font-mono text-xs text-[#b7ff00]">
            {isAllSelected
              ? `All ${selectionCount.toLocaleString()} findings selected`
              : `${selectionCount.toLocaleString()} finding${selectionCount !== 1 ? "s" : ""} selected`}
          </span>

          {onBulkUpdate && (
            <Button
              size="sm"
              onClick={onBulkUpdate}
              className="ml-auto bg-[#b7ff00] text-black hover:bg-[#b7ff00]/85 font-mono text-xs uppercase tracking-[0.08em] font-bold rounded-[4px] border-0"
            >
              Update {selectionCount.toLocaleString()} finding
              {selectionCount !== 1 ? "s" : ""}
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
                  <TableHead className="w-8 bg-white/95 dark:bg-card/95" />
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
                      Action
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((finding) => {
                  const isExpanded = expandedFindingId === finding.id;
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
                        className={isSelected ? "bg-[#b7ff00]/5" : undefined}
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

                        <TableCell className="py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() =>
                              setExpandedFindingId((prev) =>
                                prev === finding.id ? null : finding.id,
                              )
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TableCell>

                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto justify-start p-0 hover:bg-transparent"
                            onClick={() =>
                              router.push(`/findings/${finding.id}`)
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
                                  router.push(`/findings/${finding.id}`)
                                }
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
                                  router.push(`/assets/${finding.assetId}`)
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
                              router.push(`/sources/${finding.sourceId}`)
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
                            {formatEnumLabel(finding.severity)}
                          </SeverityBadge>
                        </TableCell>

                        <TableCell>
                          <StatusBadge
                            status={toFindingStatusBadgeValue(finding.status)}
                          >
                            {formatFindingStatusLabel(finding.status)}
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
                            className="h-8 rounded-[4px] border-2 border-black"
                            onClick={() =>
                              router.push(`/findings/${finding.id}`)
                            }
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={11} className="p-0 bg-muted/15">
                            <FindingExpandedRow finding={finding} />
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

        {isLoading && hasRows && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating findings…
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
            <SelectTrigger className="h-8 w-[130px] border-2 border-black rounded-[4px]">
              <SelectValue placeholder="Rows" />
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
  );
}
