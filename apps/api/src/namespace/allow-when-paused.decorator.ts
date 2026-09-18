import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_PAUSED_KEY = 'allowWhenPaused';

/**
 * Mark a handler or controller as permitted while its workspace is paused.
 * Apply only to endpoints that wind work DOWN, never to ones that start it:
 * stopping/cancelling/deleting a run, cancelling an agent run, wiping
 * ephemeral storage (a frozen workspace is the quiet window where no writer
 * can race the wipe). Everything else mutating is rejected with 409 by
 * {@link NamespacePausedGuard} so a paused workspace is truly frozen.
 */
export const AllowWhenPaused = () => SetMetadata(ALLOW_WHEN_PAUSED_KEY, true);
