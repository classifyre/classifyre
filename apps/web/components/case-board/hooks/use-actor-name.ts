"use client";

import * as React from "react";
import { setActorName } from "@workspace/api-client";

const KEY = "classifyre.actorName";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * The self-declared display name (PRD §5.12, open question Q1). The app has
 * no user model yet, so a person types a name once; it lives in this browser
 * and rides on every API request as `X-Actor-Name`. Attribution, not
 * authorisation — anyone can claim any name.
 */
export function useActorName(): [string | null, (name: string) => void] {
  const name = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (typeof window === "undefined" ? null : read()),
    () => null,
  );

  React.useEffect(() => {
    setActorName(name);
  }, [name]);

  const update = React.useCallback((next: string) => {
    const trimmed = next.trim().slice(0, 64);
    try {
      if (trimmed) window.localStorage.setItem(KEY, trimmed);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Blocked storage: the name still applies for this page.
    }
    setActorName(trimmed || null);
    for (const listener of listeners) listener();
  }, []);

  return [name, update];
}

/** Call once at startup so requests carry the name before any hook renders. */
export function primeActorName(): void {
  if (typeof window !== "undefined") setActorName(read());
}
