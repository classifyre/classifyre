"use client";

import * as React from "react";
import {
  GitCommit,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  AddThreadEntryDtoEntryTypeEnum,
  CreateThreadDtoKindEnum,
  ThreadResponseDtoKindEnum,
  type CaseEvidenceDto,
  type ThreadResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { Slider } from "@workspace/ui/components/slider";
import { Textarea } from "@workspace/ui/components/textarea";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

const STATUSES = ["PROPOSED", "SUPPORTED", "REFUTED", "INCONCLUSIVE"] as const;
const STANCES = ["SUPPORTS", "CONTRADICTS", "NEUTRAL"] as const;

const STATUS_COLOR: Record<string, string> = {
  PROPOSED: "text-muted-foreground border-border",
  SUPPORTED: "text-green-700 border-green-600/50 dark:text-green-400",
  REFUTED: "text-red-700 border-red-600/50 dark:text-red-400",
  INCONCLUSIVE: "text-amber-700 border-amber-600/50 dark:text-amber-400",
};

const SWATCHES = [
  "#e11d48", "#ea580c", "#d97706", "#65a30d", "#059669",
  "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280",
] as const;

function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
}

interface LinkTarget {
  targetType: "evidence" | "finding";
  targetId: string;
  label: string;
  group: string;
}

function buildLinkTargets(evidence: CaseEvidenceDto[]): LinkTarget[] {
  const targets: LinkTarget[] = [];
  for (const e of evidence) {
    const assetLabel = e.entity?.label ?? e.entityId;
    targets.push({ targetType: "evidence", targetId: e.id, label: assetLabel, group: assetLabel });
    for (const f of e.findings ?? []) {
      targets.push({ targetType: "finding", targetId: f.id, label: f.findingLabel, group: assetLabel });
    }
  }
  return targets;
}

// ─── Thread list item ────────────────────────────────────────────────────────

function ThreadListItem({
  thread,
  active,
  onSelect,
}: {
  thread: ThreadResponseDto;
  active: boolean;
  onSelect: () => void;
}) {
  const isHypothesis = thread.kind === ThreadResponseDtoKindEnum.Hypothesis;
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-[4px] border-2 px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-accent bg-accent/5"
          : "border-border bg-card hover:border-foreground/30"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-border/40"
          style={{ backgroundColor: thread.color ?? "#6b7280" }}
        />
        {isHypothesis ? (
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{thread.title}</span>
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {isHypothesis && (
          <>
            <Badge
              variant="outline"
              className={`h-4 px-1.5 py-0 text-[10px] uppercase tracking-wide ${STATUS_COLOR[thread.status ?? "PROPOSED"]}`}
            >
              {thread.status ?? "PROPOSED"}
            </Badge>
            {thread.confidence != null && (
              <span className="text-muted-foreground font-mono text-[10px]">
                {Math.round(Number(thread.confidence) * 100)}%
              </span>
            )}
          </>
        )}
        <span className="text-muted-foreground text-[11px]">
          {thread.supportingCount} for · {thread.contradictingCount} against ·{" "}
          {thread.entries.length} entr{thread.entries.length === 1 ? "y" : "ies"}
        </span>
      </span>
    </button>
  );
}

// ─── Thread detail pane ──────────────────────────────────────────────────────

function ThreadDetail({
  thread,
  evidence,
  onChanged,
  onDeleted,
}: {
  thread: ThreadResponseDto;
  evidence: CaseEvidenceDto[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const isHypothesis = thread.kind === ThreadResponseDtoKindEnum.Hypothesis;

  const [noteText, setNoteText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [confidence, setConfidence] = React.useState(
    Math.round(Number(thread.confidence ?? 0) * 100),
  );
  const [linkTarget, setLinkTarget] = React.useState("");
  const [linkStance, setLinkStance] = React.useState<(typeof STANCES)[number]>("SUPPORTS");
  const [linking, setLinking] = React.useState(false);

  React.useEffect(() => {
    setNoteText("");
    setConfidence(Math.round(Number(thread.confidence ?? 0) * 100));
    setLinkTarget("");
  }, [thread.id, thread.confidence]);

  const targets = React.useMemo(() => buildLinkTargets(evidence), [evidence]);
  const linkedIds = React.useMemo(
    () => new Set(thread.links.map((l) => `${l.targetType}::${l.targetId}`)),
    [thread.links],
  );
  const availableTargets = targets.filter(
    (t) => !linkedIds.has(`${t.targetType}::${t.targetId}`),
  );

  const patch = async (data: Parameters<typeof api.threads.caseThreadsControllerUpdate>[0]["updateThreadDto"]) => {
    try {
      await api.threads.caseThreadsControllerUpdate({ id: thread.id, updateThreadDto: data });
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update thread");
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setSending(true);
    try {
      await api.threads.caseThreadsControllerAddEntry({
        id: thread.id,
        addThreadEntryDto: { entryType: AddThreadEntryDtoEntryTypeEnum.Note, body: noteText.trim() },
      });
      setNoteText("");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add note");
    } finally {
      setSending(false);
    }
  };

  const link = async () => {
    if (!linkTarget) return;
    setLinking(true);
    const [type, id] = linkTarget.split("::");
    try {
      await api.threads.caseThreadsControllerLinkSupport({
        id: thread.id,
        linkThreadSupportDto: {
          targetType: type as "evidence" | "finding",
          targetId: id!,
          stance: linkStance as never,
        },
      });
      setLinkTarget("");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to link evidence");
    } finally {
      setLinking(false);
    }
  };

  const unlink = async (linkId: string) => {
    try {
      await api.threads.caseThreadsControllerUnlinkSupport({ id: thread.id, linkId });
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to unlink");
    }
  };

  const remove = async () => {
    try {
      await api.threads.caseThreadsControllerRemove({ id: thread.id });
      onDeleted();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete thread");
    }
  };

  // Entries oldest → newest reads like a conversation.
  const entries = [...thread.entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="space-y-5 rounded-[4px] border-2 border-border bg-card p-4 shadow-[0_1px_3px_rgba(28,25,23,0.04)]">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
            {isHypothesis ? "Hypothesis" : "Discussion"}
          </p>
          <h3 className="mt-0.5 break-words text-base font-semibold">{thread.title}</h3>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
              <AlertDialogDescription>
                Its notes, history and evidence links are removed. Evidence itself stays in
                the case.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ── Hypothesis state controls ── */}
      {isHypothesis && (
        <div className="flex flex-wrap items-end gap-4 rounded-[4px] border border-border bg-background/60 p-3">
          <div className="space-y-1">
            <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-wide">Verdict</p>
            <Select value={thread.status ?? "PROPOSED"} onValueChange={(v) => void patch({ status: v as never })}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px] flex-1 space-y-1">
            <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-wide">
              Confidence: <span className="text-foreground">{confidence}%</span>
            </p>
            <Slider
              value={[confidence]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => setConfidence(v ?? 0)}
              onValueCommit={([v]) => void patch({ confidence: (v ?? 0) / 100 })}
            />
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-[10px] font-mono uppercase tracking-wide">Color</p>
            <div className="flex gap-1">
              {SWATCHES.map((s) => (
                <button
                  key={s}
                  aria-label={`Set color ${s}`}
                  className={`h-5 w-5 rounded-[2px] border-2 transition-transform hover:scale-110 ${
                    (thread.color ?? "") === s ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: s }}
                  onClick={() => void patch({ color: s })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Linked evidence ── */}
      <div className="space-y-2">
        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
          Linked evidence ({thread.links.length})
        </p>
        {thread.links.length > 0 && (
          <div className="space-y-1">
            {thread.links.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2 rounded-[4px] border border-border px-2.5 py-1.5 text-xs"
              >
                {l.stance === "SUPPORTS" ? (
                  <ThumbsUp className="h-3 w-3 shrink-0 text-green-600" />
                ) : l.stance === "CONTRADICTS" ? (
                  <ThumbsDown className="h-3 w-3 shrink-0 text-red-600" />
                ) : (
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{l.targetLabel}</span>
                <span className="text-muted-foreground shrink-0 font-mono text-[10px] uppercase">
                  {l.stance.toLowerCase()}
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => void unlink(l.id)}
                  aria-label="Unlink"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {availableTargets.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <Select value={linkTarget} onValueChange={setLinkTarget}>
              <SelectTrigger className="h-8 min-w-[200px] flex-1 text-xs">
                <SelectValue placeholder="Link evidence or a finding…" />
              </SelectTrigger>
              <SelectContent>
                {[...new Set(availableTargets.map((t) => t.group))].map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {availableTargets
                      .filter((t) => t.group === group)
                      .map((t) => (
                        <SelectItem
                          key={`${t.targetType}::${t.targetId}`}
                          value={`${t.targetType}::${t.targetId}`}
                        >
                          {t.targetType === "evidence" ? "📄 " : "· "}
                          {t.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Select value={linkStance} onValueChange={(v) => setLinkStance(v as typeof linkStance)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STANCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={link} disabled={!linkTarget || linking}>
              <Link2 className="h-3.5 w-3.5" /> Link
            </Button>
          </div>
        ) : (
          thread.links.length === 0 && (
            <p className="text-muted-foreground text-xs">
              No case evidence to link yet — add evidence first.
            </p>
          )
        )}
      </div>

      {/* ── History feed ── */}
      <div className="space-y-2">
        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
          History
        </p>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-xs">No notes yet — start the record below.</p>
        ) : (
          <ol className="max-h-[360px] space-y-0 overflow-y-auto border-l-2 border-border">
            {entries.map((e) => {
              const md = (e.metadata ?? {}) as Record<string, unknown>;
              return (
                <li key={e.id} className="relative py-2 pl-5">
                  <span className="absolute -left-[7px] top-3 flex h-3 w-3 items-center justify-center rounded-full border-2 border-border bg-card">
                    {e.entryType === "NOTE" ? (
                      <MessageSquare className="h-2 w-2 text-muted-foreground" />
                    ) : (
                      <GitCommit className="h-2 w-2 text-violet-500" />
                    )}
                  </span>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
                      {e.entryType.toLowerCase().replace(/_/g, " ")}
                      {e.author ? ` · ${e.author}` : ""}
                    </p>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {relativeTime(new Date(e.createdAt))}
                    </span>
                  </div>
                  {e.body && <p className="mt-0.5 break-words text-sm">{e.body}</p>}
                  {e.entryType === "STATUS_CHANGE" && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {String(md.previousStatus ?? "?")} → {String(md.status ?? "?")}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {/* ── Composer ── */}
        <div className="flex items-end gap-2 pt-1">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addNote();
            }}
            rows={2}
            placeholder={
              isHypothesis
                ? "Record reasoning, new observations, or why the verdict changed… (⌘↵ to send)"
                : "Add to the discussion… (⌘↵ to send)"
            }
            className="flex-1 text-sm"
          />
          <Button size="sm" onClick={addNote} disabled={sending || !noteText.trim()}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function CaseThreads({
  caseId,
  evidence,
}: {
  caseId: string;
  evidence: CaseEvidenceDto[];
}) {
  const [threads, setThreads] = React.useState<ThreadResponseDto[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [newTitle, setNewTitle] = React.useState("");
  const [newKind, setNewKind] = React.useState<"HYPOTHESIS" | "DISCUSSION">("HYPOTHESIS");
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await api.threads.caseThreadsControllerList({ caseId });
    setThreads(res);
    setLoaded(true);
    return res;
  }, [caseId]);

  React.useEffect(() => {
    void load().then((res) => {
      setSelectedId((prev) => prev ?? res[0]?.id ?? null);
    });
  }, [load]);

  const create = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await api.threads.caseThreadsControllerCreate({
        caseId,
        createThreadDto: {
          kind:
            newKind === "HYPOTHESIS"
              ? CreateThreadDtoKindEnum.Hypothesis
              : CreateThreadDtoKindEnum.Discussion,
          title: newTitle.trim(),
          statement: newKind === "HYPOTHESIS" ? newTitle.trim() : undefined,
        },
      });
      setNewTitle("");
      await load();
      setSelectedId(created.id);
    } catch (err) {
      console.error(err);
      toast.error("Failed to create thread");
    } finally {
      setCreating(false);
    }
  };

  const hypotheses = threads.filter((t) => t.kind === ThreadResponseDtoKindEnum.Hypothesis);
  const discussions = threads.filter((t) => t.kind === ThreadResponseDtoKindEnum.Discussion);
  const selected = threads.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      {/* ── Create form ── */}
      <div className="flex flex-wrap gap-2">
        <Select value={newKind} onValueChange={(v) => setNewKind(v as typeof newKind)}>
          <SelectTrigger className="h-9 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="HYPOTHESIS">
              <span className="inline-flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" /> Hypothesis
              </span>
            </SelectItem>
            <SelectItem value="DISCUSSION">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Discussion
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="h-9 min-w-[240px] flex-1 text-sm"
          placeholder={
            newKind === "HYPOTHESIS"
              ? "State a testable hypothesis, e.g. “Credentials leaked via the shared wiki”…"
              : "What needs discussing?"
          }
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <Button onClick={create} disabled={creating || !newTitle.trim()}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      {loaded && threads.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No threads yet"
          description="State a hypothesis to test against the evidence, or open a discussion thread for open questions."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ── Thread list ── */}
          <div className="space-y-4">
            {hypotheses.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                  Hypotheses ({hypotheses.length})
                </p>
                {hypotheses.map((t) => (
                  <ThreadListItem
                    key={t.id}
                    thread={t}
                    active={t.id === selectedId}
                    onSelect={() => setSelectedId(t.id)}
                  />
                ))}
              </div>
            )}
            {discussions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.14em]">
                  Discussions ({discussions.length})
                </p>
                {discussions.map((t) => (
                  <ThreadListItem
                    key={t.id}
                    thread={t}
                    active={t.id === selectedId}
                    onSelect={() => setSelectedId(t.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Detail ── */}
          <div className="min-w-0">
            {selected ? (
              <ThreadDetail
                thread={selected}
                evidence={evidence}
                onChanged={() => void load()}
                onDeleted={() => {
                  setSelectedId(null);
                  void load().then((res) => setSelectedId(res[0]?.id ?? null));
                }}
              />
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Select a thread to see its history.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
