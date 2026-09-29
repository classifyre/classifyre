"use client";

import * as React from "react";

/**
 * What this browser opened last, newest first: the "Recently opened" rows of
 * the workspace directory and of each workspace's investigations page, and
 * the "Opened 2 hours ago" badge on their cards.
 *
 * Browser storage on purpose. The app has no user model yet (X-Actor-Name is
 * attribution, not identity), so a list kept on the server would be everyone's.
 * More entries are kept than a row shows, so something deleted can drop out
 * and the row still fills.
 */

export interface RecentlyOpened {
  id: string;
  /** When it was last opened, epoch ms. */
  at: number;
}

/** A list of recently opened things: one per kind and, for cases, per workspace. */
export type RecentList = `workspaces` | `cases:${string}`;

/** Workspaces, across the whole instance. Keyed by id: a slug can be renamed. */
export const RECENT_WORKSPACES: RecentList = "workspaces";

/** The cases of one workspace. */
export const recentCasesList = (namespaceSlug: string): RecentList => `cases:${namespaceSlug}`;

const KEEP = 12;
const EMPTY: RecentlyOpened[] = [];
const listeners = new Set<() => void>();

const storageKey = (list: RecentList) => `classifyre:recent:${list}`;

function readRaw(list: RecentList): string | null {
  try {
    return window.localStorage.getItem(storageKey(list));
  } catch {
    return null;
  }
}

function parse(raw: string | null): RecentlyOpened[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return value.filter(
      (r): r is RecentlyOpened =>
        !!r && typeof (r as RecentlyOpened).id === "string" && typeof (r as RecentlyOpened).at === "number",
    );
  } catch {
    return EMPTY;
  }
}

function write(list: RecentList, entries: RecentlyOpened[]): void {
  try {
    window.localStorage.setItem(storageKey(list), JSON.stringify(entries));
  } catch {
    // Private mode or storage full: the row just stays as it was.
  }
  for (const listener of listeners) listener();
}

export function recordOpened(list: RecentList, id: string): void {
  const rest = parse(readRaw(list)).filter((r) => r.id !== id);
  write(list, [{ id, at: Date.now() }, ...rest].slice(0, KEEP));
}

/** Drop entries that no longer exist. */
export function forgetOpened(list: RecentList, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const entries = parse(readRaw(list));
  const kept = entries.filter((r) => !ids.includes(r.id));
  if (kept.length !== entries.length) write(list, kept);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Opened in another tab.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const snapshots = new Map<RecentList, { raw: string | null; entries: RecentlyOpened[] }>();

function snapshot(list: RecentList): RecentlyOpened[] {
  const raw = readRaw(list);
  const cached = snapshots.get(list);
  if (cached && cached.raw === raw) return cached.entries;
  const entries = parse(raw);
  snapshots.set(list, { raw, entries });
  return entries;
}

/** A recent list, newest first; empty while rendering on the server or without a list. */
export function useRecentlyOpened(list: RecentList | null): RecentlyOpened[] {
  const getSnapshot = React.useCallback(() => (list ? snapshot(list) : EMPTY), [list]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** When each entry of a recent list was opened, for the cards' "Opened …" badge. */
export function useOpenedAt(list: RecentList | null): ReadonlyMap<string, number> {
  const entries = useRecentlyOpened(list);
  return React.useMemo(() => new Map(entries.map((r) => [r.id, r.at])), [entries]);
}
