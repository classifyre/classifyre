"use client";

import * as React from "react";

/** Where an autosaved value stands against the server. */
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";

export interface Autosave<T> {
  /** What the field shows: the person's edit, or the server's value when there is none. */
  draft: T;
  /** Change the draft; it saves itself once typing pauses. */
  setDraft: (next: T) => void;
  /** Save now (a blur, Enter, closing the panel). Resolves once the save settled. */
  flush: () => Promise<void>;
  status: AutosaveStatus;
}

/**
 * A value that saves itself as it is edited: after `delayMs` without a
 * change, on `flush()`, and when the component unmounts with an edit pending.
 * Saves run one at a time, in order, and each one is handed the value it
 * replaces (so it can send only what changed).
 *
 * The server's value (`value`) is taken over whenever it changes and the
 * person has nothing unsaved — another tab's edit, a refetch — so the field
 * never silently discards what someone is typing, nor sticks to a stale copy.
 */
export function useAutosave<T>({
  value,
  save,
  delayMs = 800,
  isEqual = Object.is,
  canSave = () => true,
}: {
  value: T;
  save: (next: T, previous: T) => Promise<void>;
  delayMs?: number;
  isEqual?: (a: T, b: T) => boolean;
  /** A draft that fails this is kept on screen but not sent (an empty title). */
  canSave?: (next: T) => boolean;
}): Autosave<T> {
  const [draft, setDraftState] = React.useState(value);
  const [status, setStatus] = React.useState<AutosaveStatus>("idle");
  const latest = React.useRef({ save, isEqual, canSave, delayMs });
  latest.current = { save, isEqual, canSave, delayMs };
  const draftRef = React.useRef(value);
  /** What the server holds, as far as this field knows. */
  const saved = React.useRef(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = React.useRef<Promise<void>>(Promise.resolve());
  const mounted = React.useRef(true);

  const setStatusIfMounted = React.useCallback((next: AutosaveStatus) => {
    if (mounted.current) setStatus(next);
  }, []);

  React.useEffect(() => {
    const { isEqual: eq } = latest.current;
    if (eq(value, saved.current)) return;
    const dirty = !eq(draftRef.current, saved.current);
    saved.current = value;
    if (!dirty) {
      draftRef.current = value;
      setDraftState(value);
    }
  }, [value]);

  const run = React.useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // One save at a time: each waits for the one before, then saves whatever is newest.
    chain.current = chain.current.then(async () => {
      const { save: persist, isEqual: eq, canSave: valid } = latest.current;
      const next = draftRef.current;
      if (eq(next, saved.current)) {
        setStatusIfMounted("idle");
        return;
      }
      if (!valid(next)) {
        setStatusIfMounted("invalid");
        return;
      }
      setStatusIfMounted("saving");
      try {
        await persist(next, saved.current);
        saved.current = next;
        setStatusIfMounted(eq(draftRef.current, next) ? "saved" : "pending");
      } catch {
        setStatusIfMounted("error");
      }
    });
    return chain.current;
  }, [setStatusIfMounted]);

  const setDraft = React.useCallback(
    (next: T) => {
      draftRef.current = next;
      setDraftState(next);
      if (timer.current) clearTimeout(timer.current);
      const { isEqual: eq, canSave: valid, delayMs: wait } = latest.current;
      if (eq(next, saved.current)) {
        timer.current = null;
        setStatus("idle");
        return;
      }
      setStatus(valid(next) ? "pending" : "invalid");
      timer.current = setTimeout(() => void run(), wait);
    },
    [run],
  );

  // Leaving with an edit pending saves it (a closed panel, a route change).
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) void run();
    };
  }, [run]);

  return { draft, setDraft, flush: run, status };
}
