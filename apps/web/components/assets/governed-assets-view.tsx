"use client";

import { Suspense, useState } from "react";
import { AssetsTable } from "@/components/assets-table";
import {
  UsageChartCard,
  type UsageSort,
} from "@/components/dashboard/usage-chart-card";
import { useGovernanceUsage } from "@/lib/governance";

const DAYS = 30;

/**
 * The Governed tab: every asset someone owns — scanned or a shared dataset —
 * how much it is read, which are read most, and the list itself, filtered to
 * governed (narrow it to a lifecycle, failing quality, or your own).
 */
export function GovernedAssetsView() {
  const [sort, setSort] = useState<UsageSort>("used");
  const usage = useGovernanceUsage({
    scope: "all",
    days: DAYS,
    sort,
    governance: "governed",
  });

  return (
    <div className="space-y-6" data-testid="governed-assets-view">
      <div className="grid gap-4 xl:grid-cols-2">
        <UsageChartCard
          part="trend"
          usage={usage.data}
          loading={usage.loading}
          days={DAYS}
          sort={sort}
          onSortChange={setSort}
        />
        <UsageChartCard
          part="top"
          usage={usage.data}
          loading={usage.loading}
          days={DAYS}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      <Suspense>
        <AssetsTable defaultGovernance="governed" preset="governed" />
      </Suspense>
    </div>
  );
}
