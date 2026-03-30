export type DetectorCatalogStatus = "ACTIVE" | "INACTIVE";
export type DetectorTrainingStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export function detectorCatalogStatusLabel(
  isActive: boolean,
): DetectorCatalogStatus {
  return isActive ? "ACTIVE" : "INACTIVE";
}

export function detectorCatalogStatusToRunnerStatus(isActive: boolean) {
  return isActive ? "COMPLETED" : "PENDING";
}

export function detectorTrainingStatusToRunnerStatus(status?: string | null) {
  const normalized = (status ?? "").toUpperCase();
  switch (normalized) {
    case "RUNNING":
      return "RUNNING";
    case "SUCCEEDED":
      return "COMPLETED";
    case "FAILED":
      return "ERROR";
    case "PENDING":
    default:
      return "PENDING";
  }
}
