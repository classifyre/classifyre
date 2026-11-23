import {
  decodeQueryTabs,
  EMPTY_QUERY_TABS,
  encodeQueryTabs,
  MAX_RECENT_ASSETS,
  MAX_SAVED_TABS,
  pushRecent,
  queryTabsCookieName,
} from "./query-tabs-cookie";

describe("query tabs cookie", () => {
  it("round-trips tabs, the active tab and recent assets", () => {
    const state = {
      tabs: [
        { kind: "source" as const, id: "src-1" },
        { kind: "asset" as const, id: "asset-1" },
      ],
      active: "asset:asset-1",
      recent: ["asset-1", "asset-0"],
    };
    expect(decodeQueryTabs(encodeQueryTabs(state))).toEqual(state);
  });

  it("is one cookie per person and workspace, with cookie-safe names", () => {
    expect(queryTabsCookieName("u-1", "acme")).not.toBe(
      queryTabsCookieName("u-2", "acme"),
    );
    expect(queryTabsCookieName("u-1", "acme")).not.toBe(
      queryTabsCookieName("u-1", "other"),
    );
    expect(queryTabsCookieName("a b;c", "x=y")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("reads anything unreadable as nothing saved", () => {
    expect(decodeQueryTabs(undefined)).toEqual(EMPTY_QUERY_TABS);
    expect(decodeQueryTabs("%7Bnot json")).toEqual(EMPTY_QUERY_TABS);
    expect(
      decodeQueryTabs(encodeURIComponent(JSON.stringify({ v: 99, t: [] }))),
    ).toEqual(EMPTY_QUERY_TABS);
  });

  it("drops malformed tab entries", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ v: 1, t: ["s:ok", "x:bad", "a:", 3], a: "query" }),
    );
    expect(decodeQueryTabs(raw).tabs).toEqual([{ kind: "source", id: "ok" }]);
  });

  it("caps what it keeps so the cookie stays small", () => {
    const tabs = Array.from({ length: MAX_SAVED_TABS + 10 }, (_, i) => ({
      kind: "asset" as const,
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    }));
    const encoded = encodeQueryTabs({
      tabs,
      active: "query",
      recent: tabs.map((tab) => tab.id),
    });
    expect(encoded.length).toBeLessThan(3500);
    const decoded = decodeQueryTabs(encoded);
    expect(decoded.tabs).toHaveLength(MAX_SAVED_TABS);
    expect(decoded.recent).toHaveLength(MAX_RECENT_ASSETS);
  });

  it("keeps the recent list unique, newest first, at most five", () => {
    let recent: string[] = [];
    for (const id of ["a", "b", "c", "a", "d", "e", "f"]) {
      recent = pushRecent(recent, id);
    }
    expect(recent).toEqual(["f", "e", "d", "a", "c"]);
  });
});
