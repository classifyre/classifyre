"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Check,
  ChevronDown,
  Circle,
  CircleDashed,
  Crosshair,
  Focus,
  GitCommitHorizontal,
  Loader2,
  MapPin,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  getActorName,
  AddThreadEntryDtoEntryTypeEnum,
  type ThreadEntryDto,
  type ThreadResponseDto,
  type ThreadSupportLinkDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Slider } from "@workspace/ui/components/slider";
import { Textarea } from "@workspace/ui/components/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { cn } from "@workspace/ui/lib/utils";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { placeThread } from "../store/commands";
import { hypothesisMeta } from "../store/selectors";
import { useFlyToEvidence } from "../hooks/use-place-evidence";
import { useVisibleCentre } from "../hooks/use-visible-centre";

export type Verdict = "PROPOSED" | "SUPPORTED" | "REFUTED" | "INCONCLUSIVE";
type Stance = "SUPPORTS" | "CONTRADICTS" | "NEUTRAL";

export const VERDICTS: Array<{ value: Verdict; icon: React.ElementType; tone: string }> = [
  { value: "PROPOSED", icon: CircleDashed, tone: "var(--muted-foreground)" },
  { value: "SUPPORTED", icon: Check, tone: "var(--cb-supports)" },
  { value: "REFUTED", icon: X, tone: "var(--cb-contradicts)" },
  { value: "INCONCLUSIVE", icon: Minus, tone: "#d97706" },
];

const STANCES: Array<{ value: Stance; icon: React.ElementType; tone: string; label: TranslationKey }> = [
  { value: "SUPPORTS", icon: Check, tone: "var(--cb-supports)", label: "caseBoard.link.supports" },
  { value: "CONTRADICTS", icon: X, tone: "var(--cb-contradicts)", label: "caseBoard.link.contradicts" },
  { value: "NEUTRAL", icon: Circle, tone: "var(--muted-foreground)", label: "caseBoard.link.neutral" },
];

const SWATCHES = ["#e11d48", "#ea580c", "#d97706", "#65a30d", "#059669", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];

const stanceOf = (value: string) => STANCES.find((s) => s.value === value) ?? STANCES[2]!;

/** What the panel needs to act on a thread: every change reloads it and the board. */
function useThread(caseId: string, threadId: string | null) {
  const store = useBoardStore();
  const boardThread = useBoard((s) => (threadId ? s.threads.get(threadId) : undefined));
  const [thread, setThread] = React.useState<ThreadResponseDto | null>(null);
  const [missing, setMissing] = React.useState(false);
  const load = React.useCallback(async () => {
    if (!threadId) return;
    try {
      const all = await api.threads.caseThreadsControllerList({ caseId });
      const found = all.find((th) => th.id === threadId) ?? null;
      setThread(found);
      setMissing(!found);
    } catch {
      setMissing(true);
    }
  }, [caseId, threadId]);
  // The board's copy changes when someone links, relabels or rules on it
  // elsewhere (the canvas, another viewer): the panel follows.
  const signature = boardThread
    ? `${boardThread.title}|${boardThread.status}|${boardThread.confidence}|${boardThread.color}|${boardThread.entryCount}|${boardThread.supportingCount}|${boardThread.contradictingCount}|${boardThread.neutralCount}`
    : "";
  React.useEffect(() => {
    void load();
  }, [load, signature]);
  const changed = React.useCallback(async () => {
    await load();
    store.getState().refetch();
  }, [load, store]);
  return { thread, missing, changed, boardThread };
}

/**
 * The thread side panel: a hypothesis as a narrow, working document — its
 * statement and verdict up top, the balance of evidence at a glance, then the
 * evidence, the log and the test in tabs, and a composer that stays at the
 * bottom. A comment's discussion gets the log and the composer alone.
 */
export function ThreadPanel({ caseId, onFlyTo }: { caseId: string; onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const threadId = useUi((s) => s.drawerThreadId);
  const { thread, missing, changed, boardThread } = useThread(caseId, threadId);
  if (missing) return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.thread.missing")}</p>;
  if (!thread) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return thread.kind === "HYPOTHESIS" ? (
    <HypothesisView thread={thread} itemId={boardThread?.itemId ?? null} onBoard={!!boardThread?.onBoard} changed={changed} onFlyTo={onFlyTo} />
  ) : (
    <DiscussionView thread={thread} itemId={boardThread?.itemId ?? null} onBoard={!!boardThread?.onBoard} changed={changed} onFlyTo={onFlyTo} />
  );
}

// ─── Hypothesis ──────────────────────────────────────────────────────────────

function HypothesisView({
  thread,
  itemId,
  onBoard,
  changed,
  onFlyTo,
}: {
  thread: ThreadResponseDto;
  itemId: string | null;
  onBoard: boolean;
  changed: () => Promise<void>;
  onFlyTo: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const threads = useBoard((s) => s.threads);
  const readOnly = useBoard((s) => s.readOnly);
  const meta = React.useMemo(() => hypothesisMeta(threads), [threads]);
  const m = meta.get(thread.id) ?? { label: "H", color: thread.color ?? "#737373", index: 0 };
  const [tab, setTab] = React.useState<"evidence" | "log" | "test">("evidence");
  const verdict = (thread.status ?? "PROPOSED") as Verdict;

  const patch = async (data: Parameters<typeof api.threads.caseThreadsControllerUpdate>[0]["updateThreadDto"]) => {
    try {
      // The thread API does not read X-Actor-Name: say who changed it.
      await api.threads.caseThreadsControllerUpdate({ id: thread.id, updateThreadDto: { ...data, actor: getActorName() } });
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const counts = { SUPPORTS: 0, CONTRADICTS: 0, NEUTRAL: 0 } as Record<Stance, number>;
  for (const l of thread.links) counts[l.stance as Stance] += 1;
  const total = thread.links.length;

  return (
    <div className="flex min-h-full flex-col gap-5" data-testid="hypothesis-panel">
      {/* The statement, with its mark and colour as the board draws it. */}
      <section className="relative pl-4">
        <span className="absolute inset-y-0 left-0 w-1 rounded-full" style={{ background: m.color }} aria-hidden />
        <div className="flex items-center gap-2">
          <span className="rounded-[3px] px-1.5 py-0.5 font-mono text-[11px] leading-none font-bold text-white" style={{ background: m.color }}>
            {m.label}
          </span>
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            {t("caseBoard.thread.hypothesis")}
          </span>
          <span className="flex-1" />
          <ThreadMenu thread={thread} itemId={itemId} onBoard={onBoard} readOnly={readOnly} onPatch={patch} onFlyTo={onFlyTo} />
        </div>
        <Statement thread={thread} readOnly={readOnly} changed={changed} />
      </section>

      {/* The verdict: one ruling, logged as an entry when it changes. */}
      <section className="space-y-2">
        <Label>{t("caseBoard.thread.verdict")}</Label>
        <div className="grid grid-cols-4 gap-1 rounded-[4px] border-2 border-border p-1" role="radiogroup" aria-label={t("caseBoard.thread.verdict")}>
          {VERDICTS.map((v) => {
            const active = verdict === v.value;
            return (
              <button
                key={v.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={readOnly}
                onClick={() => !active && void patch({ status: v.value as never })}
                data-testid={`verdict-${v.value}`}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-[3px] px-1 py-1.5 text-[11px] leading-none font-medium transition-colors disabled:cursor-default",
                  active ? "text-white" : "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                )}
                style={active ? { background: v.value === "PROPOSED" ? "var(--foreground)" : v.tone, color: v.value === "PROPOSED" ? "var(--background)" : undefined } : undefined}
              >
                <v.icon className="size-3.5" strokeWidth={2.5} aria-hidden />
                <span className="truncate">{t(`caseBoard.hypothesis.status.${v.value}`)}</span>
              </button>
            );
          })}
        </div>
        <Confidence value={thread.confidence ?? null} readOnly={readOnly} onCommit={(v) => void patch({ confidence: v })} />
      </section>

      {/* The balance of evidence, at a glance. */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>{t("caseBoard.thread.balance")}</Label>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {t("caseBoard.thread.linkedCount", { count: total })}
          </span>
        </div>
        {total === 0 ? (
          <p className="text-xs text-muted-foreground">{t("caseBoard.thread.noEvidence")}</p>
        ) : (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              {STANCES.map((s) =>
                counts[s.value] > 0 ? (
                  <span key={s.value} style={{ width: `${(counts[s.value] / total) * 100}%`, background: s.tone }} />
                ) : null,
              )}
            </div>
            <div className="flex gap-4 font-mono text-[11px] tabular-nums">
              {STANCES.map((s) => (
                <span key={s.value} className="inline-flex items-center gap-1" title={t(s.label)}>
                  <s.icon className="size-3" strokeWidth={3} style={{ color: s.tone }} aria-hidden />
                  {counts[s.value]}
                  <span className="text-muted-foreground">{t(s.label).toLowerCase()}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="flex-1 space-y-3">
        <div className="flex gap-4 border-b-2 border-border" role="tablist">
          {(
            [
              ["evidence", t("caseBoard.thread.tabs.evidence"), total],
              ["log", t("caseBoard.thread.tabs.log"), thread.entries.length],
              ["test", t("caseBoard.thread.tabs.test"), null],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              data-testid={`thread-tab-${key}`}
              className={cn(
                "-mb-0.5 border-b-2 pb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors",
                tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {count !== null && <span className="ml-1 text-muted-foreground tabular-nums">{count}</span>}
            </button>
          ))}
        </div>
        {tab === "evidence" && <EvidenceTab thread={thread} readOnly={readOnly} changed={changed} onFlyTo={onFlyTo} />}
        {tab === "log" && <EntryLog entries={thread.entries} />}
        {tab === "test" && <TestTab thread={thread} readOnly={readOnly} onPatch={patch} />}
      </section>

      {!readOnly && (
        <Composer
          placeholder={t("caseBoard.thread.reasoningPlaceholder")}
          onSend={async (body) => {
            await api.threads.caseThreadsControllerAddEntry({
              id: thread.id,
              addThreadEntryDto: { entryType: AddThreadEntryDtoEntryTypeEnum.Note, body, author: getActorName() },
            });
            await changed();
            setTab("log");
          }}
        />
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{children}</p>;
}

/** The statement; clicking it edits it, and the edit is logged as a STATEMENT entry. */
function Statement({
  thread,
  readOnly,
  changed,
}: {
  thread: ThreadResponseDto;
  readOnly: boolean;
  changed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const save = async (draft: string) => {
    const body = draft.trim();
    setEditing(false);
    if (!body || body === thread.title) return;
    setSaving(true);
    try {
      await api.threads.caseThreadsControllerAddEntry({
        id: thread.id,
        addThreadEntryDto: { entryType: AddThreadEntryDtoEntryTypeEnum.Statement, body, author: getActorName() },
      });
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };
  if (editing) return <StatementDraft initial={thread.title} placeholder={t("caseBoard.hypothesis.placeholder")} onSave={save} onCancel={() => setEditing(false)} />;
  return (
    <button
      type="button"
      disabled={readOnly || saving}
      onClick={() => setEditing(true)}
      className="group mt-2 flex w-full items-start gap-2 text-left disabled:cursor-default"
      data-testid="hypothesis-statement"
    >
      <span className="min-w-0 flex-1 text-[17px] leading-snug font-semibold break-words">{thread.title}</span>
      {saving ? (
        <Loader2 className="mt-1 size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        !readOnly && <Pencil className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      )}
    </button>
  );
}

function StatementDraft({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onSave: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <Textarea
      autoFocus
      rows={3}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSave(draft);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="mt-2 text-[15px] font-semibold"
    />
  );
}

function Confidence({ value, readOnly, onCommit }: { value: number | null; readOnly: boolean; onCommit: (v: number) => void }) {
  const { t } = useTranslation();
  const [local, setLocal] = React.useState<number | null>(null);
  const shown = local ?? Math.round((value ?? 0) * 100);
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="w-24 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
        {t("caseBoard.hypothesis.confidence")}
      </span>
      <Slider
        value={[shown]}
        min={0}
        max={100}
        step={5}
        disabled={readOnly}
        onValueChange={([v]) => setLocal(v ?? 0)}
        onValueCommit={([v]) => {
          setLocal(null);
          onCommit((v ?? 0) / 100);
        }}
        className="flex-1"
        aria-label={t("caseBoard.hypothesis.confidence")}
      />
      <span className="w-9 shrink-0 text-right font-mono text-xs font-bold tabular-nums">{value === null && local === null ? "—" : `${shown}%`}</span>
    </div>
  );
}

/** The linked evidence: each row flies to its node; the chip changes the stance. */
function EvidenceTab({
  thread,
  readOnly,
  changed,
  onFlyTo,
}: {
  thread: ThreadResponseDto;
  readOnly: boolean;
  changed: () => Promise<void>;
  onFlyTo: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const bubbles = useBoard((s) => s.bubbles);
  const flyTo = useFlyToEvidence(onFlyTo);

  const where = (l: ThreadSupportLinkDto): { itemId: string; findingId?: string } | null => {
    for (const b of bubbles.values()) {
      if (l.targetType === "evidence" && b.evidenceId === l.targetId) return { itemId: b.itemId };
      if (l.targetType === "finding") {
        const row = b.rows.find((r) => r.caseFindingId === l.targetId);
        if (row) return { itemId: b.itemId, findingId: row.findingId };
      }
    }
    return null;
  };

  const link = async (targetType: "evidence" | "finding", targetId: string, stance: Stance) => {
    try {
      await api.threads.caseThreadsControllerLinkSupport({
        id: thread.id,
        linkThreadSupportDto: { targetType, targetId, stance: stance as never },
      });
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const unlink = async (linkId: string) => {
    try {
      await api.threads.caseThreadsControllerUnlinkSupport({ id: thread.id, linkId });
      await changed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const ordered = [...thread.links].sort(
    (a, b) => STANCES.findIndex((s) => s.value === a.stance) - STANCES.findIndex((s) => s.value === b.stance),
  );

  return (
    <div className="space-y-2">
      {ordered.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t("caseBoard.thread.noEvidenceHint")}</p>}
      <ul className="space-y-1">
        {ordered.map((l) => {
          const s = stanceOf(l.stance);
          const target = where(l);
          return (
            <li key={l.id} className="group flex items-center gap-2 rounded-[4px] border-2 border-border bg-card py-1 pr-1 pl-1.5" data-testid="hypothesis-evidence-row">
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={readOnly}>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-1 font-mono text-[10px] font-bold uppercase text-white disabled:cursor-default"
                    style={{ background: s.tone }}
                    title={t("caseBoard.thread.changeStance")}
                  >
                    <s.icon className="size-3" strokeWidth={3} aria-hidden />
                    {!readOnly && <ChevronDown className="size-2.5" aria-hidden />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {STANCES.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      disabled={option.value === l.stance}
                      onSelect={() => void link(l.targetType as "evidence" | "finding", l.targetId, option.value)}
                    >
                      <option.icon className="size-4" style={{ color: option.tone }} /> {t(option.label)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                className="min-w-0 flex-1 text-left disabled:cursor-default"
                disabled={!target}
                onClick={() => target && flyTo(target.itemId, target.findingId)}
                title={target ? t("caseBoard.drawers.showOnBoard") : undefined}
              >
                <span className="block truncate text-sm">{l.targetLabel}</span>
                <span className="block font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  {l.targetType === "finding" ? t("caseBoard.palette.kinds.finding") : t("caseBoard.palette.kinds.evidence")}
                </span>
              </button>
              {target && (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  onClick={() => flyTo(target.itemId, target.findingId)}
                  aria-label={t("caseBoard.drawers.showOnBoard")}
                >
                  <Crosshair className="size-3.5" aria-hidden />
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  onClick={() => void unlink(l.id)}
                  aria-label={t("caseBoard.thread.unlink")}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && <LinkPicker thread={thread} onLink={link} />}
    </div>
  );
}

/** Link a piece of the case: pick the stance, then search the evidence and findings on the board. */
function LinkPicker({
  thread,
  onLink,
}: {
  thread: ThreadResponseDto;
  onLink: (targetType: "evidence" | "finding", targetId: string, stance: Stance) => Promise<void>;
}) {
  const { t } = useTranslation();
  const bubbles = useBoard((s) => s.bubbles);
  const [open, setOpen] = React.useState(false);
  const [stance, setStance] = React.useState<Stance>("SUPPORTS");
  const linked = new Set(thread.links.map((l) => `${l.targetType}:${l.targetId}`));
  const groups = [...bubbles.values()]
    .map((b) => ({
      label: b.label,
      options: [
        { key: `evidence:${b.evidenceId}`, type: "evidence" as const, id: b.evidenceId, label: b.label, detail: b.sourceName ?? b.assetType ?? "" },
        ...b.rows
          .filter((r) => r.caseFindingId)
          .map((r) => ({
            key: `finding:${r.caseFindingId}`,
            type: "finding" as const,
            id: r.caseFindingId!,
            label: `${r.typeLabel}: ${r.value ?? ""}`,
            detail: r.detector ?? "",
          })),
      ].filter((o) => !linked.has(o.key)),
    }))
    .filter((g) => g.options.length > 0);

  return (
    <div className="flex items-center gap-1.5 pt-1">
      <div className="flex shrink-0 rounded-[4px] border-2 border-border p-0.5" role="radiogroup" aria-label={t("caseBoard.thread.stance")}>
        {STANCES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={stance === s.value}
            onClick={() => setStance(s.value)}
            title={t(s.label)}
            className={cn("inline-flex size-6 items-center justify-center rounded-[2px]", stance === s.value ? "text-white" : "text-muted-foreground hover:text-foreground")}
            style={stance === s.value ? { background: s.tone } : undefined}
          >
            <s.icon className="size-3" strokeWidth={3} aria-hidden />
          </button>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={groups.length === 0}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[4px] border-2 border-dashed border-border px-2.5 text-left text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground disabled:opacity-50"
            data-testid="hypothesis-link-picker"
          >
            <Plus className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{groups.length === 0 ? t("caseBoard.thread.nothingToLink") : t("caseBoard.thread.linkEvidence")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] p-0">
          <Command>
            <CommandInput placeholder={t("caseBoard.thread.searchEvidence")} />
            <CommandList className="max-h-72">
              <CommandEmpty>{t("caseBoard.palette.noResults")}</CommandEmpty>
              {groups.map((g) => (
                <CommandGroup key={g.label} heading={g.label}>
                  {g.options.map((o) => (
                    <CommandItem
                      key={o.key}
                      value={`${o.label} ${o.detail} ${o.key}`}
                      onSelect={() => {
                        setOpen(false);
                        void onLink(o.type, o.id, stance);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                        {o.type === "finding" ? t("caseBoard.palette.kinds.finding") : t("caseBoard.palette.kinds.evidence")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TestTab({
  thread,
  readOnly,
  onPatch,
}: {
  thread: ThreadResponseDto;
  readOnly: boolean;
  onPatch: (data: { testablePredicate: string | null }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(thread.testablePredicate ?? "");
  React.useEffect(() => setDraft(thread.testablePredicate ?? ""), [thread.testablePredicate]);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("caseBoard.thread.testHint")}</p>
      <Textarea
        value={draft}
        disabled={readOnly}
        rows={5}
        maxLength={2000}
        placeholder={t("caseBoard.thread.testPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        onBlur={() => {
          const next = draft.trim();
          if (next !== (thread.testablePredicate ?? "")) void onPatch({ testablePredicate: next || null });
        }}
        className="text-sm"
      />
    </div>
  );
}

/** The thread's record, oldest first like a conversation. */
function EntryLog({ entries }: { entries: ThreadEntryDto[] }) {
  const { t } = useTranslation();
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  // The first statement is the hypothesis being stated; later ones restate it.
  const firstStatement = sorted.find((e) => e.entryType === "STATEMENT")?.id;
  if (sorted.length === 0) return <p className="py-2 text-xs text-muted-foreground">{t("caseBoard.thread.noEntries")}</p>;
  return (
    <ol className="relative space-y-3 border-l-2 border-border pl-4" data-testid="thread-log">
      {sorted.map((e) => {
        const md = (e.metadata ?? {}) as Record<string, unknown>;
        const change = e.entryType === "STATUS_CHANGE" || e.entryType === "CONFIDENCE_CHANGE";
        return (
          <li key={e.id} className="relative">
            <span
              className={cn(
                "absolute top-1 -left-[23px] flex size-3.5 items-center justify-center rounded-full border-2 border-border bg-background",
                change && "border-foreground",
              )}
              aria-hidden
            >
              {e.entryType === "NOTE" ? (
                <MessageSquare className="size-2 text-muted-foreground" />
              ) : (
                <GitCommitHorizontal className="size-2 text-foreground" />
              )}
            </span>
            <div className="flex items-baseline gap-2 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              <span className="truncate">
                {e.id === firstStatement ? t("caseBoard.thread.entry.STATED") : t(`caseBoard.thread.entry.${e.entryType}` as TranslationKey)}
                {e.author ? ` · ${e.author}` : ""}
              </span>
              <span className="ml-auto shrink-0 normal-case">
                {formatDistanceToNowStrict(new Date(e.createdAt), { addSuffix: true })}
              </span>
            </div>
            {e.entryType === "STATUS_CHANGE" ? (
              <p className="mt-0.5 text-sm">
                <span className="text-muted-foreground">{String(md.previousStatus ?? "—").toLowerCase()}</span>
                <span className="mx-1.5 text-muted-foreground">→</span>
                <span className="font-semibold">{String(md.status ?? "—").toLowerCase()}</span>
              </p>
            ) : e.entryType === "CONFIDENCE_CHANGE" ? (
              <p className="mt-0.5 font-mono text-sm tabular-nums">
                {typeof md.previousConfidence === "number" ? `${Math.round(md.previousConfidence * 100)}%` : "—"}
                <span className="mx-1.5 text-muted-foreground">→</span>
                {typeof md.confidence === "number" ? `${Math.round(md.confidence * 100)}%` : "—"}
              </p>
            ) : null}
            {e.body && (
              <p className={cn("mt-0.5 text-sm break-words whitespace-pre-wrap", e.entryType === "STATEMENT" && "border-l-2 border-border pl-2 italic")}>
                {e.body}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Pinned to the bottom of the panel, so the record is one keystroke away from wherever you scrolled. */
function Composer({ placeholder, onSend }: { placeholder: string; onSend: (body: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto border-t-2 border-border bg-background px-4 py-3">
      <div className="flex items-end gap-2 rounded-[4px] border-2 border-border bg-card p-1.5 focus-within:border-foreground/60">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={Math.min(6, Math.max(2, text.split("\n").length))}
          placeholder={placeholder}
          className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-snug outline-none placeholder:text-muted-foreground"
          data-testid="thread-composer"
        />
        <Button size="sm" className="h-8 shrink-0 gap-1" disabled={!text.trim() || sending} onClick={() => void send()} aria-label={t("caseBoard.thread.send")}>
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </Button>
      </div>
      <p className="mt-1 text-right font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">⌘↵ {t("caseBoard.thread.send")}</p>
    </div>
  );
}

/** Show, place, focus, recolour or delete: the less frequent moves, out of the way. */
function ThreadMenu({
  thread,
  itemId,
  onBoard,
  readOnly,
  onPatch,
  onFlyTo,
}: {
  thread: ThreadResponseDto;
  itemId: string | null;
  onBoard: boolean;
  readOnly: boolean;
  onPatch: (data: { color: string }) => Promise<void>;
  onFlyTo: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const centre = useVisibleCentre();
  const [confirming, setConfirming] = React.useState(false);
  const remove = async () => {
    try {
      await api.threads.caseThreadsControllerRemove({ id: thread.id });
      ui.getState().openDrawer(thread.kind === "HYPOTHESIS" ? "hypotheses" : null);
      store.getState().refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("caseBoard.thread.more")}
            data-testid="thread-menu"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {onBoard && itemId ? (
            <DropdownMenuItem onSelect={() => onFlyTo(itemId)}>
              <Crosshair className="size-4" /> {t("caseBoard.drawers.showOnBoard")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={readOnly}
              onSelect={() => {
                const at = centre();
                store.getState().run(placeThread(thread.id, itemId, { x: at.x - 150, y: at.y - 75 }));
              }}
            >
              <MapPin className="size-4" /> {t("caseBoard.drawers.placeOnBoard")}
            </DropdownMenuItem>
          )}
          {thread.kind === "HYPOTHESIS" && onBoard && itemId && (
            <DropdownMenuItem onSelect={() => ui.getState().set({ focusHypothesisItemId: itemId })}>
              <Focus className="size-4" /> {t("caseBoard.hypothesis.focus")}
            </DropdownMenuItem>
          )}
          {thread.kind === "HYPOTHESIS" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={readOnly}>
                <Palette className="size-4" /> {t("caseBoard.hypothesis.changeColor")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="grid grid-cols-5 gap-1 p-2">
                {SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={cn("size-6 rounded-[3px] border-2", thread.color === hex ? "border-foreground" : "border-transparent hover:border-border")}
                    style={{ background: hex }}
                    onClick={() => void onPatch({ color: hex })}
                    aria-label={hex}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={readOnly} className="text-destructive focus:text-destructive" onSelect={() => setConfirming(true)}>
            <Trash2 className="size-4" /> {thread.kind === "HYPOTHESIS" ? t("caseBoard.thread.deleteHypothesis") : t("caseBoard.thread.deleteDiscussion")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("caseBoard.thread.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("caseBoard.thread.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void remove()}>
              {t("caseBoard.thread.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Discussion (a comment's thread) ─────────────────────────────────────────

function DiscussionView({
  thread,
  itemId,
  onBoard,
  changed,
  onFlyTo,
}: {
  thread: ThreadResponseDto;
  itemId: string | null;
  /** The pin is on the board; `itemId` may name one that was removed from it. */
  onBoard: boolean;
  changed: () => Promise<void>;
  onFlyTo: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const readOnly = useBoard((s) => s.readOnly);
  return (
    <div className="flex min-h-full flex-col gap-4" data-testid="discussion-panel">
      <section>
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("caseBoard.thread.discussion")}</span>
          <span className="flex-1" />
          <ThreadMenu thread={thread} itemId={itemId} onBoard={onBoard} readOnly={readOnly} onPatch={async () => undefined} onFlyTo={onFlyTo} />
        </div>
        <p className="mt-2 text-[15px] leading-snug font-semibold break-words">{thread.title}</p>
      </section>
      <section className="flex-1">
        <EntryLog entries={thread.entries} />
      </section>
      {!readOnly && (
        <Composer
          placeholder={t("caseBoard.thread.replyPlaceholder")}
          onSend={async (body) => {
            await api.threads.caseThreadsControllerAddEntry({
              id: thread.id,
              addThreadEntryDto: { entryType: AddThreadEntryDtoEntryTypeEnum.Note, body, author: getActorName() },
            });
            await changed();
          }}
        />
      )}
    </div>
  );
}
