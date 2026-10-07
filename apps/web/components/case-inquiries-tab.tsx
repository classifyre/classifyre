"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CircleSlash,
  GitBranch,
  DownloadCloud,
  ExternalLink,
  Filter,
  History,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Unlink,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseFindingFilterDto,
  type CaseHypothesisRuleDto,
  type CaseLinkedInquiryDto,
  type InquiryResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { ToneBadge, Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { InquiryMatchesPanel } from "@/components/inquiry-matches-panel";
import { FindingFilterChips } from "@/components/case-cleanup/finding-filter-chips";
import {
  FindingFilterDialog,
  type FilterDialogRequest,
  type RuleAction,
} from "@/components/case-cleanup/finding-filter-dialog";
import { HypothesisRuleChips } from "@/components/case-cleanup/hypothesis-rule-chips";
import {
  HypothesisRuleDialog,
  type HypothesisRuleRequest,
  type RuleHypothesis,
} from "@/components/case-cleanup/hypothesis-rule-dialog";
import { EscalationFlag } from "@workspace/case-board/components/finding-node";
import { useTranslation } from "@/hooks/use-translation";
import { withReturnTo } from "@/lib/return-to";

/** What changed about a watch, as the case timeline records it (see the board's useTimelineLink). */
export type WatchHistoryRequest =
  | { kind: "landed" | "retired"; inquiryIds: string[] }
  | { kind: "settings"; inquiryId: string };

export type CaseInquiriesTabProps = {
  caseId: string;
  linked: CaseLinkedInquiryDto[];
  isClosed: boolean;
  /** Findings already attached — shown as "in case" and not selectable. */
  inCaseFindingIds: Set<string>;
  /** The case's finding filters, case-wide and per watch. */
  filters?: CaseFindingFilterDto[];
  /** The case's hypothesis rules: which hypothesis each watch's answers are linked to. */
  hypothesisRules?: CaseHypothesisRuleDto[];
  /** The case's hypotheses, to pick from and to name on a rule. */
  hypotheses?: RuleHypothesis[];
  /** The board tab, so its own filter changes do not echo back as someone else's. */
  clientId?: string;
  /** The watch open in the middle; null shows every watch as a card. */
  selectedId: string | null;
  onSelect: (inquiryId: string | null) => void;
  /**
   * "What changed": the timeline entry that explains a count. `fallback`
   * runs when the timeline has none (a watch's answers can also change
   * without a scan, when its question is edited).
   */
  onOpenHistory?: (request: WatchHistoryRequest, fallback?: () => void) => void;
  onChanged: () => void;
};

/**
 * The watches driving a case, and what their latest scans landed.
 *
 * Every watch is a small card — its answers, what is new or gone, and
 * whether it adds by itself or carries rules — so a case with several reads
 * at a glance. Picking one marks its card and opens it in full below the
 * cards, with its settings, its rules and the table of its answers; the cards
 * stay where they are. The last card links another watch, or starts one.
 */
export function CaseInquiriesTab({
  caseId,
  linked,
  isClosed,
  inCaseFindingIds,
  filters = [],
  hypothesisRules = [],
  hypotheses = [],
  clientId,
  selectedId,
  onSelect,
  onOpenHistory,
  onChanged,
}: CaseInquiriesTabProps) {
  const { t } = useTranslation();

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filterRequest, setFilterRequest] = React.useState<FilterDialogRequest | null>(null);
  const [hypothesisRequest, setHypothesisRequest] = React.useState<HypothesisRuleRequest | null>(null);
  const [pulling, setPulling] = React.useState<string | null>(null);
  // Bumped to show the open watch's gone answers (and why each left) in its table.
  const [goneNonce, setGoneNonce] = React.useState(0);
  const answersRef = React.useRef<HTMLDivElement>(null);
  const caseWideFilters = filters.filter((f) => !f.inquiryId);
  const filtersOf = (inquiryId: string) => filters.filter((f) => f.inquiryId === inquiryId);

  // A watch that is no longer linked cannot stay open; a single watch opens by itself.
  const focused = linked.find((q) => q.id === selectedId) ?? (linked.length === 1 ? linked[0]! : null);
  const focusedId = focused?.id ?? null;
  React.useEffect(() => {
    setSelected(new Set());
  }, [focusedId]);
  React.useEffect(() => {
    if (selectedId && !linked.some((q) => q.id === selectedId)) onSelect(null);
  }, [selectedId, linked, onSelect]);

  const pullableSelected = React.useMemo(
    () => Array.from(selected).filter((id) => !inCaseFindingIds.has(id)),
    [selected, inCaseFindingIds],
  );

  const addSelected = async () => {
    if (!focusedId || pullableSelected.length === 0) return;
    setPulling(focusedId);
    try {
      const res = await api.cases.casesControllerPull({
        id: caseId,
        pullFromInquiryDto: { inquiryId: focusedId, findingIds: pullableSelected },
      });
      toast.success(t("investigations.caseDetail.pulled", { count: String(res.pulled) }));
      setSelected(new Set());
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToPull"));
    } finally {
      setPulling(null);
    }
  };

  const gone = linked.filter((q) => q.goneMatchCount > 0);
  const goneTotal = gone.reduce((sum, q) => sum + q.goneMatchCount, 0);

  /** Open a watch with only its gone answers in the table: which ones, and why each left. */
  const showGone = (inquiryId: string) => {
    onSelect(inquiryId);
    setGoneNonce((n) => n + 1);
    requestAnimationFrame(() => answersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const whatChanged = (inquiryIds: string[]) =>
    onOpenHistory?.({ kind: "retired", inquiryIds }, () => showGone(inquiryIds[0]!));

  return (
    <div className="space-y-5" data-testid="case-watches">
      <p className="text-muted-foreground max-w-2xl text-xs">{t("investigations.caseDetail.inquiriesTabDesc")}</p>

      {/* Answers the corpus has dropped out from under the watches. Worth
          saying once at the top, with the scan that did it one click away. */}
      {goneTotal > 0 && (
        <div
          className="flex items-start gap-2 rounded-[4px] border-2 border-destructive/40 p-3 text-sm"
          role="status"
          data-testid="watches-gone-alert"
        >
          <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p>{t("investigations.caseDetail.goneWarning", { count: String(goneTotal) })}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => showGone(gone[0]!.id)}
                className="text-[11px] font-medium underline-offset-2 hover:underline"
                data-testid="watches-gone-show"
              >
                {t("caseWatches.showGone")}
              </button>
              {onOpenHistory && (
                <HistoryLink
                  label={t("caseBoard.timelineLink.whatChanged")}
                  onClick={() => whatChanged(gone.map((q) => q.id))}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rules that hold for the whole case, whichever watch finds a match. */}
      <Card data-testid="case-wide-filters">
        <CardContent className="space-y-2.5 p-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0 text-accent-ink" />
            <span className="min-w-0 flex-1 text-sm font-medium">{t("caseFilters.rulesCaseWide")}</span>
          </div>
          <RuleRows
            caseId={caseId}
            rules={caseWideFilters}
            readOnly={isClosed}
            onAdd={(action) => setFilterRequest({ action, inquiryId: null })}
            onEdit={(filter) => setFilterRequest({ filter })}
            onChanged={onChanged}
            testIdPrefix="case"
          />
          <p className="text-muted-foreground text-[11px]">{t("caseFilters.rulesHint")}</p>
        </CardContent>
      </Card>

      <section className="space-y-2.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            {t("caseWatches.heading", { count: linked.length })}
          </h3>
          {focused && linked.length > 1 && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => onSelect(null)}>
              <X className="h-3 w-3" /> {t("caseWatches.showAll")}
            </Button>
          )}
        </div>

        {linked.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-4 text-sm">
              {t("investigations.caseDetail.noInquiryLinked")}
            </CardContent>
          </Card>
        ) : (
          <ul
            className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]"
            aria-label={t("caseWatches.heading", { count: linked.length })}
          >
            {linked.map((q) => (
              <li key={q.id}>
                <WatchMiniCard
                  watch={q}
                  rules={filtersOf(q.id)}
                  active={q.id === focusedId}
                  // The open card closes again (a single watch stays open).
                  onOpen={() => onSelect(q.id === focusedId && linked.length > 1 ? null : q.id)}
                />
              </li>
            ))}
            {!isClosed && (
              <li>
                <LinkWatchCard caseId={caseId} linkedIds={linked.map((q) => q.id)} onLinked={onChanged} />
              </li>
            )}
          </ul>
        )}
        {linked.length === 0 && !isClosed && (
          <div className="max-w-xs">
            <LinkWatchCard caseId={caseId} linkedIds={[]} onLinked={onChanged} />
          </div>
        )}
      </section>

      {focused ? (
        <>
          <FocusedWatch
            caseId={caseId}
            watch={focused}
            rules={filtersOf(focused.id)}
            hypothesisRules={hypothesisRules.filter((r) => r.inquiryId === focused.id)}
            hypotheses={hypotheses}
            isClosed={isClosed}
            canClose={linked.length > 1}
            onClose={() => onSelect(null)}
            onRules={setFilterRequest}
            onHypothesisRule={setHypothesisRequest}
            onOpenHistory={onOpenHistory}
            onShowGone={() => showGone(focused.id)}
            onWhatChangedGone={() => whatChanged([focused.id])}
            onChanged={onChanged}
          />
          <div ref={answersRef} className="min-w-0 scroll-mt-4 space-y-3" data-testid="watch-answers">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                {t("caseWatches.answers")}
              </p>
              <Button
                size="sm"
                onClick={() => void addSelected()}
                disabled={isClosed || pulling === focused.id || pullableSelected.length === 0}
              >
                {pulling === focused.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {t("investigations.caseDetail.addSelectedToCase")}
              </Button>
            </div>
            <InquiryMatchesPanel
              inquiryId={focused.id}
              inCaseFindingIds={inCaseFindingIds}
              selected={isClosed ? undefined : selected}
              onSelectedChange={isClosed ? undefined : setSelected}
              showGone={goneNonce}
            />
          </div>
        </>
      ) : (
        linked.length > 1 && (
          <p className="text-muted-foreground rounded-[4px] border-2 border-dashed border-border py-6 text-center text-sm">
            {t("investigations.caseDetail.selectInquiry")}
          </p>
        )
      )}

      <FindingFilterDialog
        caseId={caseId}
        watches={linked.map((q) => ({ id: q.id, title: q.title }))}
        filters={filters}
        request={filterRequest}
        onClose={() => setFilterRequest(null)}
        onApplied={() => onChanged()}
        clientId={clientId}
      />
      <HypothesisRuleDialog
        caseId={caseId}
        watches={linked.map((q) => ({ id: q.id, title: q.title }))}
        hypotheses={hypotheses}
        request={hypothesisRequest}
        onClose={() => setHypothesisRequest(null)}
        onApplied={() => onChanged()}
      />
    </div>
  );
}

function HistoryLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      data-testid="timeline-link"
    >
      <History className="h-3 w-3" aria-hidden />
      {label}
    </button>
  );
}

/** The rules of one watch, counted by what they do. */
function ruleCounts(rules: CaseFindingFilterDto[]) {
  return {
    filters: rules.filter((r) => (r.action ?? "EXCLUDE") === "EXCLUDE").length,
    escalations: rules.filter((r) => r.action === "ESCALATE").length,
  };
}

/**
 * A watch at a glance: how many answers, what is new or gone, and — as
 * marks with a tooltip — whether it adds by itself and which rules it carries.
 */
function WatchMiniCard({
  watch,
  rules,
  active,
  onOpen,
}: {
  watch: CaseLinkedInquiryDto;
  rules: CaseFindingFilterDto[];
  /** The watch open below the cards. */
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const counts = ruleCounts(rules);
  const summary = [
    watch.autoPull ? t("caseWatches.autoAddOn") : t("caseWatches.autoAddOff"),
    counts.filters > 0 ? t("caseWatches.filters", { count: counts.filters }) : null,
    counts.escalations > 0 ? t("caseWatches.escalations", { count: counts.escalations }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-pressed={active}
          className={cn(
            "flex h-full w-full flex-col gap-1.5 rounded-[4px] border-2 bg-card p-2.5 text-left transition-colors",
            active
              ? "border-foreground shadow-[inset_0_-3px_0_var(--accent)]"
              : "border-border hover:border-foreground/40",
            watch.status === "ARCHIVED" && "opacity-70",
          )}
          data-testid="watch-card"
          data-watch-id={watch.id}
          data-active={active || undefined}
        >
          <span className="flex items-start gap-1.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-ink" aria-hidden />
            <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium">{watch.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {t("caseWatches.answersCount", { count: watch.matchCount })}
            </span>
            {watch.newMatchCount > 0 && (
              <ToneBadge tone="fresh">
                {watch.newMatchCount} {t("investigations.matchState.new")}
              </ToneBadge>
            )}
            {watch.goneMatchCount > 0 && (
              <ToneBadge tone="error">
                {watch.goneMatchCount} {t("investigations.caseDetail.goneMatch")}
              </ToneBadge>
            )}
          </span>
          <span className="mt-auto flex items-center gap-2 text-muted-foreground">
            <Zap
              className={cn("h-3.5 w-3.5", watch.autoPull ? "fill-current text-accent-ink" : "opacity-40")}
              aria-label={watch.autoPull ? t("caseWatches.autoAddOn") : t("caseWatches.autoAddOff")}
            />
            {counts.filters > 0 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px]" aria-label={t("caseWatches.filters", { count: counts.filters })}>
                <Filter className="h-3 w-3" aria-hidden /> {counts.filters}
              </span>
            )}
            {counts.escalations > 0 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px]" aria-label={t("caseWatches.escalations", { count: counts.escalations })}>
                <EscalationFlag size={11} /> {counts.escalations}
              </span>
            )}
            {watch.status === "ARCHIVED" && (
              <ToneBadge tone="archived">{t("investigations.caseDetail.archived")}</ToneBadge>
            )}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{summary}</TooltipContent>
    </Tooltip>
  );
}

/** The value of the "start a new watch" entry in the link list. */
const NEW_WATCH = "__new__";

/**
 * Linking another watch, as the last card of the grid — or starting one
 * (the new-watch page opens in a new tab, ready to link to this case). The
 * list is read again every time it opens, so a watch created meanwhile in
 * another tab is there.
 */
function LinkWatchCard({
  caseId,
  linkedIds,
  onLinked,
}: {
  caseId: string;
  linkedIds: string[];
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [inquiryToLink, setInquiryToLink] = React.useState("");
  const [linking, setLinking] = React.useState(false);
  const [all, setAll] = React.useState<InquiryResponseDto[] | null>(null);
  const [loadingList, setLoadingList] = React.useState(false);
  const linkedKey = linkedIds.join(",");
  const linkable = React.useMemo(() => {
    const linkedSet = new Set(linkedKey ? linkedKey.split(",") : []);
    return (all ?? []).filter((q) => !linkedSet.has(q.id) && q.status !== "ARCHIVED");
  }, [all, linkedKey]);

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.inquiries.inquiriesControllerList({ limit: 200 });
      setAll(res.items);
    } catch {
      setAll((prev) => prev ?? []);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // A new tab: created, it lands back on this board at the new watch; Cancel comes back here too.
  const startNew = () =>
    window.open(withReturnTo(nsPath(`/investigations/inquiries/new?caseId=${encodeURIComponent(caseId)}`)), "_blank", "noopener");

  const link = async () => {
    if (!inquiryToLink) return;
    setLinking(true);
    try {
      await api.cases.casesControllerLinkInquiries({ id: caseId, linkInquiriesDto: { inquiryIds: [inquiryToLink] } });
      toast.success(t("investigations.caseDetail.inquiryLinked"));
      setInquiryToLink("");
      onLinked();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToLinkInquiry"));
    } finally {
      setLinking(false);
    }
  };
  return (
    <div className="flex h-full flex-col gap-1.5 rounded-[4px] border-2 border-dashed border-border p-2.5" data-testid="watch-link-card">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Plus className="h-3.5 w-3.5" aria-hidden /> {t("caseWatches.link")}
      </span>
      <Select
        value={inquiryToLink}
        onValueChange={(value) => {
          if (value === NEW_WATCH) {
            startNew();
            return;
          }
          setInquiryToLink(value);
        }}
        onOpenChange={(open) => {
          if (open) void loadList();
        }}
      >
        <SelectTrigger className="h-8 w-full text-xs" data-testid="watch-link-select">
          <SelectValue placeholder={t("caseWatches.pick")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW_WATCH} data-testid="watch-link-new">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {t("caseWatches.createNew")}
            </span>
          </SelectItem>
          <SelectSeparator />
          {linkable.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {q.title} <span className="text-muted-foreground">({q.matchCount})</span>
            </SelectItem>
          ))}
          {all !== null && linkable.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("caseWatches.noneToLink")}</div>
          )}
          {loadingList && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("caseWatches.loadingList")}
            </div>
          )}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => void link()}
        disabled={!inquiryToLink || linking}
        data-testid="watch-link-submit"
      >
        {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        {t("investigations.caseDetail.link")}
      </Button>
    </div>
  );
}

/** The open watch, in full: counts with what changed, auto-add, its rules, its actions. */
function FocusedWatch({
  caseId,
  watch,
  rules,
  hypothesisRules,
  hypotheses,
  isClosed,
  canClose,
  onClose,
  onRules,
  onHypothesisRule,
  onOpenHistory,
  onShowGone,
  onWhatChangedGone,
  onChanged,
}: {
  caseId: string;
  watch: CaseLinkedInquiryDto;
  rules: CaseFindingFilterDto[];
  hypothesisRules: CaseHypothesisRuleDto[];
  hypotheses: RuleHypothesis[];
  isClosed: boolean;
  canClose: boolean;
  onClose: () => void;
  onRules: (request: FilterDialogRequest) => void;
  onHypothesisRule: (request: HypothesisRuleRequest) => void;
  onOpenHistory?: (request: WatchHistoryRequest, fallback?: () => void) => void;
  /** Show only the gone answers in the table below. */
  onShowGone: () => void;
  onWhatChangedGone: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [savingAutoPull, setSavingAutoPull] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);

  const setAutoPull = async (autoPull: boolean) => {
    setSavingAutoPull(true);
    try {
      await api.cases.casesControllerSetInquiryAutoPull({
        id: caseId,
        inquiryId: watch.id,
        setInquiryAutoPullDto: { autoPull },
      });
      toast.success(t("investigations.caseDetail.autoPullUpdated"));
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToSetAutoPull"));
    } finally {
      setSavingAutoPull(false);
    }
  };

  /** Everything the watch currently matches, in one request. */
  const pullAll = async () => {
    setPulling(true);
    try {
      const res = await api.cases.casesControllerPull({ id: caseId, pullFromInquiryDto: { inquiryId: watch.id } });
      toast.success(
        t("investigations.caseDetail.pulled", { count: String(res.pulled) }) +
          (res.filtered ? ` · ${t("caseFilters.pullFiltered", { count: res.filtered })}` : ""),
      );
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToPull"));
    } finally {
      setPulling(false);
    }
  };

  const unlink = async () => {
    try {
      await api.cases.casesControllerUnlinkInquiry({ id: caseId, inquiryId: watch.id });
      toast.success(t("investigations.caseDetail.inquiryUnlinked"));
      onClose();
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t("investigations.caseDetail.failedToUnlinkInquiry"));
    }
  };

  return (
    <Card className="border-accent/60 shadow-[0_1px_3px_rgba(28,25,23,0.04)]" data-testid="watch-focused" data-watch-id={watch.id}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-1 h-4 w-4 shrink-0 text-accent-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base leading-snug font-black">{watch.title}</p>
            {watch.status === "ARCHIVED" && (
              <ToneBadge tone="archived">{t("investigations.caseDetail.archived")}</ToneBadge>
            )}
          </div>
          {watch.status !== "ARCHIVED" && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={t("investigations.caseDetail.editInquiryQuery")}
              title={t("investigations.caseDetail.editInquiryQuery")}
              // Save or Cancel on the edit page comes back here, to this watch.
              onClick={() => router.push(withReturnTo(nsPath(`/investigations/inquiries/${watch.id}/edit`)))}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isClosed && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground h-7 w-7"
                  aria-label={t("investigations.caseDetail.unlinkInquiry")}
                  title={t("investigations.caseDetail.unlinkInquiry")}
                >
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("investigations.caseDetail.unlinkInquiryTitle", { title: watch.title })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("investigations.caseDetail.unlinkInquiryDesc")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void unlink()}>{t("investigations.caseDetail.unlink")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canClose && (
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground h-7 w-7"
              aria-label={t("caseWatches.showAll")}
              title={t("caseWatches.showAll")}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="font-mono tabular-nums">{t("caseWatches.answersCount", { count: watch.matchCount })}</span>
          {watch.newMatchCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <ToneBadge tone="fresh">
                      {watch.newMatchCount} {t("investigations.matchState.new")}
                    </ToneBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("investigations.matchState.newTooltip")}</TooltipContent>
              </Tooltip>
              {onOpenHistory && (
                <HistoryLink
                  label={t("caseBoard.timelineLink.whatChanged")}
                  onClick={() => onOpenHistory({ kind: "landed", inquiryIds: [watch.id] })}
                />
              )}
            </span>
          )}
          {watch.goneMatchCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={onShowGone} data-testid="watch-gone-show">
                    <ToneBadge tone="error">
                      {watch.goneMatchCount} {t("investigations.caseDetail.goneMatch")}
                    </ToneBadge>
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("caseWatches.showGoneHint")}</TooltipContent>
              </Tooltip>
              {onOpenHistory && <HistoryLink label={t("caseBoard.timelineLink.whatChanged")} onClick={onWhatChangedGone} />}
            </span>
          )}
          <span className="flex-1" />
          {onOpenHistory && (
            <HistoryLink
              label={t("caseBoard.timelineLink.history")}
              onClick={() => onOpenHistory({ kind: "settings", inquiryId: watch.id })}
            />
          )}
        </div>

        {!isClosed && (
          <div className="space-y-1 border-t border-border pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`autopull-${watch.id}`} className="text-xs font-normal">
                {t("investigations.caseDetail.autoPull")}
              </Label>
              <div className="flex items-center gap-2">
                {savingAutoPull && <Loader2 className="h-3 w-3 animate-spin" />}
                <Switch
                  id={`autopull-${watch.id}`}
                  checked={watch.autoPull}
                  disabled={savingAutoPull}
                  onCheckedChange={(checked) => void setAutoPull(checked)}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">
              {watch.autoPull ? t("investigations.caseDetail.autoPullOn") : t("investigations.caseDetail.autoPullOff")}
            </p>
          </div>
        )}

        {/* What this watch may not bring in (skipped by auto-add and by "pull
            all", taken out when added), and what it escalates (marked, and
            brought in even with auto-add off). */}
        <div className="space-y-1.5 border-t border-border pt-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {t("caseFilters.rulesWatch")}
          </span>
          <RuleRows
            caseId={caseId}
            rules={rules}
            readOnly={isClosed}
            onAdd={(action) => onRules({ action, inquiryId: watch.id })}
            onEdit={(filter) => onRules({ filter })}
            onChanged={onChanged}
            testIdPrefix={`watch-${watch.id}`}
          />
        </div>

        {/* What this case does with the watch's answers beyond keeping them:
            link them to a hypothesis, as supporting, contradicting or
            neutral, and land them beside it on the board. */}
        <div className="space-y-1.5 border-t border-border pt-2.5" data-testid={`hypothesis-rules-${watch.id}`}>
          <span className="inline-flex items-center gap-1.5 text-xs">
            <GitBranch className="h-3 w-3 text-muted-foreground" />
            {t("caseHypothesisRules.title")}
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
            {hypothesisRules.length > 0 ? (
              <HypothesisRuleChips
                caseId={caseId}
                rules={hypothesisRules}
                hypotheses={hypotheses}
                readOnly={isClosed}
                onEdit={(rule) => onHypothesisRule({ inquiryId: watch.id, rule })}
                onChanged={onChanged}
              />
            ) : (
              <span className="text-muted-foreground pt-[2px] text-[11px]">
                {hypotheses.length === 0 ? t("caseHypothesisRules.noHypotheses") : t("caseHypothesisRules.none")}
              </span>
            )}
            {!isClosed ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={t("caseHypothesisRules.add")}
                title={t("caseHypothesisRules.add")}
                disabled={hypotheses.length === 0}
                onClick={() => onHypothesisRule({ inquiryId: watch.id })}
                data-testid={`add-hypothesis-rule-${watch.id}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <span />
            )}
          </div>
          <p className="text-muted-foreground text-[11px]">{t("caseHypothesisRules.hint")}</p>
        </div>

        {!isClosed && watch.matchCount > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-2.5">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => router.push(nsPath(`/investigations/inquiries/${watch.id}?caseId=${caseId}`))}
            >
              {t("investigations.caseDetail.selectMatchesToPull")} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pulling}
              onClick={() => void pullAll()}
              title={t("investigations.caseDetail.pullAllMatches")}
            >
              {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              {t("investigations.caseDetail.all")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A scope's rules in two labelled rows: what it filters out and what it
 * escalates, each with its chips and a "+" that opens the rules dialog in
 * that mode.
 */
function RuleRows({
  caseId,
  rules,
  readOnly,
  onAdd,
  onEdit,
  onChanged,
  testIdPrefix,
}: {
  caseId: string;
  rules: CaseFindingFilterDto[];
  readOnly: boolean;
  onAdd: (action: RuleAction) => void;
  onEdit: (filter: CaseFindingFilterDto) => void;
  onChanged: () => void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  const rows: Array<{ action: RuleAction; label: string; add: string }> = [
    { action: "EXCLUDE", label: t("caseFilters.rowFilter"), add: t("caseFilters.addFilter") },
    { action: "ESCALATE", label: t("caseFilters.rowEscalate"), add: t("caseFilters.addEscalation") },
  ];
  return (
    // One grid for both rows, so the chips line up under each other and the
    // label column takes the width of its longest label (no wrapping).
    <div className="grid grid-cols-[max-content_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5">
      {rows.map((row) => {
        const own = rules.filter((r) => (r.action ?? "EXCLUDE") === row.action);
        const escalate = row.action === "ESCALATE";
        return (
          <React.Fragment key={row.action}>
            <span
              className="text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap pt-[3px] font-mono text-[10px] uppercase tracking-[0.12em]"
              data-testid={`rules-${testIdPrefix}-${row.action.toLowerCase()}`}
            >
              {escalate ? <EscalationFlag size={11} className="shrink-0" /> : <Filter className="h-2.5 w-2.5 shrink-0" />}
              {row.label}
            </span>
            {own.length > 0 ? (
              <FindingFilterChips caseId={caseId} filters={own} readOnly={readOnly} onEdit={onEdit} onChanged={onChanged} />
            ) : (
              <span className="text-muted-foreground pt-[2px] text-[11px]">—</span>
            )}
            {!readOnly ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={row.add}
                title={row.add}
                onClick={() => onAdd(row.action)}
                data-testid={`add-${testIdPrefix}-${row.action.toLowerCase()}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <span />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
