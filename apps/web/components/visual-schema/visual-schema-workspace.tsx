"use client";

import * as React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  GitCompareArrows,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalogSource } from "@/lib/data-query";
import {
  addSuggestedJoins,
  addTablesWithCapToast,
} from "./lib/catalog-helpers";
import { exportDiagramDbml } from "./lib/dbml";
import { findLinks } from "./lib/find-links";
import { layoutConnectedGroups, layoutGrid } from "./lib/layout";
import { SchemaPropertiesPanel } from "./panels/schema-properties-panel";
import { SchemaRelationsPanel } from "./panels/schema-relations-panel";
import { SchemaCatalogRail } from "./schema-catalog-rail";
import type { VisualSchemaAdapter, VisualSchemaExtensions } from "./types";
import {
  VisualSchemaCanvas,
  type VisualSchemaCanvasHandle,
} from "./visual-schema-canvas";

export interface VisualSchemaWorkspaceProps {
  adapter: VisualSchemaAdapter;
  extensions?: VisualSchemaExtensions;
  /** Optional custom right-panel component replacing the default Properties/Relations Tabs. */
  customRightPanel?: (ctx: {
    propertiesPanel: React.ReactNode;
    relationsPanel: React.ReactNode;
  }) => React.ReactNode;
  onExportDbml?: () => void;
}

export function VisualSchemaWorkspace(props: VisualSchemaWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <VisualSchemaWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}

function VisualSchemaWorkspaceInner({
  adapter,
  extensions,
  customRightPanel,
  onExportDbml,
}: VisualSchemaWorkspaceProps) {
  const { t } = useTranslation();
  const canvasRef = React.useRef<VisualSchemaCanvasHandle>(null);

  const [railOpen, setRailOpen] = React.useState(true);
  const [inspectorOpen, setInspectorOpen] = React.useState(true);
  const [selectedTableIds, setSelectedTableIds] = React.useState<string[]>([]);
  const [selectedJoinId, setSelectedJoinId] = React.useState<string | null>(null);

  const defaultTab =
    extensions?.defaultRightTab ??
    extensions?.rightTabs?.[0]?.value ??
    "properties";
  const [rightTab, setRightTab] = React.useState(defaultTab);

  const placedAssetIds = React.useMemo(
    () => new Set(adapter.spec.tables.map((tbl) => tbl.assetId)),
    [adapter.spec.tables],
  );

  const handleSelectionChange = React.useCallback(
    (tableIds: string[], joinId: string | null) => {
      setSelectedTableIds(tableIds);
      setSelectedJoinId(joinId);
    },
    [],
  );

  const handleFindLinks = React.useCallback(
    (scopeTableIds?: string[]) => {
      const scope = scopeTableIds ? new Set(scopeTableIds) : undefined;
      const found = findLinks(
        adapter.spec.tables,
        adapter.spec.joins,
        adapter.catalog,
        scope,
      );
      if (found.length === 0) {
        toast.info(t("visualSchema.toast.noLinksFound"));
        return;
      }
      addSuggestedJoins(adapter, found);
      toast.success(t("visualSchema.toast.linksFound", { count: found.length }));
    },
    [adapter, t],
  );

  const handleArrangeConnected = React.useCallback(async () => {
    const positions = await layoutConnectedGroups(
      adapter.spec.tables,
      adapter.spec.joins,
      adapter.catalog,
    );
    if (Object.keys(positions).length > 0) {
      adapter.applyLayout(positions);
      requestAnimationFrame(() => canvasRef.current?.fitAll());
    }
  }, [adapter]);

  const handleArrangeGrid = React.useCallback(() => {
    const positions = layoutGrid(adapter.spec.tables, adapter.catalog);
    if (Object.keys(positions).length > 0) {
      adapter.applyLayout(positions);
      requestAnimationFrame(() => canvasRef.current?.fitAll());
    }
  }, [adapter]);

  const handleGenerateSource = React.useCallback(
    async (source: QueryCatalogSource) => {
      const eligible = source.tables.filter(
        (tbl) =>
          (tbl.queryable || adapter.capabilities.allowLockedTables) &&
          !placedAssetIds.has(tbl.assetId),
      );
      if (eligible.length === 0) {
        toast.info(t("visualSchema.toast.sourceAlreadyPlaced"));
        return;
      }
      const added = addTablesWithCapToast(adapter, eligible, undefined, t);
      if (added.length === 0) return;

      const nextTables = [...adapter.spec.tables, ...added];
      const discovered = findLinks(
        nextTables,
        adapter.spec.joins,
        adapter.catalog,
      );
      if (discovered.length > 0) {
        addSuggestedJoins(adapter, discovered);
      }
      const nextJoins = [
        ...adapter.spec.joins,
        ...discovered.map((d, i) => ({
          id: `tmp-${i}`,
          left: d.left,
          right: d.right,
          type: "INNER" as const,
        })),
      ];
      const positions = await layoutConnectedGroups(
        nextTables,
        nextJoins,
        adapter.catalog,
      );
      if (Object.keys(positions).length > 0) {
        adapter.applyLayout(positions);
        requestAnimationFrame(() => canvasRef.current?.fitAll());
      }
    },
    [adapter, placedAssetIds, t],
  );

  const handleSelectAndFrameJoin = React.useCallback(
    (joinId: string, leftTableId: string, rightTableId: string) => {
      setSelectedTableIds([]);
      setSelectedJoinId(joinId);
      canvasRef.current?.fitNodes([leftTableId, rightTableId]);
    },
    [],
  );

  const selectedTableId =
    selectedTableIds.length === 1 ? selectedTableIds[0]! : null;

  const propertiesPanel = (
    <SchemaPropertiesPanel
      adapter={adapter}
      selectedTableId={selectedTableId}
      selectedJoinId={selectedJoinId}
      onFindLinks={() => handleFindLinks()}
      onArrangeConnected={() => void handleArrangeConnected()}
    />
  );

  const relationsPanel = (
    <SchemaRelationsPanel
      adapter={adapter}
      selectedJoinId={selectedJoinId}
      onSelectAndFrameJoin={handleSelectAndFrameJoin}
    />
  );

  const handleExportDbml = React.useCallback(() => {
    if (onExportDbml) {
      onExportDbml();
      return;
    }
    exportDiagramDbml(adapter.spec, adapter.catalog);
  }, [adapter.catalog, adapter.spec, onExportDbml]);

  return (
    <div
      className="relative flex h-full w-full min-h-0 overflow-hidden bg-background"
      style={{ width: "100%", height: "100%", minHeight: 0 }}
      data-testid="visual-schema-workspace"
    >
      <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
        {railOpen && (
          <>
            <ResizablePanel
              id="vs-rail"
              defaultSize="20%"
              minSize="15%"
              maxSize="32%"
            >
              <SchemaCatalogRail
                catalog={adapter.catalog}
                loading={adapter.catalogLoading}
                canEdit={adapter.capabilities.canEdit}
                hideSharedDatasets={adapter.capabilities.hideSharedDatasets}
                allowLockedTables={adapter.capabilities.allowLockedTables}
                placedAssetIds={placedAssetIds}
                onAddTables={(tbls) => {
                  addTablesWithCapToast(adapter, tbls, undefined, t);
                }}
                onGenerateSource={(src) => void handleGenerateSource(src)}
                onRefresh={adapter.onRefreshCatalog}
                onCollapse={() => setRailOpen(false)}
                testId={extensions?.railTestId}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        <ResizablePanel
          id="vs-canvas"
          defaultSize={
            railOpen && inspectorOpen
              ? "48%"
              : railOpen || inspectorOpen
                ? "68%"
                : "100%"
          }
          minSize="30%"
        >
          <div
            className="relative h-full w-full"
            style={{ position: "relative", width: "100%", height: "100%" }}
          >
            {!railOpen && (
              <button
                type="button"
                onClick={() => setRailOpen(true)}
                className="absolute left-3 top-3 z-10 flex size-8 items-center justify-center rounded-[4px] border-2 border-border bg-card text-foreground hover:bg-muted"
                title={t("visualSchema.rail.expand")}
                aria-label={t("visualSchema.rail.expand")}
                data-testid="vs-open-rail"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            {!inspectorOpen && (
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                className="absolute right-3 top-14 z-10 flex size-8 items-center justify-center rounded-[4px] border-2 border-border bg-card text-foreground hover:bg-muted"
                title={t("visualSchema.inspector.expand")}
                aria-label={t("visualSchema.inspector.expand")}
                data-testid="vs-open-inspector"
              >
                <PanelRightOpen className="size-4" />
              </button>
            )}

            <VisualSchemaCanvas
              ref={canvasRef}
              adapter={adapter}
              extensions={extensions}
              selectedTableIds={selectedTableIds}
              selectedJoinId={selectedJoinId}
              onSelectionChange={handleSelectionChange}
              onFindLinks={handleFindLinks}
              onArrangeConnected={() => void handleArrangeConnected()}
              onArrangeGrid={handleArrangeGrid}
              onExportDbml={handleExportDbml}
            />
          </div>
        </ResizablePanel>

        {inspectorOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="vs-inspector"
              defaultSize="32%"
              minSize="22%"
              maxSize="48%"
            >
              {customRightPanel ? (
                customRightPanel({
                  propertiesPanel,
                  relationsPanel,
                })
              ) : (
                <Tabs
                  value={rightTab}
                  onValueChange={setRightTab}
                  className="flex h-full flex-col border-l border-border/50 bg-background"
                >
                  <div className="flex items-center border-b border-border/50 px-2 pt-2">
                    <TabsList className="h-8 flex-1 justify-start gap-0.5 bg-transparent p-0">
                      {(extensions?.rightTabs ?? []).map((tab) => (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="h-7 gap-1 rounded-xs px-2 text-xs"
                          data-testid={tab.testId ?? `vs-tab-${tab.value}`}
                        >
                          {tab.icon}
                          <span>{tab.label}</span>
                          {tab.badge}
                        </TabsTrigger>
                      ))}
                      <TabsTrigger
                        value="properties"
                        className="h-7 gap-1 rounded-xs px-2 text-xs"
                        data-testid="vs-tab-properties"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>{t("visualSchema.inspector.properties")}</span>
                      </TabsTrigger>
                      <TabsTrigger
                        value="relations"
                        className="h-7 gap-1 rounded-xs px-2 text-xs"
                        data-testid="vs-tab-relations"
                      >
                        <GitCompareArrows className="h-3.5 w-3.5" />
                        <span>{t("visualSchema.inspector.relations")}</span>
                        {adapter.spec.joins.length > 0 && (
                          <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">
                            {adapter.spec.joins.length}
                          </span>
                        )}
                      </TabsTrigger>
                    </TabsList>
                    <button
                      type="button"
                      onClick={() => setInspectorOpen(false)}
                      className="mb-1 ml-1 shrink-0 rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t("visualSchema.inspector.collapse")}
                      aria-label={t("visualSchema.inspector.collapse")}
                    >
                      <PanelRightClose className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {(extensions?.rightTabs ?? []).map((tab) => (
                    <TabsContent
                      key={tab.value}
                      value={tab.value}
                      className="mt-0 min-h-0 flex-1 overflow-hidden"
                    >
                      {tab.content}
                    </TabsContent>
                  ))}
                  <TabsContent
                    value="properties"
                    className="mt-0 min-h-0 flex-1 overflow-hidden"
                  >
                    {propertiesPanel}
                  </TabsContent>
                  <TabsContent
                    value="relations"
                    className="mt-0 min-h-0 flex-1 overflow-hidden"
                  >
                    {relationsPanel}
                  </TabsContent>
                </Tabs>
              )}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
