import { SetMetadata } from '@nestjs/common';

export const READ_ONLY_ENDPOINT = 'readOnlyEndpoint';

/**
 * Marks a controller (or a single handler) as free of side effects, so
 * `DbRetryInterceptor` may re-run it after a transient database error.
 *
 * Needed for the `search/*` endpoints: they are semantically reads but use POST
 * to carry a filter body, and method alone cannot tell them apart from a
 * mutation.
 */
export const ReadOnlyEndpoint = () => SetMetadata(READ_ONLY_ENDPOINT, true);
