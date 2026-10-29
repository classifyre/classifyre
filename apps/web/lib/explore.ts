import type {
  ExploreEdgeDto,
  ExploreNeighbourhoodResponseDto,
} from "@workspace/api-client";
import {
  EXPLORE_KINDS,
  termNodeId,
  type ExploreGraph,
  type ExploreKind,
} from "@workspace/case-board/explore/model";
import type { TranslationKey } from "@/i18n";

/**
 * Explore's view in the address bar, the views it guides people between,
 * and the API's answer turned into what the canvas draws: links with their
 * reason in words, and the neighbours worth adding next. Pure, so it is
 * tested without a browser.
 */

export const EXPLORE_MAX_SEEDS = 10;

/**
 * The views Explore guides between. Lineage first: it is what a scan
 * brings in and what people come to trace. "By meaning" is the fallback
 * for an asset nothing links yet.
 */
export const EXPLORE_VIEWS = ["lineage", "duplicates", "connected", "meaning"] as const;
export type ExploreViewName = (typeof EXPLORE_VIEWS)[number];

export const VIEW_KINDS: Record<ExploreViewName, ExploreKind[]> = {
  lineage: ["lineage", "links"],
  duplicates: ["duplicates", "similar"],
  connected: ["lineage", "links", "duplicates", "similar"],
  meaning: ["meaning", "alike"],
};

export type TraceDirection = "up" | "down" | "both";
/** Which connections to keep: all, those inside the source, those leaving it. */
export const EXPLORE_SCOPES = ["all", "internal", "external"] as const;
export type ExploreScope = (typeof EXPLORE_SCOPES)[number];
/** Hops a trace walks; 6 is "all", as on the case board. */
export const EXPLORE_DEPTHS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_DEPTH = 2;

export interface ExploreView {
  /** Assets it starts from, in the order they were added. */
  seeds: string[];
  /** The view chosen; null until Explore has picked one from what the assets have. */
  view: ExploreViewName | null;
  /** Kinds chosen by hand, overriding the view's; null to follow the view. */
  kinds: ExploreKind[] | null;
  /** Hops for lineage and links. */
  depth: number;
  direction: TraceDirection;
  scope: ExploreScope;
  /** The search box. */
  q: string;
  /** The saved view this is, when one was opened or saved. */
  saved: string | null;
}

/** An empty view: nothing on the canvas, defaults everywhere. */
export const EMPTY_VIEW: ExploreView = {
  seeds: [],
  view: null,
  kinds: null,
  depth: DEFAULT_DEPTH,
  direction: "both",
  scope: "all",
  q: "",
  saved: null,
};

const list = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function readExploreView(params: URLSearchParams): ExploreView {
  const asked = new Set(list(params.get("kinds")));
  const kinds = EXPLORE_KINDS.filter((k) => asked.has(k));
  const view = params.get("view");
  const depth = Number(params.get("depth"));
  const direction = params.get("direction");
  const scope = params.get("scope");
  return {
    seeds: [...new Set(list(params.get("seeds")))].slice(0, EXPLORE_MAX_SEEDS),
    view: (EXPLORE_VIEWS as readonly string[]).includes(view ?? "") ? (view as ExploreViewName) : null,
    kinds: kinds.length ? kinds : null,
    depth: Number.isInteger(depth) && depth >= 1 && depth <= 6 ? depth : DEFAULT_DEPTH,
    direction: direction === "up" || direction === "down" ? direction : "both",
    scope: scope === "internal" || scope === "external" ? scope : "all",
    q: params.get("q") ?? "",
    saved: params.get("saved") || null,
  };
}

/** The query string for a view; defaults are left out so addresses stay short. */
export function exploreViewQuery(view: ExploreView): string {
  const params = new URLSearchParams();
  if (view.seeds.length) params.set("seeds", view.seeds.join(","));
  if (view.view) params.set("view", view.view);
  if (view.kinds?.length) params.set("kinds", EXPLORE_KINDS.filter((k) => view.kinds!.includes(k)).join(","));
  if (view.depth !== DEFAULT_DEPTH) params.set("depth", String(view.depth));
  if (view.direction !== "both") params.set("direction", view.direction);
  if (view.scope !== "all") params.set("scope", view.scope);
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.saved) params.set("saved", view.saved);
  return params.toString();
}

/** The kinds a view draws: chosen by hand, or the view's own. */
export function kindsOf(view: ExploreView): ExploreKind[] {
  return view.kinds ?? VIEW_KINDS[view.view ?? "connected"];
}

/**
 * The view to open on, from what the starting points actually have:
 * lineage when there is any, then sameness, then any link at all, and
 * likeness by meaning for an asset nothing links yet.
 */
export function pickView(counts: Partial<Record<ExploreKind, number>>): ExploreViewName {
  const n = (k: ExploreKind) => counts[k] ?? 0;
  if (n("lineage") > 0) return "lineage";
  if (n("duplicates") + n("similar") > 0) return "duplicates";
  if (n("links") > 0) return "connected";
  return "meaning";
}

/** What a view would show, as a count of neighbours: for the guide's offers. */
export function viewCount(view: ExploreViewName, res: ExploreNeighbourhoodResponseDto): number {
  const kinds = new Set(VIEW_KINDS[view]);
  const neighbours = new Set(
    res.nodes.filter((n) => n.side !== "seed" && (n.kinds as ExploreKind[]).some((k) => kinds.has(k))).map((n) => n.id),
  );
  // A starting point another one is linked to is a neighbour too: a source with
  // few enough assets that all are starting points has no one else to link.
  const seeds = new Set(res.nodes.filter((n) => n.side === "seed").map((n) => n.id));
  for (const e of res.edges) {
    if (e.fromId !== e.toId && kinds.has(e.kind as ExploreKind) && seeds.has(e.fromId) && seeds.has(e.toId)) {
      neighbours.add(e.fromId);
      neighbours.add(e.toId);
    }
  }
  return neighbours.size;
}

/**
 * Whether two views would draw the same neighbours. The guide offers only a
 * view that adds something: "Lineage" over links alone is "All connected" again.
 */
export function sameNeighbours(a: ExploreViewName, b: ExploreViewName, res: ExploreNeighbourhoodResponseDto): boolean {
  const shown = (view: ExploreViewName) => {
    const kinds = new Set(VIEW_KINDS[view]);
    return res.nodes
      .filter((n) => n.side !== "seed" && (n.kinds as ExploreKind[]).some((k) => kinds.has(k)))
      .map((n) => n.id)
      .sort()
      .join(",");
  };
  return shown(a) === shown(b);
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

/** "copy_of" → "copy of"; "TRANSFORM" → "transform". */
export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

/** "person ×2, email ×1": the values two assets share, most first. */
export function sharedValues(byLabel: Record<string, number> | null | undefined): string {
  return Object.entries(byLabel ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, n]) => `${humanize(label)} ×${n}`)
    .join(", ");
}

/** Why two things are linked, in words, as the canvas writes it on the line. */
export function linkReason(e: ExploreEdgeDto, t: Translate): string {
  if (e.origin === "MANUAL") return e.note?.trim() || humanize(e.relationType);
  // What duplicate review decided outranks what the scorer says.
  if (e.review === "CONFIRMED") {
    return e.relationType === "repeated_text_confirmed"
      ? t("explore.reason.repeatedTextConfirmed")
      : t("explore.reason.confirmed");
  }
  if (e.review === "UNSURE") return t("explore.reason.unsure", { reason: scoredReason(e, t) });
  return scoredReason(e, t);
}

function scoredReason(e: ExploreEdgeDto, t: Translate): string {
  switch (e.kind) {
    case "duplicates": {
      if (e.relationType === "identical_content") return t("explore.reason.identical");
      // Read alike passage for passage by duplicate review (no edge of its own).
      if (e.relationType === "repeated_text_confirmed") return t("explore.reason.repeatedTextConfirmed");
      if (e.relationType === "confirmed_duplicate") return t("explore.reason.confirmed");
      if (e.relationType === "repeated_text") {
        return t("explore.reason.repeatedText", { percent: Math.round((e.confidence ?? 0) * 100) });
      }
      const shared = sharedValues(e.sharedByLabel);
      return shared
        ? t("explore.reason.likelySameSharing", { values: shared })
        : t("explore.reason.likelySame");
    }
    case "similar": {
      const shared = sharedValues(e.sharedByLabel);
      return shared ? t("explore.reason.shares", { values: shared }) : t("explore.reason.sharesValues");
    }
    case "alike":
      return t("explore.reason.alike", { percent: Math.round((e.confidence ?? 0) * 100) });
    case "meaning":
      // The term itself sits at the end of the line and says it.
      return "";
    default:
      return humanize(e.relationType);
  }
}

const DIRECTED: ReadonlySet<ExploreKind> = new Set(["lineage", "links"]);
const SCORED: ReadonlySet<ExploreKind> = new Set(["duplicates", "similar", "alike"]);

export function toExploreGraph(res: ExploreNeighbourhoodResponseDto, t: Translate): ExploreGraph {
  const caseTitle = new Map(res.cases.map((c) => [c.id, c.title]));
  const watchTitle = new Map(res.inquiries.map((q) => [q.id, q.title]));
  return {
    assets: res.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      assetType: n.assetType ?? null,
      sourceName: n.sourceName ?? null,
      side: n.side as "seed" | "up" | "down" | "side",
      depth: n.depth,
      kinds: n.kinds as ExploreKind[],
      external: n.type !== "asset",
      foreign: n.foreign,
      cases: n.caseIds.flatMap((id) => caseTitle.get(id) ?? []),
      watches: n.inquiryIds.flatMap((id) => watchTitle.get(id) ?? []),
    })),
    terms: res.terms.map((term) => ({ id: term.id, name: term.name, kind: term.kind })),
    links: res.edges.map((e) => {
      const kind = e.kind as ExploreKind;
      return {
        id: e.id,
        source: e.fromType === "term" ? termNodeId(e.fromId) : e.fromId,
        target: e.toType === "term" ? termNodeId(e.toId) : e.toId,
        kind,
        label: linkReason(e, t),
        manual: e.origin === "MANUAL",
        directed: DIRECTED.has(kind),
        strength: SCORED.has(kind) ? (e.confidence ?? null) : null,
      };
    }),
  };
}

export interface ExploreSuggestion {
  id: string;
  label: string;
  sourceName: string | null;
  /** From another source than the one explored. */
  foreign: boolean;
  kinds: ExploreKind[];
  /** The strongest scored link to it, 0–1, when it has one. */
  best: number | null;
}

/**
 * The neighbours most worth adding as a starting point: reached by the most
 * kinds of connection, then by the strongest score, then nearest.
 */
export function rankSuggestions(
  res: ExploreNeighbourhoodResponseDto,
  kinds: ReadonlySet<ExploreKind>,
  limit = 12,
): ExploreSuggestion[] {
  const best = new Map<string, number>();
  for (const e of res.edges) {
    const kind = e.kind as ExploreKind;
    // Only a match carries a score worth comparing; lineage confidence is not one.
    if (e.confidence == null || !kinds.has(kind) || !SCORED.has(kind)) continue;
    for (const id of [e.fromId, e.toId]) best.set(id, Math.max(best.get(id) ?? 0, e.confidence));
  }
  return res.nodes
    .filter((n) => n.side !== "seed" && n.type === "asset")
    .map((n) => ({ n, shown: (n.kinds as ExploreKind[]).filter((k) => kinds.has(k)) }))
    .filter(({ shown }) => shown.length > 0)
    .sort(
      (a, b) =>
        b.shown.length - a.shown.length ||
        (best.get(b.n.id) ?? 0) - (best.get(a.n.id) ?? 0) ||
        a.n.depth - b.n.depth ||
        a.n.label.localeCompare(b.n.label),
    )
    .slice(0, limit)
    .map(({ n, shown }) => ({
      id: n.id,
      label: n.label,
      sourceName: n.sourceName ?? null,
      foreign: n.foreign,
      kinds: shown,
      best: best.get(n.id) ?? null,
    }));
}
