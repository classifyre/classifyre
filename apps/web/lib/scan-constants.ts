/**
 * Shared constants and types for scan/schedule configuration
 */

export type ScanFrequency = "once" | "hourly" | "daily" | "weekly" | "monthly";

export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export function getSeverityBadgeVariant(
  severity: "critical" | "high" | "medium" | "low" | "info",
): "destructive" | "default" | "secondary" {
  if (severity === "critical") return "destructive";
  if (severity === "high") return "default";
  return "secondary";
}

export function formatScheduleDescription(
  frequency: ScanFrequency,
  scheduledTime?: string,
  scheduledDate?: string,
  timezone?: string,
  daysOfWeek?: number[],
  dayOfMonth?: number,
): string {
  if (frequency === "once" && scheduledDate) {
    return `Scheduled for ${scheduledDate} at ${scheduledTime || "00:00"}`;
  }
  if (frequency === "hourly") {
    return "Runs every hour";
  }
  if (frequency === "daily") {
    return `Daily at ${scheduledTime || "00:00"}${timezone ? ` (${timezone})` : ""}`;
  }
  if (frequency === "weekly" && daysOfWeek && daysOfWeek.length > 0) {
    const dayLabels = daysOfWeek
      .map((d) =>
        DAYS_OF_WEEK.find((day) => day.value === d)?.label.slice(0, 3),
      )
      .filter(Boolean)
      .join(", ");
    return `Weekly on ${dayLabels} at ${scheduledTime || "00:00"}`;
  }
  if (frequency === "monthly") {
    return `Monthly on day ${dayOfMonth || 1} at ${scheduledTime || "00:00"}`;
  }
  return "Configure schedule";
}
