"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard, useUiStore } from "../store/board-context";
import type { UiState } from "../store/ui-store";
import { readBoardUrl, urlStateOf, withBoardUrl, type BoardUrlState } from "../store/url-state";
import { useFlyToEvidence } from "./use-place-evidence";

/** How long a restored item may take to appear on the canvas before the fly-to gives up. */
const FLY_WAIT_MS = 4_000;

/** The UI state the address holds; any change to one of these rewrites it. */
const URL_KEYS = [
  "drawer",
  "drawerThreadId",
  "detailsTarget",
  "detailsTab",
  "watchId",
  "timelineView",
  "timelineFocus",
] as const satisfies ReadonlyArray<keyof UiState>;

/**
 * Keep the side panel in the page's address: which panel is open and what it
 * shows (an asset and its tab, a finding, a relation, a thread, a watch, a
 * timeline entry). The address is read once the board has loaded — so a
 * restored asset can be flown to — and every change after that rewrites it in
 * place (replaceState: opening panels does not fill the back button).
 * Back and forward still work between addresses the browser did record.
 */
export function useBoardUrlState(onFlyTo: (nodeId: string) => void): void {
  const ui = useUiStore();
  const rf = useReactFlow();
  const loaded = useBoard((s) => s.loaded);
  const flyToEvidence = useFlyToEvidence(onFlyTo);
  const restored = React.useRef(false);

  const flyWhenDrawn = React.useCallback(
    (itemId: string, findingId: string | null) => {
      const until = Date.now() + FLY_WAIT_MS;
      const tick = () => {
        // The canvas makes its own first fit once its nodes have sizes; fly after it.
        if (rf.getNode(itemId)?.measured?.width) {
          window.setTimeout(() => flyToEvidence(itemId, findingId), 250);
          return;
        }
        if (Date.now() < until) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [rf, flyToEvidence],
  );

  const apply = React.useCallback(
    (state: BoardUrlState, fly: boolean) => {
      const u = ui.getState();
      if (!state.panel) {
        if (u.drawer) u.openDrawer(null);
        return;
      }
      u.set({ timelineView: state.timelineView });
      u.openDrawer(state.panel, {
        ...(state.threadId ? { threadId: state.threadId } : {}),
        ...(state.details ? { details: state.details, detailsTab: state.detailsTab } : {}),
        ...(state.panel === "inquiries" ? { watchId: state.watchId } : {}),
      });
      if (state.panel === "timeline" && state.entryId) u.focusTimeline(state.entryId);
      const d = state.details;
      if (fly && d && "itemId" in d) flyWhenDrawn(d.itemId, d.findingId ?? null);
    },
    [ui, flyWhenDrawn],
  );

  // Restore once the board has loaded (so what the address names exists).
  React.useEffect(() => {
    if (!loaded || restored.current) return;
    restored.current = true;
    apply(readBoardUrl(new URLSearchParams(window.location.search)), true);
  }, [loaded, apply]);

  // Write every change back — only after the restore, or the first render
  // (nothing open yet) would wipe the address before it was read.
  React.useEffect(
    () =>
      ui.subscribe((s, prev) => {
        if (!restored.current || URL_KEYS.every((key) => s[key] === prev[key])) return;
        const next = withBoardUrl(window.location.href, urlStateOf(s));
        // null: Next.js keeps its own history state and syncs its router to the address.
        if (next !== window.location.href) window.history.replaceState(null, "", next);
      }),
    [ui],
  );

  React.useEffect(() => {
    const onPop = () => {
      if (restored.current) apply(readBoardUrl(new URLSearchParams(window.location.search)), false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [apply]);
}
