"use client";

import { SourceCatalog } from "@workspace/ui/components/source-catalog";
import {
  resolveSourceCatalogMeta,
  SOURCE_TYPE_CATALOG_META,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import type { SourceType } from "@/components/source-form";

interface SourceTypeSelectorProps {
  onSelect: (type: SourceType) => void;
}

/**
 * Every source type, in both deployments.
 *
 * The folder source used to be filtered out here unless the app was running on
 * the desktop, on the reasoning that a hosted deployment has no local disk to
 * scan. That is true of the API pod and irrelevant to the scan: a scan runs in
 * a CLI job pod, and the chart's `api.localFolders` mounts a PVC, an NFS export
 * or a ConfigMap into it. Nothing is deployment-gated any more.
 */
const ALL_SOURCE_CATALOG_ENTRIES: SourceCatalogEntry[] = Object.keys(
  SOURCE_TYPE_CATALOG_META,
)
  .map((sourceType) => ({
    type: sourceType,
    ...resolveSourceCatalogMeta(sourceType),
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function SourceTypeSelector({ onSelect }: SourceTypeSelectorProps) {
  return (
    <SourceCatalog
      entries={ALL_SOURCE_CATALOG_ENTRIES}
      onSelect={(sourceType) => onSelect(sourceType as SourceType)}
    />
  );
}
