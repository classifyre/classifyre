"use client";

import { nsPath } from "@/lib/ns-path";
import {Fragment, Suspense, useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslation} from "@/hooks/use-translation";
import {
    ArrowDown,
    ArrowUp,
    ChevronDown,
    ChevronRight,
    ChevronsUpDown,
    Loader2,
    Search,
} from "lucide-react";
import {
    api,
    SearchFindingsFiltersInputDtoDetectorTypeEnum,
    type CustomDetectorResponseDto,
    type SearchFindingsRequestDto,
} from "@workspace/api-client";
import {
    Badge,
    Button,
    EmptyState,
    Input,
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
    statusBadgeClass,
} from "@workspace/ui/components";
import {formatDate, formatRelative} from "@/lib/date";
import {TAG_PIPELINE_TYPE, detectorCatalogStatusLabel, detectorCatalogStatusToRunnerStatus, isVisualDetector,} from "@/lib/custom-detector-badge";
import {DataTableFooter} from "@/components/data-table-footer";
import {getRunnerStatusBadgeTone} from "@/lib/runner-status-badge";
import {CustomDetectorTypeBadge, VisualScanBadge} from "@/components/detector-type-badge";
import {useDetectorVision} from "@/hooks/use-detector-vision";
import {FindingsTable} from "@/components/findings-table";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

type SortBy =
    | "updatedAt"
    | "name"
    | "status"
    | "findingsCount"
    | "sourcesUsingCount"
    | "sourcesWithFindingsCount";

type SortOrder = "asc" | "desc";

function compareNullableDate(
    left?: string | null,
    right?: string | null,
): number {
    const leftTime = left ? new Date(left).getTime() : 0;
    const rightTime = right ? new Date(right).getTime() : 0;
    return leftTime - rightTime;
}

function sortRows(
    rows: CustomDetectorResponseDto[],
    sortBy: SortBy,
    sortOrder: SortOrder,
): CustomDetectorResponseDto[] {
    const ordered = [...rows].sort((a, b) => {
        switch (sortBy) {
            case "name":
                return a.name.localeCompare(b.name);
            case "findingsCount":
                return a.findingsCount - b.findingsCount;
            case "status":
                return Number(a.isActive) - Number(b.isActive);
            case "sourcesUsingCount":
                return a.sourcesUsingCount - b.sourcesUsingCount;
            case "sourcesWithFindingsCount":
                return a.sourcesWithFindingsCount - b.sourcesWithFindingsCount;
            case "updatedAt":
            default:
                return compareNullableDate(a.updatedAt, b.updatedAt);
        }
    });

    if (sortOrder === "desc") {
        ordered.reverse();
    }

    return ordered;
}

function DetectorFindings({detectorKey}: { detectorKey: string }) {
    const lockedFilters = useMemo<SearchFindingsRequestDto["filters"]>(
        () => ({
            detectorType: [SearchFindingsFiltersInputDtoDetectorTypeEnum.Custom],
            customDetectorKey: [detectorKey],
            includeResolved: true,
        }),
        [detectorKey],
    );

    return (
        <Suspense>
            <FindingsTable lockedFilters={lockedFilters} disableUrlSync />
        </Suspense>
    );
}

export function CustomDetectorsTable() {
    const router = useRouter();
    const {t} = useTranslation();
    const {supportsVision} = useDetectorVision();

    const [rows, setRows] = useState<CustomDetectorResponseDto[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchInput, setSearchInput] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<
        "ALL" | "ACTIVE" | "INACTIVE"
    >("ALL");
    const [usageFilter, setUsageFilter] = useState<
        "ALL" | "USED" | "WITH_RESULTS"
    >("ALL");
    const [sortBy, setSortBy] = useState<SortBy>("updatedAt");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [pageSize, setPageSize] = useState<string>(
        String(PAGE_SIZE_OPTIONS[0]),
    );
    const [page, setPage] = useState(1);
    const [expandedDetectorId, setExpandedDetectorId] = useState<string | null>(
        null,
    );

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchInput.trim().toLowerCase());
            setPage(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [searchInput]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter, usageFilter, pageSize]);

    const load = async () => {
        try {

            setIsLoading(true);
            setError(null);
            const payload = await api.listCustomDetectors({includeInactive: true});
            setRows(payload ?? []);
        } catch (loadError) {
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load detectors",
            );
            setRows([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const filtered = useMemo(() => {
        const searched = rows.filter((row) => {
            if (statusFilter === "ACTIVE" && !row.isActive) {
                return false;
            }
            if (statusFilter === "INACTIVE" && row.isActive) {
                return false;
            }

            if (usageFilter === "USED" && row.sourcesUsingCount <= 0) {
                return false;
            }
            if (usageFilter === "WITH_RESULTS" && row.sourcesWithFindingsCount <= 0) {
                return false;
            }

            if (!debouncedSearch) {
                return true;
            }

            const haystack = [
                row.name,
                row.key,
                row.description ?? "",
                ...row.recentSourceNames,
            ]
                .join(" ")
                .toLowerCase();

            return haystack.includes(debouncedSearch);
        });

        return sortRows(searched, sortBy, sortOrder);
    }, [
        rows,
        statusFilter,
        usageFilter,
        debouncedSearch,
        sortBy,
        sortOrder,
    ]);

    const resolvedPageSize = Number(pageSize);
    const safePageSize =
        Number.isFinite(resolvedPageSize) && resolvedPageSize > 0
            ? resolvedPageSize
            : 20;
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, safePageSize)));
    const clampedPage = Math.min(page, totalPages);

    useEffect(() => {
        if (page !== clampedPage) {
            setPage(clampedPage);
        }
    }, [page, clampedPage]);

    const pagedRows = useMemo(() => {
        const start = (clampedPage - 1) * safePageSize;
        return filtered.slice(start, start + safePageSize);
    }, [filtered, clampedPage, safePageSize]);

    useEffect(() => {
        if (
            expandedDetectorId &&
            !pagedRows.some((row) => row.id === expandedDetectorId)
        ) {
            setExpandedDetectorId(null);
        }
    }, [expandedDetectorId, pagedRows]);

    const onSort = (field: SortBy) => {
        setPage(1);
        if (sortBy === field) {
            setSortOrder((current) => (current === "desc" ? "asc" : "desc"));
            return;
        }
        setSortBy(field);
        setSortOrder(field === "name" ? "asc" : "desc");
    };

    const renderSortIcon = (field: SortBy) => {
        if (sortBy !== field) {
            return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground"/>;
        }
        return sortOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5"/>
        ) : (
            <ArrowDown className="h-3.5 w-3.5"/>
        );
    };

    const renderSortHead = (label: string, field: SortBy) => (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-1.5 font-medium"
            onClick={() => onSort(field)}
        >
            <span>{label}</span>
            {renderSortIcon(field)}
        </Button>
    );

    if (isLoading && rows.length === 0) {
        return (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin"/>
                {t("common.loading")}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-[1.8]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                    <Input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder={t("detectors.search")}
                        className="h-9 rounded-[4px] border-2 border-border pl-9"
                    />
                </div>

                <Select
                    value={statusFilter}
                    onValueChange={(value) =>
                        setStatusFilter(value as typeof statusFilter)
                    }
                >
                    <SelectTrigger className="h-9 min-w-[150px] border-2 border-border rounded-[4px]">
                        <SelectValue placeholder={t("common.status")}/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All status</SelectItem>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={usageFilter}
                    onValueChange={(value) => setUsageFilter(value as typeof usageFilter)}
                >
                    <SelectTrigger className="h-9 min-w-[170px] border-2 border-border rounded-[4px]">
                        <SelectValue placeholder={t("detectors.sourcesUsing")}/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">All usage</SelectItem>
                        <SelectItem value="USED">Used in sources</SelectItem>
                        <SelectItem value="WITH_RESULTS">Has findings</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {error ? (
                <EmptyState
                    title={t("detectors.loadError")}
                    description={error}
                    action={{
                        label: t("common.retry"),
                        onClick: () => void load(),
                    }}
                />
            ) : (
                <div className="overflow-hidden rounded-[4px] bg-white dark:bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10" />
                                <TableHead>{renderSortHead("Detector", "name")}</TableHead>
                                <TableHead>{t("common.type")}</TableHead>
                                <TableHead>
                                    {renderSortHead(t("common.status"), "status")}
                                </TableHead>
                                <TableHead>
                                    {renderSortHead(t("common.sources"), "sourcesUsingCount")}
                                </TableHead>
                                <TableHead>
                                    {renderSortHead("Results", "findingsCount")}
                                </TableHead>
                                <TableHead>
                                    {renderSortHead(t("common.updated"), "updatedAt")}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pagedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7}>
                                        <EmptyState
                                            title={t("detectors.noDetectors")}
                                            description={t("detectors.noDetectorsHint")}
                                        />
                                    </TableCell>
                                </TableRow>
                            ) : (
                                pagedRows.map((row) => {
                                    const isExpanded = expandedDetectorId === row.id;
                                    // Tags are never selectable on a source, so a
                                    // sources count would always read zero.
                                    const rowPipelineType = ((row as any).pipelineSchema?.type as string | undefined)?.toUpperCase();
                                    const isTagRow = rowPipelineType === TAG_PIPELINE_TYPE;
                                    const sourcesUsing = row.sourcesUsing ?? [];

                                    return (
                                    <Fragment key={row.id}>
                                    <TableRow data-testid="detector-row">
                                        <TableCell className="py-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 w-7 p-0"
                                                aria-expanded={isExpanded}
                                                aria-label={t(
                                                    isExpanded
                                                        ? "detectors.collapseResults"
                                                        : "detectors.expandResults",
                                                    {name: row.name},
                                                )}
                                                onClick={() =>
                                                    setExpandedDetectorId((current) =>
                                                        current === row.id ? null : row.id,
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
                                            <div className="space-y-1">
                                                <button
                                                    type="button"
                                                    className="font-medium leading-tight underline-offset-2 hover:underline"
                                                    onClick={() => router.push(nsPath(`/detectors/${row.id}`))}
                                                >
                                                    {row.name}
                                                </button>
                                                <p className="font-mono text-[11px] text-muted-foreground">
                                                    {row.key}
                                                </p>
                                                {row.description ? (
                                                    <p className="line-clamp-2 max-w-[420px] text-xs text-muted-foreground">
                                                        {row.description}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap items-center gap-1">
                                                <CustomDetectorTypeBadge
                                                    method={row.method}
                                                    pipelineType={(row as any).pipelineSchema?.type as string | undefined}
                                                />
                                                {isVisualDetector(
                                                    (row as any).pipelineSchema?.type as string | undefined,
                                                    supportsVision(row.aiProviderConfigId),
                                                ) ? (
                                                    <VisualScanBadge />
                                                ) : null}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {/* Was the runner tones applied on top of Badge's
                                                default variant, so the tone's background fought a
                                                2px black border. Same tone, the shared chrome. */}
                                            <Badge
                                                variant="outline"
                                                className={`${statusBadgeClass} ${getRunnerStatusBadgeTone(
                                                    detectorCatalogStatusToRunnerStatus(row.isActive),
                                                )}`}
                                            >
                                                {detectorCatalogStatusLabel(row.isActive)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {isTagRow ? (
                                                <p
                                                    className="text-sm text-muted-foreground"
                                                    title={t("detectors.tag.notSelectable")}
                                                >
                                                    —
                                                </p>
                                            ) : sourcesUsing.length === 0 ? (
                                                <p className="text-xs text-muted-foreground">
                                                    No source binding yet
                                                </p>
                                            ) : (
                                            <div className="min-w-0 space-y-1">
                                                <p className="text-sm font-medium">
                                                    {row.sourcesUsingCount}
                                                </p>
                                                <ul className="max-w-[240px] space-y-0.5">
                                                    {sourcesUsing.map((source) => (
                                                        <li key={source.id || source.name} className="min-w-0">
                                                            {source.id ? (
                                                                <button
                                                                    type="button"
                                                                    title={source.name}
                                                                    onClick={() =>
                                                                        router.push(nsPath(`/sources/${source.id}`))
                                                                    }
                                                                    className="block max-w-full truncate text-left text-xs underline underline-offset-2 hover:text-foreground/70"
                                                                >
                                                                    {source.name}
                                                                </button>
                                                            ) : (
                                                                <span
                                                                    title={source.name}
                                                                    className="block max-w-full truncate text-xs text-muted-foreground"
                                                                >
                                                                    {source.name}
                                                                </span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {row.sourcesUsingCount > sourcesUsing.length ? (
                                                    <p className="text-xs text-muted-foreground">
                                                        +{row.sourcesUsingCount - sourcesUsing.length} more
                                                    </p>
                                                ) : null}
                                            </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium">
                                                    {row.findingsCount}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {row.sourcesWithFindingsCount} source
                                                    {row.sourcesWithFindingsCount === 1 ? "" : "s"} with
                                                    findings
                                                </p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="space-y-0.5">
                                                <p className="text-sm">{formatDate(row.updatedAt)}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatRelative(row.updatedAt)}
                                                </p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    {isExpanded ? (
                                        <TableRow data-testid="detector-findings-row">
                                            <TableCell
                                                colSpan={7}
                                                className="bg-muted/15 p-4 whitespace-normal"
                                            >
                                                <DetectorFindings detectorKey={row.key} />
                                            </TableCell>
                                        </TableRow>
                                    ) : null}
                                    </Fragment>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            <DataTableFooter
                page={clampedPage}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                totalLabel={total.toLocaleString()}
                emptyLabel="0 detectors"
            />
        </div>
    );
}
