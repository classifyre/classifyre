"use client";

import * as React from "react";
import { api } from "@workspace/api-client";

export type ExecutionStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "ERROR"
  | "CANCELLED"
  | "TIMEOUT";

export interface ExecutionRecord {
  id: string;
  status: ExecutionStatus;
  mode: string;
  targetCellId?: string | null;
  failedCellId?: string | null;
  durationMs?: number | null;
  outputs?: {
    cells?: Array<{
      cellId: string;
      status: string;
      durationMs: number;
      outputs: unknown[];
    }>;
    result?: { status: string; message: string };
    assets?: unknown[];
    contract?: { ok: boolean; violations: unknown[] };
  } | null;
  error?: {
    type?: string;
    message?: string;
    traceback?: string[];
    cellId?: string | null;
  } | null;
}

const POLL_INTERVAL_MS = 900;
const BACKOFF_MS = 3000;

function isTerminal(status: ExecutionStatus): boolean {
  return (
    status === "SUCCESS" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "TIMEOUT"
  );
}

/**
 * Start a notebook execution and watch it to completion.
 *
 * Polling rather than a socket: an execution is a short-lived job with one
 * answer at the end, and the run/finish transition is the only event anyone is
 * waiting for. A recursive timeout rather than an interval, so a slow response
 * cannot stack requests on a struggling API.
 */
export function useNotebookExecution(sourceId: string) {
  const [execution, setExecution] = React.useState<ExecutionRecord | null>(
    null,
  );
  const [starting, setStarting] = React.useState(false);
  const cancelled = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  React.useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  const poll = React.useCallback((executionId: string) => {
    const tick = async () => {
      if (cancelled.current) return;
      try {
        const next = (await api.notebooks.notebookControllerGetExecution({
          executionId,
        })) as unknown as ExecutionRecord;
        if (cancelled.current) return;
        setExecution(next);
        if (isTerminal(next.status)) return;
        timer.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch {
        // A transient failure is not a finished execution: back off and keep
        // watching rather than reporting a result that never arrived.
        if (!cancelled.current) {
          timer.current = setTimeout(tick, BACKOFF_MS);
        }
      }
    };
    timer.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, []);

  const run = React.useCallback(
    async (request: {
      revision: number;
      mode: "cell" | "all" | "test_connection" | "preview_extract";
      targetCellId?: string;
      maxAssets?: number;
    }) => {
      stopPolling();
      setStarting(true);
      try {
        const started = (await api.notebooks.notebookControllerCreateExecution({
          sourceId,
          createNotebookExecutionDto: request as never,
        })) as unknown as ExecutionRecord;
        setExecution(started);
        poll(started.id);
        return started;
      } finally {
        setStarting(false);
      }
    },
    [sourceId, poll, stopPolling],
  );

  const cancel = React.useCallback(async () => {
    if (!execution || isTerminal(execution.status)) return;
    stopPolling();
    await api.notebooks.notebookControllerCancel({ executionId: execution.id });
    setExecution((current) =>
      current ? { ...current, status: "CANCELLED" } : current,
    );
  }, [execution, stopPolling]);

  const clear = React.useCallback(() => {
    stopPolling();
    setExecution(null);
  }, [stopPolling]);

  const busy =
    starting || (execution !== null && !isTerminal(execution.status));

  return { execution, run, cancel, clear, busy, starting };
}

export { isTerminal };
