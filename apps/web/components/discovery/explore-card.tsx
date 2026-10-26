"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExploreHome } from "@/components/explore/explore-home";
import { PanelCard, panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { EMPTY_VIEW, exploreViewQuery, type ExploreView } from "@/lib/explore";
import { useNsPath } from "@/lib/ns-path";

/**
 * The Overview's way into Explore: the same search, saved views and asset
 * table as Explore's own start, shorter. Everything opens in Explore.
 */
export function ExploreCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [query, setQuery] = React.useState("");
  const open = (view: Partial<ExploreView>) => {
    const q = exploreViewQuery({ ...EMPTY_VIEW, ...view });
    router.push(nsPath(q ? `/explore?${q}` : "/explore"));
  };
  return (
    <PanelCard className="space-y-3 sm:col-span-2 xl:col-span-12">
      <h3 className={panelHeadingClass}>{t("explore.cardTitle")}</h3>
      <ExploreHome
        compact
        query={query}
        onQuery={setQuery}
        onStart={(seeds, view) => open({ seeds, view })}
        onOpenSaved={(saved) => open({ saved })}
      />
    </PanelCard>
  );
}
