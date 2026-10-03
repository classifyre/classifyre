/**
 * Workspace feature switches (Settings → Cleanup › Features).
 *
 * A feature here is a background subsystem that produces derived data at a
 * real storage and CPU cost, and that a workspace may turn off without losing
 * its investigation: findings, assets, sources, cases, inquiries and the
 * glossary are never touched by a switch.
 *
 * Duplicates and entities share one piece of derived data, the value index
 * (`asset_correlation_values`): it is kept up to date while either is on, and
 * deleted only when a feature is switched off with its data and the other is
 * off too (G5 R9).
 *
 * The key doubles as the `feature` marker on `public.worker_queue_pauses`: a
 * switched-off feature holds its queues paused there, which is what makes every
 * worker replica stop and what the Workers tab shows.
 */
export type WorkspaceFeatureKey = 'embeddings' | 'duplicates' | 'entities';

export const WORKSPACE_FEATURE_KEYS: readonly WorkspaceFeatureKey[] = [
  'embeddings',
  'duplicates',
  'entities',
];

export function isWorkspaceFeatureKey(
  value: string,
): value is WorkspaceFeatureKey {
  return (WORKSPACE_FEATURE_KEYS as readonly string[]).includes(value);
}

/** How a switched-off feature left its data. Null while the feature is on. */
export type FeatureDisabledMode = 'kept' | 'deleted';

/** Operator-facing names, used in API messages (the UI translates its own). */
export const WORKSPACE_FEATURE_LABELS: Record<WorkspaceFeatureKey, string> = {
  embeddings: 'Embeddings',
  duplicates: 'Duplicate detection',
  entities: 'Entities',
};

/** Where the switch lives, for messages that tell an API caller what to do. */
export const WORKSPACE_FEATURES_LOCATION = 'Settings → Cleanup › Features';

/** Message for anything refused because a feature is off. */
export function featureOffMessage(feature: WorkspaceFeatureKey): string {
  return (
    `${WORKSPACE_FEATURE_LABELS[feature]} is turned off for this workspace. ` +
    `Turn it on in ${WORKSPACE_FEATURES_LOCATION}.`
  );
}
