/**
 * The write side of "pull an inquiry's matches into a case", as an injectable
 * token.
 *
 * Auto-pull needs the matching worker to call CasesService, but CasesService
 * already injects InquiryMatchingService. That closes the loop twice over, and
 * the two halves fail differently:
 *
 *  - as an ES import cycle, which fails loudly at module evaluation with
 *    "cannot access X before initialization" — this file breaks that half,
 *    because the consumer then imports only these types;
 *  - as a Nest dependency cycle, which under this runtime does not fail at all.
 *    The application simply stops initialising, silently, with the event loop
 *    draining while a promise waits forever and no error anywhere. That half is
 *    broken by InquiryMatchingService resolving this token through ModuleRef
 *    instead of injecting it.
 *
 * Both fixes have to stay; removing either brings the knot back. The provider
 * is still the one live CasesService (`useExisting`), so there is no second
 * implementation of "pull into a case" to drift — and that method does more
 * than insert rows, it rebuilds the lineage edges the case graph draws.
 */
export const CASE_PULL = Symbol('CASE_PULL');

/**
 * The actor on an automatic pull.
 *
 * Lives here rather than in the matching service so both sides of the call can
 * name it without importing each other — which is the whole point of this file.
 * A case's timeline uses it to distinguish evidence a standing question brought
 * in by itself from evidence a person chose.
 */
export const AUTO_PULL_ACTOR = 'inquiry-auto-pull';

export interface CasePullResult {
  pulled: number;
}

export interface CasePullPort {
  pullFromInquiry(
    caseId: string,
    dto: { inquiryId: string; findingIds?: string[] },
    actor?: string,
  ): Promise<CasePullResult>;
}
