"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Bot,
  Check,
  ChevronDown,
  Compass,
  Loader2,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { api, type CaseLeadDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Textarea } from "@workspace/ui/components/textarea";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";

const ORIGIN_META: Record<string, { label: string; icon: React.ReactNode }> = {
  SEMANTIC_NEIGHBOR: { label: "Semantic neighbor", icon: <Sparkles className="h-3 w-3" /> },
  INQUIRY: { label: "Inquiry", icon: <Compass className="h-3 w-3" /> },
  AUTOPILOT: { label: "Autopilot", icon: <Bot className="h-3 w-3" /> },
  MANUAL: { label: "Manual", icon: <User className="h-3 w-3" /> },
};

type ReviewAction = "ACCEPT" | "DISMISS";

// ─── Lead row ─────────────────────────────────────────────────────────────────

function LeadRow({
  lead,
  reviewing,
  onReview,
}: {
  lead: CaseLeadDto;
  reviewing: ReviewAction | null;
  onReview: (leadId: string, action: ReviewAction, reason?: string) => void;
}) {
  const importancePct = lead.importance != null ? Math.round(lead.importance * 100) : null;
  const similarityPct = lead.similarity != null ? Math.round(lead.similarity * 100) : null;
  const origin = ORIGIN_META[lead.origin] ?? { label: lead.origin, icon: null };
  const [dismissOpen, setDismissOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const busy = reviewing !== null;

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-[4px] border-2 border-border bg-card p-3">
      <div className="w-[110px] shrink-0 space-y-1.5">
        {importancePct != null ? (
          <>
            <span className="font-mono text-xs font-semibold">{importancePct}</span>
            <div className="h-1.5 overflow-hidden rounded-[2px] bg-muted">
              <div className="h-full bg-accent" style={{ width: `${importancePct}%` }} />
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-[10px]">No score</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 rounded-[4px] text-[10px] uppercase tracking-wide">
            {origin.icon}
            {origin.label}
          </Badge>
          {similarityPct != null && (
            <span className="text-muted-foreground font-mono text-[10px]">
              {similarityPct}% similar
            </span>
          )}
        </div>
        <p className="text-sm font-medium">{lead.title}</p>
        <p className="text-muted-foreground whitespace-pre-wrap text-xs">{lead.rationale}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => onReview(lead.id, "ACCEPT")} disabled={busy}>
          {reviewing === "ACCEPT" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Accept
        </Button>
        <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy}>
              {reviewing === "DISMISS" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Dismiss
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Dismiss this lead?</DialogTitle>
              <DialogDescription>
                Optionally record why — it helps tune future suggestions.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Reason (optional)…"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDismissOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onReview(lead.id, "DISMISS", reason.trim() || undefined);
                  setDismissOpen(false);
                  setReason("");
                }}
              >
                Dismiss lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function CaseLeads({
  caseId,
  leads,
  loading,
  onReviewed,
  onGenerated,
}: {
  caseId: string;
  leads: CaseLeadDto[];
  loading: boolean;
  onReviewed: () => void;
  onGenerated: () => void;
}) {
  const [generating, setGenerating] = React.useState(false);
  const [generateNote, setGenerateNote] = React.useState<string | null>(null);
  const [reviewing, setReviewing] = React.useState<{ id: string; action: ReviewAction } | null>(
    null,
  );
  const [reviewedOpen, setReviewedOpen] = React.useState(false);

  const proposed = React.useMemo(
    () =>
      leads
        .filter((l) => l.status === "PROPOSED")
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)),
    [leads],
  );
  const reviewed = React.useMemo(
    () =>
      leads
        .filter((l) => l.status !== "PROPOSED")
        .sort(
          (a, b) =>
            new Date(b.reviewedAt ?? b.createdAt).getTime() -
            new Date(a.reviewedAt ?? a.createdAt).getTime(),
        ),
    [leads],
  );

  const generate = async () => {
    setGenerating(true);
    setGenerateNote(null);
    try {
      const res = await api.cases.caseLeadsControllerGenerate({ caseId });
      setGenerateNote(
        `${res.proposed} new lead${res.proposed === 1 ? "" : "s"} from ${res.considered} candidate${
          res.considered === 1 ? "" : "s"
        }`,
      );
      toast.success(`Generated ${res.proposed} lead${res.proposed === 1 ? "" : "s"}`);
      onGenerated();
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate leads");
    } finally {
      setGenerating(false);
    }
  };

  const review = async (leadId: string, action: ReviewAction, reason?: string) => {
    setReviewing({ id: leadId, action });
    try {
      await api.cases.caseLeadsControllerReview({
        caseId,
        leadId,
        reviewCaseLeadDto: { action, reason },
      });
      toast.success(action === "ACCEPT" ? "Lead accepted into evidence" : "Lead dismissed");
      onReviewed();
    } catch (err) {
      console.error(err);
      toast.error(action === "ACCEPT" ? "Failed to accept lead" : "Failed to dismiss lead");
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-2xl text-xs">
          Leads are candidate findings surfaced from semantic neighbours of your evidence and
          matches on linked inquiries. Accepting a lead attaches it to the case as evidence.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {generateNote && <span className="text-muted-foreground text-xs">{generateNote}</span>}
          <Button size="sm" variant="outline" onClick={() => void generate()} disabled={generating}>
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Generate leads
          </Button>
        </div>
      </div>

      {loading && leads.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
        </div>
      ) : proposed.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No leads to review"
          description="Leads are candidates from semantic neighbours of your evidence and matches on linked inquiries. Generate leads, or add evidence to seed the search — accepting a lead attaches it to the case as evidence."
          action={{ label: "Generate leads", onClick: () => void generate() }}
        />
      ) : (
        <div className="space-y-2">
          {proposed.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              reviewing={reviewing?.id === lead.id ? reviewing.action : null}
              onReview={(id, action, reason) => void review(id, action, reason)}
            />
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <Collapsible open={reviewedOpen} onOpenChange={setReviewedOpen}>
          <CollapsibleTrigger asChild>
            <button className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
              <ChevronDown
                className={`h-3 w-3 transition-transform ${reviewedOpen ? "" : "-rotate-90"}`}
              />
              Reviewed ({reviewed.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            {reviewed.map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border px-3 py-2 text-xs"
              >
                <Badge
                  variant="outline"
                  className={`rounded-[3px] text-[10px] uppercase ${
                    lead.status === "ACCEPTED"
                      ? "border-green-600/40 text-green-700 dark:text-green-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {lead.status === "ACCEPTED" ? "Accepted" : "Dismissed"}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{lead.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {lead.reviewedBy ?? "—"}
                  {lead.reviewedAt ? ` · ${new Date(lead.reviewedAt).toLocaleDateString()}` : ""}
                </span>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
