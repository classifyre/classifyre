/**
 * Finding a notebook execution's answer in a stream that carries other things.
 *
 * Locally the CLI's stdout is clean, but in Kubernetes the only channel back is
 * the pod log: the notebook's own prints, uv's install chatter and Python
 * warnings all arrive on the same stream. So the CLI prefixes its one-line JSON
 * result with a marker, and this looks for that rather than assuming the answer
 * is the last line — which it very often is not.
 */

/** Must match RESULT_PREFIX in apps/cli/src/notebook/protocol.py. */
export const NOTEBOOK_RESULT_PREFIX = '__CLASSIFYRE_NOTEBOOK_RESULT__';

export function parseNotebookResult(
  output: string,
): Record<string, unknown> | null {
  if (!output) return null;

  // Last marked line wins: a retried or restarted container can emit more than
  // one, and the latest is the one that describes how the run actually ended.
  const lines = output.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith(NOTEBOOK_RESULT_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(
        line.slice(NOTEBOOK_RESULT_PREFIX.length),
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // A truncated final line is worth skipping past, not worth failing on.
    }
  }
  return null;
}
