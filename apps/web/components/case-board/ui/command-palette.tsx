"use client";

import * as React from "react";
import {
  AlertTriangle,
  Clock3,
  Compass,
  CornerDownLeft,
  FileText,
  FlaskConical,
  Frame,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  SlidersHorizontal,
  StickyNote,
  Wand2,
} from "lucide-react";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { cn } from "@workspace/ui/lib/utils";
import { getAssetKindIcon } from "@/lib/asset-kind";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { addFrame, addNote } from "../store/commands";
import { hypothesisMeta } from "../store/selectors";
import type { SeverityKey } from "../store/types";
import { useQuickSearch } from "../hooks/use-quick-search";
import { useVisibleCentre } from "../hooks/use-visible-centre";
import {
  evidenceStatus,
  useFlyToEvidence,
  usePlaceEvidence,
  type EvidenceCandidate,
} from "../hooks/use-place-evidence";

type Scope = "all" | "board" | "corpus" | "actions";
const SCOPES: Scope[] = ["all", "board", "corpus", "actions"];

/** How many of each kind "All" shows before pointing at the scope that has them all. */
const PEEK = { board: 5, corpus: 6, actions: 4 } as const;

type BoardKind = "evidence" | "finding" | "hypothesis" | "note" | "frame" | "comment";

interface BoardRow {
  key: string;
  kind: BoardKind;
  label: string;
  detail: string;
  itemId: string;
  findingId?: string;
  assetType?: string | null;
  severity?: SeverityKey | null;
  color?: string;
}

/** A corpus search result as the palette lists it. */
interface CorpusRow extends EvidenceCandidate {
  label: string;
  detail: string | null;
  severity?: SeverityKey | null;
}

interface ActionRow {
  key: string;
  label: string;
  icon: React.ElementType;
  run: () => void;
  shortcut?: string;
  editing?: boolean;
}

/** The first match of the query in a label, marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-transparent font-semibold text-foreground underline decoration-[var(--cb-evidence)] decoration-2 underline-offset-2">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

function Heading({ children, count, onMore }: { children: React.ReactNode; count?: number; onMore?: () => void }) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-3 pb-1">
      <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{children}</span>
      {count !== undefined && <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">{count}</span>}
      {onMore && (
        <button
          type="button"
          className="ml-auto font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onMore}
        >
          ⇥
        </button>
      )}
    </div>
  );
}

const itemClass =
  "group mx-1.5 flex cursor-default items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-sm outline-none select-none data-[selected=true]:bg-foreground data-[selected=true]:text-background";

function Row({
  value,
  onSelect,
  icon,
  label,
  detail,
  trailing,
  testId,
}: {
  value: string;
  onSelect: () => void;
  icon: React.ReactNode;
  label: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  testId?: string;
}) {
  return (
    <CommandItem value={value} onSelect={onSelect} className={itemClass} data-testid={testId}>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-[selected=true]:text-background">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="max-w-[38%] shrink-0 truncate text-xs text-muted-foreground group-data-[selected=true]:text-background/70">
          {detail}
        </span>
      )}
      {trailing}
    </CommandItem>
  );
}

function Tag({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[3px] border px-1.5 py-px font-mono text-[9px] tracking-[0.08em] uppercase",
        strong
          ? "border-foreground bg-foreground text-background group-data-[selected=true]:border-background group-data-[selected=true]:bg-background group-data-[selected=true]:text-foreground"
          : "border-border text-muted-foreground group-data-[selected=true]:border-background/40 group-data-[selected=true]:text-background/80",
      )}
    >
      {children}
    </span>
  );
}

function SeverityDot({ severity }: { severity: SeverityKey | null | undefined }) {
  return (
    <span
      className="size-2.5 rounded-full ring-1 ring-current/30"
      style={{ background: FINDING_SEVERITY_COLOR_BY_LEVEL[severity ?? "info"] }}
      aria-hidden
    />
  );
}

/**
 * ⌘K (PRD §5.11): one field for everything, scoped. "All" peeks at each kind
 * — what is on the board, what the corpus has, what you can do — and Tab
 * moves to the scope that lists a kind in full. With nothing typed it offers
 * the hypotheses and evidence to jump to and the things to create.
 */
export function CommandPalette({
  onFlyTo,
  onTidyUp,
}: {
  onFlyTo: (itemId: string) => void;
  onTidyUp: () => void;
}) {
  const { t } = useTranslation();
  const open = useUi((s) => s.paletteOpen);
  const ui = useUiStore();
  const store = useBoardStore();
  const readOnly = useBoard((s) => s.readOnly);
  const items = useBoard((s) => s.items);
  const bubbles = useBoard((s) => s.bubbles);
  const threads = useBoard((s) => s.threads);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<Scope>("all");
  const centre = useVisibleCentre();
  const place = usePlaceEvidence(onFlyTo);
  const flyToEvidence = useFlyToEvidence(onFlyTo);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setScope("all");
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const typing = q.length > 0;

  // The corpus, through the cheap search-as-you-type endpoint; every keystroke
  // cancels the request before it.
  const searchCorpus = !readOnly && (scope === "all" || scope === "corpus");
  const search = useQuickSearch({ q: query, limit: scope === "corpus" ? 12 : 6 }, open && searchCorpus);
  const corpus: CorpusRow[] = [
    ...search.assets.map((a) => ({
      kind: "asset" as const,
      id: a.id,
      assetId: a.id,
      assetName: a.name,
      assetType: a.assetType,
      sourceType: a.sourceType,
      label: a.name,
      detail: a.sourceName ?? a.assetType,
    })),
    ...search.findings.map((f) => ({
      kind: "finding" as const,
      id: f.id,
      assetId: f.assetId,
      assetName: f.assetName ?? f.findingType,
      assetType: null,
      sourceType: null,
      label: `${f.customDetectorName ?? f.findingType}: ${f.matchedContent ?? ""}`.slice(0, 140),
      detail: f.assetName ?? null,
      severity: f.severity.toLowerCase() as SeverityKey,
    })),
  ];

  const close = () => ui.getState().set({ paletteOpen: false });
  const after = (run: () => void) => {
    close();
    // After the dialog has closed, so what it does lands on a settled canvas.
    requestAnimationFrame(run);
  };
  const moreFilters = () => {
    close();
    ui.getState().set({ addEvidenceQuery: query.trim() });
    ui.getState().openDrawer("addEvidence");
  };

  const boardRows = React.useMemo(() => {
    const meta = hypothesisMeta(threads);
    const rows: BoardRow[] = [];
    for (const item of items.values()) {
      if (item.kind === "HYPOTHESIS" && item.refId) {
        const th = threads.get(item.refId);
        const m = meta.get(item.refId);
        if (th) {
          rows.push({
            key: `h:${item.id}`,
            kind: "hypothesis",
            label: th.title,
            detail: m?.label ?? "",
            itemId: item.id,
            color: m?.color,
          });
        }
      }
    }
    for (const b of bubbles.values()) {
      rows.push({
        key: `b:${b.itemId}`,
        kind: "evidence",
        label: b.label,
        detail: b.sourceName ?? b.assetType ?? "",
        itemId: b.itemId,
        assetType: b.assetType,
      });
    }
    for (const b of bubbles.values()) {
      for (const r of b.rows) {
        rows.push({
          key: `f:${r.findingId}`,
          kind: "finding",
          label: `${r.typeLabel}: ${r.value ?? ""}`,
          detail: b.label,
          itemId: b.itemId,
          findingId: r.findingId,
          severity: r.severity,
        });
      }
    }
    for (const item of items.values()) {
      if (item.kind === "NOTE") {
        rows.push({ key: `n:${item.id}`, kind: "note", label: item.content.text?.slice(0, 120) || t("caseBoard.note.empty"), detail: "", itemId: item.id });
      } else if (item.kind === "FRAME") {
        rows.push({ key: `fr:${item.id}`, kind: "frame", label: item.content.title || t("caseBoard.frame.untitled"), detail: "", itemId: item.id });
      } else if (item.kind === "COMMENT" && item.refId) {
        const th = threads.get(item.refId);
        if (th) rows.push({ key: `c:${item.id}`, kind: "comment", label: th.title, detail: "", itemId: item.id });
      }
    }
    return rows;
  }, [items, bubbles, threads, t]);

  const boardMatches = typing
    ? boardRows.filter((r) => r.label.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q))
    : boardRows.filter((r) => r.kind === "hypothesis" || r.kind === "evidence");

  const actions: ActionRow[] = [
    {
      key: "evidence",
      label: t("caseBoard.palette.addWithFilters"),
      icon: SlidersHorizontal,
      editing: true,
      run: moreFilters,
    },
    {
      key: "hypothesis",
      label: t("caseBoard.palette.newHypothesis"),
      icon: FlaskConical,
      editing: true,
      shortcut: "T",
      run: () =>
        after(() => {
          const at = centre();
          const pane = document.querySelector<HTMLElement>(".case-board .react-flow")?.getBoundingClientRect();
          ui.getState().set({
            composer: {
              kind: "hypothesis",
              at: { x: at.x - 150, y: at.y - 75 },
              screen: pane ? { x: pane.left + pane.width / 2 - 140, y: pane.top + pane.height / 2 - 60 } : { x: 240, y: 200 },
              anchor: null,
            },
          });
        }),
    },
    {
      key: "note",
      label: t("caseBoard.palette.newNote"),
      icon: StickyNote,
      editing: true,
      shortcut: "N",
      run: () =>
        after(() => {
          const at = centre();
          const cmd = addNote({ x: at.x - 110, y: at.y - 80 });
          store.getState().run(cmd);
          ui.getState().set({ editingItemId: cmd.id });
        }),
    },
    {
      key: "frame",
      label: t("caseBoard.palette.newFrame"),
      icon: Frame,
      editing: true,
      shortcut: "F",
      run: () =>
        after(() => {
          const at = centre();
          const cmd = addFrame({ x: at.x - 320, y: at.y - 200, width: 640, height: 400 });
          store.getState().run(cmd);
          ui.getState().set({ editingItemId: cmd.id });
        }),
    },
    { key: "tidy", label: t("caseBoard.palette.tidyUp"), icon: Wand2, editing: true, run: () => after(onTidyUp) },
    { key: "hypotheses", label: t("caseBoard.palette.openHypotheses"), icon: FlaskConical, run: () => after(() => ui.getState().openDrawer("hypotheses")) },
    { key: "timeline", label: t("caseBoard.palette.openTimeline"), icon: Clock3, run: () => after(() => ui.getState().openDrawer("timeline")) },
    { key: "leads", label: t("caseBoard.palette.openLeads"), icon: Compass, run: () => after(() => ui.getState().openDrawer("leads")) },
    { key: "evidenceTable", label: t("caseBoard.palette.openEvidence"), icon: Paperclip, run: () => after(() => ui.getState().openDrawer("evidence")) },
    { key: "caseFile", label: t("caseBoard.palette.openCaseFile"), icon: FileText, run: () => after(() => ui.getState().openDrawer("caseFile")) },
  ];
  const actionMatches = actions.filter((a) => (!readOnly || !a.editing) && (!typing || a.label.toLowerCase().includes(q)));

  const cycle = (dir: 1 | -1) => setScope((s) => SCOPES[(SCOPES.indexOf(s) + dir + SCOPES.length) % SCOPES.length]!);

  const boardIcon = (r: BoardRow) => {
    if (r.kind === "evidence") {
      const Icon = getAssetKindIcon(r.assetType);
      return <Icon className="size-4" />;
    }
    if (r.kind === "finding") return <SeverityDot severity={r.severity} />;
    if (r.kind === "hypothesis") return <FlaskConical className="size-4" style={{ color: r.color }} />;
    if (r.kind === "note") return <StickyNote className="size-4" />;
    if (r.kind === "frame") return <Frame className="size-4" />;
    return <MessageSquare className="size-4" />;
  };
  const boardKindLabel: Record<BoardKind, TranslationKey> = {
    evidence: "caseBoard.palette.kinds.evidence",
    finding: "caseBoard.palette.kinds.finding",
    hypothesis: "caseBoard.palette.kinds.hypothesis",
    note: "caseBoard.palette.kinds.note",
    frame: "caseBoard.palette.kinds.frame",
    comment: "caseBoard.palette.kinds.comment",
  };

  const renderBoard = (rows: BoardRow[]) =>
    rows.map((r) => (
      <Row
        key={r.key}
        value={r.key}
        onSelect={() => {
          close();
          flyToEvidence(r.itemId, r.findingId);
        }}
        icon={boardIcon(r)}
        label={<Marked text={r.label} query={query} />}
        detail={r.detail ? <Marked text={r.detail} query={query} /> : undefined}
        trailing={<Tag>{t(boardKindLabel[r.kind])}</Tag>}
      />
    ));

  const renderCorpus = (rows: CorpusRow[]) =>
    rows.map((c) => {
      const status = evidenceStatus({ itemByAsset, bubbles }, c);
      const Icon = getAssetKindIcon(c.assetType);
      return (
        <Row
          key={`${c.kind}:${c.id}`}
          value={`${c.kind}:${c.id}`}
          onSelect={() => after(() => place(c))}
          icon={c.kind === "finding" ? <SeverityDot severity={c.severity} /> : <Icon className="size-4" />}
          label={<Marked text={c.label} query={query} />}
          detail={c.detail ? <Marked text={c.detail} query={query} /> : undefined}
          trailing={
            status === "onBoard" ? (
              <Tag>{t("caseBoard.palette.alreadyOnBoard")}</Tag>
            ) : (
              <Tag strong>
                <span className="inline-flex items-center gap-0.5">
                  <Plus className="size-2.5" strokeWidth={3} aria-hidden />
                  {status === "attachable" ? t("caseBoard.bubble.attach") : t("caseBoard.addEvidence.add")}
                </span>
              </Tag>
            )
          }
        />
      );
    });

  const renderActions = (rows: ActionRow[], grid: boolean) => (
    <div className={cn(grid && "grid grid-cols-2")}>
      {rows.map((a) => (
        <Row
          key={a.key}
          value={`action:${a.key}`}
          onSelect={a.run}
          icon={<a.icon className="size-4" />}
          label={a.label}
          trailing={
            a.shortcut ? (
              <kbd className="shrink-0 font-mono text-[10px] text-muted-foreground group-data-[selected=true]:text-background/70">
                {a.shortcut}
              </kbd>
            ) : undefined
          }
        />
      ))}
    </div>
  );

  const corpusBlock = (limit: number | null) =>
    readOnly ? null : typing && q.length >= 2 ? (
      <CommandGroup className="p-0">
        <Heading count={corpus.length || undefined} onMore={scope === "all" ? () => setScope("corpus") : undefined}>
          {t("caseBoard.palette.addToBoard")}
        </Heading>
        {search.loading && corpus.length === 0 && (
          <div className="mx-1.5 flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {t("caseBoard.palette.searching")}
          </div>
        )}
        {renderCorpus(limit === null ? corpus : corpus.slice(0, limit))}
        {search.truncated && (
          <div className="mx-1.5 flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5" /> {t("caseBoard.addEvidence.truncated")}
          </div>
        )}
        <Row
          value="action:more-filters"
          onSelect={moreFilters}
          icon={<SlidersHorizontal className="size-4" />}
          label={t("caseBoard.palette.moreFilters", { query: query.trim() })}
          testId="palette-more-filters"
        />
      </CommandGroup>
    ) : scope === "corpus" ? (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("caseBoard.addEvidence.hint")}</p>
    ) : null;

  const scopeCount: Partial<Record<Scope, number>> = {
    board: boardMatches.length,
    corpus: typing && q.length >= 2 ? corpus.length : undefined,
    actions: actionMatches.length,
  };
  const empty =
    (scope === "board" && boardMatches.length === 0) ||
    (scope === "actions" && actionMatches.length === 0) ||
    (scope === "all" && typing && boardMatches.length === 0 && actionMatches.length === 0 && (readOnly || q.length < 2));

  return (
    <Dialog open={open} onOpenChange={(next) => ui.getState().set({ paletteOpen: next })}>
      <DialogContent
        showCloseButton={false}
        className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-[6px] border-2 border-border p-0 sm:max-w-2xl"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">{t("caseBoard.topBar.palette")}</DialogTitle>
        <DialogDescription className="sr-only">{t("caseBoard.palette.placeholder")}</DialogDescription>
        <Command shouldFilter={false} loop className="flex max-h-[min(640px,72vh)] flex-col rounded-none bg-background">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("caseBoard.palette.placeholder")}
            wrapperClassName="h-14 gap-3 border-b-2 border-border px-4 [&>svg]:opacity-60"
            className="h-14 text-base"
            data-testid="palette-input"
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                cycle(e.shiftKey ? -1 : 1);
              }
            }}
          >
            {search.loading && searchCorpus && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
          </CommandInput>
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5" role="tablist" aria-label={t("caseBoard.palette.scopes")}>
            {SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setScope(s)}
                data-testid={`palette-scope-${s}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors",
                  scope === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`caseBoard.palette.scope.${s}`)}
                {scopeCount[s] !== undefined && s !== "all" && (
                  <span className={cn("tabular-nums", scope === s ? "text-background/70" : "text-muted-foreground/70")}>
                    {scopeCount[s]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto pb-2">
            {empty && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("caseBoard.palette.noResults")}</p>}

            {scope === "all" && !typing && (
              <>
                {boardMatches.length > 0 && (
                  <CommandGroup className="p-0">
                    <Heading count={boardMatches.length} onMore={() => setScope("board")}>
                      {t("caseBoard.palette.jumpTo")}
                    </Heading>
                    {renderBoard(boardMatches.slice(0, PEEK.board))}
                  </CommandGroup>
                )}
                {actionMatches.length > 0 && (
                  <CommandGroup className="p-0">
                    <Heading>{t("caseBoard.palette.actions")}</Heading>
                    {renderActions(actionMatches, true)}
                  </CommandGroup>
                )}
              </>
            )}

            {scope === "all" && typing && (
              <>
                {boardMatches.length > 0 && (
                  <CommandGroup className="p-0">
                    <Heading count={boardMatches.length} onMore={() => setScope("board")}>
                      {t("caseBoard.palette.onBoard")}
                    </Heading>
                    {renderBoard(boardMatches.slice(0, PEEK.board))}
                  </CommandGroup>
                )}
                {corpusBlock(PEEK.corpus)}
                {actionMatches.length > 0 && (
                  <CommandGroup className="p-0">
                    <Heading count={actionMatches.length} onMore={() => setScope("actions")}>
                      {t("caseBoard.palette.actions")}
                    </Heading>
                    {renderActions(actionMatches.slice(0, PEEK.actions), false)}
                  </CommandGroup>
                )}
              </>
            )}

            {scope === "board" && boardMatches.length > 0 && (
              <CommandGroup className="p-0">
                <Heading count={boardMatches.length}>{t("caseBoard.palette.onBoard")}</Heading>
                {renderBoard(boardMatches.slice(0, 80))}
              </CommandGroup>
            )}

            {scope === "corpus" && corpusBlock(null)}

            {scope === "actions" && actionMatches.length > 0 && (
              <CommandGroup className="p-0">
                <Heading count={actionMatches.length}>{t("caseBoard.palette.actions")}</Heading>
                {renderActions(actionMatches, false)}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center gap-4 border-t-2 border-border px-4 py-2 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[3px] border border-border px-1">↑↓</kbd> {t("caseBoard.palette.hints.move")}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="inline-flex items-center rounded-[3px] border border-border px-1">
                <CornerDownLeft className="size-2.5" aria-hidden />
              </kbd>{" "}
              {t("caseBoard.palette.hints.open")}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[3px] border border-border px-1">⇥</kbd> {t("caseBoard.palette.hints.scope")}
            </span>
            <span className="ml-auto inline-flex items-center gap-1">
              <kbd className="rounded-[3px] border border-border px-1">esc</kbd> {t("caseBoard.palette.hints.close")}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
