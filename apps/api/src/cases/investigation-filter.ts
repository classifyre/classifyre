import { CaseKind } from '@prisma/client';

/**
 * Shared Prisma where-clause keeping Autopilot, cleanup, leads, escalation,
 * and investigation automation strictly scoped to INVESTIGATION cases
 * (docs/prd/DR-data-requests.md §4.4).
 */
export const INVESTIGATIONS = { kind: CaseKind.INVESTIGATION } as const;
