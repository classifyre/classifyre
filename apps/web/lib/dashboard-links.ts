import type { DashboardScope } from "@/lib/governance";

/** What a dashboard number can open on the assets page (`?governance=`). */
export type AssetsDrill =
  | "governed"
  | "ungoverned"
  | "draft"
  | "active"
  | "deprecated"
  | "retired"
  | "failing";

/**
 * The assets list behind a dashboard number: the same governance filter, and
 * for *Mine* only the assets the person owns or stewards (`responsible=me`,
 * the dashboard's own definition of mine). Governed numbers open the
 * Governed tab, which counts scanned assets and shared datasets alike, as the
 * dashboard does; ungoverned ones the Raw tab. Unprefixed: wrap in `nsPath`.
 */
export function assetsHref(
  governance: AssetsDrill | null,
  scope: DashboardScope,
  sourceId?: string | null,
): string {
  const params = new URLSearchParams({
    tab:
      governance === "ungoverned" || governance === null ? "raw" : "governed",
  });
  if (governance) params.set("governance", governance);
  if (scope === "mine") params.set("responsible", "me");
  if (sourceId) params.set("source", sourceId);
  return `/assets?${params.toString()}`;
}
