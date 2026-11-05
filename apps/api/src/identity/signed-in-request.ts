import type { Principal } from './identity.service';

/** Methods that change something; a cookie may only send these same-origin. */
export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A browser sends its session cookie with any request, also one a foreign
 * page triggers; a change is accepted only from the app's own origin. Bearer
 * tokens are not sent by the browser on its own, so they need no check.
 */
export function isCrossOriginCookieWrite(
  principal: Pick<Principal, 'via'>,
  method: string,
  origin: unknown,
  appOrigin: string | null | undefined,
): boolean {
  if (principal.via !== 'cookie') return false;
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return false;
  return !appOrigin || origin !== appOrigin;
}

export const CROSS_ORIGIN_BODY = {
  statusCode: 403,
  error: 'Forbidden',
  code: 'CROSS_ORIGIN',
  message: 'Changes are only accepted from the Classifyre app.',
};

/**
 * Body fields in which clients name who made a change. Without sign-in they
 * are a self-declared name; with sign-in the author is whoever signed in, so
 * the request cannot claim someone else.
 */
export const AUTHOR_FIELDS = [
  'actor',
  'addedBy',
  'approvedBy',
  'author',
  'changedBy',
  'closedBy',
  'createdBy',
  'resolvedBy',
  'reviewedBy',
  'updatedBy',
] as const;

/** Overwrite every author field the body carries with the signed-in actor. */
export function stampAuthorFields(body: unknown, actorRef: string): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  for (const field of AUTHOR_FIELDS) {
    if (field in record) record[field] = actorRef;
  }
}
