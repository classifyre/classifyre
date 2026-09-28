import {
  ASSET_DETAILS_TABS,
  FINDING_DETAILS_TABS,
  TIMELINE_VIEWS,
  parseBoardEdgeId,
  type DetailsTarget,
  type DrawerKind,
  type TimelineView,
  type UiState,
} from "./ui-store";

/**
 * What the board keeps in its address: which side panel is open and what it
 * shows, so a reload lands where the investigator was and a copied link opens
 * the same view for a colleague. Only this state lives in the URL; the
 * viewport, the view choices and the panel width are per-viewer and stay in
 * localStorage.
 *
 * Pure (parse and serialize), so it is tested without a DOM; the hook in
 * hooks/use-board-url-state.ts moves it between the URL and the UI store.
 */

/** Every query parameter the board owns. Anything else in the URL is left alone. */
export const BOARD_URL_PARAMS = ["panel", "thread", "item", "finding", "edge", "suggested", "tab", "watch", "view", "entry"] as const;

/**
 * Panels by the name they carry in the address. "Connections" is left out:
 * it shows a trace that lives only as long as the panel is open.
 */
const PANEL_SLUGS: Partial<Record<DrawerKind, string>> = {
  details: "details",
  hypotheses: "hypotheses",
  thread: "thread",
  addEvidence: "add-evidence",
  evidence: "evidence",
  leads: "leads",
  inquiries: "watches",
  timeline: "timeline",
  caseFile: "case-file",
  snapshots: "snapshots",
};

const PANEL_BY_SLUG = new Map(Object.entries(PANEL_SLUGS).map(([kind, slug]) => [slug, kind as DrawerKind]));

/** The part of the UI state the address holds. */
export interface BoardUrlState {
  panel: DrawerKind | null;
  threadId: string | null;
  details: DetailsTarget | null;
  detailsTab: UiState["detailsTab"];
  watchId: string | null;
  timelineView: TimelineView;
  /** A timeline entry the link points at. */
  entryId: string | null;
}

export const EMPTY_URL_STATE: BoardUrlState = {
  panel: null,
  threadId: null,
  details: null,
  detailsTab: null,
  watchId: null,
  timelineView: "activity",
  entryId: null,
};

/** Ids and keys are opaque; anything unreasonable in the address is ignored. */
function clean(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 300 ? trimmed : null;
}

function isTab(value: string | null): value is NonNullable<UiState["detailsTab"]> {
  return (
    value !== null &&
    ((ASSET_DETAILS_TABS as readonly string[]).includes(value) || (FINDING_DETAILS_TABS as readonly string[]).includes(value))
  );
}

/** Read the board's state out of a query string; missing or malformed parts fall back to nothing. */
export function readBoardUrl(params: URLSearchParams): BoardUrlState {
  const panel = PANEL_BY_SLUG.get(params.get("panel") ?? "") ?? null;
  if (!panel) return EMPTY_URL_STATE;
  const state: BoardUrlState = { ...EMPTY_URL_STATE, panel };
  if (panel === "thread") {
    const threadId = clean(params.get("thread"));
    // A thread panel without its thread is the list of hypotheses.
    return threadId ? { ...state, threadId } : { ...state, panel: "hypotheses" };
  }
  if (panel === "details") {
    const edge = clean(params.get("edge"));
    const suggested = clean(params.get("suggested"));
    const item = clean(params.get("item"));
    if (edge && parseBoardEdgeId(edge)) state.details = { edgeId: edge };
    else if (suggested) state.details = { suggestedKey: suggested };
    else if (item) state.details = { itemId: item, findingId: clean(params.get("finding")) };
    const tab = params.get("tab");
    if (state.details && !("suggestedKey" in state.details) && !("edgeId" in state.details) && isTab(tab)) {
      state.detailsTab = tab;
    }
    return state;
  }
  if (panel === "inquiries") return { ...state, watchId: clean(params.get("watch")) };
  if (panel === "timeline") {
    const view = params.get("view");
    return {
      ...state,
      timelineView: (TIMELINE_VIEWS as readonly string[]).includes(view ?? "") ? (view as TimelineView) : "activity",
      entryId: clean(params.get("entry")),
    };
  }
  return state;
}

/** The board's state as query parameters (only the ones that say something). */
export function boardUrlParams(state: BoardUrlState): Array<[string, string]> {
  const slug = state.panel ? PANEL_SLUGS[state.panel] : undefined;
  if (!state.panel || !slug) return [];
  const out: Array<[string, string]> = [["panel", slug]];
  if (state.panel === "thread" && state.threadId) out.push(["thread", state.threadId]);
  if (state.panel === "details" && state.details) {
    const d = state.details;
    if ("edgeId" in d) out.push(["edge", d.edgeId]);
    else if ("suggestedKey" in d) out.push(["suggested", d.suggestedKey]);
    else {
      out.push(["item", d.itemId]);
      if (d.findingId) out.push(["finding", d.findingId]);
      if (state.detailsTab) out.push(["tab", state.detailsTab]);
    }
  }
  if (state.panel === "inquiries" && state.watchId) out.push(["watch", state.watchId]);
  if (state.panel === "timeline") {
    if (state.timelineView !== "activity") out.push(["view", state.timelineView]);
    if (state.entryId && state.timelineView === "activity") out.push(["entry", state.entryId]);
  }
  return out;
}

/** The address with the board's parameters replaced; every other parameter is kept as it was. */
export function withBoardUrl(href: string, state: BoardUrlState): string {
  const url = new URL(href);
  for (const key of BOARD_URL_PARAMS) url.searchParams.delete(key);
  for (const [key, value] of boardUrlParams(state)) url.searchParams.set(key, value);
  return url.toString();
}

/** The address state of the UI store as it is now. */
export function urlStateOf(ui: Pick<
  UiState,
  "drawer" | "drawerThreadId" | "detailsTarget" | "detailsTab" | "watchId" | "timelineView" | "timelineFocus"
>): BoardUrlState {
  return {
    panel: ui.drawer,
    threadId: ui.drawerThreadId,
    details: ui.detailsTarget,
    detailsTab: ui.detailsTab,
    watchId: ui.watchId,
    timelineView: ui.timelineView,
    entryId: ui.timelineFocus?.entryId ?? null,
  };
}
