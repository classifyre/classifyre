"use client";

import * as React from "react";
import { api } from "@workspace/api-client";

export type StatsFreshnessState = {
  refreshedAt: Date | null;
  isBuilt: boolean;
  source: "rollup" | "live";
  isRefreshing: boolean;
  /** Queue a rebuild and resolve once the numbers on screen are new. */
  refresh: () => Promise<void>;
};

/** How long to keep polling for a queued rebuild before giving up on it. */
const REFRESH_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Freshness of the shared finding-statistics rollup, plus a way to rebuild it.
 *
 * The overview, the findings charts and the assets charts all read the same
 * pre-aggregated tables, so they share one freshness stamp and one refresh
 * rather than each owning a cache that could disagree with the others. Drop
 * `<StatsFreshness>` into any section backed by it and pass this hook's state.
 *
 * `onRefreshed` lets the caller re-fetch its own data once the rebuild lands;
 * the hook deliberately does not know what any particular section displays.
 */
export function useStatsFreshness(onRefreshed?: () => void): StatsFreshnessState {
  const [refreshedAt, setRefreshedAt] = React.useState<Date | null>(null);
  const [isBuilt, setIsBuilt] = React.useState(true);
  const [source, setSource] = React.useState<"rollup" | "live">("rollup");
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const onRefreshedRef = React.useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;

  const read = React.useCallback(async () => {
    const stats = await api.findings.findingsControllerGetStatsFreshness();
    const at = stats.refreshedAt ? new Date(stats.refreshedAt) : null;
    setRefreshedAt(at);
    setIsBuilt(Boolean(stats.isBuilt));
    setSource(stats.isBuilt ? "rollup" : "live");
    return at;
  }, []);

  React.useEffect(() => {
    let active = true;
    void read().catch(() => {
      // Freshness is decoration around the real content: failing to read it
      // must never blank out the section it labels.
      if (active) setIsBuilt(true);
    });
    return () => {
      active = false;
    };
  }, [read]);

  const refresh = React.useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    const before = refreshedAt?.getTime() ?? 0;
    try {
      await api.findings.findingsControllerRefreshDiscoveryStats();
      // The rebuild is a full pass over every finding and runs on a background
      // worker, so poll for the stamp to move rather than blocking on it.
      const deadline = Date.now() + REFRESH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const at = await read();
        if ((at?.getTime() ?? 0) > before) {
          onRefreshedRef.current?.();
          return;
        }
      }
    } catch (error) {
      console.error("Failed to refresh statistics:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, read, refreshedAt]);

  return { refreshedAt, isBuilt, source, isRefreshing, refresh };
}
