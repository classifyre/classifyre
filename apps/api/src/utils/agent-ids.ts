/**
 * Identifier validation for agent-supplied tool input.
 *
 * Every id an agent passes should have come from a previous tool result. When
 * one is composed instead, the resulting error is usually "not found" — which
 * reads to the model as "that row does not exist", so it tries a different
 * plausible id rather than stopping. Observed on a live instance:
 *
 *   cases.link_support  threadId "e9a5610357-4199-93cd-658b1bf0e536"   4 attempts
 *   cases.add_note      caseId   "e19fe273-cfe-481a-ac25-139f94fceb5a" 1 attempt
 *
 * Neither is a UUID — the first is 10-4-4-12, the second 8-3-4-4-12. Saying so
 * turns an unbounded guessing loop into one corrective step.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The 8-4-4-4-12 group shape of the supplied value, for the error message. */
function describeShape(value: string): string {
  return value
    .split('-')
    .map((group) => group.length)
    .join('-');
}

/**
 * Assert that `value` is a UUID, or throw a message that tells the agent what
 * was wrong and where a real id comes from.
 *
 * Deliberately distinct from "not found": a malformed id is a mistake the agent
 * can fix by re-reading, whereas a well-formed id that does not resolve may
 * simply have been deleted.
 */
export function assertUuid(
  value: unknown,
  field: string,
  hint?: string,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `${field} is required and must be a UUID string.` +
        (hint ? ` ${hint}` : ''),
    );
  }
  const id = value.trim();
  if (!UUID_RE.test(id)) {
    throw new Error(
      `${field} "${id}" is not a valid UUID — it has group lengths ` +
        `${describeShape(id)} where 8-4-4-4-12 hexadecimal is required. Ids are ` +
        `never composed: use one exactly as a previous tool returned it.` +
        (hint ? ` ${hint}` : ''),
    );
  }
  return id;
}

/** True when the value is a well-formed UUID. */
export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
