import type {
  SourceDocFieldRow,
  SourceDocModel,
} from "@workspace/schemas/source-docs";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
}

function sectionRows(
  rows: SourceDocFieldRow[],
  section: "required" | "masked" | "optional",
): SourceDocFieldRow[] {
  return rows.filter(
    (row) =>
      row.path === section ||
      row.path.startsWith(`${section}.`) ||
      row.path.startsWith(`${section}[]`),
  );
}

function renderFieldsTable(title: string, rows: SourceDocFieldRow[]): string {
  if (rows.length === 0) {
    return `## ${title}\n\n_No fields in this section._`;
  }

  const header = [
    `## ${title}`,
    "",
    "| Path | Type | Required | Description | Default | Constraints |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  const body = rows.map((row) => {
    const description = [
      row.description,
      row.enumValues ? `Allowed: ${row.enumValues}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `| ${tableCell(row.path)} | ${tableCell(row.type)} | ${row.required ? "Yes" : "No"} | ${tableCell(description)} | ${tableCell(row.defaultValue ?? "—")} | ${tableCell(row.constraints ?? "—")} |`;
  });

  return [...header, ...body].join("\n");
}

export function buildSourcesOverviewCopy(sourceDocs: SourceDocModel[]): string {
  const totalExamples = sourceDocs.reduce(
    (sum, source) => sum + source.examples.length,
    0,
  );
  const sorted = [...sourceDocs].sort((a, b) => a.label.localeCompare(b.label));

  const lines = [
    "# Sources",
    "",
    "Schema-driven source documentation generated from shared source schemas and examples.",
    "",
    `- Source types: ${sourceDocs.length}`,
    `- Examples: ${totalExamples}`,
    "",
    "## Source Catalog",
    "",
    "| Source | Type | Examples |",
    "| --- | --- | --- |",
    ...sorted.map(
      (source) =>
        `| ${tableCell(source.label)} | \`${source.sourceType}\` | ${source.examples.length} |`,
    ),
  ];

  return lines.join("\n");
}

export function buildSourceDetailsCopy(source: SourceDocModel): string {
  const requiredRows = sectionRows(source.fieldRows, "required");
  const maskedRows = sectionRows(source.fieldRows, "masked");
  const optionalRows = sectionRows(source.fieldRows, "optional");

  const lines: string[] = [
    `# ${source.label} Source`,
    "",
    `- Source type: \`${source.sourceType}\``,
    `- Definition: \`${source.definitionName}\``,
    `- Fields: ${source.fieldRows.length}`,
    `- Examples: ${source.examples.length}`,
    "",
    renderFieldsTable("Required Fields", requiredRows),
    "",
    renderFieldsTable("Masked Fields", maskedRows),
    "",
    renderFieldsTable("Optional Fields", optionalRows),
    "",
    "## Raw Source JSON Schema",
    "",
    "```json",
    json(source.schema),
    "```",
  ];

  if (source.examples.length > 0) {
    lines.push("", "## Examples");
    source.examples.forEach((example) => {
      lines.push("", `### ${example.name}`);
      if (example.description) {
        lines.push("", example.description);
      }
      if (example.schedule) {
        lines.push(
          "",
          "#### Schedule",
          "",
          "```json",
          json(example.schedule),
          "```",
        );
      }
      lines.push(
        "",
        "#### Config Payload",
        "",
        "```json",
        json(example.config),
        "```",
      );
    });
  }

  return lines.join("\n");
}
