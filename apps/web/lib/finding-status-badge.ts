export type FindingStatusBadgeValue =
  | "open"
  | "resolved"
  | "false_positive"
  | "ignored";

export function toFindingStatusBadgeValue(
  status?: string | null,
): FindingStatusBadgeValue {
  switch (status?.toUpperCase()) {
    case "FALSE_POSITIVE":
      return "false_positive";
    case "RESOLVED":
      return "resolved";
    case "IGNORED":
      return "ignored";
    default:
      return "open";
  }
}

export function formatFindingStatusLabel(status?: string | null) {
  return (status ?? "OPEN")
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
