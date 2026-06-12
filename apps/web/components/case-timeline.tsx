"use client";

import * as React from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  Download,
  FileText,
  Fingerprint,
  FolderOpen,
  GitCommit,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { api, type CaseActivityDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";

// ─── Event metadata ───────────────────────────────────────────────────────────

type EventGroup = "case" | "inquiry" | "evidence" | "thread" | "ai";

/** Synthetic activityType for autopilot runs blended into the timeline. */
const AUTOPILOT_RUN = "AUTOPILOT_RUN";

const TYPE_META: Record<
  string,
  { icon: React.ReactNode; label: string; color: string; group: EventGroup }
> = {
  CASE_CREATED: { icon: <FolderOpen className="h-3.5 w-3.5" />, label: "Case opened", color: "text-green-600 dark:text-green-400", group: "case" },
  CASE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Case updated", color: "text-muted-foreground", group: "case" },
  CONCLUSION_UPDATED: { icon: <FileText className="h-3.5 w-3.5" />, label: "Conclusion updated", color: "text-amber-600 dark:text-amber-400", group: "case" },
  INQUIRY_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry linked", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  INQUIRY_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Inquiry unlinked", color: "text-muted-foreground", group: "inquiry" },
  INQUIRY_PULLED: { icon: <Download className="h-3.5 w-3.5" />, label: "Evidence pulled from inquiry", color: "text-blue-600 dark:text-blue-400", group: "inquiry" },
  EVIDENCE_ADDED: { icon: <Search className="h-3.5 w-3.5" />, label: "Evidence added", color: "text-green-600 dark:text-green-400", group: "evidence" },
  EVIDENCE_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Evidence removed", color: "text-red-600 dark:text-red-400", group: "evidence" },
  EVIDENCE_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Evidence note updated", color: "text-muted-foreground", group: "evidence" },
  FINDING_ADDED: { icon: <Fingerprint className="h-3.5 w-3.5" />, label: "Finding attached", color: "text-green-600 dark:text-green-400", group: "evidence" },
  FINDING_REMOVED: { icon: <Trash2 className="h-3.5 w-3.5" />, label: "Finding removed", color: "text-red-600 dark:text-red-400", group: "evidence" },
  FINDING_NOTE_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Finding note updated", color: "text-muted-foreground", group: "evidence" },
  THREAD_CREATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Thread started", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_ENTRY_ADDED: { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Note added", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_STATEMENT_UPDATED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Statement revised", color: "text-violet-600 dark:text-violet-400", group: "thread" },
  THREAD_STATUS_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Hypothesis status changed", color: "text-amber-600 dark:text-amber-400", group: "thread" },
  THREAD_CONFIDENCE_CHANGED: { icon: <GitCommit className="h-3.5 w-3.5" />, label: "Confidence updated", color: "text-amber-600 dark:text-amber-400", group: "thread" },
  SUPPORT_LINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence linked to thread", color: "text-blue-600 dark:text-blue-400", group: "thread" },
  SUPPORT_UNLINKED: { icon: <Link2 className="h-3.5 w-3.5" />, label: "Evidence unlinked from thread", color: "text-muted-foreground", group: "thread" },
  SUPPORT_UPDATED: { icon: <Pencil className="h-3.5 w-3.5" />, label: "Support updated", color: "text-muted-foreground", group: "thread" },
  [AUTOPILOT_RUN]: { icon: <Bot className="h-3.5 w-3.5" />, label: "AI autopilot run", color: "text-amber-600 dark:text-amber-400", group: "ai" },
};

const GROUP_FILTERS: Array<{ key: "ALL" | EventGroup; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "case", label: "Case" },
  { key: "inquiry", label: "Inquiries" },
  { key: "evidence", label: "Evidence" },
  { key: "thread", label: "Threads" },
  { key: "ai", label: "AI" },
];

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Subject of the event — the entity it happened to, shown emphasized. */
function eventSubject(item: CaseActivityDto): string | null {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  // Synthetic AI-run events are not part of the generated activity enum.
  if ((item.activityType as string) === AUTOPILOT_RUN) return str(p.instruction);
  switch (item.activityType) {
    case "INQUIRY_LINKED":
    case "INQUIRY_UNLINKED":
    case "INQUIRY_PULLED":
      return str(p.inquiryTitle);
    case "THREAD_CREATED":
    case "THREAD_ENTRY_ADDED":
    case "THREAD_STATEMENT_UPDATED":
    case "THREAD_STATUS_CHANGED":
    case "THREAD_CONFIDENCE_CHANGED":
    case "SUPPORT_LINKED":
    case "SUPPORT_UNLINKED":
    case "SUPPORT_UPDATED":
      return str(p.threadTitle);
    case "EVIDENCE_ADDED":
    case "EVIDENCE_REMOVED":
    case "EVIDENCE_NOTE_UPDATED":
    case "FINDING_ADDED":
    case "FINDING_REMOVED":
    case "FINDING_NOTE_UPDATED":
      return str(p.label);
    case "CASE_CREATED":
      return str(p.title);
    default:
      return null;
  }
}

/** Rich detail block under the event title. Old events may lack the newer payload fields. */
function EventDetail({ item }: { item: CaseActivityDto }) {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const lines: React.ReactNode[] = [];

  if ((item.activityType as string) === AUTOPILOT_RUN) {
    const status = str(p.status) ?? "?";
    return (
      <div className="text-muted-foreground mt-0.5 space-y-1 text-xs">
        <span>
          <span className="font-medium text-foreground">{status.toLowerCase()}</span>
          {str(p.summary) ? ` — ${String(p.summary)}` : ""}
          {status === "FAILED" && str(p.error) ? ` — ${String(p.error)}` : ""}
        </span>
      </div>
    );
  }

  switch (item.activityType) {
    case "INQUIRY_PULLED": {
      lines.push(
        <span key="count">
          {Number(p.pulled ?? 0)} finding{Number(p.pulled ?? 0) === 1 ? "" : "s"} copied into the case
        </span>,
      );
      break;
    }
    case "THREAD_ENTRY_ADDED":
    case "THREAD_STATEMENT_UPDATED": {
      const body = str(p.body);
      if (body) {
        lines.push(
          <span key="body" className="block whitespace-pre-wrap">
            “{body.slice(0, 200)}{body.length > 200 ? "…" : ""}”
          </span>,
        );
      }
      break;
    }
    case "THREAD_STATUS_CHANGED":
      lines.push(
        <span key="status">
          {String(p.previousStatus ?? "?")} → <span className="font-medium text-foreground">{String(p.status ?? "?")}</span>
        </span>,
      );
      break;
    case "THREAD_CONFIDENCE_CHANGED":
      lines.push(<span key="conf">confidence → {Math.round(Number(p.confidence ?? 0) * 100)}%</span>,);
      break;
    case "SUPPORT_LINKED":
    case "SUPPORT_UNLINKED": {
      const target = str(p.targetLabel);
      if (target) {
        lines.push(
          <span key="target">
            <span className="font-medium text-foreground">{target}</span>
            {str(p.stance) ? ` · ${String(p.stance).toLowerCase()}` : ""}
          </span>,
        );
      }
      break;
    }
    case "EVIDENCE_NOTE_UPDATED":
    case "FINDING_NOTE_UPDATED": {
      const note = str(p.note);
      lines.push(
        note ? (
          <span key="note" className="block whitespace-pre-wrap">
            “{note}”
          </span>
        ) : (
          <span key="note" className="italic">note cleared</span>
        ),
      );
      break;
    }
    case "CONCLUSION_UPDATED":
      if (p.closed) {
        const archived = Number(p.archivedInquiries ?? 0);
        lines.push(
          <span key="closed">
            Case closed with a conclusion
            {archived > 0 ? ` · ${archived} inquir${archived === 1 ? "y" : "ies"} archived` : ""}
          </span>,
        );
      }
      break;
    case "CASE_UPDATED":
      if (str(p.status)) lines.push(<span key="status">status → {String(p.status)}</span>);
      break;
    default:
      break;
  }

  // Finding/asset chips for batch events (pull + batch attach).
  const findingLabels = strList(p.findingLabels);
  const assetLabels = strList(p.assetLabels);
  const chips = [...new Set([...findingLabels, ...assetLabels])];

  if (lines.length === 0 && chips.length === 0) return null;
  return (
    <div className="text-muted-foreground mt-0.5 space-y-1 text-xs">
      {lines}
      {chips.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {chips.slice(0, 8).map((label) => (
            <span key={label} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
              {label}
            </span>
          ))}
          {Number(p.pulled ?? p.count ?? 0) > 8 && (
            <span className="px-1 text-[10px]">+{Number(p.pulled ?? p.count) - 8} more</span>
          )}
        </span>
      )}
    </div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CaseTimeline({ caseId }: { caseId: string }) {
  const [items, setItems] = React.useState<CaseActivityDto[]>([]);
  const [aiRuns, setAiRuns] = React.useState<CaseActivityDto[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"ALL" | EventGroup>("ALL");

  const load = React.useCallback(
    async (append = false, fromCursor?: string) => {
      setLoading(true);
      try {
        const res = await api.cases.caseTimelineControllerGetTimeline({
          caseId,
          cursor: append ? fromCursor : undefined,
          limit: "100",
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor ?? null);
        if (!append) {
          // Blend case-focused autopilot runs into the stream as synthetic
          // events, so the AI's work shows up where it happened in time.
          try {
            const runs = await api.autopilot.autopilotControllerListRuns({
              caseId,
              limit: 50,
            });
            setAiRuns(
              runs.items.map(
                (r): CaseActivityDto => ({
                  id: `ai-run-${r.id}`,
                  caseId,
                  activityType: AUTOPILOT_RUN as CaseActivityDto["activityType"],
                  payload: {
                    status: r.status,
                    summary: r.summary,
                    instruction: r.instruction,
                    error: r.error,
                    runId: r.id,
                  },
                  actor: "ai-autopilot",
                  createdAt: r.createdAt,
                }),
              ),
            );
          } catch {
            setAiRuns([]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [caseId],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const visible = React.useMemo(() => {
    const merged = [...items, ...aiRuns].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return filter === "ALL"
      ? merged
      : merged.filter((i) => (TYPE_META[i.activityType]?.group ?? "case") === filter);
  }, [items, aiRuns, filter]);

  // Group by day, newest day first (API returns newest first).
  const days = React.useMemo(() => {
    const map = new Map<string, CaseActivityDto[]>();
    for (const item of visible) {
      const key = dayKey(new Date(item.createdAt));
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const jumpTo = (key: string) => {
    document
      .getElementById(`timeline-day-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading && items.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading timeline…
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_200px]">
      <div className="min-w-0 space-y-4">
        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {GROUP_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-[4px] border-2 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                filter === key
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:border-foreground/30"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => void load()}
            className="text-muted-foreground ml-auto text-xs underline"
          >
            Refresh
          </button>
        </div>

        {days.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No activity {filter === "ALL" ? "yet" : "in this category"}.
          </p>
        ) : (
          days.map(([key, dayItems]) => (
            <section key={key} id={`timeline-day-${key}`} className="scroll-mt-20">
              <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur">
                <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">
                  {dayLabel(key)}
                  <span className="text-muted-foreground ml-2 font-normal">
                    {dayItems.length} event{dayItems.length === 1 ? "" : "s"}
                  </span>
                </h3>
              </div>
              <ol className="ml-2 border-l-2 border-border">
                {dayItems.map((item) => {
                  const meta = TYPE_META[item.activityType] ?? {
                    icon: <Activity className="h-3.5 w-3.5" />,
                    label: item.activityType.toLowerCase().replace(/_/g, " "),
                    color: "text-muted-foreground",
                    group: "case" as const,
                  };
                  const subject = eventSubject(item);
                  return (
                    <li key={item.id} id={`timeline-event-${item.id}`} className="relative pl-6 py-2">
                      <span
                        className={`absolute -left-[9px] top-2.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-border bg-card ${meta.color}`}
                      >
                        <span className="scale-[0.65]">{meta.icon}</span>
                      </span>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-sm">
                          <span className="font-medium">{meta.label}</span>
                          {subject && (
                            <>
                              <span className="text-muted-foreground"> — </span>
                              <span className="font-medium text-foreground">{subject}</span>
                            </>
                          )}
                        </p>
                        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
                          {timeLabel(new Date(item.createdAt))}
                        </span>
                      </div>
                      <EventDetail item={item} />
                      {item.actor &&
                        (isAiActor(item.actor) ? (
                          <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
                            by <AiActorBadge className="align-middle" />
                          </p>
                        ) : (
                          <p className="text-muted-foreground/70 mt-0.5 text-[11px]">by {item.actor}</p>
                        ))}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}

        {cursor && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true, cursor)}
            disabled={loading}
            className="w-full"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Load older events
          </Button>
        )}
      </div>

      {/* ── Jump navigation ── */}
      {days.length > 1 && (
        <nav className="sticky top-4 hidden self-start lg:block">
          <p className="text-muted-foreground mb-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            Jump to
          </p>
          <ul className="space-y-1 border-l-2 border-border">
            {days.map(([key, dayItems]) => (
              <li key={key}>
                <button
                  onClick={() => jumpTo(key)}
                  className="text-muted-foreground hover:text-foreground block w-full truncate px-3 py-0.5 text-left text-xs transition-colors"
                >
                  {dayLabel(key)}
                  <span className="text-muted-foreground/60 ml-1">({dayItems.length})</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
