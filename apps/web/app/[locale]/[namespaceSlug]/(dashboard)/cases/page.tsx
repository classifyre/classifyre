"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CasesGrid } from "@/components/cases/cases-grid";
import { InquiriesTable } from "@/components/inquiries-table";
import { useCan, useMe } from "@/hooks/use-me";
import { useTranslation } from "@/hooks/use-translation";

export default function CasesPage() {
  return (
    <React.Suspense>
      <CasesPageInner />
    </React.Suspense>
  );
}

function CasesPageInner() {
  const router = useRouter();
  const { t } = useTranslation();
  const me = useMe();
  const canEditCase = useCan("case.edit");
  const canViewCases = me
    ? (me.capabilities as string[]).includes("case.view")
    : true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.04em]">
            {t("nav.cases")}
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEditCase && (
            <Button
              variant="outline"
              onClick={() => router.push(nsPath("/cases/inquiries/new"))}
            >
              <Sparkles className="h-4 w-4" /> {t("investigations.page.newInquiry")}
            </Button>
          )}
          <Button
            onClick={() => router.push(nsPath("/cases/new"))}
            data-testid="new-case-button"
          >
            <Plus className="h-4 w-4" /> {t("cases.page.newCase")}
          </Button>
        </div>
      </div>

      {canViewCases ? (
        <Tabs key="all-cases" defaultValue="all" urlParam="tab">
          <TabsList>
            <TabsTrigger value="all">{t("cases.page.tabAll")}</TabsTrigger>
            <TabsTrigger value="investigations">
              {t("cases.page.tabInvestigations")}
            </TabsTrigger>
            <TabsTrigger value="data-requests">
              {t("cases.page.tabDataRequests")}
            </TabsTrigger>
            <TabsTrigger value="inquiries">
              {t("cases.page.tabInquiries")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <CasesGrid />
          </TabsContent>

          <TabsContent value="investigations">
            <CasesGrid kind={["INVESTIGATION"]} />
          </TabsContent>

          <TabsContent value="data-requests">
            <CasesGrid kind={["DATA_REQUEST"]} />
          </TabsContent>

          <TabsContent value="inquiries">
            <InquiriesTable />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs key="requests-only" defaultValue="data-requests" urlParam="tab">
          <TabsList>
            <TabsTrigger value="data-requests">
              {t("cases.page.tabDataRequests")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="data-requests">
            <CasesGrid kind={["DATA_REQUEST"]} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
