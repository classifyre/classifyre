import {
  SearchAssetsFiltersDtoGovernanceEnum,
  type SearchAssetsFiltersDtoGovernanceEnum as GovernanceFilter,
  type SearchAssetsFiltersDtoKindEnum,
} from "@workspace/api-client";
import type { DashboardScope } from "@/lib/governance";

/** Scanned assets or shared datasets: the asset search's `kind`. */
export type AssetKind = SearchAssetsFiltersDtoKindEnum;

/**
 * What a dashboard number can open on the assets page: a governance filter of
 * the asset search, or the governed assets failing quality.
 */
export type AssetsDrill =
  | Exclude<
      GovernanceFilter,
      typeof SearchAssetsFiltersDtoGovernanceEnum.Failing
    >
  | "failing";

/**
 * The assets list behind a dashboard number, with the same filter, and for
 * *Mine* only the assets the person owns or stewards (`responsible=me`, the
 * dashboard's own definition of mine). Governed numbers open the Governed tab,
 * which counts scanned assets and shared datasets alike, as the dashboard
 * does; `failing` is the governed assets failing quality (`quality=failing`
 * on that tab), as the dashboard counts it; ungoverned ones open the Raw tab.
 * Unprefixed: wrap in `nsPath`.
 */
export function assetsHref(
  drill: AssetsDrill | null,
  scope: DashboardScope,
  sourceId?: string | null,
): string {
  const params = new URLSearchParams({
    tab:
      drill === null ||
      drill === SearchAssetsFiltersDtoGovernanceEnum.Ungoverned
        ? "raw"
        : "governed",
  });
  if (drill === "failing") params.set("quality", "failing");
  else if (drill) params.set("governance", drill);
  if (scope === "mine") params.set("responsible", "me");
  if (sourceId) params.set("source", sourceId);
  return `/assets?${params.toString()}`;
}

/** The dashboard's links, with its scope and source already in them. */
export type AssetsLink = (drill: AssetsDrill | null) => string;
