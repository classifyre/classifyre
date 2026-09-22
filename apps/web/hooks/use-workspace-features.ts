"use client";

import * as React from "react";
import {
  api,
  type WorkspaceFeatureKey,
  type WorkspaceFeatureState,
} from "@workspace/api-client";
import { useOptionalNamespace } from "@/components/namespace-provider";

/**
 * The workspace's feature switches (Settings → Cleanup › Features), shared by
 * every component that has to say "this is off".
 *
 * One fetch per workspace, cached at module level and handed to every caller
 * through `useSyncExternalStore`, because the consumers are scattered — the
 * duplicates page, finding details, search, the Workers tab — and each would
 * otherwise ask the API the same question. Anything that changes a switch or
 * wipes a feature's data calls {@link refreshWorkspaceFeatures}, so the banners
 * elsewhere catch up without a reload.
 */

interface Entry {
  features: WorkspaceFeatureState[] | null;
  failed: boolean;
  fetchedAt: number;
}

/** Re-fetch on mount when the cached answer is older than this. */
const STALE_MS = 30_000;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function load(slug: string): Promise<void> {
  const running = inflight.get(slug);
  if (running) return running;
  const promise = (async () => {
    try {
      const { features } = await api.maintenance.features();
      entries.set(slug, { features, failed: false, fetchedAt: Date.now() });
    } catch {
      // A failed read must not raise false "off" banners: keep what we had.
      const previous = entries.get(slug);
      entries.set(slug, {
        features: previous?.features ?? null,
        failed: true,
        fetchedAt: Date.now(),
      });
    } finally {
      inflight.delete(slug);
      emit();
    }
  })();
  inflight.set(slug, promise);
  return promise;
}

/**
 * Re-read the switches of every workspace a component is showing. Call after
 * turning a feature on or off, or after its data was wiped.
 */
export async function refreshWorkspaceFeatures(): Promise<void> {
  const slugs = [...entries.keys()];
  await Promise.all(slugs.map((slug) => load(slug)));
}

export interface WorkspaceFeaturesView {
  /** Null until the first answer arrives. */
  features: WorkspaceFeatureState[] | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
  feature: (key: WorkspaceFeatureKey) => WorkspaceFeatureState | undefined;
  /**
   * True only when the feature is KNOWN to be off. While loading, or when the
   * read failed, this is false: a banner that flashes "off" on every page load
   * would teach people to ignore it.
   */
  isOff: (key: WorkspaceFeatureKey) => boolean;
}

export function useWorkspaceFeatures(): WorkspaceFeaturesView {
  const slug = useOptionalNamespace()?.slug ?? "";
  const entry = React.useSyncExternalStore(
    subscribe,
    () => (slug ? entries.get(slug) : undefined),
    () => undefined,
  );

  React.useEffect(() => {
    if (!slug) return;
    const cached = entries.get(slug);
    if (!cached || Date.now() - cached.fetchedAt > STALE_MS) void load(slug);
  }, [slug]);

  const features = entry?.features ?? null;
  const refresh = React.useCallback(
    () => (slug ? load(slug) : Promise.resolve()),
    [slug],
  );
  const feature = React.useCallback(
    (key: WorkspaceFeatureKey) => features?.find((f) => f.key === key),
    [features],
  );
  const isOff = React.useCallback(
    (key: WorkspaceFeatureKey) => feature(key)?.enabled === false,
    [feature],
  );

  return {
    features,
    loading: Boolean(slug) && !entry,
    failed: entry?.failed ?? false,
    refresh,
    feature,
    isOff,
  };
}
