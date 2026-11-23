"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  CircleSlash,
  Code2,
  Columns3,
  Copy,
  ExternalLink,
  FileCode2,
  GitFork,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import { api, type AssetListItemDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { ConnectToolButton } from "@/components/sql-connections/connect-tool-button";
import { RequestAccess } from "@/components/access-requests/request-access";
import { AssetKindBadge } from "@/components/asset-kind-badge";
import { AssetMetadataCard } from "@/components/asset-metadata-card";
import { ColumnLineagePanel } from "@/components/column-lineage-panel";
import { FindingsTable } from "@/components/findings-table";
import { ReferencingFindingsPanel } from "@/components/referencing-findings-panel";
import { ActorChip } from "@/components/actor-chip";
import { AssetGovernanceView } from "@/components/governance/asset-governance-view";
import { AssetGovernanceSummary } from "@/components/governance/governance-summary";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { ClassificationChip } from "@/components/governance/columns-card";
import { GovernanceBadge } from "@/components/governance/governance-badge";
import { QualityChip } from "@/components/governance/quality-chip";
import { UsageCard } from "@/components/governance/usage-card";
import {
  DatasetBadges,
  DatasetDefinitionCard,
  DatasetInputsCard,
  DatasetOverviewCard,
} from "@/components/shared-datasets/dataset-cards";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";
import { useCan } from "@/hooks/use-me";
import { formatAssetKind } from "@/lib/asset-kind";
import {
  useAssetColumns,
  useAssetGovernance,
  useAssetQuality,
  useAssetUsage,
} from "@/lib/governance";
import { useSharedDataset } from "@/lib/shared-datasets";
import {
  apiErrorMessage,
  cancelQuery,
  copyText,
  downloadExport,
  fetchRows,
  previewSql,
  runErrorMessage,
  startQuery,
  TABLE_PREVIEW_LIMIT,
  waitForRun,
  type ExportFormat,
  type QueryCatalogSource,
  type QueryCatalogTable,
  type QueryRows,
  type QueryRun,
} from "@/lib/data-query";
import { DataNotice } from "./data-tab";
import {
  DataAccessSection,
  GiveDataAccessButton,
  useDataAccessGrants,
  type DataScope,
} from "./data-access";
import { RunMasksNote, RunRowsNote } from "./query-workbench";
import { ResultsGrid } from "./results-grid";
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

function columnNames(metadata: unknown): string[] {
  const columns = (metadata as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) =>
      typeof column === "string"
        ? column
        : ((column as { name?: unknown })?.name ?? ""),
    )
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
}

/**
 * A table/asset tab inside the SQL workbench (DBeaver-style):
 * - Automatically preloads the first 200 rows in its Data subtab.
 * - Shows the preview SQL with one-click Copy and "Edit in SQL" (which
 *   switches to the fixed main SQL Query tab with that query loaded).
 * - Exposes Overview (columns, metadata, usage, governance summary),
 *   Governance, Findings, Connections, and Access in compact subtabs by
 *   reusing the existing asset-detail components.
 */
export function QueryAssetTab({
  table,
  source,
  onEditInQuery,
  onOpenSource,
  onRunFinished,
}: {
  table: QueryCatalogTable;
  source: QueryCatalogSource;
  onEditInQuery: (sql: string) => void;
  onOpenSource: (source: QueryCatalogSource) => void;
  onRunFinished?: (run: QueryRun) => void;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const canViewActivity = useCan("activity.view");
  const canViewAccess = useCan("access.view");
  const canManageAccess = useCan("access.manage");

  const [subtab, setSubtab] = React.useState("data");
  const [showSql, setShowSql] = React.useState(true);

  const querySql = React.useMemo(
    () => previewSql(table.sqlName, TABLE_PREVIEW_LIMIT),
    [table.sqlName],
  );

  // Preloaded 200-row query state — owned here so switching subtabs never
  // discards the fetched rows or triggers redundant queries.
  const [run, setRun] = React.useState<QueryRun | null>(null);
  const [rows, setRows] = React.useState<QueryRows | null>(null);
  const [queryError, setQueryError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRef = React.useRef(0);
  const onRunFinishedRef = React.useRef(onRunFinished);
  onRunFinishedRef.current = onRunFinished;

  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setElapsed(Date.now() - startedRef.current),
      200,
    );
    return () => clearInterval(timer);
  }, [busy]);

  const loadPreview = React.useCallback(async () => {
    if (!table.canQuery) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setQueryError(null);
    startedRef.current = Date.now();
    setElapsed(0);
    try {
      const created = await startQuery(querySql);
      if (controller.signal.aborted) return;
      setRun(created);
      const finished = await waitForRun(created.id, setRun, controller.signal);
      if (controller.signal.aborted) return;
      if (finished.status === "SUCCESS") {
        const fetched = await fetchRows(finished);
        if (!controller.signal.aborted) setRows(fetched);
      } else {
        setQueryError(runErrorMessage(finished));
      }
      onRunFinishedRef.current?.(finished);
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError") {
        setQueryError(await apiErrorMessage(caught));
      }
    } finally {
      if (!controller.signal.aborted) {
        setElapsed(Date.now() - startedRef.current);
        setBusy(false);
      }
    }
  }, [querySql, table.canQuery]);

  React.useEffect(() => {
    void loadPreview();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadPreview]);

  const stopPreview = React.useCallback(async () => {
    if (!run) return;
    abortRef.current?.abort();
    try {
      setRun(await cancelQuery(run.id));
    } finally {
      setBusy(false);
    }
  }, [run]);

  const exportAs = React.useCallback(
    async (fileFormat: ExportFormat) => {
      if (!table.canQuery) return;
      try {
        const created = await startQuery(querySql, fileFormat);
        const finished = await waitForRun(created.id, () => undefined);
        if (finished.status !== "SUCCESS") {
          toast.error(
            runErrorMessage(finished) ?? t("dataQuery.export.failed"),
          );
          return;
        }
        await downloadExport(finished);
        toast.success(
          finished.truncated
            ? t("dataQuery.export.truncated", {
                count: finished.rowCount ?? 0,
              })
            : t("dataQuery.export.done", { count: finished.rowCount ?? 0 }),
        );
      } catch (caught) {
        toast.error(await apiErrorMessage(caught));
      }
    },
    [querySql, t, table.canQuery],
  );

  // Asset details & governance hooks (same APIs as /assets/[id]).
  const [assetDetails, setAssetDetails] =
    React.useState<AssetListItemDto | null>(null);
  const [assetLoading, setAssetLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setAssetLoading(true);
    api.assets
      .assetsControllerGetAsset({ id: table.assetId })
      .then((res) => {
        if (active) setAssetDetails(res);
      })
      .catch(() => {
        if (active) setAssetDetails(null);
      })
      .finally(() => {
        if (active) setAssetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table.assetId]);

  const governance = useAssetGovernance(table.assetId);
  const columnsMeta = useAssetColumns(table.assetId);
  const quality = useAssetQuality(table.assetId);
  const usage = useAssetUsage(table.assetId, canViewActivity);

  const isDataset =
    assetDetails?.sourceType === "SHARED_DATASET" ||
    source.type === "SHARED_DATASET";
  const dataset = useSharedDataset(isDataset ? table.assetId : null);

  const scope = React.useMemo<DataScope>(
    () => ({
      kind: "asset",
      assetId: table.assetId,
      sourceId: table.sourceId,
      name: table.name,
    }),
    [table.assetId, table.name, table.sourceId],
  );
  const access = useDataAccessGrants(scope);

  const owner = governance.data?.roles.find(
    (role: { role: string }) => role.role === "OWNER",
  );
  const masked =
    (table.hiddenColumns ?? 0) > 0 ||
    table.columns.some((column) => column.access && !column.inClear);

  const handleCopySql = React.useCallback(() => {
    void copyText(querySql).then((ok) => {
      if (ok) toast.success(t("dataQuery.objectView.copiedSql"));
    });
  }, [querySql, t]);

  const columnsByName = React.useMemo(() => {
    const map = new Map(
      (columnsMeta.data?.columns ?? []).map((col) => [col.name, col] as const),
    );
    return map;
  }, [columnsMeta.data]);

  const dataContent = !table.queryable ? (
    <DataNotice title={t("dataQuery.notQueryable")}>
      {table.reason ?? t("dataQuery.notQueryable")}
    </DataNotice>
  ) : !table.canQuery ? (
    <div className="space-y-3">
      <DataNotice title={t("dataQuery.assetLockedTitle")} locked>
        {t("dataQuery.assetLocked")}
      </DataNotice>
      <RequestAccess target={{ scopeType: "asset", scopeId: table.assetId }} />
    </div>
  ) : (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2.5"
      data-testid={`asset-tab-data-${table.assetId}`}
    >
      {/* DBeaver-style toolbar: Show SQL, Refresh, Copy SQL, Edit in SQL */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
        <Button
          size="sm"
          variant={showSql ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          onClick={() => setShowSql((open) => !open)}
          data-testid="asset-toggle-sql"
        >
          <Code2 className="mr-1.5 h-3.5 w-3.5" />
          {showSql
            ? t("dataQuery.objectView.hideSql")
            : t("dataQuery.objectView.showSql")}
        </Button>

        {busy ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() => void stopPreview()}
            data-testid="asset-cancel-preview"
          >
            <Square className="mr-1.5 h-3 w-3" />
            {t("dataQuery.cancel")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void loadPreview()}
            data-testid="asset-refresh-preview"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("dataQuery.objectView.refresh")}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={handleCopySql}
          data-testid="asset-copy-sql"
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.objectView.copySql")}
        </Button>

        <Button
          size="sm"
          variant="default"
          className="h-7 px-2.5 text-xs"
          onClick={() => onEditInQuery(querySql)}
          title={t("dataQuery.objectView.editInQueryHint")}
          data-testid="asset-edit-in-query"
        >
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {t("dataQuery.objectView.editInQuery")}
        </Button>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {busy && (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="tabular-nums">
                {t("dataQuery.elapsed", {
                  seconds: (elapsed / 1000).toFixed(elapsed < 10_000 ? 2 : 1),
                })}
              </span>
            </span>
          )}
          {!busy && run && (
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              {t("dataQuery.objectView.previewLimitNote", {
                count: TABLE_PREVIEW_LIMIT,
              })}
            </span>
          )}
        </div>
      </div>

      {/* Read-only SQL preview box: copyable, clicking Edit opens main SQL Query tab */}
      {showSql && (
        <div
          className="flex items-start justify-between gap-2 rounded-md border bg-muted/25 px-3 py-2"
          data-testid="asset-sql-preview"
        >
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
            {querySql}
          </pre>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={handleCopySql}
              title={t("dataQuery.objectView.copySql")}
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => onEditInQuery(querySql)}
              title={t("dataQuery.objectView.editInQueryHint")}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {queryError && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-testid="asset-preview-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            {run?.error?.code && (
              <div className="font-mono text-xs text-muted-foreground">
                {run.error.code}
              </div>
            )}
            <div className="whitespace-pre-wrap font-mono text-xs">
              {queryError}
            </div>
          </div>
        </div>
      )}

      {busy && !rows && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed py-14">
          <Spinner
            label={t("dataQuery.objectView.loadingPreview", {
              count: TABLE_PREVIEW_LIMIT,
            })}
          />
        </div>
      )}

      {rows && (
        <div className="space-y-2">
          <RunMasksNote masks={run?.masks} />
          <RunRowsNote filters={run?.rowFilters} />
          {run?.truncated && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {run.truncatedReason === "bytes"
                ? t("dataQuery.truncatedBytes", { count: rows.rows.length })
                : t("dataQuery.truncatedRows", { count: rows.rows.length })}
            </p>
          )}
          {rows.rows.length ? (
            <ResultsGrid
              result={rows}
              height={460}
              defaultPageSize={TABLE_PREVIEW_LIMIT}
              canExport
              onExport={(fileFormat) => void exportAs(fileFormat)}
            />
          ) : (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              {t("dataQuery.emptyResult")}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const overviewContent = (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {governance.data && (
            <AssetGovernanceSummary
              governance={governance.data}
              quality={quality.data}
              onOpen={() => setSubtab("governance")}
            />
          )}

          {isDataset && dataset.data && (
            <DatasetOverviewCard
              dataset={dataset.data}
              onChange={dataset.setData}
            />
          )}

          {/* Table schema / columns card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Columns3 className="h-4 w-4" aria-hidden />
                {t("dataQuery.objectView.schemaTitle")}
                <Badge variant="outline" className="font-mono text-[10px]">
                  {table.columns.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                {t("dataQuery.objectView.schemaDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {table.columns.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("dataQuery.explorer.noColumns")}
                </p>
              ) : (
                <div className="overflow-auto rounded-md border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("dataQuery.objectView.columnName")}
                        </TableHead>
                        <TableHead className="w-40">
                          {t("dataQuery.objectView.columnType")}
                        </TableHead>
                        <TableHead>
                          {t("dataQuery.objectView.columnPolicy")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {table.columns.map((column) => {
                        const govCol = columnsByName.get(column.name);
                        return (
                          <TableRow key={column.name}>
                            <TableCell className="font-mono font-medium">
                              {column.name}
                            </TableCell>
                            <TableCell className="font-mono text-muted-foreground">
                              {column.type}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {column.access && (
                                  <ColumnAccessChip
                                    action={column.access}
                                    mask={column.mask}
                                    inClear={column.inClear}
                                    compact
                                  />
                                )}
                                {govCol && (
                                  <ClassificationChip column={govCol} />
                                )}
                                {!column.access && !govCol?.effectiveClassification && (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {!isDataset && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("assets.detail.metadata")}
                </CardTitle>
                <CardDescription>
                  {t("assets.detail.metadataDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <SourceIcon source={source.type} size="md" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("common.source")}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenSource(source)}
                      className="text-sm font-semibold underline-offset-4 hover:underline"
                    >
                      {source.name}
                    </button>
                  </div>
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("assets.detail.assetName")}
                    </div>
                    <div className="break-words text-sm font-semibold">
                      {assetDetails?.name || table.name}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("assets.detail.assetType")}
                    </div>
                    <div className="text-sm font-semibold">
                      {assetDetails
                        ? formatAssetKind(assetDetails.assetType)
                        : "Table"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("dataQuery.objectView.sqlNameLabel")}
                    </div>
                    <div className="break-all font-mono text-xs">
                      {table.sqlName}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      {t("assets.detail.externalUrl")}
                    </div>
                    <div className="break-all font-mono text-xs">
                      {assetDetails?.externalUrl || "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {(usage.data || usage.loading) && (
            <UsageCard usage={usage.data} loading={usage.loading} />
          )}
        </div>
      </div>

      {!isDataset &&
        !assetLoading &&
        assetDetails?.metadata &&
        Object.keys(assetDetails.metadata).length > 0 && (
          <AssetMetadataCard metadata={assetDetails.metadata} />
        )}
    </div>
  );

  const tabs: WorkbenchSubtabItem[] = [
    {
      value: "data",
      label: t("dataQuery.objectView.subtabs.data"),
      icon: <Table2 className="h-3.5 w-3.5" />,
      badge:
        rows && !busy ? (
          <span className="rounded bg-muted px-1 py-0.2 text-[10px] tabular-nums text-muted-foreground">
            {rows.rows.length}
          </span>
        ) : undefined,
      testId: `asset-subtab-data-${table.assetId}`,
      content: dataContent,
    },
    {
      value: "overview",
      label: t("dataQuery.objectView.subtabs.overview"),
      icon: <Info className="h-3.5 w-3.5" />,
      testId: `asset-subtab-overview-${table.assetId}`,
      content: overviewContent,
    },
    ...(isDataset
      ? [
          {
            value: "definition",
            label: t("dataQuery.objectView.subtabs.definition"),
            icon: <FileCode2 className="h-3.5 w-3.5" />,
            testId: `asset-subtab-definition-${table.assetId}`,
            content: dataset.data ? (
              <DatasetDefinitionCard dataset={dataset.data} />
            ) : (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ),
          } satisfies WorkbenchSubtabItem,
        ]
      : []),
    {
      value: "governance",
      label: t("dataQuery.objectView.subtabs.governance"),
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      testId: `asset-subtab-governance-${table.assetId}`,
      content: (
        <AssetGovernanceView
          extraSteps={
            isDataset && dataset.data
              ? [
                  {
                    id: "inputs",
                    title: t("sharedDatasets.inputs.step"),
                    description: t("sharedDatasets.inputs.stepDesc"),
                    complete: !dataset.data.inputs.some((i) => i.blocked),
                    content: <DatasetInputsCard dataset={dataset.data} />,
                  },
                ]
              : []
          }
          governance={governance.data}
          loading={governance.loading}
          onChange={governance.setData}
          reload={() => void governance.reload()}
          columns={columnsMeta.data}
          onColumnsChange={columnsMeta.setData}
          quality={quality.data}
          onQualityChange={quality.setData}
          isTable
          reloadAll={() => {
            void governance.reload();
            void columnsMeta.reload();
            void quality.reload();
          }}
          sourceHref={nsHref(`/sources/${source.id}`)}
        />
      ),
    },
    ...(!isDataset
      ? [
          {
            value: "findings",
            label: t("dataQuery.objectView.subtabs.findings"),
            icon: <ShieldAlert className="h-3.5 w-3.5" />,
            testId: `asset-subtab-findings-${table.assetId}`,
            content: (
              <div className="space-y-4">
                <React.Suspense
                  fallback={
                    <div className="flex justify-center py-10">
                      <Spinner />
                    </div>
                  }
                >
                  <FindingsTable
                    lockedFilters={{
                      assetId: [table.assetId],
                      includeResolved: true,
                    }}
                  />
                </React.Suspense>
                <ReferencingFindingsPanel assetId={table.assetId} />
              </div>
            ),
          } satisfies WorkbenchSubtabItem,
        ]
      : []),
    {
      value: "connections",
      label: t("dataQuery.objectView.subtabs.connections"),
      icon: <GitFork className="h-3.5 w-3.5" />,
      testId: `asset-subtab-connections-${table.assetId}`,
      content: (
        <div className="space-y-4">
          <ExploreWorkspace mode="asset" assetId={table.assetId} />
          <ColumnLineagePanel
            assetId={table.assetId}
            columns={
              assetDetails
                ? columnNames(assetDetails.metadata)
                : table.columns.map((col) => col.name)
            }
          />
        </div>
      ),
    },
    ...(canViewAccess
      ? [
          {
            value: "access",
            label: t("dataQuery.objectView.subtabs.access"),
            icon: <KeyRound className="h-3.5 w-3.5" />,
            testId: `asset-subtab-access-${table.assetId}`,
            content: (
              <div className="space-y-3">
                {canManageAccess && (
                  <div className="flex justify-end">
                    <GiveDataAccessButton scope={scope} access={access} />
                  </div>
                )}
                <DataAccessSection scope={scope} access={access} />
              </div>
            ),
          } satisfies WorkbenchSubtabItem,
        ]
      : []),
  ];

  const headerIcon = !table.queryable ? (
    <CircleSlash className="h-4 w-4 text-muted-foreground" />
  ) : !table.canQuery ? (
    <Lock className="h-4 w-4 text-muted-foreground" />
  ) : (
    <Table2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
  );

  return (
    <WorkbenchObjectShell
      testId={`query-asset-tab-${table.assetId}`}
      icon={headerIcon}
      title={table.table}
      sqlName={table.sqlName}
      badges={
        <>
          <button
            type="button"
            onClick={() => onOpenSource(source)}
            className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-muted"
            title={t("dataQuery.explorer.openSourceTabHint", {
              name: source.name,
            })}
          >
            <SourceIcon source={source.type} size="sm" />
            <span className="max-w-[10rem] truncate">{source.name}</span>
          </button>
          <Badge variant="outline" className="font-mono text-[10px]">
            {table.schema}
          </Badge>
          {isDataset && dataset.data ? (
            <DatasetBadges dataset={dataset.data} />
          ) : (
            assetDetails && <AssetKindBadge kind={assetDetails.assetType} />
          )}
          {governance.data && (
            <GovernanceBadge status={governance.data.status} />
          )}
          {quality.data && quality.data.rules.length > 0 && (
            <button
              type="button"
              onClick={() => setSubtab("governance")}
              className="rounded-[4px]"
            >
              <QualityChip
                quality={{
                  rules: quality.data.rules.filter((rule) => rule.enabled)
                    .length,
                  failing: quality.data.failing,
                  score: quality.data.score ?? null,
                }}
              />
            </button>
          )}
          {owner && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <ActorChip actorRef={owner.principal.ref} />
            </span>
          )}
        </>
      }
      actions={
        <>
          {table.canQuery && masked && (
            <RequestAccess
              target={{ scopeType: "asset", scopeId: table.assetId }}
              unmasked
              compact
            />
          )}
          <ConnectToolButton scope={scope} />
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href={nsHref(`/assets/${table.assetId}`)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              {t("dataQuery.objectView.openFullAsset")}
            </Link>
          </Button>
        </>
      }
      tabs={tabs}
      activeTab={subtab}
      onTabChange={setSubtab}
    />
  );
}
