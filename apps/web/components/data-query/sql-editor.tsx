"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position } from "monaco-editor";
import { Undo2, Redo2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Textarea } from "@workspace/ui/components/textarea";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalog } from "@/lib/data-query";

// Monaco reads `window` when its module loads: never in a server chunk.
const Editor = dynamic(() => import("@/components/monaco-editor-lazy"), {
  ssr: false,
});

/** The words completion details are written in, translated by the editor. */
export interface SqlCompletionLabels {
  /** `{{source}} · {{count}} tables you can query` for a schema. */
  schema: (source: string, count: number) => string;
  /** `{{name}} · {{count}} columns` for a table you can query. */
  table: (name: string, count: number) => string;
  /** `{{name}} (no access)` for a table you cannot. */
  locked: (name: string) => string;
  /** `{{source}} · {{count}} tables` for a source. */
  source: (source: string, count: number) => string;
}

/**
 * What each editor completes from, by its model: one SQL completion provider
 * serves every editor on the page (Monaco registers per language), and looks
 * up the catalog and words of the editor it is completing in — a source's
 * Data tab completes only that source, the SQL page the whole workspace.
 */
const completionContexts = new Map<
  string,
  { catalog: QueryCatalog | null; labels: SqlCompletionLabels }
>();
let providerRegistered = false;

const KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "GROUP BY ALL",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "JOIN",
  "LEFT JOIN",
  "INNER JOIN",
  "ON",
  "AS",
  "WITH",
  "UNION ALL",
  "DISTINCT",
  "COUNT(*)",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CASE WHEN",
  "EXCLUDE",
  "QUALIFY",
];

/**
 * Three levels of catalog completion, like Dremio's explorer but inline:
 * `source.` lists that source's schemas, `source.schema.` lists its tables
 * (with access marked), and a bare word offers sources first, then tables.
 * Anything already qualifying a name (`alias.` or a full `a.b.c.`) falls
 * through to columns of the tables named in the query.
 */
function registerCompletions(monaco: Monaco): void {
  if (providerRegistered) return;
  providerRegistered = true;
  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: ["."],
    provideCompletionItems(
      model: editor.ITextModel,
      position: Position,
    ): languages.CompletionList {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      // The word being typed narrows the list; the path before the dot
      // decides the level: `source`, `source.schema`, or an alias.
      const line = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const pathMatch = /([a-z0-9_]+(?:\.[a-z0-9_]+)*)\.([a-z0-9_]*)$/i.exec(
        line,
      );
      const suggestions: languages.CompletionItem[] = [];
      const context = completionContexts.get(model.uri.toString());
      if (!context) return { suggestions };
      const { labels } = context;
      const sources = context.catalog?.sources ?? [];
      const Kind = monaco.languages.CompletionItemKind;

      if (pathMatch) {
        const parts = pathMatch[1]!.toLowerCase().split(".");
        const typed = (pathMatch[2] ?? "").toLowerCase();
        const matches = (name: string) =>
          !typed || name.toLowerCase().startsWith(typed);

        if (parts.length === 1) {
          const source = sources.find((s) => s.sqlName === parts[0]);
          if (source) {
            // `source.`: the schemas inside it.
            const schemas = new Map<string, number>();
            for (const table of source.tables) {
              schemas.set(
                table.schema,
                (schemas.get(table.schema) ?? 0) + (table.canQuery ? 1 : 0),
              );
            }
            for (const [schema, queryable] of [...schemas].sort()) {
              if (!matches(schema)) continue;
              suggestions.push({
                label: schema,
                kind: Kind.Module,
                detail: labels.schema(source.name, queryable),
                insertText: schema,
                range,
              });
            }
            if (suggestions.length) return { suggestions };
          }
        }

        if (parts.length === 2) {
          const [sourceName, schemaName] = parts as [string, string];
          const source = sources.find((s) => s.sqlName === sourceName);
          if (source) {
            // `source.schema.`: the tables inside it.
            const tables = source.tables
              .filter(
                (t) => t.schema === schemaName && matches(t.table),
              )
              .sort((a, b) => a.table.localeCompare(b.table));
            for (const table of tables) {
              suggestions.push({
                label: table.table,
                kind: Kind.Struct,
                detail: table.canQuery
                  ? labels.table(table.name, table.columns.length)
                  : labels.locked(table.name),
                insertText: table.table,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              });
            }
            if (suggestions.length || tables.length) return { suggestions };
          }
        }

        // `alias.` or a full `source.schema.table.`: the columns of every
        // table named in the query — collected from FROM/JOIN, falling back
        // to any three-part name the text mentions.
        for (const column of columnsOfQueryTables(model.getValue(), sources)) {
          if (!matches(column.name)) continue;
          suggestions.push({
            label: column.name,
            kind: Kind.Field,
            detail: `${column.table} · ${column.type}`,
            insertText: column.name,
            range,
          });
        }
        return { suggestions };
      }

      // Bare word: sources first (they open the path above), then tables.
      for (const source of sources) {
        const queryable = source.tables.filter((t) => t.canQuery).length;
        if (!queryable) continue;
        suggestions.push({
          label: source.sqlName,
          kind: Kind.Folder,
          detail: labels.source(source.name, queryable),
          insertText: source.sqlName,
          range,
        });
      }
      for (const source of sources) {
        for (const table of source.tables) {
          if (!table.canQuery) continue;
          suggestions.push({
            label: table.sqlName,
            kind: Kind.Struct,
            detail: `${table.name} · ${source.name}`,
            insertText: table.sqlName,
            range,
          });
        }
      }
      for (const keyword of KEYWORDS) {
        suggestions.push({
          label: keyword,
          kind: Kind.Keyword,
          insertText: keyword,
          range,
        });
      }
      return { suggestions };
    },
  });
}

/**
 * Columns of the tables the query reads: aliases bound in FROM/JOIN first
 * (`FROM t AS a` makes `a.` offer t's columns), so `alias.` completes even
 * when the full name is never typed.
 */
function columnsOfQueryTables(
  sql: string,
  sources: QueryCatalog["sources"],
): Array<{ name: string; table: string; type: string }> {
  const bySqlName = new Map(
    sources.flatMap((s) => s.tables.map((t) => [t.sqlName, t] as const)),
  );
  const out: Array<{ name: string; table: string; type: string }> = [];
  const seen = new Set<string>();
  const push = (table: { sqlName: string; columns: { name: string; type: string }[] }) => {
    for (const column of table.columns) {
      const key = `${table.sqlName}.${column.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: column.name, table: table.sqlName, type: column.type });
    }
  };
  // FROM/JOIN clauses (with or without AS): `FROM src.sch.tbl [AS] alias`.
  const clause = /(?:from|join)\s+([a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+)(?:\s+(?:as\s+)?([a-z0-9_]+))?/gi;
  let foundAnyClause = false;
  for (let match = clause.exec(sql); match; match = clause.exec(sql)) {
    foundAnyClause = true;
    const table = bySqlName.get(match[1]!.toLowerCase());
    if (table) push(table);
  }
  if (foundAnyClause) return out;
  // No FROM yet: any three-part name in the text.
  const name = /([a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+)/gi;
  for (let match = name.exec(sql); match; match = name.exec(sql)) {
    const table = bySqlName.get(match[1]!.toLowerCase());
    if (table) push(table);
  }
  return out;
}

/** What the workbench beside the editor may do to it. */
export interface SqlEditorHandle {
  /** Insert where the cursor stands (the explorer's table and column names). */
  insert: (text: string) => void;
  /**
   * Replace everything as one undoable edit (history, saved, previews): one
   * Ctrl/Cmd+Z brings back what was on screen before.
   */
  replaceAll: (text: string) => void;
}

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onFormat?: () => void;
  catalog: QueryCatalog | null;
  height?: number | string;
  /** Distinct per editor, so each keeps its own undo history. */
  path: string;
  /** React 19: `ref` arrives as a prop. */
  ref?: React.Ref<SqlEditorHandle>;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  onFormat,
  catalog,
  height = 220,
  path,
  ref,
}: SqlEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const runRef = React.useRef(onRun);
  runRef.current = onRun;
  const formatRef = React.useRef(onFormat);
  formatRef.current = onFormat;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const [, bumpHistory] = React.useState(0);
  const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);
  const modelKey = React.useRef<string | null>(null);
  // Edits asked for before Monaco finished loading (it loads lazily): the
  // textarea fallback shows `value` meanwhile, and these apply on mount.
  const pending = React.useRef<Array<(e: editor.IStandaloneCodeEditor) => void>>([]);

  const labels = React.useMemo<SqlCompletionLabels>(
    () => ({
      schema: (source, count) =>
        t("dataQuery.completion.schema", { source, count }),
      table: (name, count) => t("dataQuery.completion.table", { name, count }),
      locked: (name) => t("dataQuery.completion.locked", { name }),
      source: (source, count) =>
        t("dataQuery.completion.source", { source, count }),
    }),
    [t],
  );

  // This editor's catalog and words, under its model's uri.
  React.useEffect(() => {
    const key = modelKey.current;
    if (key) completionContexts.set(key, { catalog, labels });
  }, [catalog, labels]);
  React.useEffect(
    () => () => {
      if (modelKey.current) completionContexts.delete(modelKey.current);
    },
    [],
  );

  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;
  const labelsRef = React.useRef(labels);
  labelsRef.current = labels;

  const handleMount = React.useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = instance;
      registerCompletions(monaco);
      const key = instance.getModel()?.uri.toString() ?? null;
      modelKey.current = key;
      if (key) {
        completionContexts.set(key, {
          catalog: catalogRef.current,
          labels: labelsRef.current,
        });
      }
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        runRef.current(),
      );
      instance.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        () => formatRef.current?.(),
      );
      // Undo/redo across every programmatic replace (history reopen,
      // preview, template), not just keystrokes: Monaco's own stack covers
      // them — the buttons only need to re-render when it changes.
      instance.onDidChangeModelContent(() => bumpHistory((n) => n + 1));
      for (const apply of pending.current.splice(0)) apply(instance);
    },
    [],
  );

  /** Runs now on a mounted editor, or once Monaco has loaded. */
  const withEditor = React.useCallback(
    (apply: (instance: editor.IStandaloneCodeEditor) => void) => {
      const instance = editorRef.current;
      if (instance) apply(instance);
      else pending.current.push(apply);
    },
    [],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      insert: (text) =>
        withEditor((instance) => {
          insertAtCursor(instance, text);
          onChangeRef.current(instance.getValue());
          instance.focus();
        }),
      replaceAll: (text) => {
        // The textarea fallback reads `value`: keep it current right away.
        if (!editorRef.current) onChangeRef.current(text);
        withEditor((instance) => {
          const model = instance.getModel();
          if (model) {
            instance.executeEdits("replace-all", [
              { range: model.getFullModelRange(), text },
            ]);
          }
          onChangeRef.current(instance.getValue());
          instance.focus();
        });
      },
    }),
    [withEditor],
  );

  const undo = React.useCallback(() => {
    const instance = editorRef.current;
    if (!instance) return;
    instance.trigger("history", "undo", null);
    onChangeRef.current(instance.getValue());
  }, []);

  const redo = React.useCallback(() => {
    const instance = editorRef.current;
    if (!instance) return;
    instance.trigger("history", "redo", null);
    onChangeRef.current(instance.getValue());
  }, []);

  return (
    <EditorShell
      value={value}
      onChange={onChange}
      handleMount={handleMount}
      resolvedTheme={resolvedTheme}
      height={height}
      path={path}
      undo={undo}
      redo={redo}
      undoLabel={t("dataQuery.editor.undo")}
      redoLabel={t("dataQuery.editor.redo")}
    />
  );
}

/** Insert where the cursor stands, replacing the selection when there is one. */
function insertAtCursor(
  instance: editor.IStandaloneCodeEditor,
  text: string,
): void {
  const selection = instance.getSelection();
  const range =
    selection ??
    (() => {
      const position = instance.getPosition();
      if (!position) return null;
      return {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
    })();
  if (!range) return;
  instance.executeEdits("catalog-insert", [
    {
      range,
      text,
      forceMoveMarkers: true,
    },
  ]);
  instance.revealPositionInCenterIfOutsideViewport({
    lineNumber: range.startLineNumber,
    column: range.startColumn + text.length,
  });
}

function EditorShell({
  value,
  onChange,
  handleMount,
  resolvedTheme,
  height,
  path,
  undo,
  redo,
  undoLabel,
  redoLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  handleMount: (
    instance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => void;
  resolvedTheme: string | undefined;
  height: number | string;
  path: string;
  undo: () => void;
  redo: () => void;
  undoLabel: string;
  redoLabel: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-md border bg-background"
      data-testid="sql-editor"
    >
      <div className="absolute right-8 top-1 z-10 flex gap-0.5 rounded border bg-background/90 shadow-sm">
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={undo}
          title={undoLabel}
          aria-label={undoLabel}
          data-testid="sql-undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={redo}
          title={redoLabel}
          aria-label={redoLabel}
          data-testid="sql-redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <Editor
        height={height}
        defaultLanguage="sql"
        path={path}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        onMount={handleMount}
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        loading={
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-full rounded-none border-0 font-mono text-sm"
          />
        }
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          folding: false,
          renderLineHighlight: "none",
          padding: { top: 8, bottom: 8 },
          fontSize: 13,
          tabSize: 2,
          wordWrap: "on",
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
        }}
      />
    </div>
  );
}
