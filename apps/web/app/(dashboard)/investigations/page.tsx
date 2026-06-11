"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Sparkles, FolderPlus, FolderOpen, Pencil, Loader2 } from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { api, type InquiryResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CasesTable } from "@/components/cases-table";
import { AutopilotPanel } from "@/components/autopilot/autopilot-panel";

function inquiryScope(q: InquiryResponseDto): string {
  const sources = q.matchAllSources
    ? "all sources"
    : `${q.sourceIds.length} source${q.sourceIds.length === 1 ? "" : "s"}`;
  const matcherCount =
    q.detectorTypes.length +
    q.customDetectorKeys.length +
    q.findingTypes.length +
    q.findingTypeRegex.length;
  return matcherCount === 0
    ? `${sources} · any finding`
    : `${sources} · ${matcherCount} matcher${matcherCount === 1 ? "" : "s"}`;
}

function InquiryRow({ inquiry }: { inquiry: InquiryResponseDto }) {
  const router = useRouter();
  const archived = inquiry.status === "ARCHIVED";
  return (
    <div
      className={`flex items-center gap-3 rounded-[4px] border-2 border-border bg-card px-4 py-3 shadow-[0_1px_3px_rgba(28,25,23,0.04)] transition-colors hover:border-foreground/30 ${archived ? "opacity-60" : ""}`}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--color-amber-600,#d97706)]" />
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => router.push(`/investigations/inquiries/${inquiry.id}`)}
      >
        <p className="flex items-center gap-2 truncate font-medium">
          <span className="truncate">{inquiry.title}</span>
          {isAiActor(inquiry.createdBy) && <AiActorBadge />}
        </p>
        <p className="text-muted-foreground text-xs">{inquiryScope(inquiry)}</p>
      </button>

      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <p className="font-mono text-sm tabular-nums">{inquiry.matchCount}</p>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wide">matches</p>
        </div>
        {inquiry.newMatchCount > 0 && (
          <Badge
            variant="outline"
            className="border-[color:var(--color-amber-600,#d97706)]/50 text-[color:var(--color-amber-600,#d97706)]"
          >
            {inquiry.newMatchCount} new
          </Badge>
        )}
        {archived && (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            archived
          </Badge>
        )}
        {inquiry.cases.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              router.push(
                inquiry.cases.length === 1
                  ? `/investigations/${inquiry.cases[0]!.id}`
                  : `/investigations/inquiries/${inquiry.id}`,
              )
            }
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {inquiry.cases.length === 1 ? "Case" : `${inquiry.cases.length} cases`}
          </Button>
        )}
        {!archived && (
          <Button
            size="sm"
            variant={inquiry.cases.length === 0 ? "default" : "ghost"}
            onClick={() => router.push(`/investigations/cases/new?inquiryId=${inquiry.id}`)}
          >
            <FolderPlus className="h-3.5 w-3.5" /> Open case
          </Button>
        )}
        {!archived && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Edit inquiry"
            onClick={() => router.push(`/investigations/inquiries/${inquiry.id}/edit`)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

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
  const [inquiries, setInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [loading, setLoading] = React.useState(true);

  const loadInquiries = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.inquiries.inquiriesControllerList({ limit: 200 });
      setInquiries(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadInquiries();
  }, [loadInquiries]);

  const active = inquiries.filter((q) => q.status !== "ARCHIVED");
  const archived = inquiries.filter((q) => q.status === "ARCHIVED");
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
          <TabsTrigger value="inquiries">
            Inquiries
            {active.some((q) => q.newMatchCount > 0) && (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--color-amber-600,#d97706)]" />
            )}
          </TabsTrigger>
          <TabsTrigger value="autopilot">Autopilot</TabsTrigger>
        </TabsList>

        <TabsContent value="cases">
          <CasesTable />
        </TabsContent>

        <TabsContent value="inquiries" className="space-y-5">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading inquiries…
            </div>
          ) : inquiries.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No inquiries yet"
              description="Create an inquiry to start monitoring findings across your sources."
            />
          ) : (
            <>
              <div className="space-y-2">
                {active.map((q) => (
                  <InquiryRow key={q.id} inquiry={q} />
                ))}
              </div>
              {archived.length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                    Archived ({archived.length})
                  </p>
                  {archived.map((q) => (
                    <InquiryRow key={q.id} inquiry={q} />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="autopilot">
          <AutopilotPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
