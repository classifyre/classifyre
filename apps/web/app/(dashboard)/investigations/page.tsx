"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, FolderPlus, Check } from "lucide-react";
import { toast } from "sonner";
import { api, type InquiryResponseDto } from "@workspace/api-client";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { CasesTable } from "@/components/cases-table";

export default function InvestigationsPage() {
  const router = useRouter();
  const [inquiries, setInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);

  const loadInquiries = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.inquiries.inquiriesControllerList({ limit: 100 });
      setInquiries(res.items);
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void loadInquiries(); }, [loadInquiries]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const createCaseFromSelected = async () => {
    if (selected.size === 0) return;
    setCreating(true);
    try {
      const first = inquiries.find((q) => selected.has(q.id));
      const created = await api.cases.casesControllerCreate({
        createCaseDto: {
          title: selected.size === 1 && first ? first.title : `Investigation (${selected.size} inquiries)`,
          inquiryIds: Array.from(selected),
        },
      });
      toast.success("Case created");
      router.push(`/investigations/${created.id}`);
    } catch (err) { console.error(err); toast.error("Failed to create case"); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.04em]">Investigations</h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-xl">
            Inquiries are saved queries that surface relevant findings. Group them into a case to gather
            evidence and weigh hypotheses.
          </p>
        </div>
        <Button onClick={() => router.push("/investigations/inquiries/new")}>
          <Plus className="h-4 w-4" /> New inquiry
        </Button>
      </div>

      <Tabs defaultValue="inquiries">
        <TabsList>
          <TabsTrigger value="inquiries">Inquiries</TabsTrigger>
          <TabsTrigger value="cases">Cases</TabsTrigger>
        </TabsList>

        <TabsContent value="inquiries" className="space-y-3">
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-[4px] border-2 border-border bg-card px-3 py-2 shadow-[3px_3px_0_var(--color-border)]">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
                <Button size="sm" onClick={createCaseFromSelected} disabled={creating}>
                  <FolderPlus className="h-3.5 w-3.5" /> Create case from selected
                </Button>
              </div>
            </div>
          )}

          {!loading && inquiries.length === 0 ? (
            <EmptyState title="No inquiries yet" description="Create an inquiry to start monitoring findings across your sources." />
          ) : (
            <div className="space-y-2">
              {inquiries.map((q) => {
                const isSel = selected.has(q.id);
                return (
                  <Card key={q.id} className={isSel ? "border-primary" : undefined}>
                    <CardContent className="flex items-center gap-3 p-3">
                      <button
                        onClick={() => toggle(q.id)}
                        aria-label="Select inquiry"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${isSel ? "border-primary bg-primary" : "border-muted-foreground/40 hover:border-muted-foreground"}`}
                      >
                        {isSel && <Check className="h-3 w-3 text-primary-foreground" />}
                      </button>
                      <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => router.push(`/investigations/inquiries/${q.id}`)}>
                        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{q.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {q.matchAllSources ? "all sources" : `${q.sourceIds.length} source${q.sourceIds.length === 1 ? "" : "s"}`}
                            {q.caseId ? " · in a case" : ""}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {q.newMatchCount > 0 && (
                          <Badge variant="outline" className="border-[color:var(--color-amber-600,#d97706)]/50 text-[color:var(--color-amber-600,#d97706)]">
                            {q.newMatchCount} new
                          </Badge>
                        )}
                        <span className="font-mono text-sm tabular-nums">{q.matchCount}</span>
                        <span className="text-muted-foreground text-[11px]">matches</span>
                        <Badge variant="outline">{q.status}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cases">
          <CasesTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
