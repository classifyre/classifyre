import type { ExploreEdgeDto, ExploreNeighbourhoodResponseDto } from "@workspace/api-client";
import { layoutExplore, visibleGraph } from "@workspace/case-board/explore";
import {
  exploreViewQuery,
  kindsOf,
  linkReason,
  pickView,
  rankSuggestions,
  readExploreView,
  sameNeighbours,
  sharedValues,
  toExploreGraph,
  VIEW_KINDS,
} from "./explore";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.values(values).join("|")})` : key;

const edge = (over: Partial<ExploreEdgeDto>): ExploreEdgeDto =>
  ({
    id: "e",
    fromType: "asset",
    fromId: "s",
    toType: "asset",
    toId: "b",
    kind: "links",
    relationType: "REFERENCES",
    relationClass: "REFERENCE",
    confidence: null,
    origin: "INFERRED",
    sharedByLabel: null,
    note: null,
    passage: null,
    ...over,
  }) as ExploreEdgeDto;

const node = (id: string, side: string, kinds: string[], depth = 1) => ({
  id,
  type: "asset",
  label: `${id}.txt`,
  assetType: "file",
  sourceType: "LOCAL_FOLDER",
  sourceName: "Shared drive",
  sourceId: "drive",
  foreign: false,
  depth,
  side,
  kinds,
  caseIds: [] as string[],
  inquiryIds: [] as string[],
});

describe("explore view in the address bar", () => {
  it("reads defaults from an empty address and writes nothing back", () => {
    const view = readExploreView(new URLSearchParams(""));
    expect(view).toMatchObject({ seeds: [], view: null, kinds: null, depth: 2, direction: "both", scope: "all", q: "", saved: null });
    expect(exploreViewQuery(view)).toBe("");
  });

  it("round-trips seeds, the view, the trace and the search", () => {
    const query = exploreViewQuery({
      seeds: ["a", "b"],
      view: "lineage",
      kinds: null,
      depth: 6,
      direction: "up",
      scope: "external",
      q: " water ",
      saved: null,
    });
    expect(query).toBe("seeds=a%2Cb&view=lineage&depth=6&direction=up&scope=external&q=water");
    expect(readExploreView(new URLSearchParams(query))).toMatchObject({
      seeds: ["a", "b"],
      view: "lineage",
      depth: 6,
      direction: "up",
      scope: "external",
      q: "water",
    });
  });

  it("carries the saved view it is", () => {
    const view = readExploreView(new URLSearchParams("seeds=a&saved=v1"));
    expect(view.saved).toBe("v1");
    expect(exploreViewQuery(view)).toBe("seeds=a&saved=v1");
  });

  it("keeps kinds chosen by hand over the view's", () => {
    const view = readExploreView(new URLSearchParams("view=lineage&kinds=alike,lineage"));
    expect(kindsOf(view)).toEqual(["lineage", "alike"]);
    expect(kindsOf({ ...view, kinds: null })).toEqual(VIEW_KINDS.lineage);
  });

  it("drops unknown kinds, views and depths, and caps the seeds", () => {
    const many = Array.from({ length: 14 }, (_, i) => `a${i}`).join(",");
    const view = readExploreView(new URLSearchParams(`seeds=${many}&kinds=bogus&view=bogus&depth=9`));
    expect(view.seeds).toHaveLength(10);
    expect(view.kinds).toBeNull();
    expect(view.view).toBeNull();
    expect(view.depth).toBe(2);
  });
});

describe("the view Explore opens on", () => {
  it("prefers lineage, then sameness, then any link, then meaning", () => {
    expect(pickView({ lineage: 2, duplicates: 5 })).toBe("lineage");
    expect(pickView({ similar: 1, links: 3 })).toBe("duplicates");
    expect(pickView({ links: 3, alike: 8 })).toBe("connected");
    expect(pickView({ alike: 8 })).toBe("meaning");
    expect(pickView({})).toBe("meaning");
  });
});

describe("the reason on a link", () => {
  it("names the values two assets share, most first", () => {
    expect(sharedValues({ email: 1, person: 2, iban_code: 0 })).toBe("person ×2, email ×1");
    expect(linkReason(edge({ kind: "similar", sharedByLabel: { person: 2 } }), t)).toBe(
      "explore.reason.shares(person ×2)",
    );
  });

  it("says exact duplicates are the same content", () => {
    expect(linkReason(edge({ kind: "duplicates", relationType: "identical_content" }), t)).toBe(
      "explore.reason.identical",
    );
  });

  it("names repeated text, and says when a reviewer confirmed it", () => {
    expect(linkReason(edge({ kind: "duplicates", relationType: "repeated_text", confidence: 0.973 }), t)).toBe(
      "explore.reason.repeatedText(97)",
    );
    expect(linkReason(edge({ kind: "duplicates", relationType: "repeated_text_confirmed" }), t)).toBe(
      "explore.reason.repeatedTextConfirmed",
    );
  });

  it("gives likeness as a percentage", () => {
    expect(linkReason(edge({ kind: "alike", confidence: 0.836 }), t)).toBe("explore.reason.alike(84)");
  });

  it("shows what a person wrote on their own link", () => {
    expect(linkReason(edge({ origin: "MANUAL", relationType: "derived_from", note: "Copied by hand" }), t)).toBe(
      "Copied by hand",
    );
    expect(linkReason(edge({ origin: "MANUAL", relationType: "derived_from" }), t)).toBe("derived from");
  });
});

describe("from the API to the canvas", () => {
  const res = {
    seeds: ["s"],
    home: ["drive"],
    nodes: [
      node("s", "seed", [], 0),
      node("up1", "up", ["lineage"]),
      node("dup", "side", ["duplicates", "similar"]),
      node("near", "side", ["alike"]),
      node("m", "side", ["meaning"]),
    ],
    terms: [{ id: "damp", key: "damp", name: "Damp", kind: "CONCEPT" }],
    edges: [
      edge({ id: "l", fromId: "up1", toId: "s", kind: "lineage", relationType: "TRANSFORM" }),
      edge({ id: "d", toId: "dup", kind: "duplicates", relationType: "likely_duplicate", confidence: 0.9 }),
      edge({ id: "v", toId: "near", kind: "alike", confidence: 0.7 }),
      edge({ id: "t1", fromId: "s", toType: "term", toId: "damp", kind: "meaning" }),
      edge({ id: "t2", fromId: "m", toType: "term", toId: "damp", kind: "meaning" }),
    ],
    counts: {},
    alike: "ok",
    truncated: false,
    cases: [{ id: "c1", title: "Leak at 2C", status: "OPEN" }],
    inquiries: [],
  } as unknown as ExploreNeighbourhoodResponseDto;
  res.nodes[2]!.caseIds = ["c1"];

  it("carries the cases an asset is evidence in, by title", () => {
    const graph = toExploreGraph(res, t);
    expect(graph.assets.find((a) => a.id === "dup")?.cases).toEqual(["Leak at 2C"]);
    expect(graph.assets.find((a) => a.id === "s")?.cases).toEqual([]);
  });

  it("points term links at the term node", () => {
    const graph = toExploreGraph(res, t);
    expect(graph.links.find((l) => l.id === "t1")?.target).toBe("term:damp");
    expect(graph.links.find((l) => l.id === "l")?.directed).toBe(true);
  });

  it("leaves out what only a switched-off kind reaches", () => {
    const graph = toExploreGraph(res, t);
    const shown = visibleGraph(graph, new Set(["lineage"]));
    expect(shown.assets.map((a) => a.id).sort()).toEqual(["s", "up1"]);
    expect(shown.terms).toEqual([]);
  });

  it("hides an asset only a switched-off kind reached, even when another kind's line runs to it", () => {
    const graph = toExploreGraph(
      {
        ...res,
        // Lineage running from the seed to an asset only shared concepts reached.
        edges: [...res.edges, edge({ id: "across", fromId: "s", toId: "m", kind: "lineage" })],
      } as ExploreNeighbourhoodResponseDto,
      t,
    );
    const shown = visibleGraph(graph, new Set(["lineage"]));
    expect(shown.assets.map((a) => a.id).sort()).toEqual(["s", "up1"]);
    expect(shown.links.map((l) => l.id)).toEqual(["l"]);
  });

  it("lays lineage out left of the seed and lanes above and below", () => {
    const graph = toExploreGraph(res, t);
    const layout = layoutExplore(graph, new Set(["lineage", "duplicates", "meaning", "alike"]));
    const at = (id: string) => layout.positions.get(id)!;
    expect(at("up1").x).toBeLessThan(at("s").x);
    expect(at("dup").y).toBeLessThan(at("s").y);
    expect(at("term:damp").y).toBeGreaterThan(at("s").y);
    expect(at("m").y).toBeGreaterThan(at("term:damp").y);
    expect(layout.lanes.map((l) => l.lane)).toEqual(["duplicates", "terms", "meaning", "alike"]);
  });

  it("puts the same picture out for the same graph", () => {
    const graph = toExploreGraph(res, t);
    const kinds = new Set(["lineage", "duplicates", "alike"] as const);
    expect([...layoutExplore(graph, kinds).positions]).toEqual([...layoutExplore(graph, kinds).positions]);
  });

  it("ranks suggestions by how many kinds reach them, then by score", () => {
    const ranked = rankSuggestions(res, new Set(["duplicates", "similar", "alike", "lineage", "meaning"]));
    expect(ranked.map((s) => s.id)).toEqual(["dup", "near", "m", "up1"]);
    expect(ranked[0]?.best).toBe(0.9);
  });
});

describe("the guide's offers", () => {
  const res = (nodes: ReturnType<typeof node>[]) =>
    ({ seeds: ["s"], home: [], nodes, terms: [], edges: [], counts: {}, alike: "ok", truncated: false, cases: [], inquiries: [] }) as never;

  it("treats a view that draws the same neighbours as nothing new", () => {
    // Links alone: "Lineage" and "All connected" draw the same two.
    const links = res([node("s", "seed", [], 0), node("a", "side", ["links"]), node("b", "side", ["links"])]);
    expect(sameNeighbours("lineage", "connected", links)).toBe(true);
    expect(sameNeighbours("duplicates", "connected", links)).toBe(false);
  });

  it("offers lineage when it adds what links do not", () => {
    const mixed = res([node("s", "seed", [], 0), node("a", "up", ["lineage"]), node("d", "side", ["duplicates"])]);
    expect(sameNeighbours("lineage", "connected", mixed)).toBe(false);
  });
});

describe("a term the canvas is about", () => {
  const graph = {
    assets: [
      { id: "a", label: "a", side: "seed" as const, depth: 0, kinds: [] },
      { id: "b", label: "b", side: "seed" as const, depth: 0, kinds: [] },
      { id: "c", label: "c", side: "side" as const, depth: 1, kinds: ["meaning" as const] },
      { id: "d", label: "d", side: "up" as const, depth: 1, kinds: ["lineage" as const] },
    ],
    terms: [
      { id: "damp", name: "Damp", kind: "CONCEPT" },
      { id: "mould", name: "Mould", kind: "CONCEPT" },
    ],
    links: [
      { id: "1", source: "a", target: "term:damp", kind: "meaning" as const, label: "" },
      { id: "2", source: "b", target: "term:damp", kind: "meaning" as const, label: "" },
      { id: "3", source: "c", target: "term:damp", kind: "meaning" as const, label: "" },
      { id: "4", source: "a", target: "term:mould", kind: "meaning" as const, label: "" },
      { id: "5", source: "c", target: "term:mould", kind: "meaning" as const, label: "" },
      { id: "6", source: "d", target: "a", kind: "lineage" as const, label: "feeds" },
    ],
  };

  it("stays, with everything that carries it, when meaning is not shown", () => {
    const shown = visibleGraph({ ...graph, anchor: "damp" }, new Set(["lineage"]));
    expect(shown.terms.map((t) => t.id)).toEqual(["damp"]);
    expect(shown.assets.map((a) => a.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(shown.links.map((l) => l.id).sort()).toEqual(["1", "2", "3", "6"]);
  });

  it("is a term like any other without the anchor", () => {
    const shown = visibleGraph(graph, new Set(["lineage"]));
    expect(shown.terms).toEqual([]);
    expect(shown.assets.map((a) => a.id).sort()).toEqual(["a", "b", "d"]);
  });
});
