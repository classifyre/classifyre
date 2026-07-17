"use client";

import * as React from "react";
import {
  ArrowLeft,
  Copy,
  Fingerprint,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
} from "lucide-react";
import { api, type AssetSimilarityDto, type GraphEdgeDto, type GraphNodeDto } from "@workspace/api-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Button } from "@workspace/ui/components/button";
import type { AssistantUiAction } from "@workspace/api-client";
import {
  FingerprintsGraph,
  type FingerprintsGraphData,
  type FingerprintsRailState,
} from "@/components/fingerprints-graph";
import { FingerprintsConnections } from "@/components/fingerprints-connections";
import { BoilerplateClusters } from "@/components/boilerplate-clusters";
import { SemanticIndexControls } from "@/components/semantic-index-controls";
import {
  CorrelationTuningPanel,
  type CorrelationTuningPanelHandle,
} from "@/components/correlation-tuning-panel";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";

type SidebarMode = "connections" | "nearDuplicates" | "tune";

const EMPTY_GRAPH_DATA: FingerprintsGraphData = {
  nodes: [],
  edges: [],
  similarities: [],
  truncated: false,
};

export default function FingerprintsPage() {
  const { t } = useTranslation();
  const [sidebarMode, setSidebarMode] = React.useState<SidebarMode>("connections");
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  // Bumped when tuning is saved → tells the graph to wait for recompute + reload.
  const [pendingRecomputeAt, setPendingRecomputeAt] = React.useState<number>();
  // Set from a connection row click — the graph filters to exactly this pair.
  const [focusPair, setFocusPair] = React.useState<[string, string] | undefined>();
  // Selection detail pushed up from the graph (node/edge/bundle click) — takes
  // over the sidebar in place of the Connections/Near-duplicates/Tune panels.
  const [rail, setRail] = React.useState<FingerprintsRailState | null>(null);
  const tuningPanelRef = React.useRef<CorrelationTuningPanelHandle | null>(null);

  // ── Shared graph data, fetched once and handed to both the canvas and the
  //    Connections panel so they never disagree. ───────────────────────────
  const [graphData, setGraphData] = React.useState<FingerprintsGraphData>(EMPTY_GRAPH_DATA);
  const [graphLoading, setGraphLoading] = React.useState(true);
  const [graphError, setGraphError] = React.useState<string | null>(null);

  const loadGraph = React.useCallback(() => {
    let active = true;
    setGraphLoading(true);
    setGraphError(null);
    api.correlation
      .correlationControllerGraph({})
      .then((g) => {
        if (!active) return;
        setGraphData({
          nodes: (g.nodes ?? []) as GraphNodeDto[],
          edges: (g.edges ?? []) as GraphEdgeDto[],
          similarities: (g.similarities ?? []) as AssetSimilarityDto[],
          truncated: Boolean(g.truncated),
        });
      })
      .catch((e: unknown) => {
        if (active)
          setGraphError(
            e instanceof Error ? e.message : t("correlation.fingerprints.loadFailed"),
          );
      })
      .finally(() => {
        if (active) setGraphLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  React.useEffect(() => loadGraph(), [loadGraph]);

  const goToTune = React.useCallback(() => {
    setSidebarMode("tune");
    setSidebarCollapsed(false);
  }, []);

  const handleFocusPair = React.useCallback((assetIds: [string, string]) => {
    setFocusPair(assetIds);
  }, []);

  const assistantBridge = React.useMemo(
    () => ({
      contextKey: "fingerprints.tune" as const,
      canOpen: true,
      getContext: () => ({
        key: "fingerprints.tune" as const,
        route: "/fingerprints",
        title: t("fingerprints.tabTune"),
        entityId: null,
        values: tuningPanelRef.current?.getValues() ?? {},
        schema: null,
        validation: { isValid: true, missingFields: [], errors: [] },
        metadata: {},
      }),
      applyAction: (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          tuningPanelRef.current?.applyPatches(action.patches);
        }
      },
    }),
    [t],
  );

  useRegisterAssistantBridge(assistantBridge);

  const showingSelection = Boolean(rail?.selection);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-4">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-7 w-7" />
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.06em]">
            {t("nav.fingerprints")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("fingerprints.subtitle")}
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* ── The graph: always-visible central canvas ── */}
        <div className="min-w-0 flex-1">
          <FingerprintsGraph
            graphData={graphData}
            graphLoading={graphLoading}
            graphError={graphError}
            onReloadGraph={loadGraph}
            externalRail
            onRailStateChange={setRail}
            focusPair={focusPair}
            onExitFocusPair={() => setFocusPair(undefined)}
            onTune={goToTune}
            pendingRecomputeAt={pendingRecomputeAt}
          />
        </div>

        {/* ── Dynamic right sidebar ── */}
        {sidebarCollapsed ? (
          <div className="flex w-10 shrink-0 flex-col items-center border-2 border-border bg-background py-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarCollapsed(false)}
              aria-label={t("fingerprints.expandSidebar")}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Tabs
            value={sidebarMode}
            onValueChange={(v) => setSidebarMode(v as SidebarMode)}
            className="flex min-h-0 w-[420px] shrink-0 flex-col border-2 border-border bg-background"
          >
            <div className="flex items-center gap-2 border-b-2 border-border p-2">
              <div className="min-w-0 flex-1">
                {showingSelection ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={() => rail?.onBack()}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {t("correlation.fingerprints.backToActions")}
                  </Button>
                ) : (
                  <TabsList className="h-9 w-full rounded-[4px] border-2 border-border bg-background p-1">
                    <TabsTrigger
                      value="connections"
                      className="flex-1 gap-1.5 rounded-[3px] text-xs"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {t("fingerprints.tabConnections")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="nearDuplicates"
                      className="flex-1 gap-1.5 rounded-[3px] text-xs"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("fingerprints.tabNearDuplicates")}
                    </TabsTrigger>
                    <TabsTrigger value="tune" className="flex-1 gap-1.5 rounded-[3px] text-xs">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {t("fingerprints.tabTune")}
                    </TabsTrigger>
                  </TabsList>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setSidebarCollapsed(true)}
                aria-label={t("fingerprints.collapseSidebar")}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>

            {/* Selection detail takes over the sidebar; deselecting reveals
                the panel that was active underneath (state never resets). */}
            {showingSelection && (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">{rail?.selectionRail}</div>
            )}
            <div
              className="min-h-0 flex-1 overflow-y-auto p-3"
              hidden={showingSelection}
            >
              <TabsContent value="connections" className="mt-0">
                <FingerprintsConnections
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  similarities={graphData.similarities}
                  loading={graphLoading}
                  error={graphError}
                  onReload={loadGraph}
                  onFocusPair={handleFocusPair}
                  focusedPair={focusPair}
                />
              </TabsContent>
              <TabsContent value="nearDuplicates" className="mt-0">
                <BoilerplateClusters onGoToTune={goToTune} />
              </TabsContent>
              <TabsContent value="tune" className="mt-0 space-y-4">
                <SemanticIndexControls />
                <CorrelationTuningPanel
                  ref={tuningPanelRef}
                  layout="dialog"
                  onSaved={() => setPendingRecomputeAt(Date.now())}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>
    </div>
  );
}
