import { severityBadgeVariants } from "@workspace/ui/components/severity-badge";
import { ESCALATION_SEVERITY, FINDING_SEVERITY_INK } from "@workspace/ui/lib/finding-severity";

/**
 * Escalation borrows HIGH from the severity scale rather than a colour of its
 * own: text and icons about one use HIGH's ink, a pill about one is a HIGH
 * severity badge.
 */
export const ESCALATION_INK = FINDING_SEVERITY_INK[ESCALATION_SEVERITY];

export const escalationBadgeClass = severityBadgeVariants({ severity: ESCALATION_SEVERITY });
