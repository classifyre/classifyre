"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useTranslation } from "@/hooks/use-translation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  Loader2,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { formatRelative } from "@/lib/date";
import { getAssetTypeIcon } from "@/lib/asset-type-icon";
import {
  api,
  SandboxControllerListRunsContentTypeEnum,
  SandboxControllerListRunsDetectorTypeEnum,
  SandboxControllerListRunsStatusEnum,
  SandboxRunDtoStatusEnum,
  type SandboxRunDto,
  type SandboxRunListResponseDto,
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
} from "@workspace/ui/components";
import {
  DetectorSummaryBadges,
  TopFindingsBadges,
} from "./finding-summary-badges";

type SandboxRunStatus = SandboxControllerListRunsStatusEnum;
type AssetContentType = SandboxControllerListRunsContentTypeEnum;

type SandboxFinding = {
  finding_type?: string;
  category?: string;
  severity?: string;
  confidence?: number;
  matched_content?: string;
  detector_type?: string;
  custom_detector_name?: string;
};

type SortBy =
  | "CREATED_AT"
  | "FILE_NAME"
  | "STATUS"
  | "FILE_SIZE_BYTES"
  | "DURATION_MS"
  | "FINDINGS_COUNT";
type SortOrder = "ASC" | "DESC";

type HasFindingsFilter = "ALL" | "WITH" | "WITHOUT";

type SandboxRunsTableProps = {
  onPollingChange?: (isPolling: boolean) => void;
};

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 2500;

const STATUS_CONFIG: Record<
  SandboxRunStatus,
  {
    label: string;
    badge: "default" | "secondary" | "outline" | "destructive";
    icon: LucideIcon;
  }
> = {
  COMPLETED: { label: "Done", badge: "default", icon: CheckCircle2 },
  RUNNING: { label: "Running", badge: "secondary", icon: Loader2 },
  PENDING: { label: "Queued", badge: "outline", icon: Clock },
  ERROR: { label: "Error", badge: "destructive", icon: AlertTriangle },
};

const CONTENT_TYPE_OPTIONS = Object.values(
  SandboxControllerListRunsContentTypeEnum,
);
const STATUS_OPTIONS = Object.values(SandboxControllerListRunsStatusEnum);
const DETECTOR_OPTIONS = Object.values(
  SandboxControllerListRunsDetectorTypeEnum,
);

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function toDetectorLabel(detector: unknown): string | null {
  if (typeof detector === "string" && detector.trim()) {
    return detector.trim();
  }

  if (!detector || typeof detector !== "object" || Array.isArray(detector)) {
    return null;
  }

  const item = detector as { type?: unknown; config?: unknown };
  const rawType = typeof item.type === "string" ? item.type.trim() : "";
  if (!rawType) return null;

  if (rawType.toUpperCase() !== "CUSTOM") {
    return rawType;
  }

  if (
    item.config &&
    typeof item.config === "object" &&
    !Array.isArray(item.config)
  ) {
    const config = item.config as {
      name?: unknown;
      custom_detector_key?: unknown;
    };
    if (typeof config.name === "string" && config.name.trim()) {
      return `CUSTOM:${config.name.trim()}`;
    }
    if (
      typeof config.custom_detector_key === "string" &&
      config.custom_detector_key.trim()
    ) {
      return `CUSTOM:${config.custom_detector_key.trim()}`;
    }
  }

  return "CUSTOM";
}

function computeRunDetectorCounts(
  detectors: unknown,
): Array<{ detector: string; count: number }> {
  if (!Array.isArray(detectors)) return [];
  const counts = new Map<string, number>();

  for (const detector of detectors) {
    const label = toDetectorLabel(detector);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([detector, count]) => ({ detector, count }))
    .sort((a, b) => b.count - a.count);
}

function computeTopFindingTypes(
  findings: SandboxFinding[],
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();

  for (const finding of findings) {
    const label = String(finding.finding_type ?? "").trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
}

function FindingsRow({ findings }: { findings: SandboxFinding[] }) {
  const { t } = useTranslation();
  if (findings.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-muted-foreground">
        {t("sandbox.runs.noRuns")}
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/10">
      <Table>
        <TableHeader className="bg-white/95 dark:bg-card/95">
          <TableRow>
            <TableHead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Detector
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("common.type")}
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("common.severity")}
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("common.confidence")}
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("findings.signals.matchedContent")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.map((finding, index) => {
            const severityLabel = String(
              finding.severity ?? "INFO",
            ).toUpperCase();
            const confidencePct =
              typeof finding.confidence === "number"
                ? Math.max(
                    0,
                    Math.min(100, Math.round(finding.confidence * 100)),
                  )
                : null;
            const detectorLabel =
              finding.detector_type === "CUSTOM" &&
              typeof finding.custom_detector_name === "string"
                ? finding.custom_detector_name
                : (finding.detector_type ?? "—");

            return (
              <TableRow
                key={`${String(finding.finding_type ?? "finding")}-${index}`}
              >
                <TableCell className="py-2 text-xs font-medium">
                  {detectorLabel}
                </TableCell>
                <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
                  {finding.finding_type ?? "—"}
                </TableCell>
                <TableCell className="py-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-[0.08em]"
                  >
                    {severityLabel}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
                  {confidencePct === null ? "—" : `${confidencePct}%`}
                </TableCell>
                <TableCell className="max-w-[360px] py-2">
                  <code className="line-clamp-2 break-all text-[11px] text-muted-foreground">
                    {String(finding.matched_content ?? "").slice(0, 140) || "—"}
                  </code>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RunRow({
  run,
  onDelete,
}: {
  run: SandboxRunDto;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const statusConfig = STATUS_CONFIG[run.status];
  const StatusIcon = statusConfig.icon;
  const canExpand = run.status === SandboxRunDtoStatusEnum.Completed;
  const isActive =
    run.status === SandboxRunDtoStatusEnum.Pending ||
    run.status === SandboxRunDtoStatusEnum.Running;

  const findings = Array.isArray(run.findings)
    ? (run.findings as unknown as SandboxFinding[])
    : [];
  const findingsCount = findings.length;

  const detectorCounts = computeRunDetectorCounts(run.detectors as unknown);
  const topFindingTypes = computeTopFindingTypes(findings);
  const ContentIcon = getAssetTypeIcon(run.contentType);

  const handleDelete = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setIsDeleting(true);
    try {
      await onDelete(run.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Fragment>
      <TableRow
        className={canExpand ? "cursor-pointer hover:bg-muted/40" : undefined}
        onClick={canExpand ? () => setExpanded((value) => !value) : undefined}
      >
        <TableCell className="w-8 py-2">
          {canExpand ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )
          ) : null}
        </TableCell>

        <TableCell className="max-w-[300px] py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm font-medium">{run.fileName}</p>
            </div>
          </div>
        </TableCell>

        <TableCell className="py-2">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={`h-3.5 w-3.5 ${isActive ? "animate-spin" : ""}`}
            />
            <Badge
              variant={statusConfig.badge}
              className="rounded-[4px] text-[10px] uppercase tracking-[0.1em]"
            >
              {statusConfig.label}
            </Badge>
          </div>
        </TableCell>

        <TableCell className="py-2">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-[4px] text-[11px]"
          >
            <ContentIcon className="h-3 w-3 text-muted-foreground" />
            {formatEnumLabel(run.contentType)}
          </Badge>
        </TableCell>

        <TableCell className="py-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {run.fileType || "—"}
          </span>
        </TableCell>

        <TableCell className="py-2">
          <span className="font-mono text-[11px]">
            {formatBytes(run.fileSizeBytes)}
          </span>
        </TableCell>

        <TableCell className="py-2">
          <span className="font-mono text-[11px]">
            {formatDuration(run.durationMs)}
          </span>
        </TableCell>

        <TableCell className="py-2">
          <DetectorSummaryBadges items={detectorCounts} maxVisible={3} />
        </TableCell>

        <TableCell className="py-2">
          <TopFindingsBadges items={topFindingTypes} maxVisible={2} />
        </TableCell>

        <TableCell className="py-2">
          {run.status === SandboxRunDtoStatusEnum.Completed ? (
            <Badge
              variant={findingsCount > 0 ? "secondary" : "outline"}
              className="rounded-[4px] text-[11px]"
            >
              {findingsCount}
            </Badge>
          ) : run.status === SandboxRunDtoStatusEnum.Error ? (
            <span
              className="block max-w-[180px] truncate text-xs text-destructive"
              title={run.errorMessage ?? undefined}
            >
              {run.errorMessage?.slice(0, 60) ?? "Error"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>

        <TableCell className="py-2 text-[11px] text-muted-foreground">
          {formatRelative(run.createdAt)}
        </TableCell>

        <TableCell className="py-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            disabled={isDeleting}
            onClick={(event) => void handleDelete(event)}
            title={t("sandbox.runs.deleteRun")}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </TableCell>
      </TableRow>

      {expanded && canExpand ? (
        <TableRow>
          <TableCell colSpan={12} className="p-0">
            <FindingsRow findings={findings} />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

export function SandboxRunsTable({
  onPollingChange,
}: SandboxRunsTableProps = {}) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<SandboxRunStatus[]>([]);
  const [contentTypeFilters, setContentTypeFilters] = useState<
    AssetContentType[]
  >([]);
  const [detectorFilters, setDetectorFilters] = useState<
    SandboxControllerListRunsDetectorTypeEnum[]
  >([]);
  const [hasFindingsFilter, setHasFindingsFilter] =
    useState<HasFindingsFilter>("ALL");

  const [sortBy, setSortBy] = useState<SortBy>("CREATED_AT");
  const [sortOrder, setSortOrder] = useState<SortOrder>("DESC");

  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SandboxRunListResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedOnceRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [
    statusFilters,
    contentTypeFilters,
    detectorFilters,
    hasFindingsFilter,
    pageSize,
    sortBy,
    sortOrder,
  ]);

  const resolvedPageSize = Number(pageSize);
  const safePageSize =
    Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
      ? resolvedPageSize
      : DEFAULT_PAGE_SIZE;

  const fetchRuns = useCallback(
    async (silent = false) => {
      if (!silent) {
        const isInitial = !hasFetchedOnceRef.current;
        if (isInitial) {
          setIsLoading(true);
        } else {
          setIsFilterLoading(true);
        }
      }

      try {
        const response = await api.sandbox.sandboxControllerListRuns({
          skip: (page - 1) * safePageSize,
          limit: safePageSize,
          search: debouncedSearch || undefined,
          status: statusFilters.length > 0 ? statusFilters : undefined,
          contentType:
            contentTypeFilters.length > 0 ? contentTypeFilters : undefined,
          detectorType:
            detectorFilters.length > 0 ? detectorFilters : undefined,
          hasFindings:
            hasFindingsFilter === "ALL"
              ? undefined
              : hasFindingsFilter === "WITH",
          sortBy,
          sortOrder,
        });

        setData(response);
        setError(null);
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load sandbox runs";
        setError(message);
      } finally {
        hasFetchedOnceRef.current = true;
        if (!silent) {
          setIsLoading(false);
          setIsFilterLoading(false);
        }
      }
    },
    [
      contentTypeFilters,
      debouncedSearch,
      detectorFilters,
      hasFindingsFilter,
      page,
      safePageSize,
      sortBy,
      sortOrder,
      statusFilters,
    ],
  );

  useEffect(() => {
    void fetchRuns(false);
  }, [fetchRuns]);

  const runs = data?.items ?? [];
  const hasActiveRuns = runs.some(
    (run) =>
      run.status === SandboxRunDtoStatusEnum.Pending ||
      run.status === SandboxRunDtoStatusEnum.Running,
  );

  useEffect(() => {
    onPollingChange?.(hasActiveRuns);
  }, [hasActiveRuns, onPollingChange]);

  useEffect(() => {
    if (!hasActiveRuns) return;
    const interval = setInterval(() => {
      void fetchRuns(true);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchRuns, hasActiveRuns]);

  const handleDelete = useCallback(
    async (id: string) => {
      await api.sandbox.sandboxControllerDeleteRun({ id });
      await fetchRuns(true);
    },
    [fetchRuns],
  );

  const total = data?.total ?? 0;
  const hasRows = runs.length > 0;
  const showInitialLoading = isLoading && data === null;

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, safePageSize)));
  const clampedPage = Math.min(page, totalPages);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const pageItems = useMemo(
    () => getPageItems(clampedPage, totalPages),
    [clampedPage, totalPages],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("sandbox.runs.search")}
            className="h-9 rounded-[4px] border-2 border-black pl-9"
          />
        </div>

        <MultiSelect
          values={statusFilters}
          onValuesChange={(values) =>
            setStatusFilters(values as SandboxRunStatus[])
          }
        >
          <MultiSelectTrigger className="h-9 w-[170px] rounded-[4px] border-2 border-black">
            <MultiSelectValue placeholder={t("common.status")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("sources.searchStatuses"),
              emptyMessage: t("sources.noStatusesFound"),
            }}
          >
            <MultiSelectGroup>
              {STATUS_OPTIONS.map((status) => (
                <MultiSelectItem key={status} value={status}>
                  {formatEnumLabel(status)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={contentTypeFilters}
          onValuesChange={(values) =>
            setContentTypeFilters(values as AssetContentType[])
          }
        >
          <MultiSelectTrigger className="h-9 w-[180px] rounded-[4px] border-2 border-black">
            <MultiSelectValue placeholder={t("sandbox.runs.contentType")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search content types...",
              emptyMessage: "No content types found",
            }}
          >
            <MultiSelectGroup>
              {CONTENT_TYPE_OPTIONS.map((contentType) => (
                <MultiSelectItem key={contentType} value={contentType}>
                  {formatEnumLabel(contentType)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <MultiSelect
          values={detectorFilters}
          onValuesChange={(values) =>
            setDetectorFilters(
              values as SandboxControllerListRunsDetectorTypeEnum[],
            )
          }
        >
          <MultiSelectTrigger className="h-9 w-[200px] rounded-[4px] border-2 border-black">
            <MultiSelectValue placeholder={t("sandbox.runs.detectors")} />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: "Search detectors...",
              emptyMessage: "No detectors found",
            }}
          >
            <MultiSelectGroup>
              {DETECTOR_OPTIONS.map((detector) => (
                <MultiSelectItem key={detector} value={detector}>
                  {formatEnumLabel(detector)}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        <Select
          value={hasFindingsFilter}
          onValueChange={(value) =>
            setHasFindingsFilter(value as HasFindingsFilter)
          }
        >
          <SelectTrigger className="h-9 w-[150px] rounded-[4px] border-2 border-black">
            <SelectValue placeholder={t("sandbox.runs.findings")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All runs</SelectItem>
            <SelectItem value="WITH">With findings</SelectItem>
            <SelectItem value="WITHOUT">No findings</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={`${sortBy}:${sortOrder}`}
          onValueChange={(value) => {
            const [nextBy, nextOrder] = value.split(":") as [SortBy, SortOrder];
            setSortBy(nextBy);
            setSortOrder(nextOrder);
          }}
        >
          <SelectTrigger className="h-9 w-[190px] rounded-[4px] border-2 border-black">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CREATED_AT:DESC">Newest first</SelectItem>
            <SelectItem value="CREATED_AT:ASC">Oldest first</SelectItem>
            <SelectItem value="FINDINGS_COUNT:DESC">Most findings</SelectItem>
            <SelectItem value="FILE_NAME:ASC">File name A-Z</SelectItem>
            <SelectItem value="FILE_SIZE_BYTES:DESC">Largest file</SelectItem>
          </SelectContent>
        </Select>

        {isFilterLoading ? (
          <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="relative min-h-[360px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("sandbox.runs.loading")}</span>
          </div>
        ) : !hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("sandbox.runs.noRuns")}
            description={t("sandbox.runs.noRunsHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-card/95 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="w-8 bg-white/95 dark:bg-card/95" />
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      File
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("common.status")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Content
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      MIME Type
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Size
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Duration
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sandbox.runs.detectors")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Top Findings
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t("sandbox.runs.findings")}
                    </span>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      When
                    </span>
                  </TableHead>
                  <TableHead className="w-10 bg-white/95 dark:bg-card/95" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} onDelete={handleDelete} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {isFilterLoading && hasRows ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing runs
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("common.rowsPerPage")}
          </span>
          <Select value={pageSize} onValueChange={setPageSize}>
            <SelectTrigger className="h-8 w-[130px] rounded-[4px] border-2 border-black">
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

        {totalPages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
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
                    {showEllipsis ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
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
                    if (canNext) setPage(clampedPage + 1);
                  }}
                  className={
                    !canNext ? "pointer-events-none opacity-50" : undefined
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
      </div>
    </div>
  );
}
