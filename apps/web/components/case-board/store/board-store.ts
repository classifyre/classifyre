import { createStore, type StoreApi } from "zustand/vanilla";
import {
  api,
  getActorName,
  type ApplyBoardOpsResponseDto,
  type BoardTraceResponseDto,
  type CaseBoardResponseDto,
  type GraphResponseDto,
} from "@workspace/api-client";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { buildDomain, emptyDomain, mergeNeighbourGraph } from "./domain";
import { mergeTraceNeighbourhood } from "./trace";
import { applyAll, type BoardOp, type LocalContext } from "./ops";
import type { Command } from "./commands";
import { advanceClaims, recordOwnWrite, type OwnWrites } from "./claims";
import { createPersistence, type Persistence } from "./persistence";
import type { BoardDomain, ItemPreview } from "./types";

const UNDO_LIMIT = 100;
/** Coalesce refetch requests (socket pushes, focus, stale batches). */
const REFETCH_DEBOUNCE_MS = 250;

export type SaveState = "idle" | "saving" | "error";

export interface BoardNotice {
  kind: "rejected" | "error";
  message: string;
  at: number;
}

export interface BoardState extends BoardDomain {
  caseId: string;
  version: number;
  readOnly: boolean;
  caseStatus: string;
  loaded: boolean;
  loadError: string | null;
  saveState: SaveState;
  undoStack: Command[];
  redoStack: Command[];
  previews: Map<string, ItemPreview>;
  /** Other people with this board open (presence-lite, PRD §5.12). */
  presence: string[];
  notice: BoardNotice | null;
  clientId: string;

  load(): Promise<void>;
  hydrate(res: CaseBoardResponseDto): void;
  /** Apply a user intent: optimistic local apply → queue → undo stack. */
  run(cmd: Command): void;
  undo(): void;
  redo(): void;
  refetch(): void;
  setPresence(names: string[]): void;
  /** Add one bubble's live neighbourhood as suggested ghosts (Show neighbours). */
  mergeNeighbours(itemId: string, graph: GraphResponseDto): number;
  /** Neighbours beyond the first hop (a walk from every piece of evidence); null drops them. */
  setNeighbourhood(result: BoardTraceResponseDto | null): void;
  dismissNotice(): void;
  flush(): Promise<void>;
  /**
   * Start sending edits while the board is mounted; the returned function
   * stops. Call it from an effect, not at creation: StrictMode and Fast
   * Refresh remount the same store.
   */
  connect(): () => void;
}

export type BoardStore = StoreApi<BoardState>;

function localContext(previews: ReadonlyMap<string, ItemPreview>): LocalContext {
  return { actor: getActorName() ?? null, previews, now: new Date().toISOString() };
}

function domainOf(s: BoardState): BoardDomain {
  return {
    items: s.items,
    links: s.links,
    bubbles: s.bubbles,
    threads: s.threads,
    supports: s.supports,
    systemEdges: s.systemEdges,
    suggested: s.suggested,
    itemByAsset: s.itemByAsset,
    itemByFinding: s.itemByFinding,
    graveyard: s.graveyard,
    truncated: s.truncated,
  };
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

export function createBoardStore(
  caseId: string,
  opts: {
    /**
     * A demo instance refuses every write, so the board opens read-only there.
     * Without this, placing the first open's unplaced items is refused, the
     * batch dropped, the board read again and the items placed again, forever.
     */
    demo?: boolean;
  } = {},
): BoardStore {
  const demo = opts.demo ?? false;
  let persistence: Persistence;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  let loading: Promise<void> | null = null;
  // A refetch asked for while a read is in flight: that read may predate what
  // asked, so another follows it.
  let reloadAfterLoad = false;
  // Batches the server applied, counted so a read that raced one is not
  // hydrated: it could predate the batch and undo it on screen.
  let writes = 0;
  const ownWrites: OwnWrites = new Map();
  // "Show neighbours" results, re-applied after every refetch until reload.
  const neighbourGraphs = new Map<string, GraphResponseDto>();
  // The multi-hop neighbourhood, and the board's edges and suggestions
  // without it, so a new walk (or none) replaces the last one cleanly.
  let neighbourhood: BoardTraceResponseDto | null = null;
  let beforeNeighbourhood: Pick<BoardDomain, "systemEdges" | "suggested"> | null = null;

  const store = createStore<BoardState>()((set, get) => {
    const applyCommandOps = (commandOps: BoardOp[], previews?: Record<string, ItemPreview>) => {
      // Undo and redo replay ops built earlier: their text-edit claims move
      // forward over what this board itself wrote since.
      const ops = advanceClaims(commandOps, ownWrites);
      const state = get();
      const nextPreviews = previews
        ? new Map([...state.previews, ...Object.entries(previews)])
        : state.previews;
      const { domain, exact } = applyAll(domainOf(state), ops, localContext(nextPreviews));
      set({ ...domain, previews: nextPreviews });
      persistence.enqueue(ops, exact);
    };

    persistence = createPersistence(caseId, {
      getVersion: () => get().version,
      onSaving: (saving) =>
        set((s) => ({ saveState: saving ? "saving" : s.saveState === "error" ? "error" : "idle" })),
      onApplied: (res: ApplyBoardOpsResponseDto, sent: BoardOp[]) => {
        const s = get();
        if (res.applied.length > 0) writes += 1;
        // Each applied write moved its row on to a new stamp. Claims made on
        // the stamp before it (a redo, the next edit of a note just created or
        // moved) may follow that step, since the board made it itself: from
        // the version it had on screen, and from what a checked edit claimed.
        const sentById = new Map(sent.map((op) => [op.opId, op]));
        for (const a of res.applied) {
          if (!a.id || !a.updatedAt) continue;
          const onScreen = s.items.get(a.id)?.updatedAt ?? s.links.get(a.id)?.updatedAt;
          if (onScreen) recordOwnWrite(ownWrites, a.id, onScreen, a.updatedAt);
          const op = sentById.get(a.opId);
          if ((op?.type === "item.update" || op?.type === "link.update") && op.expectedUpdatedAt && op.id === a.id) {
            recordOwnWrite(ownWrites, a.id, op.expectedUpdatedAt, a.updatedAt);
          }
        }
        persistence.rebase((queued) => advanceClaims(queued, ownWrites));
        // Keep updatedAt current so the next text edit claims the right version.
        let items = s.items;
        let links = s.links;
        for (const a of res.applied) {
          if (!a.id || !a.updatedAt) continue;
          const stamp = a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt);
          const item = items.get(a.id);
          if (item) {
            if (items === s.items) items = new Map(items);
            items.set(a.id, { ...item, updatedAt: stamp, pending: false });
            continue;
          }
          const link = links.get(a.id);
          if (link) {
            if (links === s.links) links = new Map(links);
            links.set(a.id, { ...link, updatedAt: stamp });
          }
        }
        set({ items, links, version: Math.max(s.version, res.version), saveState: "idle" });
      },
      onRejected: (res) => {
        const first = res.rejected[0];
        set({
          notice: first
            ? { kind: "rejected", message: first.reason, at: Date.now() }
            : null,
        });
        get().refetch();
      },
      onDropped: (error) => {
        void extractApiErrorMessage(error, "The server refused these changes").then((message) =>
          set({ notice: { kind: "rejected", message, at: Date.now() } }),
        );
        get().refetch();
      },
      onError: (error) => {
        set({
          saveState: "error",
          notice: { kind: "error", message: describe(error), at: Date.now() },
        });
      },
      onNeedsRefetch: () => get().refetch(),
    });

    return {
      caseId,
      version: 0,
      readOnly: demo,
      caseStatus: "OPEN",
      loaded: false,
      loadError: null,
      saveState: "idle",
      undoStack: [],
      redoStack: [],
      previews: new Map(),
      presence: [],
      notice: null,
      clientId: persistence.clientId,
      ...emptyDomain(),

      async load() {
        if (loading) return loading;
        loading = (async () => {
          const seen = writes;
          try {
            const res = await api.caseBoard.caseBoardControllerGet({ id: caseId });
            // A batch landed while this read was in flight; the read may not
            // have seen it, and its ops are no longer pending to be replayed.
            // Read again rather than put the board back as it was.
            if (writes !== seen && get().loaded) reloadAfterLoad = true;
            else get().hydrate(res);
          } catch (error) {
            set({ loadError: describe(error), loaded: true });
          } finally {
            loading = null;
            if (reloadAfterLoad) {
              reloadAfterLoad = false;
              get().refetch();
            }
          }
        })();
        return loading;
      },

      hydrate(res) {
        const state = get();
        // Fresh server state, with our own unconfirmed ops replayed on top.
        const base = buildDomain(res, state.previews);
        // Keep the local graveyard: an undo right after a refetch still works.
        base.graveyard = {
          items: new Map([...state.graveyard.items].filter(([id]) => !base.items.has(id))),
          links: new Map([...state.graveyard.links].filter(([id]) => !base.links.has(id))),
        };
        let withNeighbours = base;
        for (const [itemId, graph] of neighbourGraphs) {
          if (base.items.has(itemId)) withNeighbours = mergeNeighbourGraph(withNeighbours, itemId, graph);
        }
        beforeNeighbourhood = { systemEdges: withNeighbours.systemEdges, suggested: withNeighbours.suggested };
        if (neighbourhood) withNeighbours = mergeTraceNeighbourhood(withNeighbours, neighbourhood);
        const pending = persistence.pending();
        const { domain } = applyAll(withNeighbours, pending, localContext(state.previews));
        // Previews are only needed until the server describes the row.
        const previews = new Map(
          [...state.previews].filter(([id]) => !res.items.some((i) => i.id === id && i.refId)),
        );
        set({
          ...domain,
          previews,
          version: Math.max(state.version, res.board.version),
          readOnly: res.board.readOnly || demo,
          caseStatus: res.board.caseStatus,
          loaded: true,
          loadError: null,
        });
      },

      run(cmd) {
        if (get().readOnly || cmd.forward.length === 0) return;
        applyCommandOps(cmd.forward, cmd.previews);
        if (cmd.undoable === false) return;
        set((s) => ({ undoStack: [...s.undoStack, cmd].slice(-UNDO_LIMIT), redoStack: [] }));
      },

      undo() {
        const cmd = get().undoStack.at(-1);
        if (!cmd || get().readOnly) return;
        applyCommandOps(cmd.inverse, cmd.previews);
        set((s) => ({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, cmd] }));
      },

      redo() {
        const cmd = get().redoStack.at(-1);
        if (!cmd || get().readOnly) return;
        applyCommandOps(cmd.forward, cmd.previews);
        set((s) => ({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, cmd] }));
      },

      refetch() {
        if (refetchTimer) return;
        refetchTimer = setTimeout(() => {
          refetchTimer = null;
          if (loading) reloadAfterLoad = true;
          else void get().load();
        }, REFETCH_DEBOUNCE_MS);
      },

      setPresence(names) {
        set({ presence: names });
      },


      mergeNeighbours(itemId, graph) {
        neighbourGraphs.set(itemId, graph);
        const before = get().suggested.size;
        const domain = mergeNeighbourGraph(domainOf(get()), itemId, graph);
        if (beforeNeighbourhood) {
          const plain = mergeNeighbourGraph({ ...domainOf(get()), ...beforeNeighbourhood }, itemId, graph);
          beforeNeighbourhood = { systemEdges: plain.systemEdges, suggested: plain.suggested };
        }
        set({ systemEdges: domain.systemEdges, suggested: domain.suggested });
        return get().suggested.size - before;
      },

      setNeighbourhood(result) {
        neighbourhood = result;
        const plain = { ...domainOf(get()), ...(beforeNeighbourhood ?? {}) };
        const domain = result ? mergeTraceNeighbourhood(plain, result) : plain;
        set({ systemEdges: domain.systemEdges, suggested: domain.suggested });
      },

      dismissNotice() {
        set({ notice: null });
      },

      flush() {
        return persistence.flushNow();
      },

      connect() {
        persistence.start();
        return () => {
          if (refetchTimer) {
            clearTimeout(refetchTimer);
            refetchTimer = null;
          }
          persistence.stop();
        };
      },
    };
  });
  return store;
}
