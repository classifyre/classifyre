/**
 * The "@" references the source pages offer the assistant.
 *
 * Kept out of the pages because create and edit must offer the same vocabulary:
 * a prompt that works while building a connector has to keep working when the
 * user comes back to fix it, and two hand-written lists would not stay equal.
 */

import type { AssistantMention } from "@/components/assistant-workflow-provider";
import type { DetectorConfigInput } from "@/components/source-scan-config";
import { getDetectorSchemas } from "@/lib/detector-schema-loader";
import type { NotebookCell } from "@/lib/notebook-cells";
import type { NotebookLocalFolder } from "@/lib/notebook-local-folders";

/** First non-empty line of a cell, for the menu label. */
function cellSummary(cell: NotebookCell): string {
  const line = cell.source
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return cell.type === "markdown" ? "empty note" : "empty cell";
  }
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

export interface SourceMentionInput {
  /** Null for a non-CUSTOM source: there is no notebook to reference. */
  cells: NotebookCell[] | null;
  /** Files attached to the source, uploaded or still pending. */
  files: Array<{ name: string; detail?: string }>;
  /** Folders on the machine running the app (desktop only). */
  localFolders: NotebookLocalFolder[];
  /** The detector selection currently on the form. */
  detectors: DetectorConfigInput[];
}

/**
 * Every reference the composer can offer, in menu order.
 *
 * Cells are addressed both by position (@cell:2, which is how a person reads a
 * notebook) and by id (@cell:extract, which is what `notebook_edit` needs), so
 * whichever the user reaches for resolves to the same thing.
 */
export function buildSourceMentions(
  input: SourceMentionInput,
): AssistantMention[] {
  const mentions: AssistantMention[] = [];

  (input.cells ?? []).forEach((cell, index) => {
    const body = [
      `Cell ${index + 1} (id="${cell.id}", type=${cell.type}):`,
      cell.source,
    ].join("\n");
    mentions.push({
      token: `@cell:${index + 1}`,
      label: `Cell ${index + 1} — ${cellSummary(cell)}`,
      hint: `id "${cell.id}"`,
      group: "cell",
      body,
    });
    mentions.push({
      token: `@cell:${cell.id}`,
      label: `${cell.id} — ${cellSummary(cell)}`,
      hint: `cell ${index + 1}`,
      group: "cell",
      body,
    });
  });

  for (const file of input.files) {
    mentions.push({
      token: `@file:${file.name}`,
      label: file.name,
      hint: file.detail ?? "attached to this source",
      group: "file",
      body: [
        `File "${file.name}" is attached to this source.`,
        file.detail ? `Detail: ${file.detail}` : "",
        'Read it in the notebook with ctx.files — never by an absolute path.',
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  for (const folder of input.localFolders) {
    mentions.push({
      token: `@file:${folder.name}`,
      label: folder.name,
      hint: folder.path,
      group: "folder",
      body: [
        `Local folder "${folder.name}" is configured on this source at ${folder.path}.`,
        'Read it in the notebook with ctx.folder("' + folder.name + '").',
        "Desktop only: a Kubernetes deployment has no such machine.",
      ].join("\n"),
    });
  }

  const selected = new Map(
    input.detectors.map((detector) => [detector.type.toUpperCase(), detector]),
  );
  for (const schema of getDetectorSchemas({ includeCustom: false })) {
    const current = selected.get(schema.type.toUpperCase());
    mentions.push({
      token: `@detector:${schema.type}`,
      label: schema.title,
      hint: current
        ? current.enabled
          ? "enabled on this source"
          : "added but switched off"
        : "not on this source",
      group: "detector",
      body: [
        `Detector type "${schema.type}" — ${schema.title}.`,
        schema.description ? schema.description : "",
        current
          ? `Currently ${current.enabled ? "ENABLED" : "DISABLED"} on this source with config ${JSON.stringify(current.config ?? {})}.`
          : "Not currently on this source.",
        'Change it with the "set_detectors" uiAction, sending the COMPLETE detector list.',
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return mentions;
}
