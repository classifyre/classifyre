/**
 * Prompt building and response parsing for the notebook's AI helper.
 *
 * Pure on purpose: what the model is told, and what we do with what it says
 * back, are the two things worth testing directly. The component only handles
 * state and rendering.
 *
 * This talks to the AI provider and nothing else — no MCP, no tools, no
 * round-trip through the rest of the API. One completion call, in, out.
 */

import completions from "@workspace/schemas/notebook_completions";
import type { NotebookCell } from "./notebook-cells";
import type { NotebookPackage } from "./notebook-packages";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NotebookAiContext {
  cells: NotebookCell[];
  /** The cell the request is about. */
  targetCellId: string;
  packages: NotebookPackage[];
  variables: Record<string, string>;
  /** Names only — the browser is never sent secret values. */
  secretKeys: string[];
}

export interface AiReply {
  /** Prose to show. Empty when the model replied with only code. */
  text: string;
  /** New source for the target cell, or null when nothing should change. */
  code: string | null;
}

interface CompletionManifest {
  objects: Record<
    string,
    { members: Array<{ label: string; kind: string; detail?: string }> }
  >;
  classes: Record<
    string,
    { fields: Array<{ label: string; detail?: string; required?: boolean }> }
  >;
}

const manifest = completions as unknown as CompletionManifest;

/**
 * The SDK surface, rendered for the model.
 *
 * Generated from `apps/cli/src/notebook/sdk.py`, the same file the editor's
 * autocomplete comes from — so the model is told about the API that exists
 * today rather than one described in a prompt somebody forgot to update.
 */
function sdkSurface(): string {
  const ctxMembers = (manifest.objects.ctx?.members ?? [])
    .map((member) =>
      member.kind === "property"
        ? `  ctx.${member.label}  ->  ${member.detail ?? "value"}`
        : `  ctx.${member.label}${member.detail ?? "()"}`,
    )
    .join("\n");

  const assetFields = (manifest.classes.Asset?.fields ?? [])
    .map(
      (field) =>
        `  ${field.label}: ${field.detail ?? "Any"}${field.required ? "  (required)" : ""}`,
    )
    .join("\n");

  return `Available in every cell, with or without importing:
    from classifyre import Asset, ctx

ctx:
${ctxMembers}

Asset(...) fields:
${assetFields}`;
}

function renderCells(cells: NotebookCell[], targetCellId: string): string {
  return cells
    .map((cell) => {
      const marker = cell.id === targetCellId ? "  <-- THE TARGET CELL" : "";
      return `--- cell id=${cell.id} type=${cell.type}${marker}\n${cell.source}`;
    })
    .join("\n\n");
}

function renderConfig(context: NotebookAiContext): string {
  const packages = context.packages.length
    ? context.packages
        .map((p) => `  ${p.name}${p.version ? ` ${p.version}` : ""}`)
        .join("\n")
    : "  (none declared — only the base image's libraries are available)";

  const variables = Object.entries(context.variables).length
    ? Object.entries(context.variables)
        .map(([key, value]) => `  ctx.var("${key}")  = ${value}`)
        .join("\n")
    : "  (none configured)";

  // Names only. The browser never receives secret values, so there is nothing
  // here to leak even if the model asked -- and the model does not need them
  // to write ctx.secret("api_token").
  const secrets = context.secretKeys.length
    ? context.secretKeys.map((key) => `  ctx.secret("${key}")`).join("\n")
    : "  (none configured)";

  return `Installed packages:
${packages}

Variables (plain values, read with ctx.var):
${variables}

Secrets (names only — values are never shown, read with ctx.secret):
${secrets}`;
}

export const CODE_FENCE = /```(?:python|py)?\s*\n([\s\S]*?)```/g;

export function buildSystemPrompt(context: NotebookAiContext): string {
  return `You help someone write a Classifyre custom connector: a Python notebook that ingests data from a system so it can be scanned.

HOW THE NOTEBOOK RUNS
- Cells run top to bottom in a fresh process every time. There is no persistent kernel, so state is rebuilt from the cell sources on every run.
- The notebook must define test_connection() and extract() at the TOP LEVEL of a code cell.
- extract() yields Asset(...) objects, and should yield as it goes rather than building a list.
- Cells must be valid standard Python. IPython magics (%time, !pip install) are rejected.
- Packages are declared in the packages table, never installed from a cell.

${sdkSurface()}

THE NOTEBOOK RIGHT NOW
${renderCells(context.cells, context.targetCellId)}

CONFIGURATION
${renderConfig(context)}

HOW TO REPLY
- If you are changing the code, reply with the COMPLETE new source for the target cell (id="${context.targetCellId}") in ONE \`\`\`python block. It replaces that cell entirely, so include everything it should contain — not a fragment or a diff.
- Only change the target cell. If the change really belongs elsewhere, say so in prose instead of emitting code.
- If you are answering a question, explaining, or reviewing, reply in prose with NO python code block. A code block always overwrites the cell, so never include one just to illustrate a point.
- Use ctx.var(...) and ctx.secret(...) for configuration. Never hard-code a credential or invent a variable that is not configured.
- Keep prose short.`;
}

export function buildMessages(
  context: NotebookAiContext,
  history: AiMessage[],
  question: string,
): AiMessage[] {
  return [
    // Rebuilt on every turn rather than kept in history: the notebook changes
    // as the conversation goes on, and a stale copy of the code is worse than
    // no copy at all.
    { role: "system", content: buildSystemPrompt(context) },
    ...history,
    { role: "user", content: question },
  ];
}

/**
 * Split a reply into prose and the replacement cell source.
 *
 * A python block means "change the cell"; its absence means "this was a
 * question, leave the code alone". That distinction is the whole contract, so
 * a reply that merely mentions code in a non-python fence is treated as prose.
 */
export function parseAiReply(content: string): AiReply {
  const blocks: string[] = [];
  const prose = content
    .replace(CODE_FENCE, (_match, code: string) => {
      blocks.push(String(code).replace(/\s+$/, ""));
      return "";
    })
    .trim();

  if (blocks.length === 0) {
    return { text: content.trim(), code: null };
  }

  // More than one block means the model split the answer up; the cell takes
  // one source, so they are joined in the order they were written.
  const code = blocks.join("\n\n").trim();
  return { text: prose, code: code.length > 0 ? code : null };
}
