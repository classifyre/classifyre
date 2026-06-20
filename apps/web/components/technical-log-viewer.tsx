"use client";

import * as React from "react";
import { Terminal } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

export interface TechnicalLogEntry {
  id?: string;
  timestamp: string;
  level: string;
  message: string;
  payload?: object | null;
}

const LEVEL_COLOR: Record<string, string> = {
  TRACE: "text-stone-500",
  DEBUG: "text-stone-400",
  INFO: "text-emerald-400",
  WARN: "text-amber-400",
  ERROR: "text-red-400",
  FATAL: "text-red-600",
  UNKNOWN: "text-stone-400",
};

export interface TechnicalLogViewerProps {
  entries: TechnicalLogEntry[];
  maxHeight?: string;
  className?: string;
  wrapLines?: boolean;
  renderActions?: (entry: TechnicalLogEntry) => React.ReactNode;
}

export function TechnicalLogViewer({
  entries,
  maxHeight = "max-h-[520px]",
  className,
  wrapLines = true,
  renderActions,
}: TechnicalLogViewerProps) {
  return (
    <div
      className={cn(
        "overflow-y-auto rounded-[4px] border-2 border-stone-700 bg-stone-900 px-3 py-2 font-mono text-[11px] leading-[1.15] text-stone-200",
        maxHeight,
        className,
      )}
    >
      {entries.map((l, idx) => {
        const key = l.id ?? idx;
        return (
          <div key={key}>
            <div className="group flex items-start gap-1">
              <span className="shrink-0 text-stone-500">
                {l.timestamp}{" "}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  LEVEL_COLOR[l.level] ?? "text-stone-300",
                )}
              >
                [{l.level}]
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1",
                  wrapLines ? "whitespace-pre-wrap break-words" : "truncate",
                )}
              >
                {l.message}
              </span>
              {renderActions && (
                <span className="shrink-0">{renderActions(l)}</span>
              )}
            </div>
            {l.payload && (
              <details className="ml-5 mt-0.5">
                <summary className="cursor-pointer text-stone-500 hover:text-stone-300">
                  <Terminal className="mr-1 inline h-3 w-3" />
                  payload
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-950 p-2 text-[10px] text-stone-300">
                  {JSON.stringify(l.payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
