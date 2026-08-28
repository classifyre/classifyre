"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Eye,
  FolderPlus,
  Loader2,
  RotateCcw,
  Search,
  User,
} from "lucide-react";
import { api, type ReviewDecisionRowDto } from "@workspace/api-client";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { formatDate, formatRelative } from "@/lib/date";
import { FingerprintsCaseDialog } from "@/components/fingerprints-case-dialog";
import { PanelCard, panelHeadingClass } from "@/components/panel-card";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { encodePairId, fmt, score2 } from "./review-format";

type Filter = "ALL" | "CONFIRMED" | "REJECTED" | "UNSURE" | "UNACTIONED";

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-accent-foreground";

const VERDICT_TONE: Record<string, string> = {
  CONFIRMED: "border-accent text-foreground",
  REJECTED: "border-destructive text-destructive",
  UNSURE: "border-border text-muted-foreground",
  SPLIT: "border-border text-muted-foreground",
};

/**
 * Decisions as a table, in the same idiom as the sources list: select rows,
 * act in bulk, or act on one row from the icons at its right edge.
 *
 * Per-row actions live in the row rather than in a toolbar, because a toolbar
 * makes you select something first to do a thing to one item — an extra step
 * for the common case. The bulk bar only appears once a selection exists.
 */
export function DecisionsTable({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  const [rows, setRows] = React.useState<ReviewDecisionRowDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [unactioned, setUnactioned] = React.useState(0);
  const [byAgent, setByAgent] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("ALL");
  const [selection, setSelection] = React.useState<Map<string, ReviewDecisionRowDto>>(
    () => new Map(),
  );
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [caseOpen, setCaseOpen] = React.useState(false);
  const [casePairs, setCasePairs] = React.useState<ReviewDecisionRowDto[]>([]);

  const key = (r: { aId: string; bId: string }) => `${r.aId}|${r.bId}`;

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlationReview
      .correlationReviewControllerDecisions({
        ...(filter === "UNACTIONED"
          ? { unactionedOnly: "true", verdict: "CONFIRMED" }
          : filter === "ALL"
            ? {}
            : { verdict: filter }),
        limit: "100",
      })
      .then((d) => {
        if (!active) return;
        setRows(d.rows);
        setTotal(d.total);
        setUnactioned(d.unactioned);
        setByAgent(d.byAgent);
        setSelection(new Map());
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : t("review.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, t]);

  React.useEffect(() => load(), [load]);

  const selected = Array.from(selection.values());
  const headerChecked = rows.length > 0 && selection.size === rows.length;
  const headerIndeterminate = selection.size > 0 && !headerChecked;

  const toggleRow = (r: ReviewDecisionRowDto) =>
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(key(r))) next.delete(key(r));
      else next.set(key(r), r);
      return next;
    });

  const toggleAll = () =>
    setSelection((prev) =>
      prev.size > 0 ? new Map() : new Map(rows.map((r) => [key(r), r])),
    );

  const openCaseDialog = (picks: ReviewDecisionRowDto[]) => {
    setCasePairs(picks);
    setCaseOpen(true);
  };

  const reopen = async (picks: ReviewDecisionRowDto[]) => {
    const single = picks.length === 1 ? key(picks[0]!) : null;
    if (single) setBusyKey(single);
    else setBulkBusy(true);
    try {
      await api.correlationReview.correlationReviewControllerReopen({
        reopenDecisionsDto: {
          pairs: picks.map((r) => ({ aId: r.aId, bId: r.bId })),
        },
      });
      toast.success(t("review.decisions.reopened"));
      onChanged();
      // Reopening puts the pair back in the queue, so go where it went — a
      // toast about something you can no longer see is not an outcome.
      if (picks.length === 1 && picks[0]) {
        router.push(
          nsPath(
            `/duplicates/pairs/${encodePairId(picks[0].aId, picks[0].bId)}`,
          ),
        );
        return;
      }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusyKey(null);
      setBulkBusy(false);
    }
  };

  const toInquiry = async (picks: ReviewDecisionRowDto[]) => {
    setBulkBusy(true);
    try {
      const r =
        await api.correlationReview.correlationReviewControllerDecisionsToInquiry(
          {
            decisionsToInquiryDto: {
              pairs: picks.map((x) => ({ aId: x.aId, bId: x.bId })),
            },
          },
        );
      toast.success(
        t("review.decisions.inquiryDone", {
          title: r.title,
          count: r.matchCount,
        }),
      );
      router.push(nsPath(`/investigations/inquiries/${r.inquiryId}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBulkBusy(false);
    }
  };

  const filters: Array<{ value: Filter; label: string; hint?: string }> = [
    { value: "ALL", label: t("review.decisions.filterAll") },
    {
      value: "UNACTIONED",
      label: t("review.decisions.filterUnactioned"),
      hint: t("review.decisions.unactionedHint"),
    },
    { value: "CONFIRMED", label: t("review.decisions.verdict.CONFIRMED") },
    { value: "REJECTED", label: t("review.decisions.verdict.REJECTED") },
    { value: "UNSURE", label: t("review.decisions.verdict.UNSURE") },
  ];

  return (
    <PanelCard className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className={panelHeadingClass}>{t("review.decisions.title")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {t("review.decisions.subtitle")}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          {fmt(total)}
          {unactioned > 0
            ? ` · ${fmt(unactioned)} ${t("review.decisions.nowhere")}`
            : ""}
          {byAgent > 0
            ? ` · ${t("review.decisions.agentShare", { count: fmt(byAgent) })}`
            : ""}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Tooltip key={f.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={filter === f.value}
                className={`rounded-[3px] border-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  filter === f.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            </TooltipTrigger>
            {f.hint ? <TooltipContent>{f.hint}</TooltipContent> : null}
          </Tooltip>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5">
          <span className="font-mono text-xs text-accent">
            {t("review.decisions.selected", { count: selected.length })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={() => openCaseDialog(selected)}
            className="ml-auto rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("review.decisions.toCase")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={() => toInquiry(selected)}
            className="rounded-[4px] border-2 border-border font-mono text-xs font-bold uppercase tracking-[0.08em]"
          >
            {bulkBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {t("review.decisions.toInquiry")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => reopen(selected)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("review.decisions.reopen")}
          </Button>
        </div>
      )}

      {error ? (
        <p className="py-8 text-center text-[12px] text-destructive">{error}</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Eye}
          title={t("review.decisions.empty")}
          description={t("review.decisions.emptyHint")}
        />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur dark:bg-card/95">
              <TableRow>
                <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                  <span className="flex items-center justify-center">
                    <Checkbox
                      checked={
                        headerIndeterminate ? "indeterminate" : headerChecked
                      }
                      onCheckedChange={toggleAll}
                      aria-label={t("review.decisions.selectAll")}
                      className={CHECKBOX_CLASS}
                    />
                  </span>
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colPair")}
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colVerdict")}
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colScore")}
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colPattern")}
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colOutcome")}
                </TableHead>
                <TableHead className="bg-white/95 dark:bg-card/95">
                  {t("review.decisions.colDecided")}
                </TableHead>
                <TableHead className="bg-white/95 text-right dark:bg-card/95">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t("sources.columns.actions")}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const k = key(r);
                const isSelected = selection.has(k);
                return (
                  <TableRow
                    key={k}
                    className={isSelected ? "align-top bg-accent/5" : "align-top"}
                  >
                    <TableCell className="py-3">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(r)}
                          aria-label={`${r.aName} / ${r.bName}`}
                          className={CHECKBOX_CLASS}
                        />
                      </div>
                    </TableCell>

                    <TableCell className="max-w-[300px] py-3">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto max-w-[280px] justify-start p-0 text-left"
                        onClick={() =>
                          router.push(
                            nsPath(
                              `/duplicates/pairs/${encodePairId(r.aId, r.bId)}`,
                            ),
                          )
                        }
                      >
                        <span className="truncate text-sm font-semibold">
                          {r.aName}
                        </span>
                      </Button>
                      <p className="max-w-[280px] truncate text-[11px] text-muted-foreground">
                        ↔ {r.bName}
                      </p>
                    </TableCell>

                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={`rounded-[4px] text-[11px] ${VERDICT_TONE[r.verdict] ?? ""}`}
                      >
                        {t(
                          `review.decisions.verdict.${r.verdict}` as TranslationKey,
                        )}
                      </Badge>
                    </TableCell>

                    <TableCell className="py-3">
                      <span className="font-mono text-xs tabular-nums">
                        {score2(r.scoreAtVerdict)}
                      </span>
                      {/* A decision taken on a score that has since moved
                          deserves another look, not silent trust. */}
                      {r.stale && r.currentScore != null ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="cursor-default font-mono text-[10px] text-destructive">
                              → {score2(r.currentScore)}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("review.decisions.staleHint")}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </TableCell>

                    <TableCell className="max-w-[180px] py-3">
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {r.patternKey}
                      </span>
                    </TableCell>

                    <TableCell className="py-3">
                      {r.caseId ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-[11px]"
                          onClick={() =>
                            router.push(nsPath(`/investigations/${r.caseId}`))
                          }
                        >
                          {t("review.decisions.inCase")}
                        </Button>
                      ) : r.inquiryId ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-[11px]"
                          onClick={() =>
                            router.push(
                              nsPath(
                                `/investigations/inquiries/${r.inquiryId}`,
                              ),
                            )
                          }
                        >
                          {t("review.decisions.inInquiry")}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {t("review.decisions.nowhere")}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      <div className="flex items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {r.decidedByKind === "ai" ? (
                              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {r.decidedByKind === "ai"
                              ? t("review.decisions.byAgent")
                              : t("review.decisions.byOperator")}
                          </TooltipContent>
                        </Tooltip>
                        <div>
                          <div className="text-xs">
                            {formatDate(r.decidedAt)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatRelative(r.decidedAt)}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Row actions: icons at the right edge, each explained. */}
                    <TableCell className="py-3">
                      <div className="flex items-center justify-end gap-2">
                        <RowAction
                          label={t("review.decisions.view")}
                          onClick={() =>
                            router.push(
                              nsPath(
                                `/duplicates/pairs/${encodePairId(r.aId, r.bId)}`,
                              ),
                            )
                          }
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </RowAction>
                        <RowAction
                          label={t("review.decisions.toCase")}
                          onClick={() => openCaseDialog([r])}
                        >
                          <FolderPlus className="h-3.5 w-3.5" />
                        </RowAction>
                        <RowAction
                          label={t("review.decisions.toInquiry")}
                          onClick={() => toInquiry([r])}
                        >
                          <Search className="h-3.5 w-3.5" />
                        </RowAction>
                        <RowAction
                          label={t("review.decisions.reopen")}
                          busy={busyKey === k}
                          onClick={() => reopen([r])}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </RowAction>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <FingerprintsCaseDialog
        open={caseOpen}
        onOpenChange={setCaseOpen}
        assetIds={[...new Set(casePairs.flatMap((r) => [r.aId, r.bId]))]}
        assetLabel={(id) =>
          casePairs.find((r) => r.aId === id)?.aName ??
          casePairs.find((r) => r.bId === id)?.bName ??
          id
        }
      />
    </PanelCard>
  );
}

function RowAction({
  label,
  onClick,
  busy,
  children,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-[4px] border-2 border-border"
          onClick={onClick}
          disabled={busy}
          aria-label={label}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
