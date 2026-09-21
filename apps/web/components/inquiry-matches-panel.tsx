"use client";

import * as React from "react";
import { CircleSlash, Loader2, Search, Sparkles } from "lucide-react";
import {
  api,
  InquiriesControllerListMatchesSeverityEnum,
  InquiriesControllerListMatchesStateEnum,
  type InquiryMatchDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Button,
  Input,
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
  ToneBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { DataTableFooter } from "@/components/data-table-footer";
import { useTranslation } from "@/hooks/use-translation";
import { InquiryMatchesTable } from "./inquiry-matches-table";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const SEVERITY_OPTIONS = Object.values(
  InquiriesControllerListMatchesSeverityEnum,
);

type MatchState = InquiriesControllerListMatchesStateEnum;

/** New and ongoing — the live set. GONE is opt-in; see the API's own note. */
const DEFAULT_STATES: MatchState[] = ["NEW", "ONGOING"];

export type InquiryMatchesStats = {
  total: number;
  newCount: number;
  goneCount: number;
};

export type InquiryMatchesPanelProps = {
  inquiryId: string;
  /** Finding IDs already attached to the linked case — shown as "in case". */
  inCaseFindingIds?: Set<string>;
  /** Omit to render a read-only table without checkboxes. */
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /**
   * "Every match, including ones later scans land" — the shape
   * `pullFromInquiry` already understands as an omitted findingIds list, so a
   * whole inquiry can be taken without paging its matches into the browser.
   */
  allSelected?: boolean;
  onAllSelectedChange?: (next: boolean) => void;
  /** Bump to force a refetch (e.g. after a re-scan). */
  reloadKey?: number;
  /** Reports the filtered totals to the parent header. */
  onStats?: (stats: InquiryMatchesStats) => void;
};

/**
 * Server-paginated, filterable view over an inquiry's matches — the heavy
 * lifting (matching, filtering, paging) stays in the API so large inquiries
 * never ship thousands of rows to the browser.
 */
export function InquiryMatchesPanel({
  inquiryId,
  inCaseFindingIds,
  selected,
  onSelectedChange,
  allSelected = false,
  onAllSelectedChange,
  reloadKey = 0,
  onStats,
}: InquiryMatchesPanelProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [severities, setSeverities] = React.useState<string[]>([]);
  const [states, setStates] = React.useState<MatchState[]>(DEFAULT_STATES);
  const [pageSize, setPageSize] = React.useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = React.useState(1);

  const [items, setItems] = React.useState<InquiryMatchDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [newCount, setNewCount] = React.useState(0);
  const [goneCount, setGoneCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [initialized, setInitialized] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resolvedPageSize = Number(pageSize);

  // ── Debounce search ───────────────────────────────────────────────────────

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => {
    setPage(1);
  }, [search, severities, states, pageSize]);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const statesKey = states.join(",");
  React.useEffect(() => {
    let active = true;
    const run = async () => {
      setIsLoading(true);
      try {
        setError(null);
        const res = await api.inquiries.inquiriesControllerListMatches({
          id: inquiryId,
          search: search || undefined,
          severity:
            severities.length > 0
              ? (severities as InquiriesControllerListMatchesSeverityEnum[])
              : undefined,
          state: states.length > 0 ? states : undefined,
          skip: (page - 1) * resolvedPageSize,
          limit: resolvedPageSize,
        });
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
        setNewCount(res.newCount);
        setGoneCount(res.goneCount);
        setInitialized(true);
        onStats?.({
          total: res.total,
          newCount: res.newCount,
          goneCount: res.goneCount,
        });
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load inquiry matches:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("investigations.matchesPanel.failedToLoad"),
        );
        setItems([]);
        setTotal(0);
        setNewCount(0);
        setGoneCount(0);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inquiryId,
    search,
    severities,
    statesKey,
    page,
    resolvedPageSize,
    reloadKey,
  ]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const totalPages = Math.max(
    1,
    Math.ceil(total / Math.max(1, resolvedPageSize)),
  );
  const clampedPage = Math.min(page, totalPages);
  const showInitialLoading = isLoading && !initialized;
  const selectable = selected !== undefined && onSelectedChange !== undefined;

  // In "all" mode every row on the page reads as checked, and the checkboxes
  // stop responding — the selection is no longer a list of ids to toggle.
  const pageIds = React.useMemo(
    () => new Set(items.map((m) => m.findingId)),
    [items],
  );

  const toggleState = (state: MatchState) =>
    setStates((prev) =>
      prev.includes(state)
        ? prev.filter((s) => s !== state)
        : [...prev, state].sort(),
    );

  const stateButton = (
    state: MatchState,
    label: string,
    tooltip: string,
    count?: number,
  ) => (
    <Tooltip key={state}>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant={states.includes(state) ? "default" : "outline"}
          className="h-full rounded-none px-2.5"
          onClick={() => toggleState(state)}
        >
          {state === "NEW" && <Sparkles className="h-3.5 w-3.5" />}
          {state === "GONE" && <CircleSlash className="h-3.5 w-3.5" />}
          {label}
          {count ? ` (${count})` : ""}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("investigations.matchesPanel.search")}
            className="h-9 pl-9 border-2 border-border rounded-[4px]"
          />
        </div>

        <MultiSelect values={severities} onValuesChange={setSeverities}>
          <MultiSelectTrigger className="h-9 w-[180px] border-2 border-border rounded-[4px]">
            <MultiSelectValue
              placeholder={t("investigations.matchesPanel.severity")}
            />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("investigations.matchesPanel.searchSeverities"),
              emptyMessage: t("investigations.matchesPanel.noSeverities"),
            }}
          >
            <MultiSelectGroup>
              {SEVERITY_OPTIONS.map((severity) => (
                <MultiSelectItem key={severity} value={severity}>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[2px] border border-border/20"
                      style={{
                        backgroundColor:
                          FINDING_SEVERITY_COLOR_BY_ENUM[
                            severity as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM
                          ],
                      }}
                    />
                    {severity.charAt(0) + severity.slice(1).toLowerCase()}
                  </span>
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>

        {/* State is a segmented filter rather than a "New only" toggle: the
            third state (gone) is not the absence of the other two. */}
        <div className="flex h-9 overflow-hidden rounded-[4px] border-2 border-border">
          {stateButton(
            "NEW",
            t("investigations.matchState.new"),
            t("investigations.matchState.newTooltip"),
            newCount,
          )}
          {stateButton(
            "ONGOING",
            t("investigations.matchState.ongoing"),
            t("investigations.matchState.ongoingTooltip"),
          )}
          {stateButton(
            "GONE",
            t("investigations.matchState.gone"),
            t("investigations.matchState.goneTooltip"),
            goneCount,
          )}
        </div>

        {isLoading && initialized && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("investigations.matchesPanel.updating")}
          </span>
        )}
      </div>

      {/* ── Selection mode ── */}
      {selectable && onAllSelectedChange && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5">
          <span className="font-mono text-xs text-accent-ink">
            {allSelected
              ? t("investigations.matchesPanel.allSelected", {
                  count: total.toLocaleString(),
                })
              : t("investigations.matchesPanel.selectedCount", {
                  count: (selected?.size ?? 0).toLocaleString(),
                })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
            onClick={() => {
              onAllSelectedChange(!allSelected);
              if (!allSelected) onSelectedChange?.(new Set());
            }}
          >
            {allSelected
              ? t("investigations.matchesPanel.chooseIndividually")
              : t("investigations.matchesPanel.selectAll", {
                  count: total.toLocaleString(),
                })}
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="relative min-h-[240px]">
        {showInitialLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">
              {t("investigations.matchesPanel.loading")}
            </span>
          </div>
        ) : (
          <InquiryMatchesTable
            matches={items}
            inCaseFindingIds={inCaseFindingIds}
            selected={allSelected ? pageIds : selected}
            onSelectedChange={allSelected ? undefined : onSelectedChange}
          />
        )}

        {isLoading && initialized && items.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[4px] bg-background/45 backdrop-blur-[1px]">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("investigations.matchesPanel.updating")}
            </div>
          </div>
        )}
      </div>

      {goneCount > 0 && !states.includes("GONE") && (
        <button
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
          onClick={() => toggleState("GONE")}
        >
          <ToneBadge tone="error" dot>
            {goneCount}
          </ToneBadge>
          {t("investigations.matchState.goneTooltip")}
        </button>
      )}

      <DataTableFooter
        page={clampedPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        totalLabel={total.toLocaleString()}
        emptyLabel={t("investigations.matchesPanel.empty")}
      />
    </div>
  );
}
