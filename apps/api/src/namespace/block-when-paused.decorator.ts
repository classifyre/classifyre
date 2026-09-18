import { SetMetadata } from '@nestjs/common';

export const BLOCK_WHEN_PAUSED_KEY = 'blockWhenPaused';

/**
 * Mark a handler as activity-starting: while its workspace is paused the
 * {@link NamespacePausedGuard} rejects it with 409, so a manual click fails
 * fast with "resume first" instead of silently queueing work nobody runs.
 *
 * Apply ONLY to endpoints whose call starts something that outlives the
 * request or drives automation — scan/run creation, job or queue submits
 * (exports, imports, rebuilds, reindexes, training, notebook executions),
 * schedule resumes, connection tests that can spawn jobs, AI wakes and
 * agentic/generative calls. Everything else stays available while paused:
 * reads of any HTTP method, direct CRUD, synchronous request-scoped
 * recomputation (rematch, rollup rebuilds), and diagnostics. Stopping the
 * automation itself is handled separately by freezing the namespace's
 * workers, and service-level `assertNotPaused` stays as the backstop for
 * non-HTTP triggers (schedulers, pg-boss handlers, supervisor).
 */
export const BlockWhenPaused = () => SetMetadata(BLOCK_WHEN_PAUSED_KEY, true);
