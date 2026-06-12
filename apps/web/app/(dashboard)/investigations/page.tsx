"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CasesTable } from "@/components/cases-table";
import { InquiriesTable } from "@/components/inquiries-table";
import { AutopilotPanel } from "@/components/autopilot/autopilot-panel";

export default function InvestigationsPage() {
  return (
    <React.Suspense>
      <InvestigationsPageInner />
    </React.Suspense>
  );
}

function InvestigationsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab =
    tabParam === "inquiries" || tabParam === "autopilot" ? tabParam : "cases";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.04em]">
            Investigations
          </h1>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            Start with an inquiry — a saved question over your findings. When the matches
            warrant a deeper look, open a case to collect evidence, weigh hypotheses, and
            reach a conclusion.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push("/investigations/inquiries/new")}
          >
            <Sparkles className="h-4 w-4" /> New inquiry
          </Button>
          <Button onClick={() => router.push("/investigations/cases/new")}>
            <Plus className="h-4 w-4" /> New case
          </Button>
        </div>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="inquiries">Inquiries</TabsTrigger>
          <TabsTrigger value="autopilot">Autopilot</TabsTrigger>
        </TabsList>

        <TabsContent value="cases">
          <CasesTable />
        </TabsContent>

        <TabsContent value="inquiries">
          <InquiriesTable />
        </TabsContent>

        <TabsContent value="autopilot">
          <AutopilotPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
