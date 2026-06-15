"use client";

import * as React from "react";
import { Fingerprint } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { FingerprintsGraph } from "@/components/fingerprints-graph";
import { CorrelationTuningPanel } from "@/components/correlation-tuning-panel";
import { useTranslation } from "@/hooks/use-translation";

export default function FingerprintsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState("graph");
  // Bumped when tuning is saved → tells the graph to wait for recompute + reload.
  const [pendingRecomputeAt, setPendingRecomputeAt] = React.useState<number>();

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
          <TabsTrigger value="graph" className="rounded-[3px]">
            {t("fingerprints.tabGraph")}
          </TabsTrigger>
          <TabsTrigger value="tune" className="rounded-[3px]">
            {t("fingerprints.tabTune")}
          </TabsTrigger>
        </TabsList>

        {/* Keep the graph mounted across tab switches (preserves layout/zoom). */}
        <TabsContent
          value="graph"
          forceMount
          className="mt-4 min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <FingerprintsGraph
            onTune={() => setTab("tune")}
            pendingRecomputeAt={pendingRecomputeAt}
          />
        </TabsContent>

        <TabsContent value="tune" className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <CorrelationTuningPanel
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
