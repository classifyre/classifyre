"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position } from "monaco-editor";
import { Undo2, Redo2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Textarea } from "@workspace/ui/components/textarea";
import type { QueryCatalog } from "@/lib/data-query";

// Monaco reads `window` when its module loads: never in a server chunk.
const Editor = dynamic(() => import("@/components/monaco-editor-lazy"), {
  ssr: false,
});

/**
 * The catalog completions are read from. One SQL completion provider serves
 * every editor on the page, so it reads whatever catalog the last mounted
 * editor was given rather than registering one provider per editor.
 */
let completionCatalog: QueryCatalog | null = null;
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
      const sources = completionCatalog?.sources ?? [];
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
                detail: `${source.name} · ${queryable} tables you can query`,
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
                  ? `${table.name} · ${table.columns.length} columns`
                  : `${table.name} (no access)`,
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
          detail: `${source.name} · ${queryable} tables`,
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
  sources: NonNullable<typeof completionCatalog>["sources"],
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

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onFormat?: () => void;
  catalog: QueryCatalog | null;
  height?: number | string;
  /** Distinct per editor, so each keeps its own undo history. */
  path: string;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  onFormat,
  catalog,
  height = 220,
  path,
}: SqlEditorProps) {
  const { resolvedTheme } = useTheme();
  const runRef = React.useRef(onRun);
  runRef.current = onRun;
  const formatRef = React.useRef(onFormat);
  formatRef.current = onFormat;
  const [, bumpHistory] = React.useState(0);

  React.useEffect(() => {
    completionCatalog = catalog;
  }, [catalog]);

  /**
   * Insert text where the cursor stands — a table from the explorer lands
   * exactly where a table belongs, never appended to the wrong clause.
   * Returns the text after the edit, so the caller's state stays in sync with
   * what Monaco shows (and undo keeps working).
   */
  const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount = React.useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = instance;
      registerCompletions(monaco);
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        runRef.current(),
      );
      instance.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        () => formatRef.current?.(),
      );
      // Browser memory: undo/redo across every programmatic replace
      // (history reopen, preview, template), not just keystrokes. Monaco's
      // own stack already covers all of these — the buttons below just need
      // to be told when it changed.
      const historyListener = instance.onDidChangeModelContent(() =>
        bumpHistory((n) => n + 1),
      );
      return historyListener.dispose.bind(historyListener);
    },
    [],
  );

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const pending = (SqlEditor as { pendingInsert?: string }).pendingInsert;
    if (pending) {
      delete (SqlEditor as { pendingInsert?: string }).pendingInsert;
      insertAtCursor(editor, pending);
      onChange(editor.getValue());
      editor.focus();
    }
  });

  const replaceAll = React.useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) {
        (SqlEditor as { pendingReplace?: string }).pendingReplace = text;
        onChange(text);
        return;
      }
      const model = editor.getModel();
      // A full-model edit, so one Ctrl/Cmd+Z restores exactly what was on
      // screen before the reopen — programmatic memory for free. Empty
      // models need a range too: push a no-op edit first.
      if (model) {
        const fullRange = model.getFullModelRange();
        editor.executeEdits("history-reopen", [{ range: fullRange, text }]);
      } else {
        onChange(text);
      }
      onChange(editor.getValue());
      editor.focus();
    },
    [onChange],
  );

  // The workbench's history/saved reopen funnels through here.
  (SqlEditor as { replaceAll?: (text: string) => void }).replaceAll =
    replaceAll;

  const undo = React.useCallback(() => {
    editorRef.current?.trigger("history", "undo", null);
    const editor = editorRef.current;
    if (editor) onChange(editor.getValue());
  }, [onChange]);

  const redo = React.useCallback(() => {
    editorRef.current?.trigger("history", "redo", null);
    const editor = editorRef.current;
    if (editor) onChange(editor.getValue());
  }, [onChange]);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const pending = (SqlEditor as { pendingReplace?: string }).pendingReplace;
    if (pending !== undefined) {
      delete (SqlEditor as { pendingReplace?: string }).pendingReplace;
      replaceAll(pending);
    }
  });

  return (
    <SqlEditorInsertContext.Provider
      value={React.useCallback((text: string) => {
        const editor = editorRef.current;
        if (!editor) {
          (SqlEditor as { pendingInsert?: string }).pendingInsert = text;
          return;
        }
        insertAtCursor(editor, text);
        onChange(editor.getValue());
        editor.focus();
      }, [onChange])}
    >
      <EditorShell
        value={value}
        onChange={onChange}
        handleMount={handleMount}
        resolvedTheme={resolvedTheme}
        height={height}
        path={path}
        undo={undo}
        redo={redo}
      />
    </SqlEditorInsertContext.Provider>
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

const SqlEditorInsertContext = React.createContext<(text: string) => void>(
  () => undefined,
);

/** The nearest editor's cursor-aware insert, for explorer buttons beside it. */
export function useSqlInsert(): (text: string) => void {
  return React.useContext(SqlEditorInsertContext);
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
          title="Undo (Ctrl/Cmd+Z)"
          data-testid="sql-undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={redo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
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
