"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunnerLogEntryDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import { Toggle } from "@workspace/ui/components/toggle";
import { cn } from "@workspace/ui/lib/utils";
import {
  Copy,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Search,
} from "lucide-react";
import { formatLogTimestamp } from "@/lib/date";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

type LogLevel =
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL"
  | "UNKNOWN";

type ParsedLogEntry = {
  entry: RunnerLogEntryDto;
  level: LogLevel;
  message: string;
  structured: Record<string, unknown> | null;
  searchText: string;
};

export interface RunnerLogViewerProps {
  runnerId: string;
  entries: RunnerLogEntryDto[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  isRunning: boolean;
  autoRefreshEnabled: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onLoadMore: () => Promise<void> | void;
  onRefreshNow?: () => Promise<void> | void;
  onDownloadAll?: () => Promise<RunnerLogEntryDto[]>;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  TRACE: "border-muted-foreground/30 text-muted-foreground",
  DEBUG: "border-cyan-500/40 text-cyan-600 dark:text-cyan-400",
  INFO: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  WARN: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  ERROR: "border-red-500/40 text-red-600 dark:text-red-400",
  FATAL: "border-red-700/50 text-red-700 dark:text-red-300",
  UNKNOWN: "border-muted-foreground/30 text-muted-foreground",
};

function parseStructuredPayload(
  message: string,
): Record<string, unknown> | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeLevel(rawLevel: unknown): LogLevel {
  if (typeof rawLevel !== "string") {
    return "UNKNOWN";
  }

  switch (rawLevel.toUpperCase()) {
    case "TRACE":
      return "TRACE";
    case "DEBUG":
      return "DEBUG";
    case "INFO":
      return "INFO";
    case "WARN":
    case "WARNING":
      return "WARN";
    case "ERROR":
      return "ERROR";
    case "FATAL":
    case "CRITICAL":
      return "FATAL";
    default:
      return "UNKNOWN";
  }
}

function inferLevel(
  entry: RunnerLogEntryDto,
  structured: Record<string, unknown> | null,
  message: string,
): LogLevel {
  const structuredLevel = normalizeLevel(
    structured?.level ?? structured?.severity,
  );
  if (structuredLevel !== "UNKNOWN") {
    return structuredLevel;
  }

  const matched = message.match(
    /\b(trace|debug|info|warn(?:ing)?|error|fatal|critical)\b/i,
  );
  if (matched?.[1]) {
    return normalizeLevel(matched[1]);
  }

  if (entry.stream === "stderr") {
    return "ERROR";
  }

  return "UNKNOWN";
}

function inferMessage(
  structured: Record<string, unknown> | null,
  rawMessage: string,
): string {
  const structuredMessage = structured?.message ?? structured?.msg;
  if (
    typeof structuredMessage === "string" &&
    structuredMessage.trim().length > 0
  ) {
    return structuredMessage.trim();
  }
  return rawMessage.trim();
}

function formatRowTimestamp(iso?: string | null): string {
  return formatLogTimestamp(iso);
}

function formatExportTimestamp(iso?: string | null): string {
  if (!iso) {
    return new Date().toISOString();
  }
  return iso;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(content: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function RunnerLogViewer({
  runnerId,
  entries,
  hasMore,
  loading,
  loadingMore,
  isRunning,
  autoRefreshEnabled,
  onAutoRefreshChange,
  onLoadMore,
  onRefreshNow,
  onDownloadAll,
}: RunnerLogViewerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedCursor, setSelectedCursor] = useState<string | null>(null);
  const [selectedCursors, setSelectedCursors] = useState<Set<string>>(
    () => new Set(),
  );
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [following, setFollowing] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  const parsedEntries = useMemo<ParsedLogEntry[]>(() => {
    return entries.map((entry) => {
      const structured = parseStructuredPayload(entry.message);
      const message = inferMessage(structured, entry.message);
      const level = inferLevel(entry, structured, message);
      return {
        entry,
        level,
        message,
        structured,
        searchText: message.toLowerCase(),
      };
    });
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return parsedEntries.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }
      return item.searchText.includes(normalizedQuery);
    });
  }, [parsedEntries, query]);

  const selectedEntry = useMemo(() => {
    if (!selectedCursor) {
      return null;
    }
    return (
      filteredEntries.find((item) => item.entry.cursor === selectedCursor) ??
      null
    );
  }, [filteredEntries, selectedCursor]);

  const selectedRows = useMemo(() => {
    if (selectedCursors.size === 0) {
      return [];
    }
    const selected = new Set(selectedCursors);
    return filteredEntries.filter((item) => selected.has(item.entry.cursor));
  }, [filteredEntries, selectedCursors]);

  const handleScroll = useCallback(() => {
    const container = listRef.current;
    if (!container) {
      return;
    }
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      36;
    setFollowing(nearBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = listRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
    setFollowing(true);
  }, []);

  useEffect(() => {
    if (!following) {
      return;
    }
    const container = listRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [following, filteredEntries.length]);

  const exportRows = useCallback((rows: ParsedLogEntry[]) => {
    return rows
      .map((item) => {
        const ts = formatExportTimestamp(item.entry.timestamp);
        return `${ts} [${item.level}] ${item.message}`;
      })
      .join("\n");
  }, []);

  const toggleRowSelection = useCallback((cursor: string) => {
    setSelectedCursors((prev) => {
      const next = new Set(prev);
      if (next.has(cursor)) {
        next.delete(cursor);
      } else {
        next.add(cursor);
      }
      return next;
    });
  }, []);

  const handleSelectAllVisible = useCallback(() => {
    if (filteredEntries.length === 0) {
      return;
    }
    setSelectedCursors(
      new Set(filteredEntries.map((item) => item.entry.cursor)),
    );
  }, [filteredEntries]);

  const handleClearSelection = useCallback(() => {
    setSelectedCursors(new Set());
  }, []);

  const handleCopySelected = useCallback(async () => {
    if (selectedRows.length === 0) {
      toast.error(t("runners.logs.noRowsToCopy"));
      return;
    }

    try {
      await copyTextToClipboard(exportRows(selectedRows));
      toast.success(t("runners.logs.copiedRows", { count: String(selectedRows.length.toLocaleString()) }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to copy rows";
      toast.error(message);
    }
  }, [exportRows, selectedRows, t]);

  const handleDownloadVisible = useCallback(() => {
    if (filteredEntries.length === 0) {
      toast.error(t("runners.logs.noLogsDownload"));
      return;
    }
    const filename = `runner-${runnerId}-logs-visible.log`;
    downloadTextFile(filename, exportRows(filteredEntries));
    toast.success(t("runners.logs.downloaded"));
  }, [exportRows, filteredEntries, runnerId, t]);

  const handleDownloadAll = useCallback(async () => {
    if (!onDownloadAll) {
      handleDownloadVisible();
      return;
    }

    try {
      setIsDownloadingAll(true);
      const allEntries = await onDownloadAll();
      if (!allEntries.length) {
        toast.error("No logs available for download");
        return;
      }
      const parsed = allEntries.map((entry) => {
        const structured = parseStructuredPayload(entry.message);
        const message = inferMessage(structured, entry.message);
        return {
          entry,
          level: inferLevel(entry, structured, message),
          message,
        };
      });

      const content = parsed
        .map((item) => {
          const ts = formatExportTimestamp(item.entry.timestamp);
          return `${ts} [${item.level}] ${item.message}`;
        })
        .join("\n");

      downloadTextFile(`runner-${runnerId}-logs-all.log`, content);
      toast.success(
        `Downloaded ${allEntries.length.toLocaleString()} log entries`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to download logs";
      toast.error(message);
    } finally {
      setIsDownloadingAll(false);
    }
  }, [handleDownloadVisible, onDownloadAll, runnerId]);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Logs</CardTitle>
            <CardDescription>
              Parsed runner logs with level extraction
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Auto refresh</span>
            <Toggle
              variant="outline"
              size="sm"
              pressed={autoRefreshEnabled}
              onPressedChange={onAutoRefreshChange}
            >
              {autoRefreshEnabled ? "On" : "Off"}
            </Toggle>
            <span className="text-xs text-muted-foreground">Wrap lines</span>
            <Toggle
              variant="outline"
              size="sm"
              pressed={wrapLines}
              onPressedChange={setWrapLines}
            >
              {wrapLines ? "On" : "Off"}
            </Toggle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onRefreshNow?.()}
              disabled={!onRefreshNow}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadVisible}>
              <Download className="mr-2 h-4 w-4" />
              Download Visible
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownloadAll()}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download All
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search message"
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAllVisible}
            disabled={filteredEntries.length === 0}
          >
            Select Visible
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearSelection}
            disabled={selectedCursors.size === 0}
          >
            Clear Selection
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCopySelected()}
            disabled={selectedRows.length === 0}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy Selected
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedRows.length.toLocaleString()} selected
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No Logs Available"
            description="No log entries match your search."
          />
        ) : (
          <div className="relative overflow-hidden rounded-md border bg-background">
            <div className="hidden border-b bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:grid md:grid-cols-[30px_120px_84px_1fr] md:gap-3">
              <span />
              <span>Time</span>
              <span>Level</span>
              <span>Message</span>
            </div>
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="max-h-[420px] overflow-y-auto"
            >
              {filteredEntries.map((item) => {
                const isDetailOpen = selectedCursor === item.entry.cursor;
                const isRowSelected = selectedCursors.has(item.entry.cursor);
                return (
                  <div
                    key={item.entry.cursor}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setSelectedCursor(isDetailOpen ? null : item.entry.cursor)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCursor(
                          isDetailOpen ? null : item.entry.cursor,
                        );
                      }
                    }}
                    className={cn(
                      "w-full border-b px-3 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer",
                      isDetailOpen && "bg-muted/60",
                      isRowSelected && "ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <div className="grid gap-1 md:hidden">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isRowSelected}
                          onCheckedChange={() =>
                            toggleRowSelection(item.entry.cursor)
                          }
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select log row ${item.entry.cursor}`}
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatRowTimestamp(item.entry.timestamp)}
                        </span>
                        <Badge
                          variant="outline"
                          className={LEVEL_CLASS[item.level]}
                        >
                          {item.level}
                        </Badge>
                      </div>
                      <p
                        className={cn(
                          "font-mono text-xs break-all",
                          wrapLines ? "whitespace-pre-wrap" : "line-clamp-2",
                        )}
                      >
                        {item.message}
                      </p>
                    </div>
                    <div className="hidden items-start gap-3 font-mono text-xs md:grid md:grid-cols-[30px_120px_84px_1fr]">
                      <div className="pt-0.5">
                        <Checkbox
                          checked={isRowSelected}
                          onCheckedChange={() =>
                            toggleRowSelection(item.entry.cursor)
                          }
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select log row ${item.entry.cursor}`}
                        />
                      </div>
                      <span className="text-muted-foreground">
                        {formatRowTimestamp(item.entry.timestamp)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "justify-center",
                          LEVEL_CLASS[item.level],
                        )}
                      >
                        {item.level}
                      </Badge>
                      <span
                        className={cn(
                          "break-all",
                          wrapLines ? "whitespace-pre-wrap" : "truncate",
                        )}
                      >
                        {item.message}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {!following && (
              <div className="pointer-events-none absolute bottom-3 right-3">
                <Button
                  size="sm"
                  className="pointer-events-auto"
                  onClick={jumpToLatest}
                >
                  Jump To Latest
                </Button>
              </div>
            )}
          </div>
        )}

        {selectedEntry && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Badge
                variant="outline"
                className={LEVEL_CLASS[selectedEntry.level]}
              >
                {selectedEntry.level}
              </Badge>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
              <p className="font-mono">
                timestamp: {selectedEntry.entry.timestamp ?? "n/a"}
              </p>
              <p className="font-mono">cursor: {selectedEntry.entry.cursor}</p>
            </div>
            <p className="mt-2 break-all font-mono text-xs">
              {selectedEntry.message}
            </p>
            {selectedEntry.structured && (
              <pre className="mt-2 max-h-52 overflow-auto rounded bg-background p-2 text-xs">
                {JSON.stringify(selectedEntry.structured, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {isRunning
              ? autoRefreshEnabled
                ? "Auto refresh enabled (every 2s)"
                : "Auto refresh paused"
              : "Runner completed"}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Showing {filteredEntries.length.toLocaleString()} /{" "}
              {entries.length.toLocaleString()} loaded
            </span>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onLoadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Load Newer
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
