import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticationError, type Principal } from './identity.service';

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

/** Throws the 401/503 a failed sign-in check becomes (guard and hook share it). */
export async function authenticateOr(
  authenticate: () => Promise<Principal>,
  send: {
    unauthorized: (body: Record<string, unknown>) => unknown;
    unavailable: (body: Record<string, unknown>) => unknown;
  },
): Promise<Principal | null> {
  try {
    return await authenticate();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      await send.unauthorized({
        statusCode: 401,
        error: 'Unauthorized',
        code: error.code,
        message: error.message,
      });
      return null;
    }
    await send.unavailable({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'IDENTITY_UNAVAILABLE',
      message: 'Sign-in cannot be checked right now. Try again in a moment.',
    });
    return null;
  }
}

/** The guard's variant: the same branches as exceptions. */
export function throwAuthenticationError(error: unknown): never {
  if (error instanceof AuthenticationError) {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      code: error.code,
      message: error.message,
    });
  }
  throw new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    code: 'IDENTITY_UNAVAILABLE',
    message: 'Sign-in cannot be checked right now. Try again in a moment.',
  });
}

/** Refuses a cookie write from another origin on every route (M-3). */
export function assertSameOrigin(
  principal: Pick<Principal, 'via'>,
  request: { method: string; headers?: Record<string, unknown> },
  appOrigin: string | null | undefined,
): void {
  if (
    isCrossOriginCookieWrite(
      principal,
      request.method,
      request.headers?.origin,
      appOrigin,
    )
  ) {
    throw new ForbiddenException(CROSS_ORIGIN_BODY);
  }
}

/**
 * Body fields that name who made a change. The author is whoever signed in,
 * so a request cannot claim someone else: any value sent is replaced.
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
export function stampAuthorFields(
  body: unknown,
  /** Actor ref of the signer (`user:<sub>`); nothing else is ever stamped. */
  actorRef: string,
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  for (const field of AUTHOR_FIELDS) {
    if (field in record) record[field] = actorRef;
  }
}
