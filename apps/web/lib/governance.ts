"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AssetQualityDto,
  type QualityRuleDto,
  type AssetColumnDto,
  type AssetColumnsDto,
  type AssetUsageDto,
  type GovernanceSummaryDto,
  type AssetGovernanceDto,
  type GovernancePrincipalDto,
  type GovernanceRoleDto,
  type SourceGovernanceDto,
} from "@workspace/api-client";

/**
 * Governed data assets in the web app (docs/prd/GOV-governed-data-assets.md).
 * An asset is governed while someone owns it (its own owner, or its
 * source's); its lifecycle is DRAFT until an owner or steward certifies it.
 */
export type GovernanceRoleKind = "OWNER" | "STEWARD" | "CUSTODIAN";
export type GovernanceStatus = "DRAFT" | "ACTIVE" | "DEPRECATED" | "RETIRED";

export const GOVERNANCE_ROLE_KINDS: readonly GovernanceRoleKind[] = [
  "OWNER",
  "STEWARD",
  "CUSTODIAN",
];

/** Which principals a role takes (R1): an owner is a person, a custodian a team. */
export function principalKindsFor(
  role: GovernanceRoleKind,
): readonly ("user" | "group")[] {
  if (role === "OWNER") return ["user"];
  if (role === "CUSTODIAN") return ["group"];
  return ["user", "group"];
}

export type {
  AssetQualityDto,
  QualityRuleDto,
  AssetColumnDto,
  AssetColumnsDto,
  AssetUsageDto,
  GovernanceSummaryDto,
  AssetGovernanceDto,
  GovernancePrincipalDto,
  GovernanceRoleDto,
  SourceGovernanceDto,
};

function useLoad<T>(load: (() => Promise<T>) | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(load));
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async () => {
    if (!load) return;
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, setData, loading, error, reload: run };
}

export function useAssetGovernance(assetId: string | null | undefined) {
  const load = useCallback(
    () => api.governance.governanceControllerAssetGovernance({ id: assetId! }),
    [assetId],
  );
  return useLoad<AssetGovernanceDto>(assetId ? load : null);
}

export function useSourceGovernance(sourceId: string | null | undefined) {
  const load = useCallback(
    () =>
      api.governance.governanceControllerSourceGovernance({ id: sourceId! }),
    [sourceId],
  );
  return useLoad<SourceGovernanceDto>(sourceId ? load : null);
}

export function searchPrincipals(
  q: string,
  kinds: readonly ("user" | "group")[],
): Promise<GovernancePrincipalDto[]> {
  return api.governance.governanceControllerPrincipals({
    q: q || undefined,
    kinds: kinds.join(","),
  });
}

/** The roles of one kind, in the order they were given. */
export function rolesOf(
  roles: readonly GovernanceRoleDto[],
  kind: GovernanceRoleKind,
): GovernanceRoleDto[] {
  return roles.filter((role) => role.role === kind);
}

/** What a column holds, least to most guarded (GOV R6). */
export const CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "personal",
  "sensitive",
  "secret",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function useAssetColumns(assetId: string | null | undefined) {
  const load = useCallback(
    () => api.governance.governanceControllerAssetColumns({ id: assetId! }),
    [assetId],
  );
  return useLoad<AssetColumnsDto>(assetId ? load : null);
}

export function useAssetUsage(
  assetId: string | null | undefined,
  enabled: boolean,
) {
  const load = useCallback(
    () =>
      api.governance.governanceControllerUsage({ id: assetId!, days: "30" }),
    [assetId],
  );
  return useLoad<AssetUsageDto>(assetId && enabled ? load : null);
}

export function useGovernanceSummary() {
  const load = useCallback(
    () => api.governance.governanceControllerSummary({ days: "30" }),
    [],
  );
  return useLoad<GovernanceSummaryDto>(load);
}

export function useAssetQuality(assetId: string | null | undefined) {
  const load = useCallback(
    () => api.governance.governanceControllerAssetQuality({ id: assetId! }),
    [assetId],
  );
  return useLoad<AssetQualityDto>(assetId ? load : null);
}

export const QUALITY_DIMENSIONS = [
  "accuracy",
  "completeness",
  "conformity",
  "consistency",
  "coverage",
  "timeliness",
  "uniqueness",
] as const;

export const QUALITY_OPERATORS = [
  "mustBe",
  "mustNotBe",
  "mustBeGreaterThan",
  "mustBeGreaterOrEqualTo",
  "mustBeLessThan",
  "mustBeLessOrEqualTo",
  "mustBeBetween",
  "mustNotBeBetween",
] as const;
export type QualityOperator = (typeof QUALITY_OPERATORS)[number];

export const isBetween = (operator: string) =>
  operator === "mustBeBetween" || operator === "mustNotBeBetween";
