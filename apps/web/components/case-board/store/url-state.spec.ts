import { EMPTY_URL_STATE, boardUrlParams, readBoardUrl, withBoardUrl, type BoardUrlState } from "./url-state";
import { detailsKey, parseBoardEdgeId } from "./ui-store";

const read = (query: string) => readBoardUrl(new URLSearchParams(query));
const state = (patch: Partial<BoardUrlState>): BoardUrlState => ({ ...EMPTY_URL_STATE, ...patch });

describe("board URL state", () => {
  it("reads nothing from an address without a panel", () => {
    expect(read("")).toEqual(EMPTY_URL_STATE);
    expect(read("item=abc")).toEqual(EMPTY_URL_STATE);
    expect(read("panel=nonsense")).toEqual(EMPTY_URL_STATE);
  });

  it("round-trips an asset's details with its tab", () => {
    const s = state({ panel: "details", details: { itemId: "i1", findingId: null }, detailsTab: "lineage" });
    const params = boardUrlParams(s);
    expect(params).toEqual([
      ["panel", "details"],
      ["item", "i1"],
      ["tab", "lineage"],
    ]);
    expect(read(new URLSearchParams(params).toString())).toEqual(s);
  });

  it("round-trips a finding, a relation and a suggested neighbour", () => {
    for (const details of [
      { itemId: "i1", findingId: "f1" },
      { edgeId: "lnk:l1" },
      { suggestedKey: "sg:a9" },
    ]) {
      const s = state({ panel: "details", details });
      expect(read(new URLSearchParams(boardUrlParams(s)).toString())).toEqual(s);
    }
  });

  it("ignores a tab that does not exist and an edge id it cannot place", () => {
    expect(read("panel=details&item=i1&tab=bogus").detailsTab).toBeNull();
    expect(read("panel=details&edge=zz:1").details).toBeNull();
  });

  it("names panels by readable slugs", () => {
    expect(boardUrlParams(state({ panel: "inquiries", watchId: "w1" }))).toEqual([
      ["panel", "watches"],
      ["watch", "w1"],
    ]);
    expect(read("panel=case-file").panel).toBe("caseFile");
    expect(read("panel=add-evidence").panel).toBe("addEvidence");
  });

  it("keeps a timeline entry only on the activity view", () => {
    expect(read("panel=timeline&entry=e1")).toEqual(state({ panel: "timeline", entryId: "e1" }));
    expect(boardUrlParams(state({ panel: "timeline", timelineView: "chronology", entryId: "e1" }))).toEqual([
      ["panel", "timeline"],
      ["view", "chronology"],
    ]);
  });

  it("falls back to the hypotheses list for a thread panel without a thread", () => {
    expect(read("panel=thread").panel).toBe("hypotheses");
    expect(read("panel=thread&thread=t1")).toEqual(state({ panel: "thread", threadId: "t1" }));
  });

  it("never writes the connections panel (its trace does not outlive it)", () => {
    expect(boardUrlParams(state({ panel: "connections" }))).toEqual([]);
  });

  it("replaces only its own parameters", () => {
    const href = withBoardUrl(
      "http://x.test/ns/investigations/c1?utm=1&panel=leads&item=old",
      state({ panel: "details", details: { itemId: "i2" } }),
    );
    const url = new URL(href);
    expect(url.searchParams.get("utm")).toBe("1");
    expect(url.searchParams.get("panel")).toBe("details");
    expect(url.searchParams.get("item")).toBe("i2");
    expect(withBoardUrl("http://x.test/p?panel=leads&q=2", EMPTY_URL_STATE)).toBe("http://x.test/p?q=2");
  });
});

describe("details targets and edge ids", () => {
  it("parses the three kinds of board edge", () => {
    expect(parseBoardEdgeId("lnk:a")).toEqual({ kind: "link", linkId: "a" });
    expect(parseBoardEdgeId("sys:b")).toEqual({ kind: "system", systemEdgeId: "b" });
    expect(parseBoardEdgeId("st:c")).toEqual({ kind: "stance", supportId: "c" });
    expect(parseBoardEdgeId("ct:x")).toBeNull();
    expect(parseBoardEdgeId("lnk:")).toBeNull();
  });

  it("keys targets by what they show", () => {
    expect(detailsKey({ itemId: "i", findingId: null })).toBe(detailsKey({ itemId: "i" }));
    expect(detailsKey({ itemId: "i", findingId: "f" })).not.toBe(detailsKey({ itemId: "i" }));
    expect(detailsKey(null)).toBe("");
  });
});
