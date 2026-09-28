import { createStore, type StoreApi } from "zustand/vanilla";
import type { BoardEndpoint } from "@workspace/schemas/case-board";
import type { BoardTraceResponseDto } from "@workspace/api-client";
import type { TraceRequest } from "./trace";
import type { FilterDialogRequest } from "@/components/case-cleanup/finding-filter-dialog";

/**
 * Per-viewer UI state: the active tool, open drawers, the View popover's
 * choices. None of it is board data, so none of it is persisted on the board
 * (PRD §5.10); the View choices are kept in localStorage.
 */

export type Tool = "select" | "hand" | "note" | "frame" | "hypothesis" | "comment" | "link";

/** How far suggested neighbours reach from the evidence: 0 is none, 6 is as far as the walk goes. */
export type NeighbourHops = 0 | 1 | 2 | 3 | 6;

/** What the side panel shows (the rail on the right of the board opens it). */
export type DrawerKind =
  | "timeline"
  | "leads"
  | "caseFile"
  | "inquiries"
  | "evidence"
  | "hypotheses"
  | "thread"
  | "details"
  | "addEvidence"
  | "connections"
  | "snapshots";

/** A kind of board object the top bar's counters can spotlight. */
export type Spotlight = "evidence" | "findings" | "hypotheses" | "escalated";

/**
 * What the details panel shows: an item (optionally one finding), a suggested
 * neighbour, or a relation drawn between two nodes (a board edge id:
 * `lnk:` a link someone drew, `sys:` one the platform found, `st:` a stance).
 */
export type DetailsTarget =
  | { itemId: string; findingId?: string | null }
  | { suggestedKey: string }
  | { edgeId: string };

/** The tabs of an asset's details. */
export const ASSET_DETAILS_TABS = ["inCase", "other", "duplicates", "lineage"] as const;
export type AssetDetailsTab = (typeof ASSET_DETAILS_TABS)[number];

/** The tabs of a finding's details. */
export const FINDING_DETAILS_TABS = ["overview", "similar", "whereElse"] as const;
export type FindingDetailsTab = (typeof FINDING_DETAILS_TABS)[number];

/** The timeline panel's own tabs. */
export const TIMELINE_VIEWS = ["activity", "chronology", "threads"] as const;
export type TimelineView = (typeof TIMELINE_VIEWS)[number];

/**
 * A timeline entry to bring into view and mark: a shared link, or an alert's
 * "What changed". `nonce` makes asking for the same entry twice scroll again.
 */
export interface TimelineFocus {
  entryId: string;
  nonce: number;
}

export interface ViewPrefs {
  /** Suggested neighbours, by hops from the evidence. */
  neighbourHops: NeighbourHops;
  /** The viewer picked the hops; until then a crowded first hop stays hidden. */
  neighboursChosen: boolean;
  /** Findings: off dims rather than hides (evidence preservation). */
  showResolved: boolean;
  showDismissed: boolean;
  showGone: boolean;
  /** Kinds of relation drawn, and followed to neighbours ("references" is links). */
  lineage: boolean;
  duplicates: boolean;
  references: boolean;
  similar: boolean;
  onlyHighlighted: boolean;
  showResolvedComments: boolean;
  minimap: boolean;
  highlightSource: string | null;
  highlightDetector: string | null;
  highlightHypothesis: string | null;
}

export const DEFAULT_VIEW: ViewPrefs = {
  neighbourHops: 1,
  neighboursChosen: false,
  showResolved: true,
  showDismissed: true,
  showGone: true,
  lineage: true,
  duplicates: true,
  references: true,
  similar: true,
  onlyHighlighted: false,
  showResolvedComments: true,
  minimap: false,
  highlightSource: null,
  highlightDetector: null,
  highlightHypothesis: null,
};

/** Until the viewer picks the hops, a first hop crowded past this many stays hidden (D5). */
export const SUGGESTED_AUTO_LIMIT = 30;

export interface PendingLink {
  source: BoardEndpoint;
  target: BoardEndpoint;
  /** Screen position of the drop, where the popover opens. */
  screen: { x: number; y: number };
  /** Either end is a hypothesis: the popover offers stances. */
  stance: boolean;
}

export interface Composer {
  kind: "comment" | "hypothesis";
  /** Flow position to place at. */
  at: { x: number; y: number };
  /** Screen position for the popover. */
  screen: { x: number; y: number };
  anchor: BoardEndpoint | null;
  /** Hypothesis from selection: evidence it starts out supported by. */
  supports?: BoardEndpoint[];
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export interface UiState {
  tool: Tool;
  view: ViewPrefs;
  drawer: DrawerKind | null;
  /** Thread shown in the hypothesis drawer. */
  drawerThreadId: string | null;
  /** Item/finding/relation shown in the details drawer. */
  detailsTarget: DetailsTarget | null;
  /** The details tab open (an asset's or a finding's); null for the default one. */
  detailsTab: AssetDetailsTab | FindingDetailsTab | null;
  /** The watch open in the Watches panel; null shows them all as cards. */
  watchId: string | null;
  /** The timeline panel's tab. */
  timelineView: TimelineView;
  /** A timeline entry to scroll to (and mark) once the timeline shows it. */
  timelineFocus: TimelineFocus | null;
  /** Side panel width in pixels, remembered per viewer. */
  panelWidth: number;
  /** Query handed from the ⌘K palette to the add-evidence panel. */
  addEvidenceQuery: string;
  paletteOpen: boolean;
  cheatSheetOpen: boolean;
  pendingLink: PendingLink | null;
  composer: Composer | null;
  /** Hypothesis whose stance edges are in focus (card clicked). */
  focusHypothesisItemId: string | null;
  /** Every object of one kind lit up, the rest dimmed (a top-bar counter clicked). */
  spotlight: Spotlight | null;
  focusLock: boolean;
  /** "Show connections": what is being traced, and what the walk found. */
  trace: TraceRequest | null;
  traceResult: BoardTraceResponseDto | null;
  traceLoading: boolean;
  traceError: string | null;
  /** A multi-hop neighbour walk is in flight (View popover shows it). */
  neighbourhoodLoading: boolean;
  /** The last multi-hop walk stopped at its limit: more neighbours exist. */
  neighbourhoodTruncated: boolean;
  /** Bubbles showing all rows / their "+n more" list. */
  showAllRows: Set<string>;
  expandedUnattached: Set<string>;
  /** Items that just arrived from a watch (transient "New from" marker). */
  incoming: Set<string>;
  /** A pulse on an item after flying to it. */
  pulse: string | null;
  editingItemId: string | null;
  /** Comment popover open on a pin. */
  openCommentItemId: string | null;
  hiddenSuggestions: Set<string>;
  /** Edge under the pointer: its hover card and label show. */
  hoveredEdgeId: string | null;
  /** Someone is dragging a new link (connectors stay visible). */
  connecting: boolean;
  /** A destructive action waiting for "Confirm". */
  confirm: ConfirmRequest | null;
  /** The finding-filter dialog, opened from a finding's right-click menu. */
  filterRequest: FilterDialogRequest | null;
  /** The "Run Autopilot" dialog for this case is open. */
  autopilotOpen: boolean;
  /** Bumped when a run starts, so the autopilot status reloads. */
  autopilotRefresh: number;
  /** A PNG export is being drawn: every node renders, not only those in view. */
  exporting: boolean;
  /**
   * Where an item added outside the board (an accepted lead dropped on the
   * canvas) should appear, keyed `asset:<id>` or `finding:<id>`.
   */
  placementHints: Map<string, { x: number; y: number }>;

  setTool(tool: Tool): void;
  setView(patch: Partial<ViewPrefs>): void;
  openDrawer(kind: DrawerKind | null, opts?: OpenDrawerOptions): void;
  /** Open the timeline at one entry: scroll to it and mark it. */
  focusTimeline(entryId: string): void;
  set(patch: Partial<Omit<UiState, `set${string}` | "openDrawer" | "toggle" | "focusTimeline">>): void;
  toggle(key: "showAllRows" | "expandedUnattached" | "hiddenSuggestions", id: string): void;
}

export interface OpenDrawerOptions {
  threadId?: string | null;
  details?: DetailsTarget | null;
  /** The details tab to open on; a new details target starts on its default tab. */
  detailsTab?: UiState["detailsTab"];
  watchId?: string | null;
}

export type UiStore = StoreApi<UiState>;

const VIEW_KEY = "classifyre.caseBoard.view.v1";
const PANEL_KEY = "classifyre.caseBoard.panelWidth.v1";
export const DEFAULT_PANEL_WIDTH = 440;

function readPanelWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(PANEL_KEY));
    return Number.isFinite(value) && value >= 280 && value <= 1600 ? value : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

export function writePanelWidth(width: number): void {
  try {
    window.localStorage.setItem(PANEL_KEY, String(Math.round(width)));
  } catch {
    // A per-viewer convenience; losing it is harmless.
  }
}

function readView(): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewPrefs> & { suggested?: "auto" | "show" | "hide" };
    const { suggested, ...rest } = parsed;
    // The old Auto / Show / Hide choice, as hops.
    const legacy: Partial<ViewPrefs> =
      suggested && parsed.neighbourHops === undefined
        ? suggested === "hide"
          ? { neighbourHops: 0, neighboursChosen: true }
          : { neighbourHops: 1, neighboursChosen: suggested === "show" }
        : {};
    const view = { ...DEFAULT_VIEW, ...rest, ...legacy };
    return [0, 1, 2, 3, 6].includes(view.neighbourHops) ? view : { ...view, neighbourHops: 1 };
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeView(view: ViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Private windows and blocked storage: the view still works, it just
    // does not survive a reload.
  }
}

export function createUiStore(): UiStore {
  return createStore<UiState>()((set) => ({
    tool: "select",
    view: typeof window === "undefined" ? DEFAULT_VIEW : readView(),
    drawer: null,
    drawerThreadId: null,
    detailsTarget: null,
    detailsTab: null,
    watchId: null,
    timelineView: "activity",
    timelineFocus: null,
    panelWidth: typeof window === "undefined" ? DEFAULT_PANEL_WIDTH : readPanelWidth(),
    addEvidenceQuery: "",
    paletteOpen: false,
    cheatSheetOpen: false,
    pendingLink: null,
    composer: null,
    focusHypothesisItemId: null,
    spotlight: null,
    focusLock: false,
    trace: null,
    traceResult: null,
    traceLoading: false,
    traceError: null,
    neighbourhoodLoading: false,
    neighbourhoodTruncated: false,
    showAllRows: new Set(),
    expandedUnattached: new Set(),
    incoming: new Set(),
    pulse: null,
    editingItemId: null,
    openCommentItemId: null,
    hiddenSuggestions: new Set(),
    hoveredEdgeId: null,
    connecting: false,
    confirm: null,
    filterRequest: null,
    autopilotOpen: false,
    autopilotRefresh: 0,
    exporting: false,
    placementHints: new Map(),

    setTool: (tool) => set({ tool, pendingLink: null }),
    setView: (patch) =>
      set((s) => {
        const view = { ...s.view, ...patch };
        writeView(view);
        return { view };
      }),
    openDrawer: (kind, opts) =>
      set((s) => {
        const target = opts?.details;
        // Another thing to inspect starts on its default tab, unless one was asked for.
        const newTarget = target !== undefined && detailsKey(target) !== detailsKey(s.detailsTarget);
        return {
          drawer: kind,
          // The trace belongs to its panel: leaving the panel ends it.
          ...(kind !== "connections" ? { trace: null } : {}),
          // So does a marked timeline entry.
          ...(kind !== "timeline" ? { timelineFocus: null } : {}),
          ...(opts?.threadId !== undefined ? { drawerThreadId: opts.threadId } : {}),
          ...(target !== undefined ? { detailsTarget: target } : {}),
          ...(opts?.detailsTab !== undefined ? { detailsTab: opts.detailsTab } : newTarget ? { detailsTab: null } : {}),
          ...(opts?.watchId !== undefined ? { watchId: opts.watchId } : {}),
        };
      }),
    focusTimeline: (entryId) =>
      set((s) => ({
        drawer: "timeline",
        trace: null,
        timelineView: "activity",
        timelineFocus: { entryId, nonce: (s.timelineFocus?.nonce ?? 0) + 1 },
      })),
    set: (patch) => set(patch as Partial<UiState>),
    toggle: (key, id) =>
      set((s) => {
        const next = new Set(s[key]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { [key]: next } as Partial<UiState>;
      }),
  }));
}

/** One string per details target, so two targets compare by what they show. */
export function detailsKey(target: DetailsTarget | null | undefined): string {
  if (!target) return "";
  if ("edgeId" in target) return `edge:${target.edgeId}`;
  if ("suggestedKey" in target) return `suggested:${target.suggestedKey}`;
  return `item:${target.itemId}:${target.findingId ?? ""}`;
}

/** What a board edge id stands for: a drawn link, a platform relation, or a stance. */
export type BoardEdgeRef =
  | { kind: "link"; linkId: string }
  | { kind: "system"; systemEdgeId: string }
  | { kind: "stance"; supportId: string };

/** Parse a board edge id (`lnk:`, `sys:`, `st:`); null for anything else. */
export function parseBoardEdgeId(edgeId: string): BoardEdgeRef | null {
  const colon = edgeId.indexOf(":");
  if (colon <= 0) return null;
  const prefix = edgeId.slice(0, colon);
  const id = edgeId.slice(colon + 1);
  if (!id) return null;
  if (prefix === "lnk") return { kind: "link", linkId: id };
  if (prefix === "sys") return { kind: "system", systemEdgeId: id };
  if (prefix === "st") return { kind: "stance", supportId: id };
  return null;
}

export function boardEdgeId(ref: BoardEdgeRef): string {
  if (ref.kind === "link") return `lnk:${ref.linkId}`;
  if (ref.kind === "system") return `sys:${ref.systemEdgeId}`;
  return `st:${ref.supportId}`;
}
