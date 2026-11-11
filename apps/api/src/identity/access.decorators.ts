import { SetMetadata } from '@nestjs/common';
import type { Capability } from './capabilities';

export const ACCESS_AREA_KEY = 'classifyre:accessArea';
export const REQUIRES_KEY = 'classifyre:requires';
export const PUBLIC_ROUTE_KEY = 'classifyre:publicRoute';
export const SIGNED_IN_KEY = 'classifyre:signedIn';

export interface AccessAreaOptions {
  /** Needed by reads: GET/HEAD, and POSTs marked `@ReadsOnly()` (search, charts, previews). */
  view: Capability;
  /** Needed by every other route of the controller. */
  change: Capability;
}

/**
 * Default capabilities for every route of a controller. A route that needs
 * something else says so with {@link Requires}.
 */
export const AccessArea = (options: AccessAreaOptions) =>
  SetMetadata(ACCESS_AREA_KEY, options);

/** The capability a route (or a whole controller) needs. Wins over {@link AccessArea}. */
export const Requires = (capability: Capability) =>
  SetMetadata(REQUIRES_KEY, capability);

/** A route anyone may call, signed in or not: health probes, crawler files. */
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);

/**
 * On top of its capability, a route (or a whole controller) only for people
 * who signed in: visitors of a public workspace are asked to sign in even
 * where their read capabilities would cover it. SQL is the case: running a
 * query, its history and saved queries are never the public's.
 */
export const SignedInOnly = () => SetMetadata(SIGNED_IN_KEY, true);
