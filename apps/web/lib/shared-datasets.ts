"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@workspace/api-client";
import type {
  CreateSharedDatasetDto,
  SharedDatasetColumnDto,
  SharedDatasetDescriptionDto,
  SharedDatasetDto,
  SharedDatasetInputDto,
  SharedDatasetOptionsDto,
  SharedDatasetSummaryDto,
  SharedDatasetUseDto,
  SharedDatasetVersionDto,
  UpdateSharedDatasetDto,
} from "@workspace/api-client";

/**
 * Shared datasets (docs/prd/DQ-data-query.md §5.12): saved queries shared
 * with groups as governed assets of their own. Reading one is an ordinary
 * query (`shared.<domain>.<name>`); these calls keep its definition.
 */
export type {
  SharedDatasetColumnDto,
  SharedDatasetDescriptionDto,
  SharedDatasetDto,
  SharedDatasetInputDto,
  SharedDatasetOptionsDto,
  SharedDatasetSummaryDto,
  SharedDatasetUseDto,
  SharedDatasetVersionDto,
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

export function useSharedDatasets() {
  const load = useCallback(
    () => api.sharedDatasets.sharedDatasetsControllerList(),
    [],
  );
  return useLoad(load);
}

/** A shared dataset by its asset id; null id loads nothing (not a dataset). */
export function useSharedDataset(assetId: string | null | undefined) {
  const load = useCallback(
    () => api.sharedDatasets.sharedDatasetsControllerGet({ id: assetId! }),
    [assetId],
  );
  return useLoad(assetId ? load : null);
}

export function useSharedDatasetVersions(assetId: string | null | undefined) {
  const load = useCallback(
    () => api.sharedDatasets.sharedDatasetsControllerVersions({ id: assetId! }),
    [assetId],
  );
  return useLoad(assetId ? load : null);
}

export function useSharedDatasetOptions() {
  const load = useCallback(
    () => api.sharedDatasets.sharedDatasetsControllerOptions(),
    [],
  );
  return useLoad(load);
}

/** Shared datasets that read a table, or any table of a source. */
export function useSharedDatasetUses(
  scopeType: "asset" | "source",
  scopeId: string | null | undefined,
) {
  const load = useCallback(
    () =>
      api.sharedDatasets.sharedDatasetsControllerUses({
        scopeType,
        scopeId: scopeId!,
      }),
    [scopeType, scopeId],
  );
  return useLoad(scopeId ? load : null);
}

export function describeDataset(
  sql: string,
  owningGroupId?: string,
): Promise<SharedDatasetDescriptionDto> {
  return api.sharedDatasets.sharedDatasetsControllerDescribe({
    describeSharedDatasetDto: {
      sql,
      ...(owningGroupId ? { owningGroupId } : {}),
    },
  });
}

export function shareDataset(
  input: CreateSharedDatasetDto,
): Promise<SharedDatasetDto> {
  return api.sharedDatasets.sharedDatasetsControllerCreate({
    createSharedDatasetDto: input,
  });
}

export function updateDataset(
  id: string,
  input: UpdateSharedDatasetDto,
): Promise<SharedDatasetDto> {
  return api.sharedDatasets.sharedDatasetsControllerUpdate({
    id,
    updateSharedDatasetDto: input,
  });
}

export function promoteDataset(
  id: string,
  promoted: boolean,
): Promise<SharedDatasetDto> {
  return api.sharedDatasets.sharedDatasetsControllerPromote({
    id,
    promoteSharedDatasetDto: { promoted },
  });
}

export function blockDataset(
  id: string,
  scopeType: "asset" | "source",
  scopeId: string,
  reason?: string,
): Promise<SharedDatasetUseDto[]> {
  return api.sharedDatasets.sharedDatasetsControllerBlock({
    id,
    blockSharedDatasetDto: {
      scopeType,
      scopeId,
      ...(reason ? { reason } : {}),
    },
  });
}

export function unblockDataset(
  id: string,
  blockId: string,
): Promise<SharedDatasetUseDto[]> {
  return api.sharedDatasets.sharedDatasetsControllerUnblock({ id, blockId });
}

/** `shared.<domain>.<name>` as the SQL page reads it. */
export function datasetSqlName(dataset: { domain: string; name: string }) {
  return `shared.${dataset.domain}.${dataset.name}`;
}

/** A plain lower-case SQL word made from any text, as the API makes it. */
export function sqlWord(text: string, fallback = "dataset"): string {
  let id = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!id) id = fallback;
  if (/^[0-9]/.test(id)) id = `${fallback}_${id}`;
  return id.slice(0, 63);
}
