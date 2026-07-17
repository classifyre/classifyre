"use client";

import * as React from "react";
import { Fingerprint } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Button } from "@workspace/ui/components/button";
import type { AssistantUiAction } from "@workspace/api-client";
import { FingerprintsGraph } from "@/components/fingerprints-graph";
import { FingerprintsConnections } from "@/components/fingerprints-connections";
import { BoilerplateClusters } from "@/components/boilerplate-clusters";
import {
  CorrelationTuningPanel,
  type CorrelationTuningPanelHandle,
} from "@/components/correlation-tuning-panel";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { useTranslation } from "@/hooks/use-translation";

export default function FingerprintsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState("connections");
  // Bumped when tuning is saved → tells the graph to wait for recompute + reload.
  const [pendingRecomputeAt, setPendingRecomputeAt] = React.useState<number>();
  // Set from a connection row's "View in graph" action — reuses the graph's
  // existing `assetId` scoping prop as a best-effort focus (no graph-internal
  // changes) so the pair's shared cluster shows instead of the whole graph.
  const [focusAssetId, setFocusAssetId] = React.useState<string | undefined>();
  const tuningPanelRef = React.useRef<CorrelationTuningPanelHandle | null>(null);

  const handleViewInGraph = React.useCallback(
    (assetIds: [string, string]) => {
      setFocusAssetId(assetIds[0]);
      setTab("graph");
    },
    [],
  );

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

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="h-auto w-fit rounded-[4px] border-2 border-border bg-background p-1">
          <TabsTrigger value="connections" className="rounded-[3px]">
            {t("fingerprints.tabConnections")}
          </TabsTrigger>
          <TabsTrigger value="graph" className="rounded-[3px]">
            {t("fingerprints.tabGraph")}
          </TabsTrigger>
          <TabsTrigger value="near-duplicates" className="rounded-[3px]">
            {t("fingerprints.tabNearDuplicates")}
          </TabsTrigger>
          <TabsTrigger value="tune" className="rounded-[3px]">
            {t("fingerprints.tabTune")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="connections"
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <FingerprintsConnections onViewInGraph={handleViewInGraph} />
        </TabsContent>

        {/* Keep the graph mounted across tab switches (preserves layout/zoom). */}
        <TabsContent
          value="graph"
          forceMount
          className="mt-4 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          {focusAssetId && (
            <div className="mb-2 flex shrink-0 items-center gap-2 border-2 border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <span>{t("correlation.fingerprints.focusedFromConnection")}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2 text-xs"
                onClick={() => setFocusAssetId(undefined)}
              >
                {t("correlation.fingerprints.showFullGraph")}
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <FingerprintsGraph
              assetId={focusAssetId}
              onTune={() => setTab("tune")}
              pendingRecomputeAt={pendingRecomputeAt}
            />
          </div>
        </TabsContent>

        <TabsContent
          value="near-duplicates"
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <BoilerplateClusters />
        </TabsContent>

        <TabsContent value="tune" className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <CorrelationTuningPanel
            ref={tuningPanelRef}
            layout="page"
            onSaved={() => {
              setPendingRecomputeAt(Date.now());
              setTab("graph");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
