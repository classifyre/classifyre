export type NotificationEventSeverity = "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type NotificationEventType = "SCAN" | "FINDING" | "SOURCE" | "SYSTEM";

export interface NotificationEventMeta {
  /** Matches the NotificationEvent enum value, e.g. 'scan.failed' */
  event: string;
  /** Human-readable display label */
  label: string;
  type: NotificationEventType;
  severity: NotificationEventSeverity;
  /** One or two sentences explaining what this notification means */
  description: string;
  /** What the user should do when they see this notification */
  guidance: string;
}

/**
 * The canonical list of notification events Classifyre can send.
 *
 * Keep in sync with NotificationEvent in apps/api/src/types/notification.types.ts.
 * Adding a new event here automatically updates the documentation page.
 */
export const NOTIFICATION_EVENTS: NotificationEventMeta[] = [
  {
    event: "scan.failed",
    label: "Scan Failed",
    type: "SCAN",
    severity: "HIGH",
    description:
      "A scan could not finish. The notification title includes how many times in a row this source has failed.",
    guidance:
      'Click "View scan" to see the specific error. Common causes: expired credentials, network connectivity issues, or the source being temporarily unavailable.',
  },
  {
    event: "scan.recovered",
    label: "Scan Recovered",
    type: "SCAN",
    severity: "INFO",
    description: "A previously failing source completed its scan successfully.",
    guidance:
      "No action needed — this is good news. You can optionally review the scan results to confirm everything looks normal.",
  },
  {
    event: "findings.spike",
    label: "Findings Spike",
    type: "FINDING",
    severity: "HIGH",
    description:
      "This scan found significantly more findings than usual — more than 3× the recent average, with at least 20 more than baseline.",
    guidance:
      "Review the scan immediately. This may indicate newly exposed content, a newly connected service, or a change in scanning scope. If unexpected, investigate the source.",
  },
  {
    event: "findings.mass_resolved",
    label: "Large Drop in Findings",
    type: "FINDING",
    severity: "MEDIUM",
    description:
      "The number of findings dropped sharply compared to the previous scan — a 3× or greater decrease of at least 20 findings.",
    guidance:
      "Verify this was intentional. A large drop can mean a successful cleanup, but it can also signal that the scanner lost access to content or that a configuration changed unexpectedly.",
  },
  {
    event: "source.first_scan",
    label: "First Scan Complete",
    type: "SOURCE",
    severity: "INFO",
    description: "A newly added source finished its very first scan.",
    guidance:
      "Review the initial findings — this is your baseline for that source. Any findings here were already present before Classifyre started monitoring.",
  },
];
