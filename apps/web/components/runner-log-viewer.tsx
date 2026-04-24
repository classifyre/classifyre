"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunnerLogEntryDto, RunnerLogEntryDtoLevelEnum } from "@workspace/api-client";
import { RunnerLogEntryDtoLevelEnum as LevelEnum } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import { Toggle } from "@workspace/ui/components/toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Check,
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

type LogLevel = RunnerLogEntryDtoLevelEnum;
type SortOrder = "asc" | "desc";

export interface LogFetchParams {
  cursor?: string;
  take?: number;
  search?: string;
  levels?: string[];
  sortOrder?: SortOrder;
}

export interface RunnerLogViewerProps {
  runnerId: string;
  entries: RunnerLogEntryDto[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  isRunning: boolean;
  autoRefreshEnabled: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onFetch: (params: LogFetchParams, append: boolean) => Promise<void>;
  nextCursor: string | null;
  onDownloadAll?: () => Promise<RunnerLogEntryDto[]>;
}

const ALL_LEVELS: LogLevel[] = [
  LevelEnum.Trace,
  LevelEnum.Debug,
  LevelEnum.Info,
  LevelEnum.Warn,
  LevelEnum.Error,
  LevelEnum.Fatal,
  LevelEnum.Unknown,
];

const LEVEL_CLASS: Record<LogLevel, string> = {
  TRACE: "border-muted-foreground/30 text-muted-foreground",
  DEBUG: "border-cyan-500/40 text-cyan-600 dark:text-cyan-400",
  INFO: "border-blue-500/40 text-blue-600 dark:text-blue-400",
  WARN: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  ERROR: "border-red-500/40 text-red-600 dark:text-red-400",
  FATAL: "border-red-700/50 text-red-700 dark:text-red-300",
  UNKNOWN: "border-muted-foreground/30 text-muted-foreground",
};

function formatExportTimestamp(iso?: string | null): string {
  return iso ?? new Date().toISOString();
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

async function copyText(content: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation();

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    copyText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
      title={t("runners.logs.copyRow")}
      onClick={handleClick}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
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
  onFetch,
  nextCursor,
  onDownloadAll,
}: RunnerLogViewerProps) {
  const { t } = useTranslation();

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [wrapLines, setWrapLines] = useState(true);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Re-fetch when filters/sort change (always reset to first page)
  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    void onFetch({ cursor: "0", search, levels: levelFilter, sortOrder }, false);
  }, [search, levelFilter, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (sortOrder === "asc") {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 36;
      setFollowing(nearBottom);
    } else {
      setFollowing(el.scrollTop < 36);
    }
  }, [sortOrder]);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = sortOrder === "asc" ? el.scrollHeight : 0;
    setFollowing(true);
  }, [sortOrder]);

  useEffect(() => {
    if (!following) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = sortOrder === "asc" ? el.scrollHeight : 0;
  }, [following, entries.length, sortOrder]);

  useEffect(() => {
    setFollowing(true);
  }, [sortOrder]);

  const exportEntries = useCallback((rows: RunnerLogEntryDto[]) => {
    return rows
      .map((e) => `${formatExportTimestamp(e.timestamp)} [${e.level}] ${e.message}`)
      .join("\n");
  }, []);

  const handleDownloadVisible = useCallback(() => {
    if (entries.length === 0) {
      toast.error(t("runners.logs.noLogsDownload"));
      return;
    }
    downloadTextFile(`runner-${runnerId}-logs-visible.log`, exportEntries(entries));
    toast.success(t("runners.logs.downloaded"));
  }, [entries, exportEntries, runnerId, t]);

  const handleDownloadAll = useCallback(async () => {
    if (!onDownloadAll) {
      handleDownloadVisible();
      return;
    }
    try {
      setIsDownloadingAll(true);
      const all = await onDownloadAll();
      if (!all.length) {
        toast.error(t("runners.logs.noLogsDownload"));
        return;
      }
      downloadTextFile(`runner-${runnerId}-logs-all.log`, exportEntries(all));
      toast.success(t("runners.logs.downloadedCount", { count: String(all.length.toLocaleString()) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("runners.logs.noLogsDownload"));
    } finally {
      setIsDownloadingAll(false);
    }
  }, [exportEntries, handleDownloadVisible, onDownloadAll, runnerId, t]);

  const handleLoadMore = useCallback(() => {
    void onFetch(
      { cursor: nextCursor ?? undefined, search, levels: levelFilter, sortOrder },
      true,
    );
  }, [onFetch, nextCursor, search, levelFilter, sortOrder]);

  const showInitialLoading = loading && entries.length === 0;

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t("runners.logs.title")}</CardTitle>
            <CardDescription>{t("runners.logs.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isRunning && (
              <>
                <span className="text-xs text-muted-foreground">
                  {t("runners.logs.autoRefresh")}
                </span>
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={autoRefreshEnabled}
                  onPressedChange={onAutoRefreshChange}
                >
                  {autoRefreshEnabled ? t("common.on") : t("common.off")}
                </Toggle>
              </>
            )}
            <span className="text-xs text-muted-foreground">
              {t("runners.logs.wrapLines")}
            </span>
            <Toggle
              variant="outline"
              size="sm"
              pressed={wrapLines}
              onPressedChange={setWrapLines}
            >
              {wrapLines ? t("common.on") : t("common.off")}
            </Toggle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onFetch({ cursor: "0", search, levels: levelFilter, sortOrder }, false)}
              disabled={loading}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("runners.logs.refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadVisible}>
              <Download className="mr-2 h-4 w-4" />
              {t("runners.logs.downloadVisible")}
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
              {t("runners.logs.downloadAll")}
            </Button>
          </div>
        </div>

        {/* Filter bar — mirrors assets-table pattern */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("runners.logs.search")}
              className="h-9 pl-9 border-2 border-black rounded-[4px]"
            />
          </div>

          <MultiSelect
            values={levelFilter}
            onValuesChange={(values) => setLevelFilter(values as string[])}
          >
            <MultiSelectTrigger className="h-9 w-[180px] border-2 border-black rounded-[4px]">
              <MultiSelectValue placeholder={t("runners.logs.allLevels")} />
            </MultiSelectTrigger>
            <MultiSelectContent
              search={{
                placeholder: t("runners.logs.searchLevels"),
                emptyMessage: t("runners.logs.noLevelsFound"),
              }}
            >
              <MultiSelectGroup>
                {ALL_LEVELS.map((level) => (
                  <MultiSelectItem key={level} value={level}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 font-mono text-xs",
                        LEVEL_CLASS[level],
                      )}
                    >
                      {level}
                    </span>
                  </MultiSelectItem>
                ))}
              </MultiSelectGroup>
            </MultiSelectContent>
          </MultiSelect>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-2 border-black rounded-[4px]"
            onClick={() =>
              setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
            }
          >
            {sortOrder === "desc" ? (
              <>
                <ArrowDown className="h-3.5 w-3.5" />
                {t("runners.logs.newestFirst")}
              </>
            ) : (
              <>
                <ArrowUp className="h-3.5 w-3.5" />
                {t("runners.logs.oldestFirst")}
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t("runners.logs.noLogs")}
            description={t("runners.logs.noLogsHint")}
          />
        ) : (
          <div className="relative overflow-hidden rounded-[4px] border bg-background">
            {/* Header row */}
            <div className="hidden border-b bg-muted/40 px-3 py-2 md:grid md:grid-cols-[120px_84px_1fr_32px] md:gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("runners.logs.columns.time")}
              </span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("runners.logs.columns.level")}
              </span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t("runners.logs.columns.message")}
              </span>
              <span />
            </div>

            <div
              ref={listRef}
              onScroll={handleScroll}
              className="max-h-[520px] overflow-y-auto"
            >
              {entries.map((entry) => (
                <div
                  key={entry.cursor}
                  className="group w-full border-b px-3 py-2"
                >
                  {/* Mobile */}
                  <div className="flex flex-col gap-1 md:hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatLogTimestamp(entry.timestamp)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] uppercase",
                          LEVEL_CLASS[entry.level as LogLevel],
                        )}
                      >
                        {entry.level}
                      </Badge>
                    </div>
                    <p
                      className={cn(
                        "font-mono text-xs break-all",
                        wrapLines ? "whitespace-pre-wrap" : "line-clamp-2",
                      )}
                    >
                      {entry.message}
                    </p>
                  </div>

                  {/* Desktop */}
                  <div className="hidden items-start gap-3 font-mono text-xs md:grid md:grid-cols-[120px_84px_1fr_32px]">
                    <span className="text-muted-foreground">
                      {formatLogTimestamp(entry.timestamp)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "justify-center text-[10px] uppercase",
                        LEVEL_CLASS[entry.level as LogLevel],
                      )}
                    >
                      {entry.level}
                    </Badge>
                    <span
                      className={cn(
                        "break-all",
                        wrapLines ? "whitespace-pre-wrap" : "truncate",
                      )}
                    >
                      {entry.message}
                    </span>
                    <div className="flex items-start justify-end pt-0.5">
                      <CopyButton
                        text={`${formatExportTimestamp(entry.timestamp)} [${entry.level}] ${entry.message}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!following && (
              <div className="pointer-events-none absolute bottom-3 right-3">
                <Button
                  size="sm"
                  className="pointer-events-auto"
                  onClick={jumpToLatest}
                >
                  {t("runners.logs.jumpToLatest")}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {isRunning
              ? autoRefreshEnabled
                ? t("runners.logs.autoRefreshEnabled")
                : t("runners.logs.autoRefreshPaused")
              : t("runners.logs.runnerCompleted")}
          </span>
          <div className="flex items-center gap-2">
            {loading && entries.length > 0 && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">
              {entries.length.toLocaleString()}{" "}
              {t("runners.logs.loadedEntries")}
            </span>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("runners.logs.loadMore")}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
