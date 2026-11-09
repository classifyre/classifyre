"use client";

import * as React from "react";
import { setActorName } from "@workspace/api-client";
import { useServerConfig } from "@/components/server-config-provider";
import { useMe } from "@/hooks/use-me";

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
 * The display name your edits carry. Without sign-in it is self-declared
 * (PRD §5.12): typed once, kept in this browser and sent as `X-Actor-Name` —
 * attribution, not authorisation. With sign-in it is the signed-in person's
 * name and cannot be changed here; the API ignores the header anyway.
 */
export function useActorName(): [string | null, (name: string) => void] {
  const { iamEnabled } = useServerConfig();
  const me = useMe();
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

  if (iamEnabled) return [me?.actor.displayName ?? null, ignoreRename];
  return [name, update];
}

function ignoreRename(): void {
  // With sign-in the name comes from the identity server.
}

/** Call once at startup so requests carry the name before any hook renders. */
export function primeActorName(): void {
  if (typeof window !== "undefined") setActorName(read());
}
