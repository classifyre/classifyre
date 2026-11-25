import { CaseKind, DataRequestState, type Prisma } from '@prisma/client';

/**
 * Shared Prisma where-clause keeping Autopilot, cleanup, leads, escalation,
 * and investigation automation strictly scoped to INVESTIGATION cases
 * (docs/prd/DR-data-requests.md §4.4).
 */
export const INVESTIGATIONS = { kind: CaseKind.INVESTIGATION } as const;

/**
 * Draft data requests are private to their requester; every other case
 * (investigations and submitted/active/closed data requests) is visible.
 */
export function visibleCaseWhere(viewerRef?: string): Prisma.CaseWhereInput {
  return viewerRef
    ? {
        OR: [
          { kind: CaseKind.INVESTIGATION },
          { dataRequest: { state: { not: DataRequestState.DRAFT } } },
          { dataRequest: { requesterRef: viewerRef } },
        ],
      }
    : {
        OR: [
          { kind: CaseKind.INVESTIGATION },
          { dataRequest: { state: { not: DataRequestState.DRAFT } } },
        ],
      };
}
