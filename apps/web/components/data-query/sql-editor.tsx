"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position } from "monaco-editor";
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
      const line = model
        .getLineContent(position.lineNumber)
        .slice(0, word.startColumn - 1);
      const dotted = /([a-z0-9_]+(?:\.[a-z0-9_]+)*)\.$/i.exec(line)?.[1];
      const suggestions: languages.CompletionItem[] = [];
      const sources = completionCatalog?.sources ?? [];
      const Kind = monaco.languages.CompletionItemKind;

      if (dotted) {
        const parts = dotted.toLowerCase().split(".");
        for (const source of sources) {
          if (parts.length === 1 && source.sqlName === parts[0]) {
            const schemas = new Set(source.tables.map((t) => t.schema));
            for (const schema of schemas) {
              suggestions.push({
                label: schema,
                kind: Kind.Module,
                insertText: schema,
                range,
              });
            }
          }
          for (const table of source.tables) {
            if (
              parts.length === 2 &&
              source.sqlName === parts[0] &&
              table.schema === parts[1]
            ) {
              suggestions.push({
                label: table.table,
                kind: Kind.Struct,
                detail: table.canQuery
                  ? table.name
                  : `${table.name} (no access)`,
                insertText: table.table,
                range,
              });
            }
          }
        }
        // `alias.` or `table.`: offer the columns of every table in the query.
        if (!suggestions.length) {
          const text = model.getValue().toLowerCase();
          for (const source of sources) {
            for (const table of source.tables) {
              if (!text.includes(table.sqlName)) continue;
              for (const column of table.columns) {
                suggestions.push({
                  label: column.name,
                  kind: Kind.Field,
                  detail: `${table.sqlName} · ${column.type}`,
                  insertText: column.name,
                  range,
                });
              }
            }
          }
        }
        return { suggestions };
      }

      for (const source of sources) {
        for (const table of source.tables) {
          if (!table.canQuery) continue;
          suggestions.push({
            label: table.sqlName,
            kind: Kind.Struct,
            detail: table.name,
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

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  catalog: QueryCatalog | null;
  height?: number | string;
  /** Distinct per editor, so each keeps its own undo history. */
  path: string;
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  catalog,
  height = 220,
  path,
}: SqlEditorProps) {
  const { resolvedTheme } = useTheme();
  const runRef = React.useRef(onRun);
  runRef.current = onRun;

  React.useEffect(() => {
    completionCatalog = catalog;
  }, [catalog]);

  const handleMount = React.useCallback(
    (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      registerCompletions(monaco);
      instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        runRef.current(),
      );
    },
    [],
  );

  return (
    <div
      className="overflow-hidden rounded-md border bg-background"
      data-testid="sql-editor"
    >
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
