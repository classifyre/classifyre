"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CreateCaseDto,
  type InquiryMatchDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Badge } from "@workspace/ui/components/badge";
import { Textarea } from "@workspace/ui/components/textarea";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { ArrowLeft } from "lucide-react";
import { InquiryMatchesTable } from "@/components/inquiry-matches-table";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

/**
 * Dedicated case-creation page. A case can start blank or be driven by any
 * number of inquiries; for each one the analyst chooses which current matches
 * are copied in as the initial evidence.
 */
export default function NewCasePage() {
  return (
    <React.Suspense>
      <NewCasePageInner />
    </React.Suspense>
  );
}

function NewCasePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialInquiryId = searchParams.get("inquiryId");

  const [allInquiries, setAllInquiries] = React.useState<InquiryResponseDto[]>([]);
  const [selectedInquiryIds, setSelectedInquiryIds] = React.useState<string[]>(
    initialInquiryId ? [initialInquiryId] : [],
  );
  // Per-inquiry live matches + per-inquiry selected finding ids.
  const [matchesByInquiry, setMatchesByInquiry] = React.useState<
    Map<string, InquiryMatchDto[]>
  >(new Map());
  const [selectedByInquiry, setSelectedByInquiry] = React.useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [loadingMatches, setLoadingMatches] = React.useState<Set<string>>(new Set());

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<string>("MEDIUM");
  const [assignee, setAssignee] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  // Load all inquiries for the picker.
  React.useEffect(() => {
    api.inquiries
      .inquiriesControllerList({ limit: 200 })
      .then((res) => setAllInquiries(res.items))
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load inquiries");
      });
  }, []);

  // Prefill the title from the first selected inquiry.
  React.useEffect(() => {
    if (selectedInquiryIds.length === 0) return;
    const first = allInquiries.find((q) => q.id === selectedInquiryIds[0]);
    if (first) setTitle((prev) => prev || first.title);
  }, [selectedInquiryIds, allInquiries]);

  // Fetch matches for newly selected inquiries; default-select all of them.
  React.useEffect(() => {
    for (const id of selectedInquiryIds) {
      if (matchesByInquiry.has(id) || loadingMatches.has(id)) continue;
      setLoadingMatches((prev) => new Set(prev).add(id));
      api.inquiries
        .inquiriesControllerListMatches({ id })
        .then((m) => {
          setMatchesByInquiry((prev) => new Map(prev).set(id, m));
          setSelectedByInquiry((prev) =>
            new Map(prev).set(id, new Set(m.map((x) => x.findingId))),
          );
        })
        .catch((err) => {
          console.error(err);
          toast.error("Failed to load inquiry matches");
        })
        .finally(() =>
          setLoadingMatches((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
    }
  }, [selectedInquiryIds, matchesByInquiry, loadingMatches]);

  const totalSelected = selectedInquiryIds.reduce(
    (sum, id) => sum + (selectedByInquiry.get(id)?.size ?? 0),
    0,
  );

  const create = async () => {
    if (!title.trim()) {
      toast.error("Give the case a title");
      return;
    }
    setCreating(true);
    try {
      const dto: CreateCaseDto = {
        title: title.trim(),
        description: description.trim() || undefined,
        severity: severity as CreateCaseDto["severity"],
        assignee: assignee.trim() || undefined,
        inquiryIds: selectedInquiryIds.length > 0 ? selectedInquiryIds : undefined,
      };
      const created = await api.cases.casesControllerCreate({ createCaseDto: dto });

      let pulled = 0;
      let pullFailed = false;
      for (const inquiryId of selectedInquiryIds) {
        const findingIds = Array.from(selectedByInquiry.get(inquiryId) ?? []);
        if (findingIds.length === 0) continue;
        try {
          const res = await api.cases.casesControllerPull({
            id: created.id,
            pullFromInquiryDto: { inquiryId, findingIds },
          });
          pulled += res.pulled;
        } catch (err) {
          console.error(err);
          pullFailed = true;
        }
      }
      if (pullFailed) {
        toast.warning("Case opened, but some evidence could not be pulled — pull again from the case.");
      } else if (pulled > 0) {
        toast.success(`Case opened — ${pulled} finding${pulled === 1 ? "" : "s"} added as evidence`);
      } else {
        toast.success("Case opened");
      }
      router.push(`/investigations/${created.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to open case");
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">Open a case</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          A case is the workspace for one investigation: it keeps its own copy of evidence,
          tracks hypotheses and discussion, and ends with a conclusion. Link any number of
          inquiries to drive it — or start blank and add evidence directly.
        </p>
      </div>

      <div className="grid max-w-6xl gap-6 lg:grid-cols-[360px_1fr]">
        {/* ── Case details ── */}
        <div className="space-y-4">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
            Case details
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="case-title">Title</Label>
            <Input
              id="case-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is being investigated?"
              maxLength={300}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-description">Description</Label>
            <Textarea
              id="case-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context, scope, what triggered this investigation…"
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-assignee">Assignee</Label>
            <Input
              id="case-assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Who leads this case? (optional)"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Driving inquiries</Label>
            <MultiSelect values={selectedInquiryIds} onValuesChange={setSelectedInquiryIds}>
              <MultiSelectTrigger className="w-full">
                <MultiSelectValue placeholder="Select inquiries (optional)" />
              </MultiSelectTrigger>
              <MultiSelectContent
                search={{ placeholder: "Search inquiries…", emptyMessage: "No inquiries found" }}
              >
                <MultiSelectGroup>
                  {allInquiries.map((q) => (
                    <MultiSelectItem key={q.id} value={q.id}>
                      <span className="inline-flex items-center gap-1.5">
                        {q.title}
                        <span className="text-muted-foreground text-xs">
                          ({q.matchCount} match{q.matchCount === 1 ? "" : "es"})
                        </span>
                      </span>
                    </MultiSelectItem>
                  ))}
                </MultiSelectGroup>
              </MultiSelectContent>
            </MultiSelect>
            <p className="text-muted-foreground text-xs">
              An inquiry can drive several cases at once.
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={create} disabled={creating || !title.trim()} className="w-full">
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              {totalSelected > 0
                ? `Open case with ${totalSelected} finding${totalSelected === 1 ? "" : "s"}`
                : "Open case"}
            </Button>
          </div>
        </div>

        {/* ── Initial evidence per inquiry ── */}
        <div className="space-y-5">
          {selectedInquiryIds.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground p-4 text-sm">
                This case starts empty. Select inquiries on the left to bring their matches
                in as initial evidence — or add evidence directly from the case workspace
                later.
              </CardContent>
            </Card>
          ) : (
            selectedInquiryIds.map((inquiryId) => {
              const inquiry = allInquiries.find((q) => q.id === inquiryId);
              const matches = matchesByInquiry.get(inquiryId);
              const selected = selectedByInquiry.get(inquiryId) ?? new Set<string>();
              return (
                <div key={inquiryId} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-[color:var(--color-amber-600,#d97706)]" />
                    <span className="text-sm font-medium">{inquiry?.title ?? inquiryId}</span>
                    {matches && (
                      <Badge variant="outline" className="text-[10px]">
                        {selected.size}/{matches.length} selected
                      </Badge>
                    )}
                  </div>
                  {!matches ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading matches…
                    </div>
                  ) : (
                    <InquiryMatchesTable
                      matches={matches}
                      selected={selected}
                      onSelectedChange={(next) =>
                        setSelectedByInquiry((prev) => new Map(prev).set(inquiryId, next))
                      }
                    />
                  )}
                </div>
              );
            })
          )}
          {selectedInquiryIds.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Selected matches are copied into the case as evidence — the case keeps its own
              snapshot, and you can pull newer matches at any time.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
