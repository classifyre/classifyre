"use client";

import * as React from "react";
import {
  api,
  type QuickSearchAssetDto,
  type QuickSearchFindingDto,
  type QuickSearchRequestDto,
} from "@workspace/api-client";

const DEBOUNCE_MS = 300;

export interface QuickSearchState {
  assets: QuickSearchAssetDto[];
  findings: QuickSearchFindingDto[];
  loading: boolean;
  /** The server ran out of its time budget; the lists may be short. */
  truncated: boolean;
  error: string | null;
}

const IDLE: QuickSearchState = { assets: [], findings: [], loading: false, truncated: false, error: null };

/**
 * Search as you type against `POST /search/quick`: debounced, and every new
 * keystroke aborts the request before it, so a fast typist never stacks
 * queries on the server. Below two characters it does nothing.
 */
export function useQuickSearch(
  request: Omit<QuickSearchRequestDto, "q"> & { q: string },
  enabled = true,
): QuickSearchState {
  const [state, setState] = React.useState<QuickSearchState>(IDLE);
  const key = JSON.stringify(request);

  React.useEffect(() => {
    const q = request.q.trim();
    if (!enabled || q.length < 2) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      api.assets
        .searchAssetsControllerQuickSearch(
          { quickSearchRequestDto: { ...request, q } as QuickSearchRequestDto },
          { signal: controller.signal },
        )
        .then((res) =>
          setState({ assets: res.assets, findings: res.findings, loading: false, truncated: res.truncated, error: null }),
        )
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ ...IDLE, error: error instanceof Error ? error.message : String(error) });
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // The serialised request is the dependency: a new object each render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
