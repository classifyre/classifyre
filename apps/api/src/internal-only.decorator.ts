import { SetMetadata } from '@nestjs/common';

export const INTERNAL_ONLY_KEY = 'internalOnly';

/**
 * Restrict a handler (or controller) to callers that present the internal API
 * key — in practice the CLI jobs the API itself launches.
 *
 * Apply to the CLI's write-back endpoints: they take ingestion payloads at
 * face value and, since the API has no user authentication, would otherwise be
 * open to anyone who can reach the public web proxy.
 *
 * Inert when `CLASSIFYRE_INTERNAL_KEY` is unset (see InternalApiKeyService).
 */
export const InternalOnly = () => SetMetadata(INTERNAL_ONLY_KEY, true);
