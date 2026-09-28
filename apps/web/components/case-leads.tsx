"use client";

import * as React from "react";
import {
  Bookmark,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  Equal,
  GripVertical,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CaseLeadDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { cn } from "@workspace/ui/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { FeatureOffNotice } from "@/components/feature-off-notice";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { useTranslation } from "@/hooks/use-translation";
import {
  LEAD_ORIGINS,
  countByOrigin,
  isPendingLead,
  isReviewedLead,
  joinedAnotherWay,
  leadReason,
  leadScore,
  leadWhy,
  selectLeads,
  type LeadOrigin,
  type LeadReason,
  type LeadSort,
} from "@/components/case-board/store/leads";

const ORIGIN_ICON: Record<LeadReason, LucideIcon> = {
  DUPLICATE: Copy,
  // The Watches panel's own icon: an answer of a watch reads as one.
  INQUIRY: Sparkles,
  SEMANTIC_NEIGHBOR: Radar,
  SAME_VALUE: Equal,
  AUTOPILOT: Bot,
  MANUAL: Bookmark,
};

export interface CaseLeadsProps {
  leads: CaseLeadDto[];
  loading: boolean;
  readOnly?: boolean;
  /** Leads with a review in flight. */
  busy?: ReadonlySet<string>;
  refreshing?: boolean;
  onAccept: (lead: CaseLeadDto) => void;
  onDismiss: (leadIds: string[], reason?: string) => void;
  onRefresh: () => void;
  /** Makes waiting leads draggable (the case board accepts drops). */
  onLeadDragStart?: (lead: CaseLeadDto, event: React.DragEvent) => void;
  /** Fly to what a lead relates to; offered when `canShowOnBoard` says it is there. */
  onShowOnBoard?: (lead: CaseLeadDto) => void;
  canShowOnBoard?: (lead: CaseLeadDto) => boolean;
  /** A watch's answer: open the watches. */
  onOpenWatch?: (inquiryId: string) => void;
  /** Whether what a lead points at is in the case now (reviewed leads say so). */
  isInCase?: (lead: CaseLeadDto) => boolean;
  /**
   * Makes reviewed leads that are not in the case draggable (the board adds
   * what they point at where they are dropped); the review itself stays.
   */
  onReviewedDragStart?: (lead: CaseLeadDto, event: React.DragEvent) => void;
  /** Add what a reviewed lead points at, without dragging. */
  onAddReviewed?: (lead: CaseLeadDto) => void;
}

/**
 * The case's lead queue: what the case may be missing, each with its reason
 * and the evidence it hangs off. Waiting leads can be filtered by reason,
 * searched and sorted; accepting one adds it to the case, dismissing it is
 * remembered for the case.
 */
export function CaseLeads({
  leads,
  loading,
  readOnly = false,
  busy,
  refreshing = false,
  onAccept,
  onDismiss,
  onRefresh,
  onLeadDragStart,
  onShowOnBoard,
  canShowOnBoard,
  onOpenWatch,
  isInCase,
  onReviewedDragStart,
  onAddReviewed,
}: CaseLeadsProps) {
  const { t } = useTranslation();
  const [origin, setOrigin] = React.useState<LeadOrigin | "ALL">("ALL");
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<LeadSort>("relevance");
  const [reviewedOpen, setReviewedOpen] = React.useState(false);
  const [dismissing, setDismissing] = React.useState<string[] | null>(null);

  const pending = React.useMemo(() => leads.filter(isPendingLead), [leads]);
  const counts = React.useMemo(() => countByOrigin(pending), [pending]);
  // A filter whose leads have all been reviewed falls back to everything.
  const activeOrigin = origin !== "ALL" && (counts.get(origin) ?? 0) === 0 ? "ALL" : origin;
  const shown = React.useMemo(
    () => selectLeads(pending, { origin: activeOrigin, query, sort }),
    [pending, activeOrigin, query, sort],
  );

  const reviewed = React.useMemo(
    () =>
      leads
        .filter(isReviewedLead)
        .sort(
          (a, b) =>
            new Date(b.reviewedAt ?? b.createdAt).getTime() - new Date(a.reviewedAt ?? a.createdAt).getTime(),
        ),
    [leads],
  );

  return (
    <div className="@container space-y-3" data-testid="case-leads">
      <FeatureOffNotice feature="embeddings" context="leads" variant="inline" />
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("caseLeads.intro")}</p>
        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1 text-xs"
            onClick={onRefresh}
            disabled={refreshing}
            title={t("caseLeads.refreshHint")}
            data-testid="leads-refresh"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} aria-hidden />
            {t("caseLeads.refresh")}
          </Button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1" role="toolbar" aria-label={t("caseBoard.drawers.leads")}>
            <FilterChip active={activeOrigin === "ALL"} count={pending.length} onClick={() => setOrigin("ALL")}>
              {t("caseLeads.filters.all")}
            </FilterChip>
            {LEAD_ORIGINS.filter((o) => (counts.get(o) ?? 0) > 0).map((o) => {
              const Icon = ORIGIN_ICON[o];
              return (
                <FilterChip
                  key={o}
                  active={activeOrigin === o}
                  count={counts.get(o) ?? 0}
                  onClick={() => setOrigin(activeOrigin === o ? "ALL" : o)}
                  testId={`leads-filter-${o}`}
                >
                  <Icon className="size-3" aria-hidden />
                  {t(`caseLeads.filters.${o}`)}
                </FilterChip>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("caseLeads.search")}
                className="h-8 pl-7 text-xs"
                aria-label={t("caseLeads.search")}
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as LeadSort)}>
              <SelectTrigger className="h-8 w-[136px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relevance">{t("caseLeads.sort.relevance")}</SelectItem>
                <SelectItem value="newest">{t("caseLeads.sort.newest")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {loading && leads.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("caseLeads.loading")}
        </div>
      ) : pending.length === 0 ? (
        <div className="rounded-[4px] border-2 border-dashed border-border px-4 py-8 text-center" data-testid="leads-empty">
          <Radar className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium">{t("caseLeads.emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("caseLeads.emptyBody")}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("caseLeads.noMatch")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {shown.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                busy={busy?.has(lead.id) ?? false}
                readOnly={readOnly}
                onAccept={() => onAccept(lead)}
                onDismiss={() => setDismissing([lead.id])}
                onDragStart={onLeadDragStart && !readOnly ? (event) => onLeadDragStart(lead, event) : undefined}
                onShowOnBoard={onShowOnBoard && (canShowOnBoard?.(lead) ?? true) ? () => onShowOnBoard(lead) : undefined}
                onOpenWatch={onOpenWatch && lead.viaInquiryId ? () => onOpenWatch(lead.viaInquiryId!) : undefined}
              />
            ))}
          </ul>
          {!readOnly && shown.length > 1 && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => setDismissing(shown.map((l) => l.id))}
              data-testid="leads-dismiss-shown"
            >
              {t("caseLeads.dismissShown", { count: shown.length })}
            </button>
          )}
        </>
      )}

      {reviewed.length > 0 && (
        <Collapsible open={reviewedOpen} onOpenChange={setReviewedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              <ChevronDown className={cn("size-3 transition-transform", !reviewedOpen && "-rotate-90")} />
              {t("caseLeads.reviewed", { count: reviewed.length })}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {reviewed.length > 0 && !readOnly && (onReviewedDragStart || onAddReviewed) && (
              <p className="text-[11px] text-muted-foreground">{t("caseLeads.reviewedHint")}</p>
            )}
            {reviewed.map((lead) => {
              const joined = joinedAnotherWay(lead);
              // What the lead points at, as the case holds it now (it may have left since).
              const here = isInCase ? isInCase(lead) : joined;
              const draggable = !readOnly && !here && !!onReviewedDragStart;
              return (
                <div
                  key={lead.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-[4px] border border-border px-2.5 py-1.5 text-xs",
                    draggable && "cursor-grab hover:border-foreground/40 active:cursor-grabbing",
                  )}
                  draggable={draggable || undefined}
                  onDragStart={draggable ? (event) => onReviewedDragStart!(lead, event) : undefined}
                  title={draggable ? t("caseLeads.drag") : undefined}
                  data-testid="lead-reviewed"
                  data-in-case={here || undefined}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-[3px] border px-1 font-mono text-[9px] tracking-[0.06em] uppercase",
                      lead.status === "DISMISSED" ? "border-border text-muted-foreground" : "border-foreground/40 text-foreground",
                    )}
                  >
                    {joined ? t("caseLeads.status.inCase") : t(`caseLeads.status.${lead.status === "DISMISSED" ? "DISMISSED" : "ACCEPTED"}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{lead.kind === "ASSET" ? (lead.assetName ?? lead.title) : lead.title}</span>
                  {!joined && (
                    <span className="hidden shrink-0 text-muted-foreground @sm:inline">
                      {lead.reviewedBy ?? "—"}
                      {lead.reviewedAt ? ` · ${new Date(lead.reviewedAt).toLocaleDateString()}` : ""}
                    </span>
                  )}
                  {here ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-muted-foreground uppercase"
                      title={t("caseLeads.inCaseNow")}
                      data-testid="lead-reviewed-in-case"
                    >
                      <Check className="size-3" aria-hidden /> {t("caseLeads.inCaseShort")}
                    </span>
                  ) : (
                    !readOnly &&
                    onAddReviewed && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 gap-0.5 px-1.5 text-[10px]"
                        onClick={() => onAddReviewed(lead)}
                        title={t("caseLeads.addAgainHint")}
                        data-testid="lead-reviewed-add"
                      >
                        <Plus className="size-3" /> {t("caseLeads.addAgain")}
                      </Button>
                    )
                  )}
                  {draggable && <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" aria-hidden />}
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}

      <DismissDialog
        count={dismissing?.length ?? 0}
        open={!!dismissing}
        onCancel={() => setDismissing(null)}
        onConfirm={(reason) => {
          if (dismissing) onDismiss(dismissing, reason);
          setDismissing(null);
        }}
      />
    </div>
  );
}

function FilterChip({
  active,
  count,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border-2 px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/30",
      )}
    >
      {children}
      <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

/** Why the case suggests it, in words, from the lead's origin and what it hangs off. */
function useWhy() {
  const { t } = useTranslation();
  return (lead: CaseLeadDto): string => {
    const why = leadWhy(lead);
    const inAsset = (text: string, asset: string | null) =>
      asset ? `${text} ${t("caseLeads.why.in", { asset })}` : text;
    switch (why.kind) {
      case "sameValue":
        return inAsset(t("caseLeads.why.sameValue", { via: why.via }), why.asset);
      case "similar":
        return inAsset(t("caseLeads.why.similar", { pct: why.pct, via: why.via }), why.asset);
      case "watch":
        return why.isNew
          ? `${t("caseLeads.why.watch", { watch: why.watch })} · ${t("caseLeads.why.new")}`
          : t("caseLeads.why.watch", { watch: why.watch });
      case "confirmed":
        return t("caseLeads.why.confirmed", { asset: why.asset });
      case "identical":
        return t("caseLeads.why.identical", { asset: why.asset });
      case "shares":
        return `${
          why.labels.length > 0
            ? t("caseLeads.why.shares", { labels: why.labels.join(", "), asset: why.asset })
            : t("caseLeads.why.sharesValues", { asset: why.asset })
        } · ${t("caseLeads.why.matchWeight", { pct: why.pct })}`;
      case "rationale":
        // Autopilot's reasoning and a person's note are their own words.
        return why.text;
    }
  };
}

function LeadCard({
  lead,
  busy,
  readOnly,
  onAccept,
  onDismiss,
  onDragStart,
  onShowOnBoard,
  onOpenWatch,
}: {
  lead: CaseLeadDto;
  busy: boolean;
  readOnly: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onDragStart?: (event: React.DragEvent) => void;
  onShowOnBoard?: () => void;
  onOpenWatch?: () => void;
}) {
  const { t } = useTranslation();
  const why = useWhy();
  const reason = leadReason(lead);
  // Confirmed duplicates and same values are the strongest reasons there are.
  const strong = reason === "SAME_VALUE" || (lead.details as Record<string, unknown> | null)?.verdict === "CONFIRMED";
  const ReasonIcon = ORIGIN_ICON[reason] ?? Radar;
  const asset = lead.kind === "ASSET";
  const AssetIcon = getAssetKindIcon(lead.assetType);
  const scored = leadScore(lead);
  const score =
    scored === null
      ? null
      : scored.kind === "identical"
        ? t("caseLeads.score.identical")
        : scored.kind === "importance"
          ? t("caseLeads.score.importance", { value: scored.value })
          : t(`caseLeads.score.${scored.kind}`, { pct: scored.pct });
  const where = asset
    ? [lead.assetType, lead.sourceName ?? lead.sourceType].filter(Boolean).join(" · ")
    : [lead.assetName ? t("caseLeads.inAsset", { asset: lead.assetName }) : null, lead.sourceName ?? lead.sourceType]
        .filter(Boolean)
        .join(" · ");

  return (
    <li
      className={cn(
        "group rounded-[4px] border-2 border-border bg-card transition-colors hover:border-foreground/40",
        onDragStart && !busy && "cursor-grab active:cursor-grabbing",
        busy && "opacity-60",
      )}
      draggable={onDragStart ? !busy : undefined}
      onDragStart={onDragStart}
      title={onDragStart ? t("caseLeads.drag") : undefined}
      data-testid="lead-card"
      data-origin={lead.origin}
    >
      <div className="space-y-1 px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.08em] whitespace-nowrap uppercase",
              strong ? "border-foreground text-foreground" : "border-border text-muted-foreground",
            )}
          >
            <ReasonIcon className="size-3" aria-hidden />
            {t(`caseLeads.origin.${reason}`)}
          </span>
          {score && <span className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">{score}</span>}
          <span className="flex-1" />
          {lead.severity && (
            <SeverityBadge severity={lead.severity.toLowerCase() as never} className="px-1 py-px text-[8px]">
              {lead.severity}
            </SeverityBadge>
          )}
          {onDragStart && <GripVertical className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground" aria-hidden />}
        </div>

        {asset ? (
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <AssetIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{lead.assetName ?? lead.title}</span>
          </p>
        ) : lead.value != null ? (
          <p className="min-w-0 text-sm">
            <span className="mr-1.5 font-mono text-[10px] text-muted-foreground uppercase">{lead.findingType}</span>
            <span className="font-mono font-medium break-all">{lead.value}</span>
          </p>
        ) : (
          <p className="text-sm font-medium">{lead.title}</p>
        )}
        {where && <p className="truncate text-[11px] text-muted-foreground">{where}</p>}
        <p className="text-xs">
          <span className="text-muted-foreground">↳ </span>
          {why(lead)}
        </p>
        {lead.findingStatus && lead.findingStatus !== "OPEN" && (
          <p className="font-mono text-[10px] text-muted-foreground uppercase">{t("caseLeads.resolved")}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-2 py-1.5">
        {!readOnly && (
          <>
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onAccept} disabled={busy} title={t("caseLeads.acceptHint")} data-testid="lead-accept">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" strokeWidth={3} />}
              {t("caseLeads.accept")}
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onDismiss} disabled={busy} data-testid="lead-dismiss">
              <X className="size-3" />
              {t("caseLeads.dismiss")}
            </Button>
          </>
        )}
        <span className="flex-1" />
        {onOpenWatch && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-[11px] whitespace-nowrap" onClick={onOpenWatch}>
            <Sparkles className="size-3" /> {t("caseLeads.openWatch")}
          </Button>
        )}
        {onShowOnBoard && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onShowOnBoard}
            title={t("caseLeads.showOnBoard")}
            aria-label={t("caseLeads.showOnBoard")}
            data-testid="lead-show-on-board"
          >
            <Crosshair className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}

function DismissDialog({
  count,
  open,
  onCancel,
  onConfirm,
}: {
  count: number;
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{count > 1 ? t("caseLeads.dismissManyTitle", { count }) : t("caseLeads.dismissTitle")}</DialogTitle>
          <DialogDescription>{t("caseLeads.dismissBody")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={3}
          placeholder={t("caseLeads.reasonPlaceholder")}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim() || undefined)} data-testid="lead-dismiss-confirm">
            {t("caseLeads.dismissConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
