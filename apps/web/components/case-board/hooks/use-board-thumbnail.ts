"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import { useServerConfig } from "@/components/server-config-provider";
import { forgetSketch, rememberSketch, settleSketch } from "@/components/cases/sketch-cache";
import { useBoardStore } from "../store/board-context";
import type { BoardState } from "../store/board-store";
import { buildBoardSketch, sketchSignature } from "../store/sketch";

/** Quiet time after the last change before the board is sketched. */
const SETTLE_MS = 4_000;
/** While someone keeps editing, at most one sketch per this long. */
const MIN_INTERVAL_MS = 30_000;

/** Changes that can alter what the sketch draws. */
function drawnChanged(s: BoardState, prev: BoardState): boolean {
  return (
    s.items !== prev.items ||
    s.links !== prev.links ||
    s.bubbles !== prev.bubbles ||
    s.threads !== prev.threads ||
    s.supports !== prev.supports ||
    s.systemEdges !== prev.systemEdges
  );
}

function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(fn, { timeout: 2_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(fn, 0);
  return () => window.clearTimeout(handle);
}

/**
 * Keep the case card's thumbnail in step with the board: once an edit
 * settles, sketch the board (BoardSketch) and store the sketch if it differs
 * from the stored one. That also covers a first open with no sketch yet, or
 * one drawn before changes made elsewhere (an agent, another tab), and a last
 * sketch on the way out if one is still owed.
 *
 * Lazy on purpose. It trails the board by seconds, every change restarts the
 * wait so it never runs mid-drag, and a sketch costs a projection of the board
 * and a few kilobytes: no DOM capture, no image.
 */
export function useBoardThumbnail(caseId: string): void {
  const store = useBoardStore();
  const { demoMode } = useServerConfig();

  React.useEffect(() => {
    // A demo instance refuses every write.
    if (demoMode) return;
    let timer: number | null = null;
    let cancelIdle: (() => void) | null = null;
    let owed = false;
    let lastSentAt = 0;
    // The signature the server has or is being sent. Until the first send,
    // the board's own read says what it had.
    let sent: string | null = null;

    const sketchNow = (leaving = false) => {
      owed = false;
      const s = store.getState();
      if (!s.loaded || s.loadError) return;
      const sketch = buildBoardSketch(s);
      const signature = sketchSignature(sketch);
      if (signature === (sent ?? s.thumbnailSignature)) return;
      sent = signature;
      lastSentAt = Date.now();
      rememberSketch(caseId, sketch, signature);
      api.caseBoard
        .caseBoardControllerSaveThumbnail(
          { id: caseId, putBoardThumbnailDto: { sketch, signature, version: s.version } },
          // Navigating away must not cancel the last one.
          leaving ? { keepalive: true } : undefined,
        )
        .then((res) => settleSketch(caseId, signature, res.signature === signature, res.updatedAt))
        .catch(() => {
          // Sent again after the next change.
          forgetSketch(caseId, signature);
          if (sent === signature) sent = null;
        });
    };

    const schedule = () => {
      owed = true;
      if (timer !== null) window.clearTimeout(timer);
      cancelIdle?.();
      cancelIdle = null;
      const wait = Math.max(SETTLE_MS, lastSentAt + MIN_INTERVAL_MS - Date.now());
      timer = window.setTimeout(() => {
        timer = null;
        cancelIdle = whenIdle(() => {
          cancelIdle = null;
          sketchNow();
        });
      }, wait);
    };

    const unsubscribe = store.subscribe((s, prev) => {
      if (s.loaded && drawnChanged(s, prev)) schedule();
    });
    if (store.getState().loaded) schedule();
    const onPageHide = () => {
      if (owed) sketchNow(true);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onPageHide);
      if (timer !== null) window.clearTimeout(timer);
      cancelIdle?.();
      if (owed) sketchNow(true);
    };
  }, [caseId, store, demoMode]);
}
