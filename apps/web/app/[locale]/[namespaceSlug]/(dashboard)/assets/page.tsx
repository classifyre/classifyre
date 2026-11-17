"use client";

import { Suspense, useState } from "react";
import { FileText } from "lucide-react";
import { Tabs, TabsContent } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { StatsFreshness } from "@/components/stats-freshness";
import { useStatsFreshness } from "@/hooks/use-stats-freshness";
import { useAssetsOverview } from "@/lib/governance";
import { AssetTabCards } from "@/components/assets/asset-tab-cards";
import { RawAssetsView } from "@/components/assets/raw-assets-view";
import { GovernanceDashboard } from "@/components/assets/governance-dashboard";
import { SharedAssetsView } from "@/components/assets/shared-assets-view";

/**
 * Assets, three ways (`?tab=`): Governance — what people answer for and
 * what needs them; Raw assets — everything scanned; Shared assets — saved
 * queries shared as governed datasets.
 */
export default function AssetsPage() {
  const { t } = useTranslation();
  // Bumped when a rollup rebuild lands so the numbers are read again.
  const [statsToken, setStatsToken] = useState(0);
  const stats = useStatsFreshness(() => setStatsToken((token) => token + 1));
  const overview = useAssetsOverview(statsToken);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-7" />
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("assets.title")}
        </h1>
        <div className="ml-auto">
          <StatsFreshness
            refreshedAt={stats.refreshedAt}
            isBuilt={stats.isBuilt}
            source={stats.source}
            onRefresh={stats.refresh}
            isRefreshing={stats.isRefreshing}
          />
        </div>
      </div>

      <Tabs urlParam="tab" defaultValue="raw" className="gap-6">
        <AssetTabCards overview={overview.data} />
        <TabsContent value="governance">
          <Suspense>
            <GovernanceDashboard onChanged={() => void overview.reload()} />
          </Suspense>
        </TabsContent>
        <TabsContent value="raw">
          <RawAssetsView statsToken={statsToken} />
        </TabsContent>
        <TabsContent value="shared">
          <SharedAssetsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
