"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import {
  ArrowUpToLine,
  ArrowDownToLine,
  Check,
  CircleDot,
  Copy,
  ExternalLink,
  Eye,
  Focus,
  Frame as FrameIcon,
  Globe,
  FlaskConical,
  Link2,
  Lock,
  MessageSquare,
  Minus,
  Network,
  Paintbrush,
  Pencil,
  Plus,
  Route,
  Search,
  StickyNote,
  Trash2,
  Unlink,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type UpdateFindingDto } from "@workspace/api-client";
import {
  BOARD_HIGHLIGHT_COLORS,
  BOARD_LINK_KINDS,
  BOARD_NOTE_COLORS,
  type BoardEndpoint,
  type BoardStance,
} from "@workspace/schemas/case-board";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@workspace/ui/components/context-menu";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { useBoardStore, useUiStore } from "../store/board-context";
import {
  addNote,
  attachFinding,
  bringToFront,
  combine,
  deleteItems,
  deleteLinks,
  detachFinding,
  duplicateItems,
  moveItems,
  promoteLink,
  removeEvidence,
  resizeItem,
  removeStance,
  resolveComment,
  setCollapsed,
  setRowHighlight,
  setStance,
  setStyle,
  updateLink,
  addEvidence,
} from "../store/commands";
import { absolutePosition } from "../store/ops";
import { spotInFrame } from "../store/geometry";
import { parseFindingNodeId } from "../store/relations";
import { hypothesisMeta, topZ } from "../store/selectors";
import { humanizeKind } from "../edges/link-edge";
import type { BoardItem } from "../store/types";

export type MenuTarget =
  | { kind: "item"; itemId: string }
  | { kind: "finding"; itemId: string; findingId: string; attached: boolean }
  | { kind: "suggested"; key: string }
  | { kind: "link"; linkId: string }
  | { kind: "global"; systemEdgeId: string }
  | { kind: "system"; systemEdgeId: string }
  | { kind: "stance"; supportId: string }
  | { kind: "pane"; at: { x: number; y: number }; screen: { x: number; y: number } }
  | { kind: "selection"; itemIds: string[] };

const openInTab = (path: string) => window.open(nsPath(path), "_blank", "noopener");

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-3 rounded-[2px] border border-border"
      style={{ background: `var(--cb-${color})` }}
    />
  );
}

/**
 * The board's right-click menu (PRD §5.8). React Flow's `on*ContextMenu`
 * handlers record the target first; the same native event then reaches the
 * Radix trigger, which opens this content.
 */
export function BoardContextMenuContent({
  target,
  onTidyUp,
  onShowNeighbours,
  onFlyTo,
}: {
  target: MenuTarget | null;
  onTidyUp: () => void;
  onShowNeighbours: (itemId: string) => void;
  onFlyTo: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const ui = useUiStore();
  const rf = useReactFlow();
  if (!target) return <ContextMenuContent className="hidden" />;
  const s = store.getState();
  const run = s.run;
  const readOnly = s.readOnly;

  const confirm = (title: string, body: string, confirmLabel: string, onConfirm: () => void) =>
    ui.getState().set({ confirm: { title, body, confirmLabel, destructive: true, onConfirm } });

  const highlightMenu = (onPick: (color: string | null) => void) => (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={readOnly}>
        <Paintbrush className="size-4" /> {t("caseBoard.highlight.title")}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {BOARD_HIGHLIGHT_COLORS.map((c) => (
          <ContextMenuItem key={c} onSelect={() => onPick(c)}>
            <Swatch color={c} /> {t(`caseBoard.note.colors.${c}`)}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPick(null)}>
          <Minus className="size-4" /> {t("caseBoard.highlight.none")}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  const hypothesisMenu = (endpoint: BoardEndpoint) => {
    const meta = hypothesisMeta(s.threads);
    const hyps = [...s.threads.values()].filter((th) => th.kind === "HYPOTHESIS" && th.itemId && th.onBoard);
    if (hyps.length === 0) return null;
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={readOnly}>
          <FlaskConical className="size-4" /> {t("caseBoard.hypothesis.addTo")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-72">
          {hyps.map((th) => (
            <ContextMenuSub key={th.id}>
              <ContextMenuSubTrigger>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.get(th.id)?.color }} />
                <span className="font-mono text-xs">{meta.get(th.id)?.label}</span>
                <span className="truncate">{th.title}</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {(["SUPPORTS", "CONTRADICTS", "NEUTRAL"] as BoardStance[]).map((stance) => (
                  <ContextMenuItem
                    key={stance}
                    onSelect={() => {
                      const previous =
                        [...s.supports.values()].find(
                          (sp) =>
                            sp.threadId === th.id &&
                            sp.endpoint?.itemId === endpoint.itemId &&
                            (sp.endpoint?.findingId ?? null) === (endpoint.findingId ?? null),
                        ) ?? null;
                      run(setStance(th.itemId!, endpoint, stance, previous));
                    }}
                  >
                    {stance === "SUPPORTS"
                      ? t("caseBoard.link.supports")
                      : stance === "CONTRADICTS"
                        ? t("caseBoard.link.contradicts")
                        : t("caseBoard.link.neutral")}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  };

  const commentOn = (item: BoardItem, findingId?: string) => {
    const node = rf.getInternalNode(item.id);
    const width = node?.measured.width ?? 320;
    const abs = node?.internals.positionAbsolute ?? absolutePosition(s.items, item.id);
    const screen = rf.flowToScreenPosition({ x: abs.x + width, y: abs.y });
    ui.getState().set({
      composer: {
        kind: "comment",
        at: { x: width - 12, y: -14 },
        screen,
        anchor: { itemId: item.id, ...(findingId ? { findingId } : {}) },
      },
    });
  };

  const arrange = (items: BoardItem[]) => (
    <>
      <ContextMenuItem disabled={readOnly} onSelect={() => run(bringToFront(items, topZ(s)))}>
        <ArrowUpToLine className="size-4" /> {t("caseBoard.menu.bringToFront")}
      </ContextMenuItem>
      <ContextMenuItem disabled={readOnly} onSelect={() => run(bringToFront(items, topZ(s), true))}>
        <ArrowDownToLine className="size-4" /> {t("caseBoard.menu.sendToBack")}
      </ContextMenuItem>
    </>
  );

  const moveToFrame = (item: BoardItem) => {
    // Not into itself, nor into a frame nested inside it.
    const inside = (frameId: string) => {
      for (let cursor: string | null = frameId; cursor; cursor = s.items.get(cursor)?.parentId ?? null) {
        if (cursor === item.id) return true;
      }
      return false;
    };
    const frames = [...s.items.values()].filter((i) => i.kind === "FRAME" && !inside(i.id));
    if (frames.length === 0 && !item.parentId) return null;
    const from = { x: item.x ?? 0, y: item.y ?? 0, parentId: item.parentId };
    const moveTo = (frameId: string | null) => {
      if (frameId === item.parentId) return;
      if (!frameId) {
        // Out of its frame, staying where it is on the canvas.
        const abs = absolutePosition(s.items, item.id);
        run(moveItems([{ id: item.id, from, to: { x: abs.x, y: abs.y, parentId: null } }]));
        return;
      }
      const frame = s.items.get(frameId);
      if (!frame) return;
      // Into the frame for real: a free spot inside it, the frame growing when full.
      const { at, grow } = spotInFrame(s, frame, item);
      run(
        combine(
          t("caseBoard.menu.moveToFrame"),
          moveItems([{ id: item.id, from, to: { x: Math.round(at.x), y: Math.round(at.y), parentId: frameId } }]),
          grow ? resizeItem(frame, { x: frame.x ?? 0, y: frame.y ?? 0, ...grow }) : null,
          frame.collapsed ? setCollapsed(frame, false) : null,
        ),
      );
      requestAnimationFrame(() => onFlyTo(item.id));
    };
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={readOnly}>
          <FrameIcon className="size-4" /> {t("caseBoard.menu.moveToFrame")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {frames.map((f) => (
            <ContextMenuItem key={f.id} onSelect={() => moveTo(f.id)}>
              {f.content.title || t("caseBoard.frame.untitled")}
              {item.parentId === f.id && <Check className="ml-auto size-4" />}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => moveTo(null)}>{t("caseBoard.menu.noFrame")}</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  };

  const content = (() => {
    switch (target.kind) {
      case "pane": {
        const at = target.at;
        return (
          <>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => {
                const cmd = addNote(at);
                run(cmd);
                ui.getState().set({ editingItemId: cmd.id });
              }}
            >
              <StickyNote className="size-4" /> {t("caseBoard.menu.addNoteHere")}
              <ContextMenuShortcut>N</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() =>
                ui.getState().set({ composer: { kind: "hypothesis", at, screen: target.screen, anchor: null } })
              }
            >
              <FlaskConical className="size-4" /> {t("caseBoard.menu.addHypothesisHere")}
              <ContextMenuShortcut>T</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() =>
                ui.getState().set({ composer: { kind: "comment", at, screen: target.screen, anchor: null } })
              }
            >
              <MessageSquare className="size-4" /> {t("caseBoard.menu.addCommentHere")}
              <ContextMenuShortcut>C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={readOnly} onSelect={() => ui.getState().set({ paletteOpen: true })}>
              <Search className="size-4" /> {t("caseBoard.menu.addEvidence")}
              <ContextMenuShortcut>⌘K</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} onSelect={onTidyUp}>
              <Wand2 className="size-4" /> {t("caseBoard.menu.tidyUp")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void rf.fitView({ duration: 300, padding: 0.15 })}>
              <Focus className="size-4" /> {t("caseBoard.menu.fitView")}
              <ContextMenuShortcut>⇧1</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        );
      }

      case "selection": {
        const items = target.itemIds.map((id) => s.items.get(id)).filter((i): i is BoardItem => !!i);
        const evidence = items.filter((i) => i.kind === "EVIDENCE");
        const userItems = items.filter((i) => i.kind !== "EVIDENCE");
        return (
          <>
            <ContextMenuLabel>{items.length}</ContextMenuLabel>
            {evidence.length > 0 && (
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => {
                  const first = rf.getInternalNode(evidence[0]!.id);
                  const at = first
                    ? { x: first.internals.positionAbsolute.x, y: first.internals.positionAbsolute.y - 220 }
                    : { x: 0, y: 0 };
                  ui.getState().set({
                    composer: {
                      kind: "hypothesis",
                      at,
                      screen: rf.flowToScreenPosition(at),
                      anchor: null,
                      supports: evidence.map((e) => ({ itemId: e.id })),
                    },
                  });
                }}
              >
                <FlaskConical className="size-4" /> {t("caseBoard.hypothesis.newFromSelection")}
              </ContextMenuItem>
            )}
            {highlightMenu((color) =>
              run(setStyle(items, { highlight: (color as never) ?? null }, t("caseBoard.highlight.title"))),
            )}
            {arrange(items)}
            {userItems.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={readOnly}
                  variant="destructive"
                  onSelect={() => run(deleteItems(s, userItems))}
                >
                  <Trash2 className="size-4" /> {t("caseBoard.menu.delete")}
                  <ContextMenuShortcut>⌫</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </>
        );
      }

      case "suggested": {
        const suggestion = s.suggested.get(target.key);
        if (!suggestion) return null;
        return (
          <>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() => {
                const node = rf.getNode(target.key);
                run(
                  addEvidence({ entityType: "asset", entityId: suggestion.assetId }, node?.position ?? null, {
                    label: suggestion.label,
                    assetType: suggestion.assetType,
                    sourceType: suggestion.sourceType,
                  }),
                );
              }}
            >
              <Plus className="size-4" /> {t("caseBoard.menu.pin")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openInTab(`/assets/${suggestion.assetId}`)}>
              <ExternalLink className="size-4" /> {t("caseBoard.menu.openAsset")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => ui.getState().toggle("hiddenSuggestions", target.key)}>
              <Eye className="size-4" /> {t("caseBoard.menu.hideSuggestion")}
            </ContextMenuItem>
          </>
        );
      }

      case "finding": {
        const item = s.items.get(target.itemId);
        const bubble = s.bubbles.get(target.itemId);
        if (!item || !bubble) return null;
        const row = [...bubble.rows, ...bubble.unattached].find((r) => r.findingId === target.findingId);
        if (!target.attached) {
          return (
            <>
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => run(attachFinding(item.id, target.findingId))}
              >
                <Plus className="size-4" /> {t("caseBoard.menu.attach")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => openInTab(`/findings/${target.findingId}`)}>
                <ExternalLink className="size-4" /> {t("caseBoard.menu.openFinding")}
              </ContextMenuItem>
            </>
          );
        }
        const setStatus = async (status: NonNullable<UpdateFindingDto["status"]>) => {
          try {
            await api.findings.findingsControllerUpdate({
              id: target.findingId,
              updateFindingDto: { status },
            });
            store.getState().refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        };
        return (
          <>
            <ContextMenuItem onSelect={() => openInTab(`/findings/${target.findingId}`)}>
              <ExternalLink className="size-4" /> {t("caseBoard.menu.openFinding")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                ui.getState().openDrawer("details", {
                  details: { itemId: item.id, findingId: target.findingId },
                })
              }
            >
              <Search className="size-4" /> {t("caseBoard.menu.explainFinding")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} onSelect={() => ui.getState().setTool("link")}>
              <Link2 className="size-4" /> {t("caseBoard.menu.linkFromFinding")}
              <ContextMenuShortcut>L</ContextMenuShortcut>
            </ContextMenuItem>
            {hypothesisMenu({ itemId: item.id, findingId: target.findingId })}
            <ContextMenuItem disabled={readOnly} onSelect={() => commentOn(item, target.findingId)}>
              <MessageSquare className="size-4" /> {t("caseBoard.menu.comment")}
            </ContextMenuItem>
            {highlightMenu((color) => run(setRowHighlight(item, target.findingId, (color as never) ?? null)))}
            <ContextMenuSeparator />
            {row?.status === "RESOLVED" || row?.status === "FALSE_POSITIVE" ? (
              <ContextMenuItem disabled={readOnly} onSelect={() => void setStatus("OPEN")}>
                <CircleDot className="size-4" /> {t("caseBoard.menu.reopenFinding")}
              </ContextMenuItem>
            ) : (
              <>
                <ContextMenuItem
                  disabled={readOnly}
                  onSelect={() => void setStatus("RESOLVED")}
                >
                  <Check className="size-4" /> {t("caseBoard.menu.markResolved")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={readOnly}
                  onSelect={() => void setStatus("FALSE_POSITIVE")}
                >
                  <X className="size-4" /> {t("caseBoard.menu.markFalsePositive")}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={readOnly}
              variant="destructive"
              onSelect={() =>
                confirm(
                  t("caseBoard.menu.detachTitle"),
                  t("caseBoard.menu.detachBody"),
                  t("caseBoard.menu.detach"),
                  () => run(detachFinding(item.id, target.findingId)),
                )
              }
            >
              <Unlink className="size-4" /> {t("caseBoard.menu.detach")}
            </ContextMenuItem>
          </>
        );
      }

      case "item": {
        const item = s.items.get(target.itemId);
        if (!item) return null;
        if (item.kind === "EVIDENCE") {
          const bubble = s.bubbles.get(item.id);
          if (!bubble) return null;
          return (
            <>
              <ContextMenuItem onSelect={() => openInTab(`/assets/${bubble.assetId}`)} disabled={!bubble.assetId}>
                <ExternalLink className="size-4" /> {t("caseBoard.menu.openAsset")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ui.getState().openDrawer("details", { details: { itemId: item.id } })}>
                <Search className="size-4" /> {t("caseBoard.menu.openDetails")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={readOnly} onSelect={() => ui.getState().setTool("link")}>
                <Link2 className="size-4" /> {t("caseBoard.menu.linkFromHere")}
                <ContextMenuShortcut>L</ContextMenuShortcut>
              </ContextMenuItem>
              {hypothesisMenu({ itemId: item.id })}
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => {
                  const node = rf.getInternalNode(item.id);
                  const abs = node?.internals.positionAbsolute ?? absolutePosition(s.items, item.id);
                  const at = { x: abs.x, y: abs.y - 220 };
                  ui.getState().set({
                    composer: {
                      kind: "hypothesis",
                      at,
                      screen: rf.flowToScreenPosition(at),
                      anchor: null,
                      supports: [{ itemId: item.id }],
                    },
                  });
                }}
              >
                <FlaskConical className="size-4" /> {t("caseBoard.hypothesis.newFromSelection")}
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onSelect={() => commentOn(item)}>
                <MessageSquare className="size-4" /> {t("caseBoard.menu.comment")}
              </ContextMenuItem>
              {highlightMenu((color) => run(setStyle([item], { highlight: (color as never) ?? null })))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onShowNeighbours(item.id)}>
                <Network className="size-4" /> {t("caseBoard.menu.showNeighbours")}
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onSelect={() => run(setCollapsed(item, !item.collapsed))}>
                <Minus className="size-4" /> {item.collapsed ? t("caseBoard.menu.expand") : t("caseBoard.menu.collapse")}
                <ContextMenuShortcut>E</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => ui.getState().set({ pathFrom: item.id, path: null })}>
                <Route className="size-4" /> {t("caseBoard.menu.findPath")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {moveToFrame(item)}
              {arrange([item])}
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={readOnly}
                variant="destructive"
                onSelect={() =>
                  confirm(
                    t("caseBoard.menu.removeFromCaseTitle"),
                    t("caseBoard.menu.removeFromCaseBody"),
                    t("caseBoard.menu.removeFromCase"),
                    () => run(removeEvidence(item, bubble)),
                  )
                }
              >
                <Trash2 className="size-4" /> {t("caseBoard.menu.removeFromCase")}
              </ContextMenuItem>
            </>
          );
        }
        if (item.kind === "HYPOTHESIS") {
          const thread = item.refId ? s.threads.get(item.refId) : undefined;
          return (
            <>
              <ContextMenuItem
                disabled={!thread || thread.pending}
                onSelect={() => ui.getState().openDrawer("thread", { threadId: thread?.id ?? null })}
              >
                <FlaskConical className="size-4" /> {t("caseBoard.hypothesis.openThread")}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly || !thread || thread.pending}
                onSelect={() => ui.getState().set({ editingItemId: item.id })}
              >
                <Pencil className="size-4" /> {t("caseBoard.hypothesis.editStatement")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  ui.getState().set({
                    focusHypothesisItemId: ui.getState().focusHypothesisItemId === item.id ? null : item.id,
                  })
                }
              >
                <Focus className="size-4" /> {t("caseBoard.hypothesis.focus")}
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger disabled={readOnly || !thread || thread.pending}>
                  <Paintbrush className="size-4" /> {t("caseBoard.hypothesis.changeColor")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {(["red", "blue", "green", "amber", "violet", "pink"] as const).map((c) => (
                    <ContextMenuItem
                      key={c}
                      onSelect={async () => {
                        if (!thread) return;
                        const style = getComputedStyle(document.querySelector(".case-board") ?? document.body);
                        const hex = style.getPropertyValue(`--cb-${c}`).trim() || c;
                        await api.threads.caseThreadsControllerUpdate({ id: thread.id, updateThreadDto: { color: hex } });
                        store.getState().refetch();
                      }}
                    >
                      <Swatch color={c} /> {t(`caseBoard.note.colors.${c}`)}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              {highlightMenu((color) => run(setStyle([item], { highlight: (color as never) ?? null })))}
              <ContextMenuItem disabled={readOnly} onSelect={() => commentOn(item)}>
                <MessageSquare className="size-4" /> {t("caseBoard.menu.comment")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {moveToFrame(item)}
              {arrange([item])}
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={readOnly}
                onSelect={() => {
                  run(deleteItems(s, [item]));
                  // The hypothesis itself stays; say where to find it again.
                  toast.message(t("caseBoard.hypothesis.removedFromBoard"), {
                    action: {
                      label: t("caseBoard.drawers.allHypotheses"),
                      onClick: () => ui.getState().openDrawer("hypotheses"),
                    },
                  });
                }}
              >
                <Eye className="size-4" /> {t("caseBoard.hypothesis.removeFromBoard")}
              </ContextMenuItem>
            </>
          );
        }
        if (item.kind === "COMMENT") {
          const thread = item.refId ? s.threads.get(item.refId) : undefined;
          const resolved = Boolean(thread?.resolvedAt);
          return (
            <>
              <ContextMenuItem onSelect={() => ui.getState().set({ openCommentItemId: item.id })}>
                <MessageSquare className="size-4" /> {t("caseBoard.menu.comment")}
              </ContextMenuItem>
              <ContextMenuItem disabled={readOnly} onSelect={() => run(resolveComment(item.id, !resolved))}>
                <Check className="size-4" /> {resolved ? t("caseBoard.comment.reopen") : t("caseBoard.comment.resolve")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={readOnly} variant="destructive" onSelect={() => run(deleteItems(s, [item]))}>
                <Trash2 className="size-4" /> {t("caseBoard.menu.delete")}
              </ContextMenuItem>
            </>
          );
        }
        // NOTE / FRAME
        const colors = item.kind === "NOTE" ? BOARD_NOTE_COLORS : (["gray", "yellow", "blue", "green", "pink", "violet"] as const);
        return (
          <>
            <ContextMenuItem disabled={readOnly} onSelect={() => ui.getState().set({ editingItemId: item.id })}>
              <Pencil className="size-4" /> {t("caseBoard.menu.editText")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={readOnly}>
                <Paintbrush className="size-4" /> {item.kind === "NOTE" ? t("caseBoard.note.color") : t("caseBoard.frame.tint")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {colors.map((c) => (
                  <ContextMenuItem key={c} onSelect={() => run(setStyle([item], { color: c }))}>
                    <Swatch color={c} /> {t(`caseBoard.note.colors.${c}`)}
                    {(item.style.color ?? (item.kind === "NOTE" ? "yellow" : "gray")) === c && (
                      <Check className="ml-auto size-4" />
                    )}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {item.kind === "NOTE" && highlightMenu((color) => run(setStyle([item], { highlight: (color as never) ?? null })))}
            <ContextMenuItem disabled={readOnly} onSelect={() => run(duplicateItems([item]))}>
              <Copy className="size-4" /> {t("caseBoard.menu.duplicate")}
              <ContextMenuShortcut>⌘D</ContextMenuShortcut>
            </ContextMenuItem>
            {item.kind === "NOTE" && moveToFrame(item)}
            {arrange([item])}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} variant="destructive" onSelect={() => run(deleteItems(s, [item]))}>
              <Trash2 className="size-4" /> {t("caseBoard.menu.delete")}
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        );
      }

      case "link": {
        const link = s.links.get(target.linkId);
        if (!link) return null;
        return (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={readOnly}>
                <Pencil className="size-4" /> {t("caseBoard.link.edit")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {BOARD_LINK_KINDS.map((kind) => (
                  <ContextMenuItem key={kind} onSelect={() => run(updateLink(link, { kind }))}>
                    {humanizeKind(kind, t)}
                    {link.kind === kind && <Check className="ml-auto size-4" />}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              disabled={readOnly}
              onSelect={() =>
                run(updateLink(link, { certainty: link.certainty === "CONFIRMED" ? "SUSPECTED" : "CONFIRMED" }))
              }
            >
              <CircleDot className="size-4" />
              {link.certainty === "CONFIRMED" ? t("caseBoard.link.suspected") : t("caseBoard.link.confirmed")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={readOnly}>
                <Minus className="size-4" /> {t("caseBoard.link.confidence")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {[0.25, 0.5, 0.75, 1].map((c) => (
                  <ContextMenuItem key={c} onSelect={() => run(updateLink(link, { confidence: c }))}>
                    {c.toFixed(2)}
                    {link.confidence === c && <Check className="ml-auto size-4" />}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={readOnly || !!link.promotedEdgeId}
              onSelect={() => {
                run(promoteLink(link));
                toast.success(t("caseBoard.toasts.promoted"));
              }}
              title={t("caseBoard.link.promoteHint")}
            >
              <Globe className="size-4" />
              {link.promotedEdgeId ? t("caseBoard.link.promoted") : t("caseBoard.link.promote")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={readOnly} variant="destructive" onSelect={() => run(deleteLinks([link]))}>
              <Trash2 className="size-4" /> {t("caseBoard.link.delete")}
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        );
      }

      case "global": {
        return (
          <>
            <ContextMenuLabel className="flex items-center gap-1">
              <Globe className="size-3.5" /> {t("caseBoard.edges.global")}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={readOnly}
              variant="destructive"
              onSelect={() =>
                confirm(
                  t("caseBoard.link.deleteEverywhereTitle"),
                  t("caseBoard.link.deleteEverywhereBody"),
                  t("caseBoard.link.deleteEverywhere"),
                  async () => {
                    try {
                      await api.graph.graphControllerDeleteEdge({ id: target.systemEdgeId });
                      store.getState().refetch();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : String(error));
                    }
                  },
                )
              }
            >
              <Trash2 className="size-4" /> {t("caseBoard.link.deleteEverywhere")}
            </ContextMenuItem>
          </>
        );
      }

      case "system": {
        const edge = s.systemEdges.get(target.systemEdgeId);
        return (
          <>
            <ContextMenuLabel className="flex items-center gap-1">
              <Lock className="size-3.5" /> {t("caseBoard.edges.locked")}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                if (!edge) return;
                toast.message(t("caseBoard.menu.whyHere"), {
                  description: `${edge.relationType} · ${edge.relationClass} · ${edge.method ?? "—"} · ${Math.round(edge.confidence * 100)}%`,
                });
              }}
            >
              <Search className="size-4" /> {t("caseBoard.menu.whyHere")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                if (!edge) return;
                for (const key of [edge.from, edge.to]) {
                  const [type, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
                  if (type === "asset") openInTab(`/assets/${id}`);
                  if (type === "finding") openInTab(`/findings/${id}`);
                }
              }}
            >
              <ExternalLink className="size-4" /> {t("caseBoard.menu.openBoth")}
            </ContextMenuItem>
          </>
        );
      }

      case "stance": {
        const support = s.supports.get(target.supportId);
        const thread = support ? s.threads.get(support.threadId) : undefined;
        if (!support?.endpoint || !thread?.itemId) return null;
        const endpoint = {
          itemId: support.endpoint.itemId,
          ...(support.endpoint.findingId ? { findingId: support.endpoint.findingId } : {}),
        };
        return (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={readOnly}>
                <FlaskConical className="size-4" /> {t("caseBoard.menu.stance")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {(["SUPPORTS", "CONTRADICTS", "NEUTRAL"] as BoardStance[]).map((stance) => (
                  <ContextMenuItem
                    key={stance}
                    onSelect={() => run(setStance(thread.itemId!, endpoint, stance, support))}
                  >
                    {stance === "SUPPORTS"
                      ? t("caseBoard.link.supports")
                      : stance === "CONTRADICTS"
                        ? t("caseBoard.link.contradicts")
                        : t("caseBoard.link.neutral")}
                    {support.stance === stance && <Check className="ml-auto size-4" />}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={readOnly}
              variant="destructive"
              onSelect={() => run(removeStance(thread.itemId!, endpoint, support))}
            >
              <Trash2 className="size-4" /> {t("caseBoard.menu.removeStance")}
            </ContextMenuItem>
          </>
        );
      }
    }
  })();

  return (
    <ContextMenuContent className="w-60" data-testid="board-context-menu">
      {content}
    </ContextMenuContent>
  );
}

/** Menu target for a right-click inside a node: the row under the pointer wins. */
export function targetFromNodeEvent(event: React.MouseEvent, nodeId: string): MenuTarget {
  if (nodeId.startsWith("sg:")) return { kind: "suggested", key: nodeId };
  const finding = parseFindingNodeId(nodeId);
  if (finding) {
    const node = (event.target as HTMLElement).closest<HTMLElement>("[data-finding-id]");
    return {
      kind: "finding",
      itemId: finding.itemId,
      findingId: finding.findingId,
      attached: node?.dataset.rowAttached !== "false",
    };
  }
  return { kind: "item", itemId: nodeId };
}
