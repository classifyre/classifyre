"use client";

import * as React from "react";
import {
  Activity, FileText, Search, Link2, Trash2, Download,
  Pencil, MessageSquare, GitCommit, ChevronDown,
} from "lucide-react";
import { api, type CaseActivityDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";

const TYPE_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  CASE_CREATED: { icon: <Activity className="h-3.5 w-3.5" />, label: "Case created", color: "text-green-600 dark:text-green-400" },
  CASE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Case updated", color: "text-muted-foreground" },
  CONCLUSION_UPDATED: { icon: <FileText className="h-3.5 w-3.5" />, label: "Conclusion updated", color: "text-amber-600 dark:text-amber-400" },
  INQUIRY_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry linked", color: "text-blue-600 dark:text-blue-400" },
  INQUIRY_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry unlinked", color: "text-muted-foreground" },
  INQUIRY_PULLED: { icon: <Download className="h-3.5 w-3.5" />, label: "Pulled from inquiry", color: "text-blue-600 dark:text-blue-400" },
  EVIDENCE_ADDED: { icon: <Search className="h-3.5 w-3.5" />, label: "Evidence added", color: "text-green-600 dark:text-green-400" },
  EVIDENCE_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Evidence removed", color: "text-red-600 dark:text-red-400" },
  EVIDENCE_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Evidence note updated", color: "text-muted-foreground" },
  FINDING_ADDED: { icon: <Search className="h-3.5 w-3.5" />, label: "Finding added", color: "text-green-600 dark:text-green-400" },
  FINDING_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Finding removed", color: "text-red-600 dark:text-red-400" },
  FINDING_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Finding note updated", color: "text-muted-foreground" },
  THREAD_CREATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Thread created", color: "text-violet-600 dark:text-violet-400" },
  THREAD_ENTRY_ADDED: { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Note added", color: "text-muted-foreground" },
  THREAD_STATEMENT_UPDATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Statement revised", color: "text-violet-600 dark:text-violet-400" },
  THREAD_STATUS_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Status changed", color: "text-amber-600 dark:text-amber-400" },
  THREAD_CONFIDENCE_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Confidence updated", color: "text-amber-600 dark:text-amber-400" },
  SUPPORT_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence linked to thread", color: "text-blue-600 dark:text-blue-400" },
  SUPPORT_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence unlinked", color: "text-muted-foreground" },
  SUPPORT_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Support updated", color: "text-muted-foreground" },
};

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
}

function ActivityCard({ item }: { item: CaseActivityDto }) {
  const meta = TYPE_META[item.activityType] ?? {
    icon: <Activity className="h-3.5 w-3.5" />,
    label: item.activityType.toLowerCase().replace(/_/g, " "),
    color: "text-muted-foreground",
  };
  const p = item.payload as Record<string, unknown>;

  const detail = (() => {
    if (item.activityType === "INQUIRY_PULLED") return `${p.pulled ?? 0} finding${p.pulled === 1 ? "" : "s"} pulled`;
    if (item.activityType === "THREAD_CREATED") return p.threadTitle ? String(p.threadTitle) : null;
    if (item.activityType === "THREAD_STATEMENT_UPDATED" && p.body) return String(p.body).slice(0, 80);
    if (item.activityType === "THREAD_STATUS_CHANGED") return `${p.previousStatus} → ${p.status}`;
    if (item.activityType === "THREAD_CONFIDENCE_CHANGED") return `confidence → ${Math.round(Number(p.confidence ?? 0) * 100)}%`;
    if (item.activityType === "EVIDENCE_ADDED" && p.label) return String(p.label);
    if (item.activityType === "FINDING_ADDED" && p.label) return String(p.label);
    return null;
  })();

  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className={`mt-0.5 shrink-0 ${meta.color}`}>{meta.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{meta.label}</p>
        {detail && <p className="text-muted-foreground mt-0.5 truncate text-xs">{detail}</p>}
      </div>
      <div className="shrink-0 text-right">
        {item.actor && <p className="text-muted-foreground text-xs">{item.actor}</p>}
        <p className="text-muted-foreground text-[11px]">{relativeTime(new Date(item.createdAt))}</p>
      </div>
    </div>
  );
}

type FilterKind = "ALL" | "SYSTEM" | "THREADS";

const FILTER_TYPES: Record<FilterKind, string[] | null> = {
  ALL: null,
  SYSTEM: ["CASE_CREATED", "CASE_UPDATED", "CONCLUSION_UPDATED", "INQUIRY_LINKED", "INQUIRY_UNLINKED", "INQUIRY_PULLED", "EVIDENCE_ADDED", "EVIDENCE_REMOVED", "EVIDENCE_NOTE_UPDATED", "FINDING_ADDED", "FINDING_REMOVED", "FINDING_NOTE_UPDATED"],
  THREADS: ["THREAD_CREATED", "THREAD_ENTRY_ADDED", "THREAD_STATEMENT_UPDATED", "THREAD_STATUS_CHANGED", "THREAD_CONFIDENCE_CHANGED", "SUPPORT_LINKED", "SUPPORT_UNLINKED", "SUPPORT_UPDATED"],
};

export function CaseTimeline({ caseId }: { caseId: string }) {
  const [items, setItems] = React.useState<CaseActivityDto[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<FilterKind>("ALL");

  const load = React.useCallback(async (append = false) => {
    setLoading(true);
    try {
      const res = await api.threads.threadsControllerTimeline({
        caseId,
        cursor: append && cursor ? cursor : undefined,
        limit: 50,
      });
      setItems((prev) => append ? [...prev, ...res.items] : res.items);
      setCursor(res.nextCursor);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [caseId, cursor]);

  React.useEffect(() => { void load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = React.useMemo(() => {
    const allowed = FILTER_TYPES[filter];
    if (!allowed) return items;
    return items.filter((i) => allowed.includes(i.activityType));
  }, [items, filter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {(["ALL", "SYSTEM", "THREADS"] as FilterKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded border px-2.5 py-0.5 text-xs font-medium transition-colors ${filter === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
          >
            {k === "ALL" ? "All" : k === "SYSTEM" ? "Case events" : "Threads"}
          </button>
        ))}
        <button onClick={() => load()} className="ml-auto text-muted-foreground text-xs underline">Refresh</button>
      </div>

      {visible.length === 0 && !loading ? (
        <p className="text-muted-foreground py-8 text-center text-sm">No activity yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {visible.map((item) => (
            <ActivityCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {cursor && (
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading} className="w-full">
          <ChevronDown className="h-3.5 w-3.5" /> Load more
        </Button>
      )}
    </div>
  );
}
