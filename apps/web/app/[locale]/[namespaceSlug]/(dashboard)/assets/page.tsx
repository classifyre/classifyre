"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Tabs, TabsContent } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { StatsFreshness } from "@/components/stats-freshness";
import { useStatsFreshness } from "@/hooks/use-stats-freshness";
import { useAssetsOverview } from "@/lib/governance";
import { useUrlParams } from "@/lib/url-filters";
import {
  ASSETS_TABS,
  AssetTabCards,
  type AssetsTab,
} from "@/components/assets/asset-tab-cards";
import { RawAssetsView } from "@/components/assets/raw-assets-view";
import { GovernedAssetsView } from "@/components/assets/governed-assets-view";
import { SharedAssetsView } from "@/components/assets/shared-assets-view";
import { ExploreAssetsView } from "@/components/assets/explore-assets-view";
import { EXPLORE_URL_KEYS } from "@/components/explore/explore-workspace";

/**
 * The asset list's filters and the map's view in the URL: a tab switch
 * starts them afresh.
 */
const TABLE_PARAMS = [
  ...EXPLORE_URL_KEYS,
  "start",
  "state",
  "promoted",
  "q",
  "source",
  "detector",
  "findingSeverity",
  "governance",
  "status",
  "responsible",
  "sortBy",
  "sortOrder",
] as const;

/**
 * Assets, four ways (`?tab=`): Raw — everything scanned; Governed — what
 * someone owns, scanned or shared, with its usage; Shared — saved queries
 * shared as governed datasets; Explore — the map of what is connected, and
 * the assets worth starting from. Each is the same asset list; the
 * dashboard's numbers open them with the same filter (`?governance=`,
 * `?responsible=me`).
 *
 * The tab follows the URL rather than leading it, so the list of the tab
 * switched to mounts on the cleared filters, not on the last tab's.
 */
export default function AssetsPage() {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlParams();
  // Bumped when a rollup rebuild lands so the numbers are read again.
  const [statsToken, setStatsToken] = useState(0);
  const stats = useStatsFreshness(() => setStatsToken((token) => token + 1));
  const overview = useAssetsOverview(statsToken);
  const param = searchParams.get("tab");
  const tab: AssetsTab = (ASSETS_TABS as readonly string[]).includes(
    param ?? "",
  )
    ? (param as AssetsTab)
    : "raw";

  const switchTab = (next: string) => {
    if (next === tab) return;
    setParams({
      tab: next,
      ...Object.fromEntries(TABLE_PARAMS.map((key) => [key, null])),
    });
  };

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

      <Tabs value={tab} onValueChange={switchTab} className="gap-6">
        <AssetTabCards overview={overview.data} />
        <TabsContent value="raw">
          <RawAssetsView statsToken={statsToken} />
        </TabsContent>
        <TabsContent value="governed">
          <GovernedAssetsView />
        </TabsContent>
        <TabsContent value="shared">
          <SharedAssetsView />
        </TabsContent>
        <TabsContent value="explore">
          <ExploreAssetsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
