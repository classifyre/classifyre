"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoardStore, useUiStore } from "../store/board-context";
import {
  combine,
  deleteItems,
  deleteLinks,
  duplicateItems,
  removeStance,
  setCollapsed,
} from "../store/commands";
import type { BoardEdge, BoardNode } from "../store/projection";
import type { Tool } from "../store/ui-store";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  n: "note",
  f: "frame",
  t: "hypothesis",
  c: "comment",
  l: "link",
};

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Board keyboard shortcuts (PRD §5.14). React Flow's own delete key is off;
 * deletion comes through here so it can only ever reach the user's items —
 * notes, frames, comment pins, hypothesis cards and drawn links. Evidence
 * leaves only through "Remove from case…", which asks first.
 */
export function useBoardShortcuts({
  selectAll,
  clearSelection,
  selectedEdges,
}: {
  selectAll: () => void;
  clearSelection: () => void;
  selectedEdges: () => BoardEdge[];
}): void {
  const store = useBoardStore();
  const ui = useUiStore();
  const rf = useReactFlow<BoardNode, BoardEdge>();

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event.target) || event.defaultPrevented) return;
      // A dialog or popover owns the keyboard while it is open.
      if (document.querySelector("[role=dialog][data-state=open]")) {
        if (event.key !== "Escape") return;
      }
      const s = store.getState();
      const u = ui.getState();
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "k") {
        event.preventDefault();
        u.set({ paletteOpen: !u.paletteOpen });
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        selectAll();
        return;
      }
      const selectedItems = () =>
        rf
          .getNodes()
          .filter((n) => n.selected && !n.id.startsWith("sg:"))
          .map((n) => s.items.get(n.id))
          .filter((i): i is NonNullable<typeof i> => !!i);

      if (mod && key === "d") {
        event.preventDefault();
        const items = selectedItems();
        if (items.length > 0 && !s.readOnly) s.run(duplicateItems(items));
        return;
      }
      if (mod || event.altKey) return;

      if (event.key === "Escape") {
        if (u.pendingLink || u.composer || u.paletteOpen) return;
        // An open dropdown or dialog takes this Escape for itself.
        if (document.querySelector("[data-radix-popper-content-wrapper], [role=dialog][data-state=open]")) return;
        const inPanel = (event.target as HTMLElement | null)?.closest?.("[data-testid=board-drawer]");
        const busy =
          u.tool !== "select" ||
          !!u.spotlight ||
          !!u.path ||
          !!u.pathFrom ||
          !!u.editingItemId ||
          (!!u.focusHypothesisItemId && !u.focusLock) ||
          rf.getNodes().some((n) => n.selected);
        // Escape unwinds the canvas first; with nothing left there, it closes the side panel.
        if (u.drawer && (inPanel || !busy)) {
          u.openDrawer(null);
          return;
        }
        clearSelection();
        u.set({
          tool: "select",
          spotlight: null,
          path: null,
          pathFrom: null,
          focusHypothesisItemId: u.focusLock ? u.focusHypothesisItemId : null,
          editingItemId: null,
        });
        return;
      }
      if (event.key === "?" || (event.shiftKey && key === "/")) {
        event.preventDefault();
        u.set({ cheatSheetOpen: !u.cheatSheetOpen });
        return;
      }
      if (event.shiftKey && (event.code === "Digit1" || key === "!")) {
        event.preventDefault();
        void rf.fitView({ duration: 300, padding: 0.15 });
        return;
      }
      if (event.shiftKey && (event.code === "Digit2" || key === "@")) {
        event.preventDefault();
        const nodes = rf.getNodes().filter((n) => n.selected);
        if (nodes.length > 0) void rf.fitView({ nodes, duration: 300, padding: 0.3, maxZoom: 1.2 });
        return;
      }
      if (key === ".") {
        u.set({ focusLock: !u.focusLock });
        return;
      }
      if (key === "e") {
        const bubbles = selectedItems().filter((i) => i.kind === "EVIDENCE" || i.kind === "FRAME");
        if (bubbles.length > 0 && !s.readOnly) {
          const collapse = !bubbles[0]!.collapsed;
          s.run(combine(collapse ? "Collapse" : "Expand", ...bubbles.map((b) => setCollapsed(b, collapse))));
        }
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (s.readOnly) return;
        event.preventDefault();
        const items = selectedItems().filter((i) => i.kind !== "EVIDENCE");
        const edges = selectedEdges();
        const links = edges
          .map((e) => (e.data?.linkId ? s.links.get(e.data.linkId) : undefined))
          .filter((l): l is NonNullable<typeof l> => !!l);
        const stances = edges
          .map((e) => (e.data?.supportId ? s.supports.get(e.data.supportId) : undefined))
          .filter((sp): sp is NonNullable<typeof sp> => !!sp && !!sp.endpoint);
        const cmds = [
          items.length > 0 ? deleteItems(s, items) : null,
          links.length > 0 ? deleteLinks(links) : null,
          ...stances.map((sp) => {
            const hyp = s.threads.get(sp.threadId)?.itemId;
            return hyp
              ? removeStance(
                  hyp,
                  { itemId: sp.endpoint!.itemId, ...(sp.endpoint!.findingId ? { findingId: sp.endpoint!.findingId } : {}) },
                  sp,
                )
              : null;
          }),
        ].filter((c): c is NonNullable<typeof c> => !!c);
        if (cmds.length > 0) s.run(combine(cmds.length === 1 ? cmds[0]!.label : "Delete", ...cmds));
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && !event.shiftKey) {
        if (s.readOnly && tool !== "select" && tool !== "hand") return;
        u.setTool(tool);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, ui, rf, selectAll, clearSelection, selectedEdges]);
}
