/**
 * The /query workbench remembers, per person and per workspace, which Source
 * and Asset tabs were open, which one was active, and the last assets opened
 * (the "Recently opened" list). It lives in a cookie of this browser only;
 * the server never reads it.
 */

export type SavedQueryTab = { kind: "source" | "asset" | "schema"; id: string };

export interface QueryTabsState {
  tabs: SavedQueryTab[];
  /** `query`, `source:<id>`, `asset:<id>`, or `schema:<id>`. */
  active: string;
  /** Asset ids, most recent first. */
  recent: string[];
}

/** Keeps the cookie well below the 4 KB a browser allows. */
export const MAX_SAVED_TABS = 20;
export const MAX_RECENT_ASSETS = 5;
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const VERSION = 1;

export const EMPTY_QUERY_TABS: QueryTabsState = {
  tabs: [],
  active: "query",
  recent: [],
};

/** One cookie per person and workspace; ids are reduced to cookie-safe text. */
export function queryTabsCookieName(userId: string, workspace: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
  return `classifyre-query-tabs.${safe(workspace)}.${safe(userId)}`;
}

const TAB_KIND_TO_CODE: Readonly<Record<SavedQueryTab["kind"], string>> = {
  source: "s",
  schema: "v",
  asset: "a",
};

const CODE_TO_TAB_KIND: Readonly<Record<string, SavedQueryTab["kind"]>> = {
  s: "source",
  v: "schema",
  a: "asset",
};

/** The cookie value; tab kinds are one letter to save space. */
export function encodeQueryTabs(state: QueryTabsState): string {
  return encodeURIComponent(
    JSON.stringify({
      v: VERSION,
      t: state.tabs
        .slice(-MAX_SAVED_TABS)
        .map((tab) => `${TAB_KIND_TO_CODE[tab.kind]}:${tab.id}`),
      a: state.active,
      r: state.recent.slice(0, MAX_RECENT_ASSETS),
    }),
  );
}

/** Anything unreadable, or from another version, reads as no saved tabs. */
export function decodeQueryTabs(
  raw: string | null | undefined,
): QueryTabsState {
  if (!raw) return EMPTY_QUERY_TABS;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as {
      v?: unknown;
      t?: unknown;
      a?: unknown;
      r?: unknown;
    };
    if (parsed.v !== VERSION) return EMPTY_QUERY_TABS;
    const tabs = (Array.isArray(parsed.t) ? parsed.t : [])
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry): SavedQueryTab | null => {
        const [code, ...rest] = entry.split(":");
        const id = rest.join(":");
        const kind = code ? CODE_TO_TAB_KIND[code] : undefined;
        if (!id || !kind) return null;
        return { kind, id };
      })
      .filter((tab): tab is SavedQueryTab => tab !== null)
      .slice(-MAX_SAVED_TABS);
    const recent = (Array.isArray(parsed.r) ? parsed.r : [])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .slice(0, MAX_RECENT_ASSETS);
    const active = typeof parsed.a === "string" ? parsed.a : "query";
    return { tabs, active, recent };
  } catch {
    return EMPTY_QUERY_TABS;
  }
}

export function readQueryTabs(name: string): QueryTabsState {
  if (typeof document === "undefined") return EMPTY_QUERY_TABS;
  const row = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return decodeQueryTabs(row?.slice(name.length + 1));
}

export function writeQueryTabs(name: string, state: QueryTabsState): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeQueryTabs(state)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/** Puts an asset at the front of the recent list, without duplicates. */
export function pushRecent(recent: string[], assetId: string): string[] {
  return [assetId, ...recent.filter((id) => id !== assetId)].slice(
    0,
    MAX_RECENT_ASSETS,
  );
}
