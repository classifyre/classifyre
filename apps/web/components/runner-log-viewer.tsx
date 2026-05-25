"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunnerLogEntryDto, RunnerLogEntryDtoLevelEnum, RunnerLogsResponseDto } from "@workspace/api-client";
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

const DEFAULT_TAKE = 100;

export interface LogFetchParams {
  skip?: number;
  take?: number;
  search?: string;
  levels?: string[];
  sortOrder?: SortOrder;
}

export interface RunnerLogViewerProps {
  runnerId: string;
  isRunning: boolean;
  /** Pass the WebSocket connection state so the viewer can skip polling when live. */
  isWsConnected?: boolean;
  /**
   * Stable fetch function — called by the viewer for initial load, filter
   * changes, Load More, and polling fallback. Must NOT change identity on every render.
   */
  fetchFn: (params: LogFetchParams) => Promise<RunnerLogsResponseDto>;
  /** Live entries pushed via WebSocket; prepended when desc + no active filters. */
  wsEntries?: RunnerLogEntryDto[];
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
  TRACE:   "border-muted-foreground/30 text-muted-foreground",
  DEBUG:   "border-cyan-500/40 text-cyan-600 dark:text-cyan-400",
  INFO:    "border-blue-500/40 text-blue-600 dark:text-blue-400",
  WARN:    "border-amber-500/40 text-amber-600 dark:text-amber-400",
  ERROR:   "border-red-500/40 text-red-600 dark:text-red-400",
  FATAL:   "border-red-700/50 text-red-700 dark:text-red-300",
  UNKNOWN: "border-muted-foreground/30 text-muted-foreground",
};

function formatExportTimestamp(iso?: string | null): string {
  return iso ?? new Date().toISOString();
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
      title={t("runners.logs.copyRow")}
      onClick={(e) => {
        e.stopPropagation();
        copyText(text)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
          .catch(() => undefined);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export function RunnerLogViewer({
  runnerId,
  isRunning,
  isWsConnected,
  fetchFn,
  wsEntries,
  onDownloadAll,
}: RunnerLogViewerProps) {
  const { t } = useTranslation();

  // ── filter state ──────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [wrapLines, setWrapLines] = useState(true);

  // ── data state ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<RunnerLogEntryDto[]>([]);
  // How many entries we've loaded from the server (not counting WS-prepended ones).
  // Used as the skip offset for "Load More".
  const [serverFetchedCount, setServerFetchedCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  // ── stable refs (avoid stale closures in effects) ─────────────────────────
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const sortOrderRef = useRef(sortOrder);
  sortOrderRef.current = sortOrder;
  const searchRef = useRef(search);
  searchRef.current = search;
  const levelFilterRef = useRef(levelFilter);
  levelFilterRef.current = levelFilter;

  // ── debounce search input ─────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // ── initial / filter-change fetch (resets list) ───────────────────────────
  const fetchFresh = useCallback(async (params?: Partial<LogFetchParams>) => {
    setLoading(true);
    try {
      const resp = await fetchFnRef.current({
        skip: 0,
        take: DEFAULT_TAKE,
        sortOrder: sortOrderRef.current,
        search: searchRef.current,
        levels: levelFilterRef.current,
        ...params,
      });
      setEntries(resp.entries ?? []);
      setServerFetchedCount(resp.entries?.length ?? 0);
      setHasMore(resp.hasMore ?? false);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── load more (appends older entries) ─────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    setIsLoadingMore(true);
    try {
      const resp = await fetchFnRef.current({
        skip: serverFetchedCount,
        take: DEFAULT_TAKE,
        sortOrder: sortOrderRef.current,
        search: searchRef.current,
        levels: levelFilterRef.current,
      });
      setEntries((prev) => [...prev, ...(resp.entries ?? [])]);
      setServerFetchedCount((prev) => prev + (resp.entries?.length ?? 0));
      setHasMore(resp.hasMore ?? false);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [serverFetchedCount]);

  // ── initial load ──────────────────────────────────────────────────────────
  const initialMount = useRef(true);
  useEffect(() => {
    void fetchFresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerId]);

  // ── re-fetch on filter / sort changes ────────────────────────────────────
  useEffect(() => {
    if (initialMount.current) { initialMount.current = false; return; }
    void fetchFresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, levelFilter, sortOrder]);

  // ── WS live push ──────────────────────────────────────────────────────────
  // New WS entries are prepended at the top (desc: newest first) when no
  // filters are active. We deduplicate against what's already in the list.
  const wsEntriesPrev = useRef<RunnerLogEntryDto[] | undefined>(undefined);
  useEffect(() => {
    if (!wsEntries?.length || wsEntries === wsEntriesPrev.current) return;
    wsEntriesPrev.current = wsEntries;

    // Only touch the visible list when we're in desc order with no active filters.
    // Otherwise the current view is already filtered/sorted differently.
    if (
      sortOrderRef.current !== "desc" ||
      searchRef.current ||
      levelFilterRef.current.length
    ) return;

    setEntries((prev) => {
      const existingKeys = new Set(prev.map((e) => `${e.timestamp}|${e.message}`));
      const newOnes = wsEntries.filter((e) => !existingKeys.has(`${e.timestamp}|${e.message}`));
      return newOnes.length ? [...newOnes, ...prev] : prev;
    });
  }, [wsEntries]);

  // ── polling fallback (only when WS is not connected) ─────────────────────
  // When the WebSocket is live we rely entirely on push. If the WS is down
  // and the run is still active, fall back to polling so the user still sees
  // updates. We re-fetch from scratch to keep the "newest first" view fresh.
  useEffect(() => {
    const wsUp = isWsConnected !== false; // undefined = no WS prop → always poll
    if (!isRunning || wsUp) return;

    const id = setInterval(() => void fetchFresh(), 2500);
    return () => clearInterval(id);
  }, [isRunning, isWsConnected, fetchFresh]);

  // ── final fetch when run completes ───────────────────────────────────────
  // After a run finishes the backend flushes remaining buffer to S3. We wait
  // a short moment then do one final refresh so nothing is missed.
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    prevIsRunningRef.current = isRunning;
    if (wasRunning && !isRunning) {
      const id = setTimeout(() => void fetchFresh(), 800);
      return () => clearTimeout(id);
    }
  }, [isRunning, fetchFresh]);

  // ── export helpers ────────────────────────────────────────────────────────
  const exportEntries = useCallback(
    (rows: RunnerLogEntryDto[]) =>
      rows.map((e) => `${formatExportTimestamp(e.timestamp)} [${e.level}] ${e.message}`).join("\n"),
    [],
  );

  const handleDownloadVisible = useCallback(() => {
    if (!entries.length) { toast.error(t("runners.logs.noLogsDownload")); return; }
    downloadTextFile(`runner-${runnerId}-logs-visible.log`, exportEntries(entries));
    toast.success(t("runners.logs.downloaded"));
  }, [entries, exportEntries, runnerId, t]);

  const handleDownloadAll = useCallback(async () => {
    if (!onDownloadAll) { handleDownloadVisible(); return; }
    try {
      setIsDownloadingAll(true);
      const all = await onDownloadAll();
      if (!all.length) { toast.error(t("runners.logs.noLogsDownload")); return; }
      downloadTextFile(`runner-${runnerId}-logs-all.log`, exportEntries(all));
      toast.success(t("runners.logs.downloadedCount", { count: String(all.length.toLocaleString()) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("runners.logs.noLogsDownload"));
    } finally {
      setIsDownloadingAll(false);
    }
  }, [exportEntries, handleDownloadVisible, onDownloadAll, runnerId, t]);

  const showInitialLoading = loading && entries.length === 0;

  const liveStatus = isRunning
    ? (isWsConnected ? t("runners.logs.streamingLive") : t("runners.logs.autoRefreshEnabled"))
    : t("runners.logs.runnerCompleted");

  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t("runners.logs.title")}</CardTitle>
            <CardDescription>{t("runners.logs.description")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("runners.logs.wrapLines")}</span>
            <Toggle variant="outline" size="sm" pressed={wrapLines} onPressedChange={setWrapLines}>
              {wrapLines ? t("common.on") : t("common.off")}
            </Toggle>
            <Button variant="outline" size="sm" onClick={() => void fetchFresh()} disabled={loading}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("runners.logs.refresh")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadVisible}>
              <Download className="mr-2 h-4 w-4" />
              {t("runners.logs.downloadVisible")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleDownloadAll()} disabled={isDownloadingAll}>
              {isDownloadingAll
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Download className="mr-2 h-4 w-4" />}
              {t("runners.logs.downloadAll")}
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-[1.6]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("runners.logs.search")}
              className="h-9 pl-9 border-2 border-border rounded-[4px]"
            />
          </div>

          <MultiSelect values={levelFilter} onValuesChange={(v) => setLevelFilter(v as string[])}>
            <MultiSelectTrigger className="h-9 w-[160px] border-2 border-border rounded-[4px]">
              <MultiSelectValue placeholder={t("runners.logs.allLevels")} />
            </MultiSelectTrigger>
            <MultiSelectContent search={{ placeholder: t("runners.logs.searchLevels"), emptyMessage: t("runners.logs.noLevelsFound") }}>
              <MultiSelectGroup>
                {ALL_LEVELS.map((level) => (
                  <MultiSelectItem key={level} value={level}>
                    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", LEVEL_CLASS[level])}>
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
            className="h-9 gap-1.5 border-2 border-border rounded-[4px]"
            onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
          >
            {sortOrder === "desc"
              ? <><ArrowDown className="h-3.5 w-3.5" />{t("runners.logs.newestFirst")}</>
              : <><ArrowUp className="h-3.5 w-3.5" />{t("runners.logs.oldestFirst")}</>}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={FileText} title={t("runners.logs.noLogs")} description={t("runners.logs.noLogsHint")} />
        ) : (
          <div className="relative overflow-hidden rounded-[4px] border bg-background">
            {/* Header row */}
            <div
              className="hidden border-b bg-muted/40 px-3 py-2 md:grid md:gap-3"
              style={{ gridTemplateColumns: "140px 84px 1fr 32px" }}
            >
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

            <div className="max-h-[520px] overflow-y-auto">
              {entries.map((entry, index) => {
                const stableKey = `${entry.timestamp ?? ""}-${index}`;
                return (
                  <div key={stableKey} className="group w-full border-b px-3 py-1.5 last:border-b-0">
                    {/* Mobile */}
                    <div className="flex flex-col gap-1 md:hidden">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatLogTimestamp(entry.timestamp)}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px] uppercase", LEVEL_CLASS[entry.level as LogLevel])}>
                          {entry.level}
                        </Badge>
                      </div>
                      <p className={cn("font-mono text-xs break-all", wrapLines ? "whitespace-pre-wrap" : "line-clamp-2")}>
                        {entry.message}
                      </p>
                    </div>

                    {/* Desktop */}
                    <div
                      className="hidden items-start gap-3 font-mono text-xs md:grid"
                      style={{ gridTemplateColumns: "140px 84px 1fr 32px" }}
                    >
                      <span className="text-muted-foreground truncate">
                        {formatLogTimestamp(entry.timestamp)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn("justify-center text-[10px] uppercase", LEVEL_CLASS[entry.level as LogLevel])}
                      >
                        {entry.level}
                      </Badge>
                      <span className={cn("break-all", wrapLines ? "whitespace-pre-wrap" : "truncate")}>
                        {entry.message}
                      </span>
                      <div className="flex items-start justify-end pt-0.5">
                        <CopyButton text={`${formatExportTimestamp(entry.timestamp)} [${entry.level}] ${entry.message}`} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">{liveStatus}</span>
            {entries.length > 0 && (
              <span className="text-xs text-muted-foreground">
                · {entries.length.toLocaleString()} {t("runners.logs.loadedEntries")}
              </span>
            )}
          </div>

          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-[4px] border-2 border-border"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : null}
              {t("runners.logs.loadMore")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
