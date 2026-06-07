import { DetectorCatalog } from "@workspace/ui/components/detector-catalog";
import { resolveDetectorGroupId } from "@workspace/ui/components/detector-catalog-utils";
import { getAllDetectorDocs } from "@workspace/schemas/detector-docs";

export function PreBuiltDetectors() {
  const detectorDocs = getAllDetectorDocs();

  const items = detectorDocs.map((d) => ({
    id: d.detectorType,
    type: d.detectorType,
    title: d.label,
    description: d.catalogMeta.notes,
    categories: d.catalogMeta.categories,
    lifecycleStatus: d.catalogMeta.lifecycleStatus,
    priority: d.catalogMeta.priority,
    groupId: resolveDetectorGroupId(d.detectorType, d.catalogMeta.categories),
  }));

  return <DetectorCatalog items={items} />;
}
