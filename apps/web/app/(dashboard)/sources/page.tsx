"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Plus } from "lucide-react";
import { StatsCard } from "@workspace/ui/components";
import { Button } from "@workspace/ui/components/button";
import type { SearchSourcesResponseDto } from "@workspace/api-client";
import { SourcesTable } from "../../../components/sources-table";
import { useTranslation } from "@/hooks/use-translation";

export default function SourcesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [totals, setTotals] = useState<
    SearchSourcesResponseDto["totals"] | null
  >(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("sources.title")}
          </h1>
          <p className="text-muted-foreground">
            Manage your data sources and connections
          </p>
        </div>
        <Button onClick={() => router.push("/sources/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Add Source
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={t("sources.totalSources")}
          value={totals?.total ?? "—"}
          description={t("sources.connectedSources")}
          icon={Database}
        />
        <StatsCard
          title={t("sources.healthy")}
          value={totals?.healthy ?? "—"}
          description={t("sources.healthyDesc")}
        />
        <StatsCard
          title={t("sources.errors")}
          value={totals?.errors ?? "—"}
          description={t("sources.errorsDesc")}
        />
        <StatsCard
          title={t("sources.running")}
          value={totals?.running ?? "—"}
          description={t("sources.runningDesc")}
        />
      </div>

      {/* Sources Table */}
      <Suspense>
        <SourcesTable onTotalsChange={setTotals} />
      </Suspense>
    </div>
  );
}
