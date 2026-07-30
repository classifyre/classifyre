"use client";

import * as React from "react";

import {
  getTransferJob,
  isTerminal,
  type TransferJob,
} from "@/lib/data-transfer-api";

/** How often a running transfer is polled. */
const POLL_INTERVAL_MS = 1200;

/**
 * Polls one transfer job until it reaches a terminal state.
 *
 * Polling rather than the websocket: a transfer is a rare, operator-initiated
 * action watched by whoever started it, and the job row already carries the
 * whole progress snapshot. Adding a gateway and a room for it would be more
 * moving parts than the feature earns. Polling stops the moment the job
 * finishes, so an idle Data tab makes no requests at all.
 */
export function useTransferJob(
  jobId: string | null,
  apiBase?: string,
): {
  job: TransferJob | null;
  error: string | null;
  refresh: () => void;
} {
  const [job, setJob] = React.useState<TransferJob | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const next = await getTransferJob(jobId, apiBase);
        if (cancelled) return;
        setJob(next);
        setError(null);
        if (!isTerminal(next.status)) {
          timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      } catch (pollError) {
        if (cancelled) return;
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Could not read transfer progress",
        );
        // Keep polling through a transient failure — an API pod restarting
        // mid-transfer should not freeze the progress display permanently.
        timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS * 3);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId, apiBase, nonce]);

  return { job, error, refresh };
}
