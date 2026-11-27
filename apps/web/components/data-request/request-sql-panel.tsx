"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  History,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { DataRequestDetailDto } from "@workspace/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import {
  apiErrorMessage,
  fetchRows,
  runErrorMessage,
  startQuery,
  waitForRun,
  type QueryCatalog,
  type QueryRows,
} from "@/lib/data-query";
import {
  useSharedDatasetVersions,
  type SharedDatasetDescriptionDto,
} from "@/lib/shared-datasets";
import { SqlEditor } from "@/components/data-query/sql-editor";
import { ResultsGrid } from "@/components/data-query/results-grid";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { columnAccessFor } from "@/lib/column-access";
import { useRequest, useRequestStore } from "./store/request-context";

export interface RequestSqlPanelProps {
  request: DataRequestDetailDto;
  catalog: QueryCatalog | null;
  propertiesPanel?: React.ReactNode;
  relationsPanel?: React.ReactNode;
}

export function RequestSqlPanel({
  request,
  catalog,
  propertiesPanel,
  relationsPanel,
}: RequestSqlPanelProps) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const store = useRequestStore();

  const draftSql = useRequest((s) => s.draftSql);
  const sqlEdited = useRequest((s) => s.sqlEdited);
  const diagnostics = useRequest((s) => s.diagnostics);
  const checkResult = useRequest((s) => s.checkResult);
  const checking = useRequest((s) => s.checking);
  const describeResult = useRequest((s) => s.describeResult);
  const describing = useRequest((s) => s.describing);
  const saving = useRequest((s) => s.saving);

  const canEditSql = request.permissions.canEditSql;
  const canPreview = request.permissions.canPreview;

  const [localSql, setLocalSql] = React.useState(draftSql);
  const [confirmRegen, setConfirmRegen] = React.useState(false);

  // Sync local editor buffer when server or canvas generates new SQL
  React.useEffect(() => {
    setLocalSql(draftSql);
  }, [draftSql]);

  const sqlDirty = canEditSql && localSql.trim() !== draftSql.trim();

  // Preview state (team-only)
  const [previewing, setPreviewing] = React.useState(false);
  const [previewRows, setPreviewRows] = React.useState<QueryRows | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const versions = useSharedDatasetVersions(request.dataset?.assetId);

  const runPreview = async () => {
    if (!canPreview || !localSql.trim() || previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const started = await startQuery(localSql);
      const done = await waitForRun(started.id, () => undefined);
      const err = runErrorMessage(done);
      if (err) {
        setPreviewError(err);
        setPreviewRows(null);
      } else {
        setPreviewRows(await fetchRows(done));
      }
    } catch (caught) {
      setPreviewError(await apiErrorMessage(caught));
      setPreviewRows(null);
    } finally {
      setPreviewing(false);
    }
  };

  const described = (describeResult?.describe ??
    request.lastCheck ??
    null) as SharedDatasetDescriptionDto | null;

  return (
    <section
      className="flex h-full flex-col border-l bg-background"
      data-testid="request-sql-panel"
    >
      <Tabs defaultValue="sql" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between overflow-x-auto border-b px-2 py-1.5">
          <TabsList className="h-8">
            <TabsTrigger value="sql" className="px-2 text-xs" data-testid="tab-sql">
              {t("dataRequest.panel.tabSql")}
            </TabsTrigger>
            {propertiesPanel && (
              <TabsTrigger
                value="properties"
                className="px-2 text-xs"
                data-testid="vs-tab-properties"
              >
                {t("visualSchema.inspector.properties")}
              </TabsTrigger>
            )}
            {relationsPanel && (
              <TabsTrigger
                value="relations"
                className="px-2 text-xs"
                data-testid="vs-tab-relations"
              >
                {t("visualSchema.inspector.relations")}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="checks"
              className="gap-1 px-2 text-xs"
              data-testid="tab-checks"
            >
              {t("dataRequest.panel.tabChecks")}
              {checkResult &&
                (checkResult.ok ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                ))}
            </TabsTrigger>
            {canPreview && (
              <TabsTrigger
                value="preview"
                className="text-xs"
                data-testid="tab-preview"
              >
                {t("dataRequest.panel.tabPreview")}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="history"
              className="gap-1 text-xs"
              data-testid="tab-history"
            >
              {t("dataRequest.panel.tabHistory")}
              {request.deliveries.length > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {request.deliveries.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── PROPERTIES & RELATIONS TABS (shared visual-schema) ─────── */}
        {propertiesPanel && (
          <TabsContent
            value="properties"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            {propertiesPanel}
          </TabsContent>
        )}
        {relationsPanel && (
          <TabsContent
            value="relations"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            {relationsPanel}
          </TabsContent>
        )}

        {/* ── SQL TAB ─────────────────────────────────────────────────── */}
        <TabsContent
          value="sql"
          className="mt-0 flex min-h-0 flex-1 flex-col p-3"
        >
          {sqlEdited && (
            <div
              className="mb-2.5 flex items-center justify-between gap-2 rounded-xs border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs"
              data-testid="sql-edited-banner"
            >
              <span className="text-amber-900 dark:text-amber-200">
                {t("dataRequest.panel.sqlEditedBanner")}
              </span>
              {canEditSql && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 text-[11px]"
                  onClick={() => setConfirmRegen(true)}
                  data-testid="sql-regenerate-btn"
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  {t("dataRequest.panel.regenerate")}
                </Button>
              )}
            </div>
          )}

          <div
            className="min-h-[260px] flex-1"
            style={{ minHeight: 260, height: "100%" }}
            data-testid="request-sql-editor-wrap"
          >
            <SqlEditor
              value={localSql}
              onChange={(val) => {
                if (canEditSql) setLocalSql(val);
              }}
              onRun={() => {
                if (canEditSql && sqlDirty) {
                  void store.getState().updateManualSql(localSql);
                }
              }}
              catalog={catalog}
              height={260}
              path={`data-request-${request.id}.sql`}
              readOnly={!canEditSql}
            />
          </div>

          {canEditSql && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {sqlDirty
                  ? t("dataRequest.panel.sqlUnsavedHint")
                  : t("dataRequest.panel.sqlTeamHint")}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={!sqlDirty || saving || !localSql.trim()}
                onClick={() => void store.getState().updateManualSql(localSql)}
                data-testid="sql-save-btn"
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("dataRequest.panel.saveSql")}
              </Button>
            </div>
          )}

          {/* Diagnostics & quick status strip */}
          <div className="mt-3 space-y-1.5 border-t pt-2.5">
            {diagnostics.length > 0 ? (
              diagnostics.map((d, i) => (
                <div
                  key={`${d.code}-${i}`}
                  className="flex items-start gap-1.5 text-xs"
                  data-testid={`sql-diagnostic-${d.code}`}
                >
                  {d.level === "error" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span className="text-muted-foreground">{d.message}</span>
                </div>
              ))
            ) : checkResult ? (
              <div
                className="flex items-center gap-1.5 text-xs"
                data-testid="sql-check-summary"
              >
                {checkResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>
                      {t("dataRequest.panel.groupCanRun", {
                        group: checkResult.routeGroup.name,
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-300">
                      {checkResult.problems[0] ??
                        t("dataRequest.panel.checkHasProblems")}
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </TabsContent>

        {/* ── CHECKS TAB ──────────────────────────────────────────────── */}
        <TabsContent value="checks" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">
                    {t("dataRequest.checks.heading", {
                      group: request.routeGroup.name,
                    })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("dataRequest.checks.subheading")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={describing || checking || !draftSql.trim()}
                  onClick={() => void store.getState().runDescribe()}
                  data-testid="run-describe-btn"
                >
                  {describing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("dataRequest.checks.runDescribe")}
                </Button>
              </div>

              {/* Static per-table check */}
              {checkResult && (
                <div className="space-y-2">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dataRequest.checks.inputsTitle")}
                  </h4>
                  {checkResult.tables.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("dataRequest.checks.noTables")}
                    </p>
                  ) : (
                    <ul className="divide-y rounded-xs border text-xs">
                      {checkResult.tables.map((tbl) => (
                        <li
                          key={tbl.sqlName}
                          className="space-y-1 px-2.5 py-2"
                          data-testid={`check-table-${tbl.sqlName}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono font-medium">
                              {tbl.sqlName}
                            </span>
                            {!tbl._exists ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("dataRequest.checks.missing")}
                              </Badge>
                            ) : tbl.groupCanQuery ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-500/40 text-[10px] text-emerald-700 dark:text-emerald-400"
                              >
                                {t("dataRequest.checks.readable")}
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("dataRequest.checks.blocked")}
                              </Badge>
                            )}
                          </div>
                          {!tbl.groupCanQuery &&
                            tbl._exists &&
                            tbl.assetId &&
                            request.permissions.isTeam && (
                              <Link
                                href={nsPath(`/assets/${tbl.assetId}?tab=data`)}
                                className="inline-flex items-center gap-1 text-[11px] text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]"
                              >
                                {t("dataRequest.checks.requestAccessForGroup", {
                                  group: request.routeGroup.name,
                                })}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            )}
                          {(tbl.maskedColumns.length > 0 ||
                            tbl.hiddenColumnCount > 0) && (
                            <p className="text-[11px] text-muted-foreground">
                              {tbl.maskedColumns.length > 0 &&
                                t("dataRequest.checks.maskedList", {
                                  cols: tbl.maskedColumns.join(", "),
                                })}
                              {tbl.maskedColumns.length > 0 &&
                                tbl.hiddenColumnCount > 0 &&
                                " · "}
                              {tbl.hiddenColumnCount > 0 &&
                                t("dataRequest.checks.hiddenCount", {
                                  count: tbl.hiddenColumnCount,
                                })}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {checkResult.problems.length > 0 && (
                    <ul className="space-y-1 rounded-xs border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                      {checkResult.problems.map((p, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Describe error */}
              {describeResult?.error && (
                <div className="rounded-xs border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                  {(describeResult.error as { message?: string }).message ??
                    t("dataRequest.checks.describeFailed")}
                </div>
              )}

              {/* Inherited floors & lineage from group describe */}
              {described && (
                <div className="space-y-2">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dataRequest.checks.outputColumnsTitle", {
                      count: described.columns.length,
                    })}
                  </h4>
                  <ul className="divide-y rounded-xs border text-xs">
                    {described.columns.map((col) => {
                      const access = col.floor
                        ? columnAccessFor({
                            classification: col.floor,
                            access: null,
                            maskKind: null,
                          })
                        : null;
                      return (
                        <li
                          key={col.name}
                          className="flex items-center gap-2 px-2.5 py-1.5"
                        >
                          <span className="font-mono font-medium">
                            {col.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {col.type}
                          </span>
                          <div className="ml-auto flex items-center gap-1.5">
                            {col.floor && (
                              <Badge variant="outline" className="text-[10px]">
                                {col.floor}
                              </Badge>
                            )}
                            {access && access.action !== "clear" && (
                              <ColumnAccessChip
                                action={access.action}
                                mask={access.mask}
                                fromClassification
                                compact
                              />
                            )}
                            {!col.traced && (
                              <Badge variant="secondary" className="text-[10px]">
                                {t("dataRequest.checks.untraced")}
                              </Badge>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── PREVIEW TAB (TEAM ONLY) ─────────────────────────────────── */}
        {canPreview && (
          <TabsContent
            value="preview"
            className="mt-0 flex min-h-0 flex-1 flex-col p-3"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t("dataRequest.preview.hint")}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={previewing || !localSql.trim()}
                onClick={runPreview}
                data-testid="request-preview-run"
              >
                {previewing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t("dataRequest.preview.run")}
              </Button>
            </div>
            {previewError && (
              <div className="mb-2 rounded-xs border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                {previewError}
              </div>
            )}
            <div className="min-h-0 flex-1">
              {previewRows ? (
                <ResultsGrid result={previewRows} fill />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xs border border-dashed text-xs text-muted-foreground">
                  {t("dataRequest.preview.empty")}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* ── HISTORY TAB ─────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-4 p-3">
              {/* Live dataset status banner */}
              {request.dataset && (
                <div
                  className="rounded-xs border p-2.5 text-xs"
                  data-testid="live-dataset-status"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">
                      {request.dataset.sqlName ??
                        t("dataRequest.history.removedDataset")}
                    </span>
                    <Badge
                      variant={
                        request.dataset.status === "ok"
                          ? "outline"
                          : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {t(`dataRequest.datasetStatus.${request.dataset.status}`)}
                    </Badge>
                  </div>
                  {request.dataset.reason && (
                    <p className="mt-1 text-muted-foreground">
                      {request.dataset.reason}
                    </p>
                  )}
                  {request.dataset.assetId &&
                    request.dataset.status === "ok" && (
                      <Link
                        href={nsPath(`/assets/${request.dataset.assetId}?tab=data`)}
                        className="mt-1.5 inline-flex items-center gap-1 text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]"
                      >
                        {t("dataRequest.history.openDataset")}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                </div>
              )}

              {/* Delivery rounds */}
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  {t("dataRequest.history.deliveriesTitle")}
                </h4>
                {request.deliveries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("dataRequest.history.noDeliveries")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {request.deliveries.map((d) => (
                      <li
                        key={d.id}
                        className="space-y-1.5 rounded-xs border p-2.5 text-xs"
                        data-testid={`delivery-round-${d.round}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold">
                            v{d.datasetVersion} ·{" "}
                            {d.datasetName ?? d.datasetAssetId}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {d.mode}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {d.deliveredBy.name} ·{" "}
                          {new Date(d.createdAt).toLocaleString()}
                        </p>
                        {d.note && <p className="text-xs">{d.note}</p>}
                        <pre className="max-h-24 overflow-auto rounded bg-muted/50 p-2 font-mono text-[10px]">
                          {d.sqlSnapshot}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Dataset version history */}
              {versions.data && versions.data.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("dataRequest.history.versionsTitle")}
                  </h4>
                  <ul className="divide-y rounded-xs border text-xs">
                    {versions.data.map((v) => (
                      <li key={v.version} className="space-y-1 px-2.5 py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold">
                            v{v.version}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(v.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {v.description && (
                          <p className="text-muted-foreground">{v.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Confirm regenerate SQL from canvas */}
      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dataRequest.panel.regenConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dataRequest.panel.regenConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegen(false);
                void store.getState().regenerateSqlFromCanvas().then(() => {
                  toast.success(t("dataRequest.panel.regenerated"));
                });
              }}
            >
              {t("dataRequest.panel.regenerate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
