import { createStore, type StoreApi } from "zustand/vanilla";
import type { BoardEndpoint } from "@workspace/schemas/case-board";

/**
 * Per-viewer UI state: the active tool, open drawers, the View popover's
 * choices. None of it is board data, so none of it is persisted on the board
 * (PRD §5.10); the View choices are kept in localStorage.
 */

export type Tool = "select" | "hand" | "note" | "frame" | "hypothesis" | "comment" | "link";

export type SuggestedMode = "auto" | "show" | "hide";

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
  | "snapshots";

/** A kind of board object the top bar's counters can spotlight. */
export type Spotlight = "evidence" | "findings" | "hypotheses";

/** What the details panel shows: an item (optionally one finding), or a suggested neighbour. */
export type DetailsTarget = { itemId: string; findingId?: string | null } | { suggestedKey: string };

export interface ViewPrefs {
  suggested: SuggestedMode;
  /** Findings: off dims rather than hides (evidence preservation). */
  showResolved: boolean;
  showDismissed: boolean;
  showGone: boolean;
  /** System link classes drawn. */
  lineage: boolean;
  duplicates: boolean;
  references: boolean;
  onlyHighlighted: boolean;
  showResolvedComments: boolean;
  minimap: boolean;
  highlightSource: string | null;
  highlightDetector: string | null;
  highlightHypothesis: string | null;
}

export const DEFAULT_VIEW: ViewPrefs = {
  suggested: "auto",
  showResolved: true,
  showDismissed: true,
  showGone: true,
  lineage: true,
  duplicates: true,
  references: true,
  onlyHighlighted: false,
  showResolvedComments: true,
  minimap: false,
  highlightSource: null,
  highlightDetector: null,
  highlightHypothesis: null,
};

/** Past this many suggestions, "auto" hides them (D5). */
export const SUGGESTED_AUTO_LIMIT = 30;

export interface PendingLink {
  source: BoardEndpoint;
  target: BoardEndpoint;
  /** Screen position of the drop, where the popover opens. */
  screen: { x: number; y: number };
  /** Either end is a hypothesis: the popover offers stances. */
  stance: boolean;
}

export interface PathState {
  from: string;
  to: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  hops: number;
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
  /** Item/finding shown in the details drawer. */
  detailsTarget: DetailsTarget | null;
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
  path: PathState | null;
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
  /** "Find path to…" was chosen: the next item clicked ends the path. */
  pathFrom: string | null;
  /**
   * Where an item added outside the board (an accepted lead dropped on the
   * canvas) should appear, keyed `asset:<id>` or `finding:<id>`.
   */
  placementHints: Map<string, { x: number; y: number }>;

  setTool(tool: Tool): void;
  setView(patch: Partial<ViewPrefs>): void;
  openDrawer(kind: DrawerKind | null, opts?: { threadId?: string | null; details?: UiState["detailsTarget"] }): void;
  set(patch: Partial<Omit<UiState, `set${string}` | "openDrawer" | "toggle">>): void;
  toggle(key: "showAllRows" | "expandedUnattached" | "hiddenSuggestions", id: string): void;
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
    const parsed = JSON.parse(raw) as Partial<ViewPrefs>;
    return { ...DEFAULT_VIEW, ...parsed };
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
    panelWidth: typeof window === "undefined" ? DEFAULT_PANEL_WIDTH : readPanelWidth(),
    addEvidenceQuery: "",
    paletteOpen: false,
    cheatSheetOpen: false,
    pendingLink: null,
    composer: null,
    focusHypothesisItemId: null,
    spotlight: null,
    focusLock: false,
    path: null,
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
    pathFrom: null,
    placementHints: new Map(),

    setTool: (tool) => set({ tool, pendingLink: null }),
    setView: (patch) =>
      set((s) => {
        const view = { ...s.view, ...patch };
        writeView(view);
        return { view };
      }),
    openDrawer: (kind, opts) =>
      set({
        drawer: kind,
        ...(opts?.threadId !== undefined ? { drawerThreadId: opts.threadId } : {}),
        ...(opts?.details !== undefined ? { detailsTarget: opts.details } : {}),
      }),
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
