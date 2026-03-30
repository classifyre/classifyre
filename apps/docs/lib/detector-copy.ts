import type {
  DetectorDocExample,
  DetectorDocFieldRow,
  DetectorDocModel,
} from "@workspace/schemas/detector-docs";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
}

function renderFieldsTable(rows: DetectorDocFieldRow[]): string {
  if (rows.length === 0) return "_No parameters._";

  const header = [
    "| Parameter | Type | Required | Description | Default | Constraints |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  const body = rows.map((row) => {
    const desc = [
      row.description,
      row.enumValues ? `Allowed: ${row.enumValues}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `| ${tableCell(row.path)} | ${tableCell(row.type)} | ${row.required ? "Yes" : "No"} | ${tableCell(desc)} | ${tableCell(row.defaultValue ?? "—")} | ${tableCell(row.constraints ?? "—")} |`;
  });

  return [...header, ...body].join("\n");
}

export function buildDetectorsOverviewCopy(
  detectorDocs: DetectorDocModel[],
): string {
  const totalExamples = detectorDocs.reduce(
    (sum, d) => sum + d.examples.length,
    0,
  );
  const sorted = [...detectorDocs].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const lines = [
    "# Detectors",
    "",
    "Schema-driven detector documentation generated from all_detectors.json and all_detectors_examples.json.",
    "",
    `- Detector types: ${detectorDocs.length}`,
    `- Examples: ${totalExamples}`,
    "",
    "## Detector Catalog",
    "",
    "| Detector | Type | Status | Priority | Examples |",
    "| --- | --- | --- | --- | --- |",
    ...sorted.map(
      (d) =>
        `| ${tableCell(d.label)} | \`${d.detectorType}\` | ${d.catalogMeta.lifecycleStatus} | ${d.catalogMeta.priority} | ${d.examples.length} |`,
    ),
  ];

  return lines.join("\n");
}

export function buildDetectorDetailsCopy(detector: DetectorDocModel): string {
  const { catalogMeta } = detector;

  const lines: string[] = [
    `# ${detector.label} Detector`,
    "",
    `- Detector type: \`${detector.detectorType}\``,
    `- Config definition: \`${detector.configDefinitionName}\``,
    `- Status: ${catalogMeta.lifecycleStatus}`,
    `- Priority: ${catalogMeta.priority}`,
    `- Categories: ${catalogMeta.categories.join(", ") || "—"}`,
    `- Supported asset types: ${catalogMeta.supportedAssetTypes.join(", ") || "—"}`,
    ...(catalogMeta.recommendedModel
      ? [`- Recommended model: ${catalogMeta.recommendedModel}`]
      : []),
    ...(catalogMeta.notes ? ["", `> ${catalogMeta.notes}`] : []),
    "",
    "## Parameters",
    "",
    renderFieldsTable(detector.fieldRows),
    "",
    "## Raw JSON Schema",
    "",
    "```json",
    json(detector.schema),
    "```",
  ];

  if (detector.examples.length > 0) {
    lines.push("", "## Examples");
    detector.examples.forEach((example: DetectorDocExample) => {
      lines.push("", `### ${example.name}`);
      if (example.description) lines.push("", example.description);
      lines.push("", "```json", json(example.config), "```");
    });
  }

  return lines.join("\n");
}
