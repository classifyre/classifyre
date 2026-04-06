import { SetMetadata } from '@nestjs/common';

export const ALLOW_IN_DEMO_MODE_KEY = 'allowInDemoMode';

/**
 * Mark a handler or controller as permitted in demo-mode.
 * Apply to non-GET endpoints that are query/read-only by nature
 * (e.g. POST /search/*, POST /semantic/query/*).
 */
export const AllowInDemoMode = () =>
  SetMetadata(ALLOW_IN_DEMO_MODE_KEY, true);
