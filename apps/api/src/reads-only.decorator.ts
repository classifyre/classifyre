import { SetMetadata } from '@nestjs/common';

export const READS_ONLY_KEY = 'readsOnly';

/**
 * Marks a non-GET handler (or controller) that only reads: a search or a
 * preview sent as POST because its input does not fit a query string. Access
 * checks then treat it as viewing (`route-access.ts`), so read-only people —
 * a Viewer, or a visitor of a public workspace — may call it.
 */
export const ReadsOnly = () => SetMetadata(READS_ONLY_KEY, true);
