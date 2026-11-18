"use client";

import { nsPath } from "@/lib/ns-path";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Compass,
  Filter,
  Loader2,
  Lock,
  Plus,
  X,
} from "lucide-react";
import {
  api,
  AssetListItemDtoStatusEnum,
  SearchAssetsFiltersDtoStatusEnum,
  type SearchAssetsFiltersDtoGovernanceEnum,
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
  type SharedDatasetSummaryDto,
  type SourceListItem,
} from "@workspace/api-client";
import {
  Button,
  Checkbox,
  EmptyState,
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
  ToneBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type StatusTone,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { getSourceIcon } from "../lib/source-type-icon";
import { AssetKindBadge } from "./asset-kind-badge";
import { CsvExportButton, filtersToSearchParams } from "./csv-export-button";
import { useUrlParams } from "../lib/url-filters";
import {
  DetectorSummaryBadges,
  TopFindingsBadges,
} from "./finding-summary-badges";
import { useTranslation } from "../hooks/use-translation";
import type { TranslationKey } from "../i18n";
import { FeatureOffNotice } from "@/components/feature-off-notice";
import { AssetFilterBar } from "@/components/asset-filter-bar";
import { GovernanceBadge } from "@/components/governance/governance-badge";
import { QualityChip } from "@/components/governance/quality-chip";
import { ActorChip } from "@/components/actor-chip";
import { DatasetBadges } from "@/components/shared-datasets/dataset-cards";
import type { ExploreViewName } from "@/lib/explore";
import { EXPLORE_MAX_SEEDS } from "@/lib/explore";

type AssetsTableScope = {
  sourceId?: string;
  runnerId?: string;
};

type AssetStatusFilterValue =
  (typeof SearchAssetsFiltersDtoStatusEnum)[keyof typeof SearchAssetsFiltersDtoStatusEnum];

type AssetsTableProps = {
  scope?: AssetsTableScope;
  initialPageSize?: number;
  /** `raw`: scanned assets only; `shared`: shared datasets only. */
  kind?: "raw" | "shared";
  /**
   * The governance filter when the URL names none, kept out of the URL. Set,
   * the list is that filter's own (the Governed tab): *All* and *Ungoverned*
   * are not offered.
   */
  defaultGovernance?: (typeof GOVERNANCE_FILTER_VALUES)[number];
  /** Which columns and filters show: the assets page's tabs each need others. */
  preset?: AssetsTablePreset;
  /**
   * List these assets, in this order, instead of everything (the Explore
   * tab's starting points); each may say why it is there.
   */
  pinned?: PinnedAssets | null;
  /** Explore one row (or a pair it stands for), or several picked together. */
  onExplore?: (assetIds: string[], view: ExploreViewName | null) => void;
  /** Add the picked rows to what the map already shows. */
  onAddToMap?: (assetIds: string[]) => void;
  /**
   * Only these assets, with the usual paging and sorting (the Shared tab's
   * availability and promoted filters, worked out from the datasets list).
   * null: no such restriction.
   */
  onlyIds?: string[] | null;
  /** Assets drawn on the map right now: their rows are marked. */
  onMap?: ReadonlySet<string>;
  /** First in the filter bar (the Explore tab's "Start from"). */
  toolbar?: ReactNode;
};

/** Why a pinned asset is listed, and what exploring its row opens. */
export interface PinnedReason {
  label: ReactNode;
  /** The row's asset alone, or the pair it belongs to. */
  ids: string[];
  view: ExploreViewName | null;
}

export interface PinnedAssets {
  ids: string[];
  reasons: Map<string, PinnedReason>;
}

type FilterDraft = {
  search: string;
  sourceId: string;
  detectorTypes: Array<
    (typeof SearchFindingsFiltersDtoDetectorTypeEnum)[keyof typeof SearchFindingsFiltersDtoDetectorTypeEnum]
  >;
  findingSeverities: Array<
    (typeof SearchFindingsFiltersDtoSeverityEnum)[keyof typeof SearchFindingsFiltersDtoSeverityEnum]
  >;
  /** GOV §5.7: a lifecycle, owned or not, or mine. */
  governance: string;
};

/** Governance filter values; `mine` and `stewarding` are the signed-in person's. */
const GOVERNANCE_FILTER_VALUES = [
  "ungoverned",
  "governed",
  "draft",
  "active",
  "deprecated",
  "retired",
  "failing",
  "mine",
  "stewarding",
] as const;

export type AssetsTableColumn =
  | "source"
  | "governance"
  | "quality"
  | "sourceType"
  | "assetType"
  | "status"
  | "detectors"
  | "topFindings"
  | "severity"
  | "statusMix"
  | "lastScanned"
  | "updated";

export type AssetsTableControl =
  | "searchMode"
  | "source"
  | "severity"
  | "detectors"
  | "assetStatus"
  | "governance"
  | "export";

const EVERY_COLUMN: readonly AssetsTableColumn[] = [
  "source",
  "governance",
  "quality",
  "sourceType",
  "assetType",
  "status",
  "detectors",
  "topFindings",
  "severity",
  "statusMix",
  "lastScanned",
  "updated",
];
const EVERY_CONTROL: readonly AssetsTableControl[] = [
  "searchMode",
  "source",
  "severity",
  "detectors",
  "assetStatus",
  "governance",
  "export",
];

/**
 * What each list shows. The scanned list is about findings; the governed one
 * about who answers for an asset and how good it is; a shared dataset has no
 * source, scan or findings worth a column; the explore list, what an asset
 * is and how serious it looks — enough to pick where to start.
 */
export const ASSETS_TABLE_PRESETS = {
  all: { columns: EVERY_COLUMN, controls: EVERY_CONTROL },
  governed: {
    columns: [
      "source",
      "governance",
      "quality",
      "assetType",
      "severity",
      "lastScanned",
      "updated",
    ],
    controls: ["searchMode", "source", "governance", "export"],
  },
  shared: {
    columns: ["governance", "quality", "status", "updated"],
    controls: ["searchMode", "governance"],
    // A shared dataset is always owned: what is left to pick is its lifecycle.
    governance: ["draft", "active", "deprecated", "retired"],
  },
  explore: {
    columns: ["source", "governance", "assetType", "severity", "lastScanned"],
    controls: ["searchMode", "source", "governance"],
  },
} satisfies Record<
  string,
  {
    columns: readonly AssetsTableColumn[];
    controls: readonly AssetsTableControl[];
    /** The governance filter's choices, when not all of them make sense. */
    governance?: readonly (typeof GOVERNANCE_FILTER_VALUES)[number][];
  }
>;
export type AssetsTablePreset = keyof typeof ASSETS_TABLE_PRESETS;

type SortDraft = {
  by: SearchAssetsSortBy;
  order: SearchAssetsSortOrder;
};

type SearchMode = "hybrid" | "off";

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const ALL = "ALL";
const DEFAULT_SORT: SortDraft = {
  by: SearchAssetsSortByEnum.LastScannedAt,
  order: SearchAssetsSortOrderEnum.Desc,
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

/**
 * Asset status → the shared status scale.
 *
 * These were raw `Badge` variants, which meant NEW rendered as the *default*
 * badge: acid-green fill with a 2px black border — the loudest object on the
 * page, sitting in a column next to two other status pills drawn three other
 * ways.
 */
const ASSET_STATUS_TONE: Record<AssetListItemDtoStatusEnum, StatusTone> = {
  NEW: "fresh",
  UPDATED: "changed",
  UNCHANGED: "idle",
  DELETED: "error",
};

const EMPTY_ASSET_STATUSES: AssetStatusFilterValue[] = [];

const DEFAULT_DRAFT: FilterDraft = {
  search: "",
  sourceId: ALL,
  detectorTypes: [],
  findingSeverities: [],
  governance: ALL,
};

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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
  searchMode,
  kind,
  responsibleMe = false,
  ids,
}: {
  draft: FilterDraft;
  sort: SortDraft;
  skip: number;
  limit: number;
  scope?: AssetsTableScope;
  assetStatuses: AssetStatusFilterValue[];
  searchMode: SearchMode;
  kind?: "raw" | "shared";
  /** The dashboard's *Mine*: assets the person owns or stewards. */
  responsibleMe?: boolean;
  /** Only these assets. */
  ids?: string[];
}): SearchAssetsRequestInputDto {
  const assetsFilters: NonNullable<SearchAssetsRequestInputDto["assets"]> = {
    search: searchMode === "off" ? draft.search.trim() || undefined : undefined,
    sourceId:
      scope?.sourceId || (draft.sourceId !== ALL ? draft.sourceId : undefined),
    runnerId: scope?.runnerId,
    status: assetStatuses.length > 0 ? assetStatuses : undefined,
    kind,
    responsibleRef: responsibleMe ? "me" : undefined,
    ids: ids?.length ? ids : undefined,
    ...(draft.governance === "mine"
      ? { ownerRef: "me" }
      : draft.governance === "stewarding"
        ? { stewardRef: "me" }
        : draft.governance !== ALL
          ? {
              governance:
                draft.governance as SearchAssetsFiltersDtoGovernanceEnum,
            }
          : {}),
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
    semantic:
      searchMode === "hybrid" && draft.search.trim()
        ? { query: draft.search.trim(), mode: "hybrid" }
        : undefined,
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
              <StatusBadge status={toStatusBadgeValue(finding.status)}>
                {t(`findings.statusLabels.${finding.status}` as TranslationKey)}
              </StatusBadge>
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
  kind,
  defaultGovernance,
  preset = "all",
  pinned = null,
  onExplore,
  onAddToMap,
  onlyIds = null,
  onMap,
  toolbar,
}: AssetsTableProps) {
  const governanceDefault: string = defaultGovernance ?? ALL;
  const presetConfig: {
    columns: readonly AssetsTableColumn[];
    controls: readonly AssetsTableControl[];
    governance?: readonly string[];
  } = ASSETS_TABLE_PRESETS[preset];
  const { columns, controls } = presetConfig;
  const lifecycleOnly = presetConfig.governance;
  const show = (column: AssetsTableColumn) =>
    (columns as readonly string[]).includes(column);
  const has = (control: AssetsTableControl) =>
    (controls as readonly string[]).includes(control);
  // A stable key for the pinned list, so a new Map with the same ids refetches nothing.
  const pinnedKey = pinned ? pinned.ids.join(",") : null;
  const onlyKey = onlyIds ? onlyIds.join(",") : null;
  // Rows picked to explore together.
  const [picked, setPicked] = useState<string[]>([]);
  const togglePicked = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id].slice(-EXPLORE_MAX_SEEDS),
    );
  const { t } = useTranslation();
  const router = useRouter();
  const { searchParams, setParams } = useUrlParams();
  const [assetStatuses, setAssetStatuses] = useState<AssetStatusFilterValue[]>(
    () => {
      const known = Object.values(SearchAssetsFiltersDtoStatusEnum) as string[];
      const picked = searchParams
        .getAll("status")
        .filter((value) => known.includes(value)) as AssetStatusFilterValue[];
      return picked.length ? picked : EMPTY_ASSET_STATUSES;
    },
  );

  // Set by the dashboard's links under *Mine*; cleared with the chip.
  const [responsibleMe, setResponsibleMe] = useState(
    () => searchParams.get("responsible") === "me",
  );

  const [draft, setDraft] = useState<FilterDraft>(() => ({
    search: searchParams.get("q") ?? DEFAULT_DRAFT.search,
    sourceId: searchParams.get("source") ?? DEFAULT_DRAFT.sourceId,
    detectorTypes: searchParams.getAll(
      "detector",
    ) as FilterDraft["detectorTypes"],
    findingSeverities: searchParams.getAll(
      "findingSeverity",
    ) as FilterDraft["findingSeverities"],
    governance: (GOVERNANCE_FILTER_VALUES as readonly string[]).includes(
      searchParams.get("governance") ?? "",
    )
      ? (searchParams.get("governance") as string)
      : governanceDefault,
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
  const [searchMode, setSearchMode] = useState<SearchMode>("hybrid");
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
      governance:
        draft.governance !== governanceDefault ? draft.governance : null,
      status: assetStatuses.length > 0 ? assetStatuses : null,
      responsible: responsibleMe ? "me" : null,
      sortBy: sort.by !== DEFAULT_SORT.by ? sort.by : null,
      sortOrder: sort.order !== DEFAULT_SORT.order ? sort.order : null,
    });
  }, [draft, sort, assetStatuses, responsibleMe, governanceDefault, setParams]);

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
  }, [
    draft,
    pageSize,
    sortBy,
    sortOrder,
    searchMode,
    assetStatuses,
    responsibleMe,
    pinnedKey,
    onlyKey,
  ]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        // Nothing worth starting from: nothing to ask for (an empty id list
        // would not narrow the search at all).
        const pinnedIds =
          pinnedKey === null ? null : pinnedKey.split(",").filter(Boolean);
        const onlyList =
          onlyKey === null ? null : onlyKey.split(",").filter(Boolean);
        if (
          (pinnedIds && pinnedIds.length === 0) ||
          (onlyList && onlyList.length === 0)
        ) {
          setError(null);
          setData({ items: [], total: 0, skip: 0, limit: resolvedPageSize });
          return;
        }
        setIsLoading(true);
        setError(null);

        const skip = pinnedIds ? 0 : (page - 1) * resolvedPageSize;
        const request = buildRequest({
          draft,
          sort: {
            by: sortBy,
            order: sortOrder,
          },
          skip,
          limit: pinnedIds ? pinnedIds.length : resolvedPageSize,
          scope: {
            sourceId: scopedSourceId,
            runnerId: scopedRunnerId,
          },
          assetStatuses,
          searchMode,
          kind,
          responsibleMe,
          ids: pinnedIds ?? onlyList ?? undefined,
        });

        const response = await api.searchAssets(request);

        if (!active) return;
        if (pinnedIds) {
          // In the order they are worth starting from, not the sort's.
          const rank = new Map(pinnedIds.map((id, index) => [id, index]));
          response.items = [...response.items].sort(
            (a, b) => (rank.get(a.asset.id) ?? 0) - (rank.get(b.asset.id) ?? 0),
          );
        }
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
    searchMode,
    kind,
    responsibleMe,
    pinnedKey,
    onlyKey,
  ]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // A shared dataset's own labels (promoted, blocked, locked for you) come
  // from the datasets list, read once the page shows one.
  const showsShared = items.some(
    (item) => item.asset.sourceType === "SHARED_DATASET",
  );
  const [datasets, setDatasets] = useState<Map<
    string,
    SharedDatasetSummaryDto
  > | null>(null);
  useEffect(() => {
    if (!showsShared || datasets) return;
    let active = true;
    api.sharedDatasets
      .sharedDatasetsControllerList()
      .then((list) => {
        if (active) setDatasets(new Map(list.map((row) => [row.assetId, row])));
      })
      .catch(() => {
        if (active) setDatasets(new Map());
      });
    return () => {
      active = false;
    };
  }, [showsShared, datasets]);
  const hasRows = items.length > 0;
  // The header box picks the rows shown, as many as a map holds.
  const pickable = items
    .map((item) => item.asset.id)
    .slice(0, EXPLORE_MAX_SEEDS);
  const pickedOnPage = pickable.filter((id) => picked.includes(id)).length;
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
      <AssetFilterBar
        search={searchInput}
        onSearchChange={setSearchInput}
        sources={scopedSourceId || !has("source") ? undefined : sourceOptions}
        showSeverity={has("severity")}
        showDetectors={has("detectors")}
        sourceId={draft.sourceId}
        onSourceChange={(value) =>
          setDraft((previous) => ({
            ...previous,
            sourceId: value,
          }))
        }
        severities={draft.findingSeverities}
        onSeveritiesChange={(values) =>
          setDraft((previous) => ({
            ...previous,
            findingSeverities: values as FilterDraft["findingSeverities"],
          }))
        }
        detectorTypes={draft.detectorTypes}
        onDetectorTypesChange={(values) =>
          setDraft((previous) => ({
            ...previous,
            detectorTypes: values as FilterDraft["detectorTypes"],
          }))
        }
        searchMode={has("searchMode") ? searchMode : undefined}
        onSearchModeChange={setSearchMode}
      >
        {toolbar}
        {has("assetStatus") && (
          <MultiSelect
            values={assetStatuses}
            onValuesChange={(values) =>
              setAssetStatuses(values as AssetStatusFilterValue[])
            }
          >
            <MultiSelectTrigger className="h-9 w-[170px] border-2 border-border rounded-[4px]">
              <MultiSelectValue placeholder={t("assets.assetStatus")} />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("assets.searchStatuses"),
                emptyMessage: t("assets.noStatusesFound"),
              }}
            >
              <MultiSelectGroup>
                {assetStatusOptions.map((status) => (
                  <MultiSelectItem key={status} value={status}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: `var(--${status === "NEW" ? "chart-4" : status === "UPDATED" ? "accent-ink" : "muted-foreground"})`,
                        }}
                      />
                      {formatEnumLabel(status)}
                    </span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>
        )}

        {has("governance") && (
          <Select
            value={draft.governance}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, governance: value }))
            }
          >
            <SelectTrigger
              className="h-9 w-[190px] border-2 border-border rounded-[4px]"
              data-testid="governance-filter"
            >
              <SelectValue placeholder={t("governance.filter.label")} />
            </SelectTrigger>
            <SelectContent>
              {!defaultGovernance && (
                <SelectItem value={ALL}>
                  {lifecycleOnly
                    ? t("governance.filter.anyLifecycle")
                    : t("governance.filter.all")}
                </SelectItem>
              )}
              {GOVERNANCE_FILTER_VALUES.filter(
                (value) =>
                  (!defaultGovernance || value !== "ungoverned") &&
                  (!lifecycleOnly || lifecycleOnly.includes(value)),
              ).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`governance.filter.${value}` as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {responsibleMe && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-[4px] border-2 border-foreground"
            onClick={() => setResponsibleMe(false)}
            aria-label={t("assets.responsibleMeClear")}
            data-testid="responsible-me-filter"
          >
            {t("assets.responsibleMe")}
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isFilterLoading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.sources")}
            </span>
          ) : null}
          {has("export") && (
            <CsvExportButton
              exportPath="search/assets/export"
              total={total}
              entityLabel="asset findings"
              buildQuery={() => {
                const request = buildRequest({
                  draft,
                  sort,
                  skip: 0,
                  limit: 0,
                  scope,
                  assetStatuses,
                  searchMode: "off",
                });
                return filtersToSearchParams({
                  asset_search: request.assets?.search,
                  asset_sourceId: request.assets?.sourceId,
                  asset_status: request.assets?.status,
                  finding_detectorType: request.findings?.detectorType,
                  finding_severity: request.findings?.severity,
                  finding_includeResolved: request.findings?.includeResolved,
                  excludeFindings: request.options?.excludeFindings,
                  includeAssetsWithoutFindings:
                    request.options?.includeAssetsWithoutFindings,
                });
              }}
            />
          )}
        </div>
      </AssetFilterBar>

      {onExplore && picked.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5"
          data-testid="explore-picked-bar"
        >
          <span className="font-mono text-xs text-accent-ink">
            {t("assets.explore.picked", { count: picked.length })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-8 font-mono text-xs uppercase tracking-[0.08em]"
            onClick={() => setPicked([])}
          >
            {t("assets.explore.clearPicked")}
          </Button>
          {onAddToMap && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-[4px] border-2 font-mono text-xs font-bold uppercase tracking-[0.08em]"
              onClick={() => {
                onAddToMap(picked);
                setPicked([]);
              }}
              data-testid="explore-picked-add"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("assets.explore.addToMap", { count: picked.length })}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 rounded-[4px] border-0 bg-accent font-mono text-xs font-bold uppercase tracking-[0.08em] text-accent-foreground hover:bg-accent/90"
            onClick={() => {
              onExplore(picked, null);
              setPicked([]);
            }}
            data-testid="explore-picked"
          >
            <Compass className="h-3.5 w-3.5" aria-hidden />
            {t("assets.explore.together", { count: picked.length })}
          </Button>
        </div>
      )}

      {searchMode === "hybrid" && draft.search.trim() ? (
        <FeatureOffNotice
          feature="embeddings"
          context="search"
          variant="inline"
        />
      ) : null}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("assets.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("assets.noAssets")}
            description={t("assets.noAssetsHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead
                    className={cn(
                      "bg-white/95 dark:bg-card/95",
                      onExplore ? "w-[104px]" : "w-8",
                    )}
                  >
                    {onExplore && (
                      <Checkbox
                        checked={
                          pickedOnPage === 0
                            ? false
                            : pickedOnPage === pickable.length
                              ? true
                              : "indeterminate"
                        }
                        onCheckedChange={() =>
                          setPicked((current) =>
                            pickedOnPage === pickable.length
                              ? current.filter((id) => !pickable.includes(id))
                              : [
                                  ...current,
                                  ...pickable.filter(
                                    (id) => !current.includes(id),
                                  ),
                                ].slice(0, EXPLORE_MAX_SEEDS),
                          )
                        }
                        aria-label={t("assets.explore.pickAll")}
                        className="ml-2"
                        data-testid="explore-pick-all"
                      />
                    )}
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    {renderSortableHead(
                      t("assets.columns.asset"),
                      SearchAssetsSortByEnum.Name,
                    )}
                  </TableHead>
                  {show("source") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {renderSortableHead(
                        t("common.source"),
                        SearchAssetsSortByEnum.SourceId,
                      )}
                    </TableHead>
                  )}
                  {show("governance") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("governance.column")}
                    </TableHead>
                  )}
                  {show("quality") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("governance.qualityColumn")}
                    </TableHead>
                  )}
                  {show("sourceType") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {t("assets.columns.sourceType")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("assets.columns.sourceTypeDesc")}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {show("assetType") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {renderSortableHead(
                        t("assets.columns.assetType"),
                        SearchAssetsSortByEnum.AssetType,
                      )}
                    </TableHead>
                  )}
                  {show("status") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {renderSortableHead(
                        t("common.status"),
                        SearchAssetsSortByEnum.Status,
                      )}
                    </TableHead>
                  )}
                  {show("detectors") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {t("assets.columns.detectors")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("assets.columns.detectorsDesc")}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {show("topFindings") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {t("assets.columns.topFindings")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("assets.columns.topFindingsDesc")}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {show("severity") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {t("common.severity")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("assets.columns.severityDesc")}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {show("statusMix") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            {t("assets.columns.statusMix")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("assets.columns.statusMixDesc")}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {show("lastScanned") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {renderSortableHead(
                        t("assets.columns.lastScanned"),
                        SearchAssetsSortByEnum.LastScannedAt,
                      )}
                    </TableHead>
                  )}
                  {show("updated") && (
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {renderSortableHead(
                        t("common.updated"),
                        SearchAssetsSortByEnum.UpdatedAt,
                      )}
                    </TableHead>
                  )}
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
                  const dataset = datasets?.get(asset.id);
                  const reason = pinned?.reasons.get(asset.id);
                  const mapped = onMap?.has(asset.id) ?? false;
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
                      <TableRow
                        data-testid="asset-row"
                        data-on-map={mapped || undefined}
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-1">
                            {onExplore && (
                              <Checkbox
                                checked={picked.includes(asset.id)}
                                onCheckedChange={() => togglePicked(asset.id)}
                                aria-label={t("assets.explore.pick", {
                                  name: assetName,
                                })}
                                className="mr-1"
                              />
                            )}
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
                            {onExplore && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 w-7 rounded-[4px] border-2 p-0"
                                    onClick={() =>
                                      onExplore(
                                        reason?.ids ?? [asset.id],
                                        reason?.view ?? null,
                                      )
                                    }
                                    aria-label={t("assets.explore.one", {
                                      name: assetName,
                                    })}
                                    data-testid="asset-explore"
                                  >
                                    <Compass
                                      className="h-3.5 w-3.5"
                                      aria-hidden
                                    />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {reason && reason.ids.length > 1
                                    ? t("assets.explore.pair")
                                    : t("assets.explore.one", {
                                        name: assetName,
                                      })}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
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
                                    router.push(nsPath(`/assets/${asset.id}`))
                                  }
                                  data-testid="asset-name"
                                >
                                  {dataset && !dataset.canQuery && (
                                    <Lock
                                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                      aria-label={t(
                                        "sharedDatasets.page.locked",
                                      )}
                                    />
                                  )}
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
                            {(reason || mapped) && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
                                data-testid="asset-explore-reason"
                              >
                                {mapped && (
                                  <span className="inline-flex items-center gap-1 rounded-[3px] bg-accent px-1.5 py-px font-semibold text-accent-foreground">
                                    <Compass className="h-3 w-3" aria-hidden />
                                    {t("assets.explore.onMap")}
                                  </span>
                                )}
                                {reason?.label}
                              </div>
                            )}
                            {dataset && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid="asset-dataset-badges"
                              >
                                <DatasetBadges dataset={dataset} />
                                <span className="truncate text-[11px] text-muted-foreground">
                                  {dataset.owningGroup.name}
                                </span>
                              </div>
                            )}
                            {item.match?.text ? (
                              <p
                                className="mt-1 line-clamp-2 max-w-[300px] text-xs text-muted-foreground"
                                data-testid="asset-match"
                              >
                                <span className="font-medium text-foreground">
                                  {item.match.page != null
                                    ? t("assets.match.onPage", {
                                        page: item.match.page,
                                      })
                                    : t("assets.match.inText")}
                                </span>
                                {": "}
                                {item.match.text}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>

                        {show("source") && (
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <SourceTypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto justify-start p-0 text-left text-sm"
                                onClick={() =>
                                  router.push(
                                    nsPath(`/sources/${asset.sourceId}`),
                                  )
                                }
                              >
                                {sourceName}
                              </Button>
                            </div>
                          </TableCell>
                        )}

                        {show("governance") && (
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <GovernanceBadge
                                status={item.governance?.status ?? null}
                              />
                              {item.governance?.ownerRef && (
                                <ActorChip
                                  actorRef={item.governance.ownerRef}
                                />
                              )}
                            </div>
                          </TableCell>
                        )}

                        {show("quality") && (
                          <TableCell data-testid="asset-quality-cell">
                            {item.governance?.quality?.rules ? (
                              <QualityChip quality={item.governance.quality} />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        )}

                        {show("sourceType") && (
                          <TableCell>
                            <ToneBadge tone="neutral">
                              {formatEnumLabel(asset.sourceType)}
                            </ToneBadge>
                          </TableCell>
                        )}

                        {show("assetType") && (
                          <TableCell>
                            <AssetKindBadge kind={asset.assetType} />
                          </TableCell>
                        )}

                        {show("status") && (
                          <TableCell>
                            <ToneBadge
                              tone={ASSET_STATUS_TONE[asset.status] ?? "idle"}
                            >
                              {t(
                                `sources.asset${asset.status.charAt(0) + asset.status.slice(1).toLowerCase()}` as TranslationKey,
                              )}
                            </ToneBadge>
                          </TableCell>
                        )}

                        {show("detectors") && (
                          <TableCell>
                            <DetectorSummaryBadges
                              items={topDetectors.map((entry) => ({
                                detector: String(entry.detector),
                                count: entry.count,
                              }))}
                              maxVisible={3}
                            />
                          </TableCell>
                        )}

                        {show("topFindings") && (
                          <TableCell>
                            <TopFindingsBadges
                              items={topFindingTypes}
                              maxVisible={2}
                            />
                          </TableCell>
                        )}

                        {show("severity") && (
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
                                  {t(
                                    `findings.severityLabels.${highestSeverity.toUpperCase()}` as TranslationKey,
                                  )}
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
                        )}

                        {show("statusMix") && (
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
                                    {t(
                                      `findings.statusLabels.${entry.status}` as TranslationKey,
                                    )}{" "}
                                    · {entry.count}
                                  </StatusBadge>
                                ))}
                                {statusCounts.length > 2 && (
                                  <ToneBadge tone="neutral">
                                    +{statusCounts.length - 2}
                                  </ToneBadge>
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}

                        {show("lastScanned") && (
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
                        )}

                        {show("updated") && (
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
                        )}
                      </TableRow>

                      {isExpanded && canExpand && (
                        <TableRow>
                          <TableCell
                            colSpan={columns.length + 2}
                            className="p-0 bg-muted/15"
                          >
                            <FindingsSubTable
                              findings={item.findings}
                              onFindingClick={(findingId) =>
                                router.push(nsPath(`/findings/${findingId}`))
                              }
                              t={t}
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
              {t("assets.columns.updating")}
            </div>
          </div>
        ) : null}
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

        {!pinned && totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  label={t("common.pagination.previous")}
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
                        <PaginationEllipsis
                          label={t("common.pagination.morePages")}
                        />
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
                  label={t("common.pagination.next")}
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
