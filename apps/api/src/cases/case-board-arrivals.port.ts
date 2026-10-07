/**
 * "Lay out evidence a hypothesis rule just linked", as an injectable token —
 * for the same reason as CASE_PULL (see case-pull.port.ts): the board services
 * depend on CasesService, which depends on the hypothesis rules, and resolving
 * the board through ModuleRef keeps that from becoming an import or a Nest
 * dependency cycle (which under this runtime hangs the boot silently).
 */
export const CASE_BOARD_ARRIVALS = Symbol('CASE_BOARD_ARRIVALS');

export interface CaseBoardArrivalsPort {
  /**
   * Put evidence with no position next to its hypothesis (inside its frame
   * when it has one). Resolves with how many items were placed; a case whose
   * board is read-only places none.
   */
  placeArrivals(
    caseId: string,
    evidenceIds: readonly string[],
    actor?: string,
  ): Promise<{ placed: number }>;
}
