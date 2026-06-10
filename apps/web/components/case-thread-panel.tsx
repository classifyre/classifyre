"use client";

import * as React from "react";
import { Plus, X, ThumbsUp, ThumbsDown, MessageSquare, GitCommit } from "lucide-react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { toast } from "sonner";
import {
  api,
  type CaseEvidenceDto,
  type ThreadResponseDto,
  AddThreadEntryDtoEntryTypeEnum,
  CreateThreadDtoKindEnum,
  ThreadResponseDtoKindEnum,
} from "@workspace/api-client";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { Slider } from "@workspace/ui/components/slider";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { EmptyState } from "@workspace/ui/components/empty-state";

const STATUSES = ["PROPOSED", "SUPPORTED", "REFUTED", "INCONCLUSIVE"] as const;
const STANCES = ["SUPPORTS", "CONTRADICTS", "NEUTRAL"] as const;

const SWATCHES = [
  "#e11d48", "#ea580c", "#d97706", "#65a30d",
  "#059669", "#0891b2", "#2563eb", "#7c3aed",
  "#db2777", "#6b7280",
] as const;

export interface CaseThreadPanelProps {
  caseId: string;
  evidence: CaseEvidenceDto[];
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

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return date.toLocaleDateString();
}

// ─── Thread card ─────────────────────────────────────────────────────────────

function ThreadCard({
  thread,
  evidence,
  onUpdate,
}: {
  thread: ThreadResponseDto;
  evidence: CaseEvidenceDto[];
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [title, setTitle] = React.useState(thread.title);
  const [status, setStatus] = React.useState<typeof STATUSES[number]>(thread.status ?? "PROPOSED");
  const [confidence, setConfidence] = React.useState(Math.round((thread.confidence ?? 0) * 100));
  const [color, setColor] = React.useState(thread.color ?? "#6b7280");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Notes
  const [noteText, setNoteText] = React.useState("");
  const [addingNote, setAddingNote] = React.useState(false);

  // Support
  const [linkTarget, setLinkTarget] = React.useState("");
  const [linkStance, setLinkStance] = React.useState<"SUPPORTS" | "CONTRADICTS" | "NEUTRAL">("SUPPORTS");
  const [linkingSupport, setLinkingSupport] = React.useState(false);

  const targets = buildLinkTargets(evidence);

  const save = async () => {
    setSaving(true);
    try {
      await api.threads.threadsControllerUpdate({
        id: thread.id,
        updateThreadDto: {
          title: title || thread.title,
          status: status as never,
          confidence: confidence / 100,
          color,
        },
      });
      setEditingTitle(false);
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update thread");
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await api.threads.threadsControllerAddEntry({
        id: thread.id,
        addThreadEntryDto: { entryType: AddThreadEntryDtoEntryTypeEnum.Note, body: noteText.trim() },
      });
      setNoteText("");
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add note");
    } finally {
      setAddingNote(false);
    }
  };

  const linkSupport = async () => {
    if (!linkTarget) return;
    setLinkingSupport(true);
    const [type, id] = linkTarget.split("::");
    try {
      await api.threads.threadsControllerLinkSupport({
        id: thread.id,
        linkThreadSupportDto: { targetType: type as "evidence" | "finding", targetId: id!, stance: linkStance as never },
      });
      setLinkTarget("");
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to link evidence");
    } finally {
      setLinkingSupport(false);
    }
  };

  const unlinkSupport = async (linkId: string) => {
    try {
      await api.threads.threadsControllerUnlinkSupport({ id: thread.id, linkId });
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to unlink");
    }
  };

  const remove = async () => {
    if (!confirm("Delete this thread?")) return;
    try {
      await api.threads.threadsControllerRemove({ id: thread.id });
      onUpdate();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete thread");
    }
  };

  const isHypothesis = thread.kind === ThreadResponseDtoKindEnum.Hypothesis;

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0 h-3 w-3 rounded-full border" style={{ backgroundColor: color }} />
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => { void save(); setEditingTitle(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditingTitle(false); }}
                className="h-6 text-sm px-1"
                autoFocus
              />
            ) : (
              <button className="text-left text-sm font-medium hover:underline break-words" onClick={() => setEditingTitle(true)}>
                {thread.title}
              </button>
            )}
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {isHypothesis && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{thread.status ?? "PROPOSED"}</Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                {thread.kind === ThreadResponseDtoKindEnum.Hypothesis ? "hypothesis" : "discussion"}
              </Badge>
              <span className="text-muted-foreground text-[11px]">
                {thread.supportingCount} for · {thread.contradictingCount} against
              </span>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={remove}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-3 pb-3 space-y-4">
          {/* Color + status + confidence (hypothesis only) */}
          {isHypothesis && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  className="h-6 w-6 rounded border"
                  style={{ backgroundColor: color }}
                  onClick={() => setPickerOpen((v) => !v)}
                />
                {pickerOpen && (
                  <div className="absolute z-20 mt-1 rounded border bg-popover p-2 shadow-md space-y-2">
                    <HexColorPicker color={color} onChange={setColor} style={{ width: 180 }} />
                    <div className="flex flex-wrap gap-1">
                      {SWATCHES.map((s) => (
                        <button key={s} className="h-4 w-4 rounded-sm border" style={{ backgroundColor: s }}
                          onClick={() => { setColor(s); setPickerOpen(false); }} />
                      ))}
                    </div>
                    <HexColorInput color={color} onChange={setColor} className="w-full rounded border px-2 py-1 font-mono text-xs" prefixed />
                  </div>
                )}
                <Select value={status} onValueChange={(v) => setStatus(v as typeof STATUSES[number])}>
                  <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Confidence: {confidence}%</p>
                <Slider value={[confidence]} min={0} max={100} step={5} onValueChange={([v]) => setConfidence(v ?? 0)} className="w-full" />
              </div>
              <Button size="sm" variant="outline" onClick={save} disabled={saving}>Save</Button>
            </div>
          )}

          {/* Entry history */}
          {thread.entries.length > 0 && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[11px] uppercase tracking-wide font-mono">History</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...thread.entries].reverse().map((e) => (
                  <div key={e.id} className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
                    {e.entryType === "NOTE" ? <MessageSquare className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" /> : <GitCommit className="h-3 w-3 mt-0.5 text-violet-500 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground font-mono text-[10px]">{e.entryType.toLowerCase().replace(/_/g, " ")}</p>
                      {e.body && <p className="break-words">{e.body}</p>}
                      {e.metadata && e.entryType === "STATUS_CHANGE" && (
                        <p className="text-muted-foreground">{String((e.metadata as Record<string, unknown>).previousStatus)} → {String((e.metadata as Record<string, unknown>).status)}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-muted-foreground text-[10px]">{relativeTime(new Date(e.createdAt))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add note */}
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide font-mono">Add note</p>
            <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} placeholder="Add a note…" className="text-sm" />
            <Button size="sm" variant="outline" onClick={addNote} disabled={addingNote || !noteText.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add note
            </Button>
          </div>

          {/* Support links */}
          <div className="space-y-2">
            <p className="text-muted-foreground text-[11px] uppercase tracking-wide font-mono">Linked evidence</p>
            {thread.links.length === 0 ? (
              <p className="text-muted-foreground text-xs">No evidence linked.</p>
            ) : (
              <div className="space-y-1">
                {thread.links.map((l) => (
                  <div key={l.id} className="flex items-center gap-1.5 rounded border p-1.5 text-xs">
                    {l.stance === "SUPPORTS" ? <ThumbsUp className="h-3 w-3 text-green-500 shrink-0" /> : l.stance === "CONTRADICTS" ? <ThumbsDown className="h-3 w-3 text-red-500 shrink-0" /> : null}
                    <span className="flex-1 min-w-0 truncate">{l.targetLabel}</span>
                    <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => unlinkSupport(l.id)}><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            {targets.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                <Select value={linkTarget} onValueChange={setLinkTarget}>
                  <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder="Select evidence…" /></SelectTrigger>
                  <SelectContent>
                    {[...new Set(targets.map((t) => t.group))].map((group) => (
                      <SelectGroup key={group}>
                        <SelectLabel>{group}</SelectLabel>
                        {targets.filter((t) => t.group === group).map((t) => (
                          <SelectItem key={`${t.targetType}::${t.targetId}`} value={`${t.targetType}::${t.targetId}`}>{t.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={linkStance} onValueChange={(v) => setLinkStance(v as typeof linkStance)}>
                  <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STANCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={linkSupport} disabled={!linkTarget || linkingSupport}>Link</Button>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function CaseThreadPanel({ caseId, evidence }: CaseThreadPanelProps) {
  const [threads, setThreads] = React.useState<ThreadResponseDto[]>([]);
  const [newTitle, setNewTitle] = React.useState("");
  const [newKind, setNewKind] = React.useState<"HYPOTHESIS" | "DISCUSSION">("HYPOTHESIS");
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await api.threads.threadsControllerList({ caseId });
    setThreads(res);
  }, [caseId]);

  React.useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api.threads.threadsControllerCreate({
        caseId,
        createThreadDto: {
          kind: newKind === "HYPOTHESIS" ? CreateThreadDtoKindEnum.Hypothesis : CreateThreadDtoKindEnum.Discussion,
          title: newTitle.trim(),
          statement: newKind === "HYPOTHESIS" ? newTitle.trim() : undefined,
        },
      });
      setNewTitle("");
      await load();
    } catch (err) {
      console.error(err);
      toast.error("Failed to create thread");
    } finally {
      setCreating(false);
    }
  };

  const hypotheses = threads.filter((t) => t.kind === ThreadResponseDtoKindEnum.Hypothesis);
  const discussions = threads.filter((t) => t.kind === ThreadResponseDtoKindEnum.Discussion);

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="flex gap-2">
        <Select value={newKind} onValueChange={(v) => setNewKind(v as typeof newKind)}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="HYPOTHESIS">Hypothesis</SelectItem>
            <SelectItem value="DISCUSSION">Discussion</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="h-8 flex-1 text-sm"
          placeholder={newKind === "HYPOTHESIS" ? "State a hypothesis…" : "Discussion topic…"}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
        />
        <Button size="sm" onClick={create} disabled={creating || !newTitle.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {hypotheses.length === 0 && discussions.length === 0 && (
        <EmptyState title="No threads" description="Add a hypothesis or start a discussion thread." />
      )}

      {hypotheses.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-[11px] font-mono uppercase tracking-wide">Hypotheses ({hypotheses.length})</p>
          {hypotheses.map((t) => (
            <ThreadCard key={t.id} thread={t} evidence={evidence} onUpdate={load} />
          ))}
        </div>
      )}

      {discussions.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-[11px] font-mono uppercase tracking-wide">Discussions ({discussions.length})</p>
          {discussions.map((t) => (
            <ThreadCard key={t.id} thread={t} evidence={evidence} onUpdate={load} />
          ))}
        </div>
      )}
    </div>
  );
}
