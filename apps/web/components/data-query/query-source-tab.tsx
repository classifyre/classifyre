"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  CalendarOff,
  CircleSlash,
  Copy,
  Filter,
  GitFork,
  Info,
  Lock,
  Network,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  SearchRunnersSortByEnum,
  SearchRunnersSortOrderEnum,
  type SearchAssetsChartsResponseDto,
  type SearchRunnersResponseDto,
  type SourceResponseDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  isIngestionSourceType,
  SourceIcon,
} from "@workspace/ui/components/source-icon";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { getSourceLabel } from "@workspace/schemas/source-labels";
import {
  GiveDataAccessButton,
  useDataAccessGrants,
  type DataScope,
} from "@/components/data-query/data-access";
import { SourceGovernanceView } from "@/components/governance/source-ownership";
import { SourceGovernanceSummary } from "@/components/governance/governance-summary";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { FindingsTable } from "@/components/findings-table";
import { RunnerStatusBadge } from "@/components/runner-status-badge";
import { useTranslation } from "@/hooks/use-translation";
import { useCan } from "@/hooks/use-me";
import { useFormatDuration } from "@/hooks/use-format-duration";
import { useNamespace } from "@/components/namespace-provider";
import { useSourceGovernance } from "@/lib/governance";
import { getSourceSchema } from "@/lib/schema-loader";
import { formatDate, formatRelative } from "@/lib/date";
import {
  catalogOfSource,
  copyText,
  type QueryCatalog,
  type QueryCatalogSource,
  type QueryCatalogTable,
} from "@/lib/data-query";
import {
  WorkbenchObjectShell,
  type WorkbenchSubtabItem,
} from "./workbench-subtabs";

const ExploreWorkspace = dynamic(
  () =>
    import("@/components/explore/explore-workspace").then(
      (m) => m.ExploreWorkspace,
    ),
  { ssr: false },
);

const QuerySchemaTab = dynamic(
  () => import("./query-schema-tab").then((m) => m.QuerySchemaTab),
  { ssr: false },
);

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * A database/source tab inside the SQL workbench (Navicat/DBeaver-style):
 * lists all tables of the source first for quick opening into data tabs, and
 * integrates Overview metadata, Governance, Findings, and Connections in
 * compact subtabs reusing the existing source-detail components.
 */
export function QuerySourceTab({
  source,
  catalog,
  onOpenTable,
  onEditInQuery,
}: {
  source: QueryCatalogSource;
  catalog?: QueryCatalog | null;
  onOpenTable: (table: QueryCatalogTable, source: QueryCatalogSource) => void;
  onEditInQuery?: (sql: string) => void;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const router = useRouter();
  const formatDuration = useFormatDuration();
  const canManageSource = useCan("source.manage");
  const canManageAccess = useCan("access.manage");

  const [subtab, setSubtab] = React.useState("tables");
  const [tableFilter, setTableFilter] = React.useState("");
  const [onlyQueryable, setOnlyQueryable] = React.useState(false);

  const [sourceDetails, setSourceDetails] =
    React.useState<SourceResponseDto | null>(null);
  const [recentRunners, setRecentRunners] = React.useState<
    SearchRunnersResponseDto["items"]
  >([]);
  const [assetCharts, setAssetCharts] =
    React.useState<SearchAssetsChartsResponseDto | null>(null);
  const [metaLoading, setMetaLoading] = React.useState(true);

  const sourceGovernance = useSourceGovernance(source.id);
  const scope = React.useMemo<DataScope>(
    () => ({ kind: "source", sourceId: source.id, name: source.name }),
    [source.id, source.name],
  );
  const access = useDataAccessGrants(scope);

  React.useEffect(() => {
    let active = true;
    setMetaLoading(true);
    Promise.all([
      api.sources.sourcesControllerGetSource({ id: source.id }).catch(() => null),
      api
        .searchRunners({
          filters: { sourceId: [source.id] },
          page: {
            skip: 0,
            limit: 3,
            sortBy: SearchRunnersSortByEnum.TriggeredAt,
            sortOrder: SearchRunnersSortOrderEnum.Desc,
          },
        })
        .catch(() => null),
      api.searchAssetsCharts({ assets: { sourceId: source.id } }).catch(() => null),
    ])
      .then(([src, runners, charts]) => {
        if (!active) return;
        setSourceDetails(src);
        setRecentRunners(runners?.items ?? []);
        setAssetCharts(charts);
      })
      .finally(() => {
        if (active) setMetaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source.id]);

  const queryableTables = React.useMemo(
    () => source.tables.filter((table) => table.canQuery),
    [source.tables],
  );

  const needle = tableFilter.trim().toLowerCase();
  const filteredTables = React.useMemo(
    () =>
      source.tables
        .filter(
          (table) =>
            (!onlyQueryable || table.canQuery) &&
            (!needle ||
              table.table.toLowerCase().includes(needle) ||
              table.schema.toLowerCase().includes(needle) ||
              table.name.toLowerCase().includes(needle) ||
              table.sqlName.toLowerCase().includes(needle)),
        )
        .sort(
          (a, b) =>
            a.schema.localeCompare(b.schema) || a.table.localeCompare(b.table),
        ),
    [source.tables, onlyQueryable, needle],
  );

  const requiredFields = React.useMemo(() => {
    if (!sourceDetails?.type || !sourceDetails?.config) return [];
    if (!isIngestionSourceType(sourceDetails.type)) return [];

    if (sourceDetails.type === "CUSTOM") {
      const config = sourceDetails.config as Record<string, unknown>;
      const required = config?.required as
        | { notebook?: { cellCount?: number; cells?: unknown[]; revision?: number } }
        | undefined;
      const notebook = required?.notebook ?? {};
      const cellCount =
        typeof notebook.cellCount === "number"
          ? notebook.cellCount
          : (notebook.cells ?? []).length;
      return [
        {
          key: "notebook",
          label: "notebook",
          value: `${cellCount} cell(s), revision ${notebook.revision ?? 1}`,
        },
      ];
    }

    const schema = getSourceSchema(sourceDetails.type);
    const requiredSchema = schema?.properties?.required as
      | { required?: string[] }
      | undefined;
    const requiredConfig = (sourceDetails.config as Record<string, unknown>)
      .required as Record<string, unknown> | undefined;
    if (!requiredSchema?.required || !requiredConfig) return [];

    return requiredSchema.required.map((key) => ({
      key,
      label: key.replace(/_/g, " "),
      value: requiredConfig[key],
    }));
  }, [sourceDetails?.type, sourceDetails?.config]);

  const lastRunner = recentRunners[0];

  const handleCopy = React.useCallback(
    (text: string) => {
      void copyText(text).then((ok) => {
        if (ok) toast.success(t("dataQuery.explorer.copied", { name: text }));
      });
    },
    [t],
  );

  const tablesContent = (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      data-testid={`source-tab-tables-${source.id}`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={tableFilter}
            onChange={(event) => setTableFilter(event.target.value)}
            placeholder={t("dataQuery.objectView.filterTables")}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id={`source-only-queryable-${source.id}`}
            checked={onlyQueryable}
            onCheckedChange={setOnlyQueryable}
          />
          <Label
            htmlFor={`source-only-queryable-${source.id}`}
            className="text-xs font-normal"
          >
            {t("dataQuery.onlyQueryable")}
          </Label>
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {t("dataQuery.sourceTables", {
            count: queryableTables.length,
            total: source.tables.length,
          })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-card">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{t("dataQuery.objectView.tableColumn")}</TableHead>
              <TableHead className="w-32">
                {t("dataQuery.objectView.schemaColumn")}
              </TableHead>
              <TableHead className="w-28 text-right">
                {t("dataQuery.objectView.columnsColumn")}
              </TableHead>
              <TableHead className="w-32">
                {t("dataQuery.objectView.accessColumn")}
              </TableHead>
              <TableHead className="w-28 text-right">
                {t("dataQuery.objectView.actionsColumn")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTables.map((table) => {
              const maskedCount = table.columns.filter(
                (col) => col.access && !col.inClear,
              ).length;
              return (
                <TableRow
                  key={table.assetId}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onOpenTable(table, source)}
                  data-testid={`source-table-row-${table.sqlName}`}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {!table.queryable ? (
                        <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : !table.canQuery ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Table2 className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs font-medium">
                          {table.table}
                        </div>
                        {table.name !== table.table && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {table.name}
                          </div>
                        )}
                      </div>
                      {table.rowFilter && (
                        <Filter
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {table.schema}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <span>{table.columns.length}</span>
                      {(maskedCount > 0 || (table.hiddenColumns ?? 0) > 0) && (
                        <ColumnAccessChip
                          action={maskedCount > 0 ? "mask" : "hide"}
                          compact
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {!table.queryable ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t("dataQuery.objectView.statusNotQueryable")}
                      </Badge>
                    ) : !table.canQuery ? (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Lock className="h-2.5 w-2.5" />
                        {t("dataQuery.objectView.statusLocked")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400"
                      >
                        {t("dataQuery.objectView.statusQueryable")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="inline-flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => onOpenTable(table, source)}
                        data-testid={`source-table-open-${table.sqlName}`}
                      >
                        {t("dataQuery.objectView.openTable")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={t("dataQuery.explorer.copyNameHint", {
                          name: table.sqlName,
                        })}
                        onClick={() => handleCopy(table.sqlName)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!filteredTables.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("dataQuery.noTables")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const overviewContent = metaLoading && !sourceDetails ? (
    <div className="flex items-center justify-center py-12">
      <Spinner />
    </div>
  ) : (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("dataQuery.objectView.tablesInSql")}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums">
              {source.tables.length.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("dataQuery.objectView.queryableTables")}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums">
              {queryableTables.length.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("sources.totalAssets")}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums">
              {(assetCharts?.totals.totalAssets ?? source.tables.length).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("sources.detail.lastScanStatus")}
            </p>
            <div className="mt-2">
              {lastRunner ? (
                <RunnerStatusBadge status={lastRunner.status} />
              ) : (
                <span className="text-sm text-muted-foreground">
                  {t("sources.detail.notScannedYet")}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {sourceGovernance.data && (
        <SourceGovernanceSummary
          governance={sourceGovernance.data}
          onOpen={() => setSubtab("governance")}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("sources.detail.sourceDetails")}
            </CardTitle>
            <CardDescription>
              {t("sources.detail.sourceDetailsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">
                  {t("common.type")}
                </p>
                <div className="inline-flex items-center gap-2">
                  <SourceIcon source={source.type} size="sm" />
                  <Badge variant="outline">
                    {isIngestionSourceType(source.type)
                      ? getSourceLabel(source.type)
                      : source.type}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">
                  {t("dataQuery.objectView.sqlNameLabel")}
                </p>
                <p className="font-mono text-sm">{source.sqlName}</p>
              </div>
              {sourceDetails?.createdAt && (
                <div className="space-y-1">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("common.created")}
                  </p>
                  <p className="text-sm">{formatDate(sourceDetails.createdAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(sourceDetails.createdAt)}
                  </p>
                </div>
              )}
              {sourceDetails?.updatedAt && (
                <div className="space-y-1">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("sources.detail.lastUpdated")}
                  </p>
                  <p className="text-sm">{formatDate(sourceDetails.updatedAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(sourceDetails.updatedAt)}
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">
                  {t("sources.detail.lastScan")}
                </p>
                <p className="text-sm">
                  {lastRunner
                    ? formatDate(lastRunner.triggeredAt)
                    : t("sources.detail.notScannedYet")}
                </p>
                {lastRunner && (
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(lastRunner.triggeredAt)}
                    {lastRunner.durationMs != null &&
                      ` · ${formatDuration(lastRunner.durationMs)}`}
                  </p>
                )}
              </div>
              {sourceDetails && (
                <div className="space-y-1">
                  <p className="text-xs uppercase text-muted-foreground">
                    {t("sources.detail.scheduleSection")}
                  </p>
                  {sourceDetails.scheduleMode === "AUTO" ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[#4a7c00]">
                      <CalendarClock className="h-4 w-4 shrink-0" />
                      <span>{t("schedule.modeAutomatic")}</span>
                    </div>
                  ) : sourceDetails.scheduleEnabled ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-[#4a7c00]">
                      <CalendarClock className="h-4 w-4 shrink-0" />
                      <span className="font-mono text-xs">
                        {sourceDetails.scheduleCron ?? "—"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarOff className="h-4 w-4 shrink-0" />
                      <span>{t("sources.detail.manualOnly")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {canManageSource && requiredFields.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("sources.detail.requiredDetails")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {requiredFields.map(({ key, label, value }) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-3"
                  >
                    <p className="text-xs capitalize text-muted-foreground">
                      {label}
                    </p>
                    <p
                      className="line-clamp-2 text-right font-mono text-xs"
                      title={formatFieldValue(value)}
                    >
                      {formatFieldValue(value)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t("sources.detail.recentRunners")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentRunners.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("sources.detail.notScannedMessage")}
                </p>
              ) : (
                <div className="space-y-2">
                  {recentRunners.map((runner) => (
                    <button
                      key={runner.id}
                      type="button"
                      onClick={() =>
                        router.push(nsHref(`/scans/${runner.id}`))
                      }
                      className="flex w-full items-center justify-between gap-2 rounded border px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <RunnerStatusBadge status={runner.status} />
                          <span className="truncate text-xs text-muted-foreground">
                            {formatRelative(runner.triggeredAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("sources.detail.runSummaryLine", {
                            findings: runner.totalFindings.toLocaleString(),
                            assets: (
                              runner.assetsCreated +
                              runner.assetsUpdated +
                              runner.assetsUnchanged
                            ).toLocaleString(),
                          })}
                        </p>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  const scopedCatalog = React.useMemo<QueryCatalog>(() => {
    if (catalog) return catalogOfSource(catalog, source.id);
    return {
      canQueryAll: false,
      limits: { maxRows: 10000, timeoutSeconds: 120, exportMaxRows: 1000000 },
      sources: [source],
      relations: [],
    };
  }, [catalog, source]);

  const tabs: WorkbenchSubtabItem[] = [
    {
      value: "tables",
      label: t("dataQuery.objectView.subtabs.tables"),
      icon: <Table2 className="h-3.5 w-3.5" />,
      badge: (
        <span className="rounded bg-muted px-1 py-0.2 text-[10px] tabular-nums text-muted-foreground">
          {source.tables.length}
        </span>
      ),
      testId: `source-subtab-tables-${source.id}`,
      content: tablesContent,
    },
    {
      value: "visual-schema",
      label: t("dataQuery.objectView.subtabs.visualSchema"),
      icon: <Network className="h-3.5 w-3.5" />,
      testId: `source-subtab-schema-${source.id}`,
      content: (
        <div className="h-full min-h-[540px]">
          <QuerySchemaTab
            catalog={scopedCatalog}
            scopeKey={`source:${source.id}`}
            autoPopulateSourceId={source.id}
            onOpenInSql={onEditInQuery}
            onOpenTable={onOpenTable}
          />
        </div>
      ),
    },
    {
      value: "overview",
      label: t("dataQuery.objectView.subtabs.overview"),
      icon: <Info className="h-3.5 w-3.5" />,
      testId: `source-subtab-overview-${source.id}`,
      content: overviewContent,
    },
    {
      value: "governance",
      label: t("dataQuery.objectView.subtabs.governance"),
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      testId: `source-subtab-governance-${source.id}`,
      content: sourceGovernance.data ? (
        <SourceGovernanceView
          sourceId={source.id}
          governance={sourceGovernance.data}
          onChange={sourceGovernance.setData}
        />
      ) : (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ),
    },
    {
      value: "findings",
      label: t("dataQuery.objectView.subtabs.findings"),
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      testId: `source-subtab-findings-${source.id}`,
      content: (
        <React.Suspense
          fallback={
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          }
        >
          <FindingsTable
            lockedFilters={{
              sourceId: [source.id],
              includeResolved: true,
            }}
          />
        </React.Suspense>
      ),
    },
    {
      value: "connections",
      label: t("dataQuery.objectView.subtabs.connections"),
      icon: <GitFork className="h-3.5 w-3.5" />,
      testId: `source-subtab-connections-${source.id}`,
      content: (
        <ExploreWorkspace
          mode="source"
          sourceId={source.id}
          sourceName={source.name}
        />
      ),
    },
  ];

  return (
    <WorkbenchObjectShell
      testId={`query-source-tab-${source.id}`}
      icon={<SourceIcon source={source.type} size="sm" />}
      title={source.name}
      titleHref={nsHref(`/sources/${source.id}`)}
      titleHint={t("dataQuery.objectView.openFullSource")}
      sqlName={source.sqlName}
      copyHint={t("dataQuery.explorer.copySourceHint", {
        name: source.sqlName,
      })}
      actions={
        canManageAccess ? (
          <GiveDataAccessButton scope={scope} access={access} />
        ) : undefined
      }
      tabs={tabs}
      activeTab={subtab}
      onTabChange={setSubtab}
    />
  );
}
