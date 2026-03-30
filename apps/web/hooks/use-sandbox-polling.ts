"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SandboxRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "ERROR";
export type AssetContentType =
  | "TXT"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "URL"
  | "TABLE"
  | "BINARY"
  | "OTHER";

export interface SandboxFinding {
  finding_type: string;
  category: string;
  severity: string;
  confidence: number;
  matched_content: string;
  detector_type?: string;
  custom_detector_id?: string;
  custom_detector_key?: string;
  custom_detector_name?: string;
  location?: unknown;
}

export interface SandboxRun {
  id: string;
  createdAt: string;
  fileName: string;
  fileType: string;
  contentType: AssetContentType;
  fileExtension: string;
  fileSizeBytes: number;
  detectors: unknown;
  findings: SandboxFinding[];
  status: SandboxRunStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}

const getApiBase = () => process.env.NEXT_PUBLIC_API_URL || "/api";

async function fetchRuns(
  skip = 0,
  limit = 50,
): Promise<{ items: SandboxRun[]; total: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}/sandbox/runs?skip=${skip}&limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch sandbox runs: ${res.status}`);
  return res.json() as Promise<{ items: SandboxRun[]; total: number }>;
}

async function deleteRunRequest(id: string): Promise<void> {
  const base = getApiBase();
  const res = await fetch(`${base}/sandbox/runs/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404)
    throw new Error(`Failed to delete sandbox run: ${res.status}`);
}

const POLL_INTERVAL_MS = 2500;

export function useSandboxPolling() {
  const [runs, setRuns] = useState<SandboxRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const hasActiveRuns = runs.some(
    (r) => r.status === "PENDING" || r.status === "RUNNING",
  );

  // Initial full load
  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchRuns(0, 100);
      if (!mountedRef.current) return;
      setRuns(data.items);
    } catch {
      // silently ignore
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // Poll the run list while active work exists so newly created runs are discovered.
  const pollActive = useCallback(async () => {
    try {
      const data = await fetchRuns(0, 100);
      if (!mountedRef.current) return;
      setRuns(data.items);
    } catch {
      // silently ignore
    }
  }, []);

  // Manage polling interval based on whether there are active runs
  useEffect(() => {
    if (hasActiveRuns) {
      setIsPolling(true);
      intervalRef.current = setInterval(
        () => void pollActive(),
        POLL_INTERVAL_MS,
      );
    } else {
      setIsPolling(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasActiveRuns, pollActive]);

  useEffect(() => {
    mountedRef.current = true;
    void loadAll();
    return () => {
      mountedRef.current = false;
    };
  }, [loadAll]);

  const addRun = useCallback((run: SandboxRun) => {
    setRuns((prev) => [run, ...prev]);
  }, []);

  const deleteRun = useCallback(async (id: string) => {
    await deleteRunRequest(id);
    if (!mountedRef.current) return;
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const refresh = useCallback(() => void loadAll(), [loadAll]);

  return { runs, isLoading, isPolling, addRun, deleteRun, refresh };
}
