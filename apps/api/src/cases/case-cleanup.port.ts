/**
 * Automatic case clean-up, as an injectable token — for the same reason as
 * CASE_PULL (see case-pull.port.ts): the matching worker has to call into the
 * case side after every scan, and injecting it would close a Nest dependency
 * cycle, which under this runtime hangs the boot silently. The worker resolves
 * this token through ModuleRef instead.
 */
export const CASE_CLEANUP = Symbol('CASE_CLEANUP');

/**
 * The actor on everything the clean-up does by itself (after a scan, on a
 * status change, on the periodic check). A person who switches a rule on, or
 * adds a filter, is the actor of what that takes out.
 */
export const CASE_CLEANUP_ACTOR = 'case-cleanup';

export interface CaseCleanupPort {
  /** Apply every enabled rule of every open case that cites the source. */
  sweepForSource(
    sourceId: string,
    run?: { runnerId?: string | null },
  ): Promise<void>;
}
