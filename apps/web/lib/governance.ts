"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
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
