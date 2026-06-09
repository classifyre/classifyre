"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Fingerprint, RefreshCw, FolderPlus, Trash2, Archive, Sparkles, Link2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type InquiryResponseDto,
  type InquiryMatchDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";

function abbrevDetector(dt: string | undefined | null): string {
  return dt ? dt.replace(/^UNSTRUCTURED_API_/, "").replace(/_/g, " ").toLowerCase() : "";
}

export default function InquiryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const inquiryId = params.id as string;

  const [inquiry, setInquiry] = React.useState<InquiryResponseDto | null>(null);
  const [matches, setMatches] = React.useState<InquiryMatchDto[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [q, m] = await Promise.all([
      api.inquiries.inquiriesControllerFindOne({ id: inquiryId }),
      api.inquiries.inquiriesControllerListMatches({ id: inquiryId }),
    ]);
    setInquiry(q);
    setMatches(m);
    // Viewing the detail clears the "new" badge.
    if (q.newMatchCount > 0) await api.inquiries.inquiriesControllerMarkSeen({ id: inquiryId }).catch(() => {});
  }, [inquiryId]);

  React.useEffect(() => { void load(); }, [load]);

  const rescan = async () => {
    setBusy(true);
    try {
      const res = await api.inquiries.inquiriesControllerRematch({ id: inquiryId });
      toast.success(`Re-scanned — ${res.landed} new match(es)`);
      await load();
    } catch (err) { console.error(err); toast.error("Re-scan failed"); }
    finally { setBusy(false); }
  };

  const createCase = async () => {
    setBusy(true);
    try {
      const created = await api.cases.casesControllerCreate({
        createCaseDto: { title: inquiry?.title ?? "Investigation", inquiryIds: [inquiryId] },
      });
      toast.success("Case opened from inquiry");
      router.push(`/investigations/${created.id}`);
    } catch (err) { console.error(err); toast.error("Failed to open case"); }
    finally { setBusy(false); }
  };

  const archive = async () => {
    await api.inquiries.inquiriesControllerUpdate({ id: inquiryId, updateInquiryDto: { status: "ARCHIVED" as never } });
    toast.success("Inquiry archived");
    await load();
  };

  const remove = async () => {
    await api.inquiries.inquiriesControllerRemove({ id: inquiryId });
    toast.success("Inquiry deleted");
    router.push("/investigations");
  };

  if (!inquiry) return <div className="text-muted-foreground py-12 text-center text-sm">Loading inquiry…</div>;

  const typeTokens = [
    ...inquiry.detectorTypes,
    ...inquiry.customDetectorKeys.map((k) => `custom:${k}`),
    ...inquiry.findingTypes,
    ...inquiry.findingTypeRegex.map((r) => `/${r}/`),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/investigations")}>
          <ArrowLeft className="h-4 w-4" /> Investigations
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[4px] border-2 border-border bg-card shadow-[2px_2px_0_var(--color-border)]">
            <Sparkles className="h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
          </span>
          <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">{inquiry.title}</h1>
          <Badge variant="outline">{inquiry.status}</Badge>
          {inquiry.caseId ? (
            <Button size="sm" variant="outline" onClick={() => router.push(`/investigations/${inquiry.caseId}`)}>
              <Link2 className="h-3.5 w-3.5" /> Open linked case
            </Button>
          ) : (
            <Button size="sm" onClick={createCase} disabled={busy}>
              <FolderPlus className="h-3.5 w-3.5" /> Open case
            </Button>
          )}
        </div>
        {inquiry.description && <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{inquiry.description}</p>}
      </div>

      {/* Query definition */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">This query lands findings from</p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <Badge variant="outline" className="font-medium">
              {inquiry.matchAllSources ? "all sources" : `${inquiry.sourceIds.length} source${inquiry.sourceIds.length === 1 ? "" : "s"}`}
            </Badge>
            <span className="text-muted-foreground">·</span>
            {typeTokens.length === 0 ? (
              <span className="text-muted-foreground">any finding type</span>
            ) : (
              typeTokens.map((t) => (
                <span key={t} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">{t}</span>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Matches */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="font-serif text-lg font-black uppercase tracking-[0.04em]">Matches</h2>
            <span className="text-muted-foreground tabular-nums text-sm">{inquiry.matchCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={rescan} disabled={busy}><RefreshCw className="h-3.5 w-3.5" /> Re-scan</Button>
            {inquiry.status !== "ARCHIVED" && <Button variant="outline" size="sm" onClick={archive}><Archive className="h-3.5 w-3.5" /> Archive</Button>}
            <Button variant="ghost" size="sm" className="text-destructive" onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Matches are computed live — they are not evidence. Open a case and pull the ones you want to keep.
        </p>
        {matches.length > 0 ? (
          <div className="space-y-1">
            {matches.map((m) => (
              <div key={m.findingId}
                className={`flex items-center justify-between gap-2 border px-3 py-2 text-sm transition-colors ${m.isNew ? "border-[color:var(--color-amber-600,#d97706)]/50 bg-[color:var(--color-amber-600,#d97706)]/5" : "border-border"}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <Fingerprint className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{m.label}</span>
                  {m.detectorType && <span className="text-muted-foreground text-[10px]">{abbrevDetector(m.detectorType)}</span>}
                  {m.severity && <SeverityBadge severity={m.severity.toLowerCase() as never} className="shrink-0">{m.severity}</SeverityBadge>}
                  {m.assetName && <span className="text-muted-foreground truncate text-xs">· {m.assetName}</span>}
                  {m.isNew && <Badge variant="outline" className="shrink-0 border-[color:var(--color-amber-600,#d97706)]/50 text-[color:var(--color-amber-600,#d97706)]">new</Badge>}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">{new Date(m.matchedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No matches yet" description="As sources are ingested, findings matching this query will appear here." />
        )}
      </div>
    </div>
  );
}
