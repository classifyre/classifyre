/**
 * "Workspace storage changed" — a feature was switched off with its data
 * deleted, or a dataset was wiped — so the other storage views on the page
 * re-measure instead of showing sizes from before.
 *
 * A module-level signal rather than lifted state: the cards that care (the
 * feature switches and the dataset tables on the Cleanup tab) are siblings
 * that each own their fetch, and neither should have to know the other exists.
 */
const listeners = new Set<() => void>();

export function onStorageChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitStorageChanged(): void {
  for (const listener of [...listeners]) listener();
}
