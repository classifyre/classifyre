import type { SourceDocModel } from "@workspace/schemas/source-docs";

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
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
