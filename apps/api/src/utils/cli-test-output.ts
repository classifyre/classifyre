/**
 * Reads a connection test's result out of a CLI job's combined output.
 *
 * The CLI prints the result as an indented, multi-line JSON document among
 * ordinary log lines. The Kubernetes path used to `JSON.parse` each line on its
 * own, so no line of that document ever parsed: a successful test showed the
 * generic "Connection test completed." and a failing one showed log fragments
 * instead of the connector's own error (GENESIS field report P3).
 *
 * This finds every complete top-level JSON object, single- or multi-line, and
 * returns the last one that carries a `status` — the result — plus the lines
 * that were not part of any object, for a failure message.
 */
export interface ParsedCliTestOutput {
  result: Record<string, unknown> | null;
  otherLines: string[];
}

export function parseCliTestOutput(output: string): ParsedCliTestOutput {
  const lines = output.split(/\r?\n/);
  let result: Record<string, unknown> | null = null;
  let fallback: Record<string, unknown> | null = null;
  const otherLines: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('{')) {
      const end = findObjectEnd(lines, i);
      if (end !== null) {
        const { value, last } = end;
        if ('status' in value) {
          result = value;
        } else {
          fallback = value;
        }
        i = last + 1;
        continue;
      }
    }
    otherLines.push(trimmed);
    i += 1;
  }

  return { result: result ?? fallback, otherLines };
}

/** The shortest run of lines from `start` that parses as one JSON object. */
function findObjectEnd(
  lines: string[],
  start: number,
): { value: Record<string, unknown>; last: number } | null {
  for (let j = start; j < lines.length; j += 1) {
    if (!lines[j].trimEnd().endsWith('}')) continue;
    try {
      const parsed: unknown = JSON.parse(lines.slice(start, j + 1).join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { value: parsed as Record<string, unknown>, last: j };
      }
      return null;
    } catch {
      // Not complete yet (a nested object closed on this line); keep going.
    }
  }
  return null;
}
