/**
 * Extracts a JSON value from a raw model response string.
 * Handles:
 *  - bare JSON
 *  - ```json ... ``` or ``` ... ``` fenced code blocks
 *  - mixed prose containing a single top-level JSON object/array
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // 1. Direct parse first (cheapest)
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // 2. Strip fenced code blocks: ```json\n...\n``` or ```\n...\n```
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced !== undefined) return fenced;
  }

  // 3. Find first { ... } or [ ... ] span
  const objStart = trimmed.indexOf('{');
  const arrStart = trimmed.indexOf('[');
  const start =
    objStart === -1
      ? arrStart
      : arrStart === -1
        ? objStart
        : Math.min(objStart, arrStart);

  if (start !== -1) {
    const closingChar = trimmed[start] === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(closingChar);
    if (end > start) {
      const slice = tryParse(trimmed.slice(start, end + 1));
      if (slice !== undefined) return slice;
    }
  }

  throw new SyntaxError(
    `Unable to extract JSON from response: ${trimmed.slice(0, 120)}`,
  );
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
