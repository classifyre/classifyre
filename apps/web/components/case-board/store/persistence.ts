import { api, ResponseError, type ApplyBoardOpsResponseDto } from "@workspace/api-client";
import { BOARD_MAX_OPS_PER_BATCH } from "@workspace/schemas/case-board";
import { coalesce, type BoardOp } from "./ops";

/** Debounce: a drag storm or a burst of typing becomes one request. */
const FLUSH_MS = 600;
const RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;
/** Once the board has unmounted, a failing batch gets this many more tries. */
const RETRIES_AFTER_STOP = 3;

export interface PersistenceHooks {
  getVersion: () => number;
  onSaving: (saving: boolean) => void;
  onApplied: (res: ApplyBoardOpsResponseDto, sent: BoardOp[]) => void;
  /** Some ops were refused; the board refetches to drop them. */
  onRejected: (res: ApplyBoardOpsResponseDto) => void;
  /** The server refused the whole batch (a 4xx): it is dropped, not retried. */
  onDropped: (error: unknown, batch: BoardOp[]) => void;
  /** The request failed outright; it will be retried. */
  onError: (error: unknown) => void;
  /** Someone else wrote meanwhile, or an op's effect needs the server's answer. */
  onNeedsRefetch: () => void;
}

export interface Persistence {
  clientId: string;
  enqueue(ops: BoardOp[], exact: boolean): void;
  /** Ops not yet confirmed by the server: queued and in flight. */
  pending(): BoardOp[];
  /** Rewrite the queued (not yet sent) ops, e.g. to move their claims forward. */
  rebase(rewrite: (queued: BoardOp[]) => BoardOp[]): void;
  flushNow(): Promise<void>;
  /**
   * The board mounted: start sending. Mounting is not creation. StrictMode
   * and Fast Refresh unmount and remount the same store, so start and stop
   * pair up any number of times.
   */
  start(): void;
  /** The board unmounted: send what is queued now, since the page is still alive. */
  stop(): void;
}

/** A 4xx other than a timeout or rate limit fails the same way on every resend. */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof ResponseError)) return false;
  const status = error.response.status;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * The single write path from the browser (PRD §8.4): ops are queued, coalesced
 * and sent to `POST /cases/:id/board/ops` in strictly serial batches. A failed
 * request is re-queued at the front and retried; a batch the server applied
 * but whose response was lost is harmless to resend because every op is
 * idempotent.
 */
export function createPersistence(caseId: string, hooks: PersistenceHooks): Persistence {
  let queue: BoardOp[] = [];
  let inFlight: BoardOp[] = [];
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refetchAfter = false;
  let active = false;
  let failures = 0;
  const clientId = crypto.randomUUID();

  const schedule = (ms = FLUSH_MS) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
  };

  const flush = async (): Promise<void> => {
    if (running) {
      await running;
      if (queue.length > 0) return flush();
      return;
    }
    if (queue.length === 0) return;
    const batch = coalesce(queue.splice(0, BOARD_MAX_OPS_PER_BATCH));
    inFlight = batch;
    const needsRefetch = refetchAfter;
    refetchAfter = false;
    hooks.onSaving(true);
    running = (async () => {
      try {
        const res = await api.caseBoard.caseBoardControllerApplyOps({
          id: caseId,
          applyBoardOpsDto: { clientId, baseVersion: hooks.getVersion(), ops: batch },
        });
        failures = 0;
        inFlight = [];
        hooks.onApplied(res, batch);
        if (res.rejected.length > 0) hooks.onRejected(res);
        else if (res.stale || needsRefetch) hooks.onNeedsRefetch();
      } catch (error) {
        inFlight = [];
        running = null;
        hooks.onSaving(false);
        if (isPermanent(error)) {
          // Resending cannot help: drop the batch and let a refetch resync the board.
          hooks.onDropped(error, batch);
          if (queue.length > 0) schedule(0);
          return;
        }
        // Put the batch back in front of anything queued meanwhile.
        queue = [...batch, ...queue];
        refetchAfter = refetchAfter || needsRefetch;
        failures += 1;
        hooks.onError(error);
        if (active || failures <= RETRIES_AFTER_STOP) {
          schedule(Math.min(RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS));
        }
        return;
      }
      running = null;
      if (queue.length > 0) schedule(0);
      else hooks.onSaving(false);
    })();
    await running;
  };

  // A tab closing with unsaved changes gets one last chance to send them.
  const onPageHide = () => {
    if (queue.length === 0) return;
    const batch = coalesce(queue.splice(0, BOARD_MAX_OPS_PER_BATCH));
    void api.caseBoard
      .caseBoardControllerApplyOps(
        {
          id: caseId,
          applyBoardOpsDto: { clientId, baseVersion: hooks.getVersion(), ops: batch },
        },
        { keepalive: true },
      )
      .catch(() => undefined);
  };
  // Back from the back/forward cache: that last batch's answer never arrived.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) hooks.onNeedsRefetch();
  };

  return {
    clientId,
    enqueue(ops, exact) {
      if (ops.length === 0) return;
      queue.push(...ops);
      if (!exact) refetchAfter = true;
      if (active) schedule();
    },
    pending: () => [...inFlight, ...queue],
    rebase(rewrite) {
      if (queue.length > 0) queue = rewrite(queue);
    },
    async flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
    start() {
      if (active) return;
      active = true;
      failures = 0;
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", onPageHide);
        window.addEventListener("pageshow", onPageShow);
      }
      if (queue.length > 0) schedule(0);
    },
    stop() {
      if (!active) return;
      active = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Unmounting is not unloading: an ordinary request still completes.
      void flush();
    },
  };
}
