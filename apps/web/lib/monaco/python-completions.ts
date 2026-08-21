"use client";

import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import completions from "@workspace/schemas/notebook_completions";
import {
  RUNTIME_MODULES,
  findRuntimeModule,
} from "@/lib/notebook-runtime-packages";

/**
 * Completions for notebook cells.
 *
 * Two sources, deliberately:
 *
 * The **Classifyre SDK** half is generated from `apps/cli/src/notebook/sdk.py`
 * (see `scripts/generate_sdk_completions.py`), so `ctx.` offers the methods that
 * actually exist, with their real signatures and docstrings. A hand-written list
 * would be wrong the first time someone added a parameter; a test fails when the
 * generated file drifts.
 *
 * The **runtime packages** half is generated too, from `apps/cli/pyproject.toml`
 * and `uv.lock`: an import line offers what the runner actually has, at the
 * version it actually has. That is where the intelligence stops for a third
 * party library -- knowing what `duckdb` exports, rather than that it exists,
 * is inference, not a manifest.
 *
 * The **Python** half is keywords and common builtins. Real type inference --
 * knowing that `df` is a DataFrame -- needs a language server, and a language
 * server needs a persistent process this architecture deliberately does not
 * have: notebook execution is a short-lived job, the desktop build is a static
 * export with no server, and monaco-languageclient would require standing one
 * up and holding a socket open per editor. What that would buy is inference
 * over third-party libraries; what it would cost is the property that makes
 * this whole feature cheap to run. The SDK surface -- the part no off-the-shelf
 * language server would know anyway -- is covered here instead.
 */

interface CompletionEntry {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insertText: string;
  required?: boolean;
}

interface CompletionManifest {
  module: string;
  globals: CompletionEntry[];
  objects: Record<string, { type: string; members: CompletionEntry[] }>;
  classes: Record<
    string,
    { documentation?: string; fields: CompletionEntry[] }
  >;
}

const manifest = completions as unknown as CompletionManifest;

const PYTHON_KEYWORDS = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
  "True",
  "False",
  "None",
];

const PYTHON_BUILTINS = [
  "abs",
  "all",
  "any",
  "bool",
  "bytes",
  "dict",
  "enumerate",
  "filter",
  "float",
  "format",
  "frozenset",
  "getattr",
  "hasattr",
  "hash",
  "int",
  "isinstance",
  "iter",
  "len",
  "list",
  "map",
  "max",
  "min",
  "next",
  "open",
  "print",
  "range",
  "repr",
  "reversed",
  "round",
  "set",
  "setattr",
  "sorted",
  "str",
  "sum",
  "tuple",
  "type",
  "zip",
];

/** Snippets for the shape of a connector, not just its vocabulary. */
const CONTRACT_SNIPPETS = [
  {
    label: "def test_connection",
    detail: "Required by the source contract",
    insertText: [
      "def test_connection() -> dict:",
      '    """${1:Check the system is reachable.}"""',
      '    return {"status": "SUCCESS", "message": "${2:Ready.}"}',
    ].join("\n"),
  },
  {
    label: "def extract",
    detail: "Required by the source contract",
    insertText: [
      "def extract():",
      '    """${1:Yield the assets to scan.}"""',
      "    yield Asset(",
      '        id="${2:1}",',
      '        name="${3:Example}",',
      '        content="${4:...}",',
      "    )",
    ].join("\n"),
  },
  {
    label: "def fetch_content",
    detail: "Optional: content on demand, per asset",
    insertText: [
      "def fetch_content(asset_id: str):",
      '    """${1:Return (raw, text) for one asset.}"""',
      "    return None",
    ].join("\n"),
  },
  {
    label: "def discover",
    detail: "Optional: what this source can see",
    insertText: ["def discover() -> dict:", "    return {}"].join("\n"),
  },
];

/** `import x`, `from x import y` -- but not the `y` half, which we know nothing about. */
const IMPORT_LINE = /^\s*(?:import|from)\s+[A-Za-z0-9_.]*$/;

function monacoKind(monaco: Monaco, kind: string) {
  const kinds = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "function":
      return kinds.Function;
    case "method":
      return kinds.Method;
    case "property":
      return kinds.Property;
    case "field":
      return kinds.Field;
    case "class":
      return kinds.Class;
    default:
      return kinds.Variable;
  }
}

let registered = false;

export function registerPythonCompletions(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  const snippetRule =
    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

  monaco.languages.registerCompletionItemProvider("python", {
    // `.` so member completion fires on `ctx.`, and `(`/`,` so constructor
    // fields appear while filling in an `Asset(...)`. Without these the list
    // only opens on an explicit Ctrl+Space, which nobody discovers.
    triggerCharacters: [".", "(", ","],

    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      // On an import line, offer what the runner has rather than the language:
      // every keyword and builtin in the list is noise where only a module name
      // can go, and the version is the thing an author cannot otherwise find.
      if (IMPORT_LINE.test(linePrefix)) {
        return {
          suggestions: [
            {
              label: manifest.module,
              kind: monaco.languages.CompletionItemKind.Module,
              detail: "Classifyre SDK",
              insertText: manifest.module,
              sortText: `0${manifest.module}`,
              range,
            },
            ...RUNTIME_MODULES.map(({ module, package: entry }) => ({
              label: module,
              kind: monaco.languages.CompletionItemKind.Module,
              detail: `${entry.name} ${entry.version}`,
              documentation:
                entry.availability === "always"
                  ? `${entry.name} ${entry.version} is installed in the scan runtime.`
                  : `${entry.name} ${entry.version} is installed automatically when this notebook imports it (uv group "${entry.group}").`,
              insertText: module,
              // Below the SDK, above nothing else -- this list is the whole
              // completion set on an import line.
              sortText: `1${module}`,
              range,
            })),
          ],
        };
      }

      // Member access: `ctx.` offers only what Context actually has, rather
      // than burying it under every keyword in the language.
      const member = /([A-Za-z_][A-Za-z0-9_]*)\.\s*[A-Za-z0-9_]*$/.exec(
        linePrefix,
      );
      if (member) {
        const target = manifest.objects[member[1]!];
        if (!target) return { suggestions: [] };
        return {
          suggestions: target.members.map((entry) => ({
            label: entry.label,
            kind: monacoKind(monaco, entry.kind),
            detail: entry.detail,
            documentation: entry.documentation,
            insertText: entry.insertText,
            insertTextRules: snippetRule,
            range,
          })),
        };
      }

      // Constructor keywords: inside `Asset(` offer its fields, required first.
      if (/\bAsset\s*\([^)]*$/.test(linePrefix)) {
        const fields = manifest.classes.Asset?.fields ?? [];
        return {
          suggestions: fields.map((field) => ({
            label: field.label,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: field.required
              ? `${field.detail} (required)`
              : field.detail,
            insertText: field.insertText,
            // Required fields sort above the rest.
            sortText: `${field.required ? "0" : "1"}${field.label}`,
            range,
          })),
        };
      }

      return {
        suggestions: [
          ...manifest.globals.map((entry) => ({
            label: entry.label,
            kind: monacoKind(monaco, entry.kind),
            detail: entry.detail,
            documentation: entry.documentation,
            insertText: entry.insertText,
            range,
          })),
          ...CONTRACT_SNIPPETS.map((snippet) => ({
            label: snippet.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: snippet.detail,
            insertText: snippet.insertText,
            insertTextRules: snippetRule,
            range,
          })),
          ...PYTHON_KEYWORDS.map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range,
          })),
          ...PYTHON_BUILTINS.map((builtin) => ({
            label: builtin,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: builtin,
            range,
          })),
        ],
      };
    },
  });

  monaco.languages.registerHoverProvider("python", {
    provideHover(model: editor.ITextModel, position: Position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const runtime = findRuntimeModule(word.word);
      if (runtime) {
        const { name, version, availability, group } = runtime.package;
        return {
          contents: [
            { value: `**${name}** \`${version}\`` },
            {
              value:
                availability === "always"
                  ? "Installed in the scan runtime."
                  : `Installed automatically when this notebook imports it (uv group \`${group}\`).`,
            },
          ],
        };
      }

      const entry =
        manifest.objects.ctx?.members.find((m) => m.label === word.word) ??
        manifest.globals.find((g) => g.label === word.word);
      if (!entry?.documentation) return null;
      return {
        contents: [
          {
            value: `**${entry.label}**${entry.detail ? ` \`${entry.detail}\`` : ""}`,
          },
          { value: entry.documentation },
        ],
      };
    },
  });
}
