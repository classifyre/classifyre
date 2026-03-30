/**
 * Server component — reads helm/classifyre/README.md at build time and renders
 * the Values table as HTML. No generation step or extra dependency needed.
 *
 * The README is committed to the repo. Update it with `bun run ops:helm:docs`.
 */

import { readFileSync } from "fs";
import { join } from "path";

function isTableSeparator(line: string): boolean {
  // Matches lines like |---|---|---| (only dashes, pipes, colons, spaces)
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

interface TableData {
  headers: string[];
  rows: string[][];
}

function extractValuesTable(readme: string): TableData | null {
  const marker = "\n## Values\n";
  const start = readme.indexOf(marker);
  if (start === -1) return null;

  const section = readme.slice(start + marker.length).trim();
  const tableLines = section
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && l.trim().endsWith("|"));

  if (tableLines.length < 3) return null;

  const headers = parseCells(tableLines[0]!);
  const rows = tableLines
    .slice(1)
    .filter((l) => !isTableSeparator(l))
    .map(parseCells);

  return { headers, rows };
}

// Strips backtick fences from a cell value for display (keeps the text).
// e.g. `{}` → {} so the table stays scannable.
function stripBackticks(value: string): string {
  return value.replace(/`([^`]*)`/g, "$1");
}

export function HelmValuesTable() {
  const readmePath = join(process.cwd(), "../../helm/classifyre/README.md");

  let table: TableData | null = null;
  try {
    const readme = readFileSync(readmePath, "utf8");
    table = extractValuesTable(readme);
  } catch {
    return (
      <p className="text-sm text-muted-foreground italic">
        Values reference unavailable — run{" "}
        <code className="font-mono">bun run ops:helm:docs</code> to regenerate
        helm/classifyre/README.md.
      </p>
    );
  }

  if (!table) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Could not parse Values table from helm/classifyre/README.md.
      </p>
    );
  }

  const { headers, rows } = table;

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-0 even:bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 align-top ${
                    j === 0
                      ? "font-mono text-xs font-medium text-foreground"
                      : j === 2
                        ? "font-mono text-xs text-muted-foreground"
                        : "text-xs text-foreground/80"
                  }`}
                >
                  {j === 2 ? stripBackticks(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
