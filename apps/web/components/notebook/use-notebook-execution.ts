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
    // `warnings` are not contract failures — `ok` stays true — so they are a
    // separate list. The one they exist for is a later cell silently replacing
    // an earlier cell's helper, which leaves a valid notebook that breaks at
    // runtime with no other symptom.
    contract?: { ok: boolean; violations: unknown[]; warnings?: unknown[] };
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

/**
 * Watch one execution to completion, outside React.
 *
 * The hook above owns the editor's live view of a run. This is for callers that
 * simply need the answer — the assistant, which runs the notebook and then has
 * to read what happened before it can react to it.
 */
export async function awaitExecution(
  executionId: string,
  { timeoutMs = 10 * 60 * 1000 }: { timeoutMs?: number } = {},
): Promise<ExecutionRecord | null> {
  const deadline = Date.now() + timeoutMs;
  let record: ExecutionRecord | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      record = (await api.notebooks.notebookControllerGetExecution({
        executionId,
      })) as unknown as ExecutionRecord;
      if (isTerminal(record.status)) return record;
    } catch {
      // Transient. Keep watching until the deadline rather than reporting a
      // result that never arrived.
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS));
    }
  }
  return record;
}

/** Truncate a long value without hiding that it was truncated. */
function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…(truncated)…` : value;
}

/**
 * What a run did, as text an assistant can act on.
 *
 * The traceback matters more than anything else here: it names the cell, the
 * line and the exception, which is exactly what a fix needs and exactly what a
 * "the run failed" summary throws away.
 */
export function summarizeExecution(
  record: ExecutionRecord | null,
): string {
  if (!record) {
    return "The run did not report a result before the client stopped waiting.";
  }

  const lines: string[] = [
    `Execution ${record.status} (mode: ${record.mode}${
      record.targetCellId ? `, cell: ${record.targetCellId}` : ""
    })`,
  ];

  const contract = record.outputs?.contract;
  if (contract && !contract.ok) {
    lines.push(
      `Contract violations: ${clip(JSON.stringify(contract.violations), 600)}`,
    );
  }

  if (record.error) {
    lines.push(
      `Failed in cell "${record.error.cellId ?? record.failedCellId ?? "?"}"`,
      `${record.error.type ?? "Error"}: ${record.error.message ?? ""}`,
    );
    if (record.error.traceback?.length) {
      lines.push("Traceback:", clip(record.error.traceback.join("\n"), 2500));
    }
  }

  const stdout = (record.outputs?.cells ?? [])
    .flatMap((cell) =>
      (cell.outputs ?? []).map((output) => {
        const entry = (output ?? {}) as Record<string, unknown>;
        if (typeof entry.text === "string") return entry.text;
        const data = entry.data as Record<string, unknown> | undefined;
        if (data && typeof data["text/plain"] === "string") {
          return data["text/plain"];
        }
        return "";
      }),
    )
    .filter(Boolean)
    .join("\n");
  if (stdout) {
    lines.push("Cell output:", clip(stdout, 2500));
  }

  const verdict = record.outputs?.result;
  if (verdict) {
    lines.push(`test_connection: ${verdict.status} — ${verdict.message}`);
  }

  const assets = record.outputs?.assets;
  if (Array.isArray(assets)) {
    lines.push(
      `extract() produced ${assets.length} asset(s).`,
      assets.length > 0 ? clip(JSON.stringify(assets.slice(0, 3)), 1200) : "",
    );
  }

  return lines.filter(Boolean).join("\n");
}
