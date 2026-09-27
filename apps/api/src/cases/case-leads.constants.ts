/** pg-boss queue that refreshes one case's leads. */
export const CASE_LEADS_QUEUE = 'case-leads.refresh';

/**
 * Coalescing window for refreshes a change asks for.
 *
 * A watch's auto-add or a person attaching findings one after another asks
 * many times in a minute. `singletonSeconds` folds a burst onto one job and
 * `singletonNextSlot` moves a request that arrives while one is queued into the
 * next slot instead of dropping it, so the last change of a burst is still
 * seen.
 */
export const CASE_LEADS_COALESCE_SECONDS = 30;

/**
 * How long a change-triggered refresh waits before it runs: the change may be
 * part of a transaction that has not committed yet, and the first request of a
 * burst should see the rest of it.
 */
export const CASE_LEADS_DELAY_SECONDS = 15;

/** Opening the board refreshes the leads at most this often per case. */
export const CASE_LEADS_READ_THROTTLE_SECONDS = 600;

/**
 * The actor for everything the case does to its own leads: automatic
 * refreshes, and settling a lead whose finding or asset joined the case another
 * way. The timeline names it as the platform, not as a person.
 */
export const CASE_LEADS_ACTOR = 'case-leads';

export interface CaseLeadsJobPayload {
  caseId: string;
  /** What asked for the refresh, for logs. */
  reason?: string;
}
