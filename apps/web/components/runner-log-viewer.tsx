"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunnerLogEntryDto, RunnerLogEntryDtoLevelEnum, RunnerLogsResponseDto } from "@workspace/api-client";
import { RunnerLogEntryDtoLevelEnum as LevelEnum } from "@workspace/api-client";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
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
  TriangleAlert,
} from "lucide-react";
import { TechnicalLogViewer } from "@/components/technical-log-viewer";
import { formatLogTimestamp } from "@/lib/date";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

type LogLevel = RunnerLogEntryDtoLevelEnum;
type SortOrder = "asc" | "desc";

const DEFAULT_TAKE = 100;

/**
 * Upper bound on entries kept mounted while a run streams live over the
 * WebSocket. Long scans can emit hundreds of thousands of lines; without a
 * cap the list grows unboundedly and the page becomes unusable. Older lines
 * remain available via Load More / Download All.
 */
const MAX_LIVE_ENTRIES = 2000;

export interface LogFetchParams {
  cursor?: string;
  take?: number;
  search?: string;
  levels?: string[];
  sortOrder?: SortOrder;
}

export interface RunnerLogViewerProps {
  runnerId: string;
  isRunning: boolean;
  s3Configured?: boolean;
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
  s3Configured = true,
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
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
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
        cursor: "0",
        take: DEFAULT_TAKE,
        sortOrder: sortOrderRef.current,
        search: searchRef.current,
        levels: levelFilterRef.current,
        ...params,
      });
      setEntries(resp.entries ?? []);
      setNextCursor(resp.nextCursor ?? undefined);
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
        cursor: nextCursor,
        take: DEFAULT_TAKE,
        sortOrder: sortOrderRef.current,
        search: searchRef.current,
        levels: levelFilterRef.current,
      });
      setEntries((prev) => [...prev, ...(resp.entries ?? [])]);
      setNextCursor(resp.nextCursor ?? undefined);
      setHasMore(resp.hasMore ?? false);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor]);

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
      if (!newOnes.length) return prev;
      // Cap the mounted list during live streaming; older lines stay
      // reachable via Load More / Download All.
      return [...newOnes, ...prev].slice(0, MAX_LIVE_ENTRIES);
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

  // Map DTOs to display rows with a WeakMap cache so unchanged entries keep
  // the same object identity (and a stable id/key) across prepends. This lets
  // the memoized rows in TechnicalLogViewer skip re-rendering when new lines
  // stream in at the top.
  const technicalEntryCache = useRef(
    new WeakMap<RunnerLogEntryDto, { id: string; timestamp: string; level: string; message: string }>(),
  );
  const technicalEntryIdSeq = useRef(0);
  const technicalEntries = useMemo(
    () =>
      entries.map((entry) => {
        const cached = technicalEntryCache.current.get(entry);
        if (cached) return cached;
        const row = {
          id: `log-${technicalEntryIdSeq.current++}`,
          timestamp: formatLogTimestamp(entry.timestamp),
          level: entry.level,
          message: entry.message,
        };
        technicalEntryCache.current.set(entry, row);
        return row;
      }),
    [entries],
  );

  const renderRowActions = useCallback(
    (entry: { timestamp: string; level: string; message: string }) => (
      <CopyButton text={`${entry.timestamp} [${entry.level}] ${entry.message}`} />
    ),
    [],
  );

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
        {!s3Configured && (
          <Alert className="border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
            <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-amber-800 dark:text-amber-300">
              {t("runners.logs.noStorageWarningTitle")}
            </AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-400">
              {t("runners.logs.noStorageWarningBody")}
            </AlertDescription>
          </Alert>
        )}
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={FileText} title={t("runners.logs.noLogs")} description={t("runners.logs.noLogsHint")} />
        ) : (
          <TechnicalLogViewer
            entries={technicalEntries}
            wrapLines={wrapLines}
            renderActions={renderRowActions}
          />
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
