"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Eye, Loader2, Undo2 } from "lucide-react";
import {
  api,
  type PatternPreviewResponseDto,
  type ReviewClusterRowDto,
  type ReviewPatternDto,
  type ReviewSamplePairDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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
import { PanelCard, microLabelClass, panelHeadingClass } from "@/components/panel-card";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { LineageEvidenceChip } from "./lineage-evidence-chip";
import { UndoLogDialog } from "./undo-log-dialog";
import {
  encodePairId,
  fmt,
  patternBand,
  score2,
  type Cutoffs,
  type LineageFilter,
} from "./review-format";

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground";

/**
 * One pattern: the rule it suggests, the pairs it produced, and its clusters.
 *
 * The bulk rule is stated inline with its live effect rather than hidden behind
 * a preview dialog. A dialog implies something to configure and a decision to
 * commit; there is nothing to change here, only a consequence to read, so it
 * belongs on the page where it updates as the cutoffs move.
 *
 * Pairs come before clusters because pairs are what gets reviewed. Previously
 * "review a sample" jumped straight into a pair with no idea how many there
 * were or what they looked like — the table makes the work observable first.
 */
export function PatternLevel({
  pattern,
  cutoffs,
  portfolio,
  sourceFilter,
  refresh,
}: {
  pattern: ReviewPatternDto;
  cutoffs: Cutoffs;
  portfolio: { lineageHairball: boolean };
  sourceFilter: string[];
  refresh: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  const [pairs, setPairs] = React.useState<ReviewSamplePairDto[]>([]);
  const [undecidedTotal, setUndecidedTotal] = React.useState(0);
  const [clusters, setClusters] = React.useState<ReviewClusterRowDto[]>([]);
  const [clusterTotal, setClusterTotal] = React.useState(0);
  const [preview, setPreview] = React.useState<PatternPreviewResponseDto | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [applying, setApplying] = React.useState(false);
  const [lineage, setLineage] = React.useState<LineageFilter | null>(null);
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [undoOpen, setUndoOpen] = React.useState(false);

  const band = patternBand(pattern, cutoffs);

  // Unexplained matches are the finding worth chasing, so they get the alarm
  // colour; a clean rule gets the flat foreground; everything else stays quiet.
  const unexplainedShare =
    pattern.lineageNoPathPairs / Math.max(1, pattern.pairCount);
  const tone =
    unexplainedShare >= 0.2
      ? {
          background: "#ff2b2b",
          eyebrow: t("review.lineage.escalateEyebrow"),
          headline: t("review.lineage.noPathHint"),
        }
      : pattern.ruleKind === "EXCLUSION" || pattern.ruleKind === "THRESHOLD"
        ? {
            background: "#0a0a0a",
            eyebrow: t(
              `review.patterns.rule.${pattern.ruleKind}` as TranslationKey,
            ),
            headline:
              preview?.ruleDescription ??
              t(`review.patterns.shape.${pattern.topologyShape}` as TranslationKey),
          }
        : {
            background: "#3a3a3a",
            eyebrow: t(
              `review.patterns.rule.${pattern.ruleKind}` as TranslationKey,
            ),
            headline:
              preview?.ruleDescription ??
              t(`review.patterns.shape.${pattern.topologyShape}` as TranslationKey),
          };
  const filters = React.useMemo(
    () => ({
      min: String(cutoffs.review),
      max: String(cutoffs.merge),
      sourceIds:
        sourceFilter.length > 0 ? sourceFilter.join(",") : undefined,
    }),
    [cutoffs, sourceFilter],
  );

  const load = React.useCallback(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.correlationReview.correlationReviewControllerSample({
        patternKey: pattern.patternKey,
        n: "50",
        min: filters.min,
        max: filters.max,
        ...(lineage ? { lineage } : {}),
        ...(filters.sourceIds ? { sourceIds: filters.sourceIds } : {}),
      }),
      api.correlationReview.correlationReviewControllerClusters({
        patternKey: pattern.patternKey,
        limit: "25",
        min: filters.min,
        max: filters.max,
        ...(lineage ? { lineage } : {}),
        ...(filters.sourceIds ? { sourceIds: filters.sourceIds } : {}),
      }),
      api.correlationReview.correlationReviewControllerPreview({
        patternKey: pattern.patternKey,
        patternActionDto: {
          verdict: "CONFIRMED",
          min: cutoffs.review,
          max: cutoffs.merge,
          ...(lineage ? { lineage } : {}),
        },
      }),
    ])
      .then(([s, c, p]) => {
        if (!active) return;
        setPairs(s.pairs);
        setUndecidedTotal(s.undecidedTotal);
        setClusters(c.rows);
        setClusterTotal(c.total);
        setPreview(p);
        setSelection(new Set());
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pattern.patternKey, filters, cutoffs, lineage]);

  React.useEffect(() => load(), [load]);

  const openPair = (aId: string, bId: string) =>
    router.push(nsPath(`/duplicates/pairs/${encodePairId(aId, bId)}`));

  const applyRule = async () => {
    setApplying(true);
    try {
      const r = await api.correlationReview.correlationReviewControllerApply({
        patternKey: pattern.patternKey,
        patternActionDto: {
          verdict: "CONFIRMED",
          min: cutoffs.review,
          max: cutoffs.merge,
          ...(lineage ? { lineage } : {}),
        },
      });
      toast.success(t("review.bulk.applied", { count: fmt(r.applied) }));
      refresh();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setApplying(false);
    }
  };

  const confirmSelected = async () => {
    const picks = pairs.filter((p) => selection.has(`${p.aId}|${p.bId}`));
    if (picks.length === 0) return;
    setApplying(true);
    try {
      await api.correlationReview.correlationReviewControllerRecordVerdicts({
        recordVerdictDto: {
          pairs: picks.map((p) => ({ aId: p.aId, bId: p.bId })),
          verdict: "CONFIRMED",
        },
      });
      toast.success(t("review.bulk.applied", { count: fmt(picks.length) }));
      refresh();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setApplying(false);
    }
  };

  const lineageFilters: Array<{ value: LineageFilter | null; label: string }> = [
    { value: null, label: t("review.filters.all") },
    { value: "NO_PATH", label: t("review.lineage.noPath") },
    { value: "PATH", label: t("review.lineage.path") },
    { value: "UNKNOWN", label: t("review.lineage.unknown") },
  ];

  return (
    <div className="space-y-4">
      {/* Sticky: on a page this long, a back link that scrolls away leaves
          the only exit off-screen. */}
      <div className="sticky top-0 z-30 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-[4px] border-2 border-border"
          onClick={() => router.push(nsPath("/duplicates"))}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("review.backToPatterns")}
        </Button>
      </div>

      {/* The header is coloured by what the pattern MEANS, the way the
          overview colours "what needs attention": red when the matches are
          unexplained by lineage (two teams built the same thing and nothing
          connects them — the expensive, invisible case), the flat foreground
          when it is a straightforward rule, and a quiet card when it is an
          ordinary judgement call. Colour here is information, not decoration. */}
      <PanelCard
        className="flex flex-col justify-between text-white sm:p-6"
        style={{ backgroundColor: tone.background }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-white/80">
              {tone.eyebrow}
            </span>
            <h2 className="mt-1 font-serif text-2xl font-black uppercase tracking-[0.04em]">
              {pattern.labels.join(" + ") || pattern.patternKey}
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-[13px] text-white/85">
              {tone.headline}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={applyRule}
              disabled={applying}
              className="border-2 border-white/30 bg-white text-black hover:bg-white/90"
            >
              {applying ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("review.bulk.confirmAll")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-2 border-white/30 bg-transparent text-white hover:bg-white/10"
                  onClick={() => setUndoOpen(true)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("review.bulk.undoLog")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {preview ? (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: t("review.bulk.pairsAffected"), value: preview.pairsAffected },
              { label: t("review.bulk.clustersAffected"), value: preview.clustersAffected },
              { label: t("review.bulk.assetsAffected"), value: preview.assetsAffected },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-[4px] border-2 border-white/25 bg-black/15 px-3 py-2"
              >
                <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-white/70">
                  {stat.label}
                </span>
                <span
                  className="block text-2xl font-bold tabular-nums"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {fmt(stat.value)}
                </span>
              </div>
            ))}
            <div className="rounded-[4px] border-2 border-white/25 bg-black/15 px-3 py-2">
              <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-white/70">
                {t("review.bulk.after")}
              </span>
              <span
                className="block text-2xl font-bold tabular-nums"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                {fmt(preview.workRemainingAfter)}
              </span>
              <span className="font-mono text-[10px] text-white/60">
                {t("review.bulk.before")} {fmt(preview.workRemainingBefore)}
              </span>
            </div>
          </div>
        ) : null}
      </PanelCard>

      <Tabs defaultValue="pairs" urlParam="tab">
        <TabsList>
          <TabsTrigger value="pairs">
            {t("review.pairs.title")}
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-60">
              {fmt(undecidedTotal)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="clusters">
            {t("review.clusters.title")}
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-60">
              {fmt(clusterTotal)}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pairs" className="space-y-4">
      {/* Pairs: the work itself, observable before you commit to any of it. */}
        <PanelCard className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className={panelHeadingClass}>{t("review.pairs.title")}</h3>
            <span className={microLabelClass}>
              {t("review.pairs.showing", {
                shown: fmt(pairs.length),
                total: fmt(undecidedTotal),
              })}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lineageFilters.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setLineage(f.value)}
                aria-pressed={lineage === f.value}
                className={`rounded-[3px] border-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  lineage === f.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {selection.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-[4px] border-2 border-accent/30 bg-background px-4 py-2.5">
              <span className="font-mono text-xs text-accent">
                {t("review.decisions.selected", { count: selection.size })}
              </span>
              <Button
                size="sm"
                className="ml-auto"
                onClick={confirmSelected}
                disabled={applying}
              >
                <Check className="h-3.5 w-3.5" />
                {t("review.actions.confirm")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelection(new Set())}
              >
                {t("review.decisions.clear")}
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pairs.length === 0 ? (
            <EmptyState
              icon={Eye}
              title={t("review.pairs.empty")}
              description={t("review.pairs.emptyHint")}
            />
          ) : (
            <div className="max-h-[52vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur dark:bg-card/95">
                  <TableRow>
                    <TableHead className="w-10 bg-white/95 dark:bg-card/95">
                      <span className="flex items-center justify-center">
                        <Checkbox
                          checked={
                            pairs.length > 0 && selection.size === pairs.length
                          }
                          onCheckedChange={() =>
                            setSelection((prev) =>
                              prev.size > 0
                                ? new Set()
                                : new Set(pairs.map((p) => `${p.aId}|${p.bId}`)),
                            )
                          }
                          aria-label={t("review.decisions.selectAll")}
                          className={CHECKBOX_CLASS}
                        />
                      </span>
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("review.pairs.colPair")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("review.pairs.colScore")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("review.pairs.colMatchedOn")}
                    </TableHead>
                    <TableHead className="bg-white/95 dark:bg-card/95">
                      {t("review.pairs.colLineage")}
                    </TableHead>
                    <TableHead className="bg-white/95 text-right dark:bg-card/95">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {t("sources.columns.actions")}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pairs.map((p) => {
                    const k = `${p.aId}|${p.bId}`;
                    return (
                      <TableRow
                        key={k}
                        className={selection.has(k) ? "bg-accent/5" : undefined}
                      >
                        <TableCell className="py-2.5">
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={selection.has(k)}
                              onCheckedChange={() =>
                                setSelection((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(k)) next.delete(k);
                                  else next.add(k);
                                  return next;
                                })
                              }
                              className={CHECKBOX_CLASS}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[280px] py-2.5">
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto max-w-[260px] justify-start p-0 text-left"
                            onClick={() => openPair(p.aId, p.bId)}
                          >
                            <span className="truncate text-sm font-semibold">
                              {p.aName}
                            </span>
                          </Button>
                          <p className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                            ↔ {p.bName}
                          </p>
                        </TableCell>
                        <TableCell className="py-2.5 font-mono text-xs tabular-nums">
                          {score2(p.weighted)}
                        </TableCell>
                        <TableCell className="max-w-[150px] py-2.5">
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {p.labels.join(" + ") || "—"}
                          </span>
                        </TableCell>
                        {/* The actual values, so a reviewer can see at a glance
                            whether this is a distinctive match or shared
                            boilerplate — without opening the pair. */}
                        <TableCell className="max-w-[260px] py-2.5">
                          {p.sharedValues.length > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex max-w-[250px] cursor-default flex-wrap gap-1">
                                  {p.sharedValues.slice(0, 3).map((v) => (
                                    <span
                                      key={v}
                                      className="max-w-[110px] truncate rounded-[2px] bg-accent/25 px-1 py-px font-mono text-[10px]"
                                    >
                                      {v}
                                    </span>
                                  ))}
                                  {p.sharedValues.length > 3 ? (
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      +{p.sharedValues.length - 3}
                                    </span>
                                  ) : null}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[320px]">
                                {p.sharedValues.join(", ")}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <LineageEvidenceChip
                            state={p.lineageState}
                            hairball={portfolio.lineageHairball}
                            compact
                          />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex justify-end">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 rounded-[4px] border-2 border-border"
                                  aria-label={t("review.pairs.review")}
                                  onClick={() => openPair(p.aId, p.bId)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("review.pairs.review")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </PanelCard>

        </TabsContent>

        <TabsContent value="clusters" className="space-y-4">
      {/* Clusters: for checking the rule above, not for grinding through. */}
        <PanelCard className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="max-w-[70ch]">
              <h3 className={panelHeadingClass}>{t("review.clusters.title")}</h3>
              <p className="text-[11px] text-muted-foreground">
                {t("review.clusters.purpose")}
              </p>
            </div>
            <span className={microLabelClass}>
              {t("review.clusters.showing", {
                shown: fmt(clusters.length),
                total: fmt(clusterTotal),
              })}
            </span>
          </div>

          {clusters.length === 0 ? (
            <p className="border-t-2 border-border py-6 text-center text-[12px] text-muted-foreground">
              {t("review.clusters.empty")}
            </p>
          ) : (
            <div className="overflow-auto rounded-[4px] bg-white dark:bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("review.clusters.colCluster")}</TableHead>
                    <TableHead>{t("review.clusters.colShape")}</TableHead>
                    <TableHead>{t("review.clusters.colUndecided")}</TableHead>
                    <TableHead>{t("review.clusters.colScore")}</TableHead>
                    <TableHead>{t("review.pairs.colLineage")}</TableHead>
                    <TableHead>{t("review.clusters.colLabels")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clusters.map((c) => (
                    <TableRow key={`${c.clusterId}-${c.patternKey}`}>
                      <TableCell className="py-2.5 font-mono text-[11px]">
                        {c.memberCount}{" "}
                        <span className="text-muted-foreground">
                          {t("review.clusters.assets")}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className="rounded-[4px] text-[11px]">
                          {t(
                            `review.patterns.shape.${c.shape}` as TranslationKey,
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 font-mono text-[11px] tabular-nums">
                        {fmt(c.undecidedPairs)} / {fmt(c.pairCount)}
                      </TableCell>
                      <TableCell className="py-2.5 font-mono text-[11px] tabular-nums">
                        {score2(c.maxWeighted)}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <LineageEvidenceChip
                          state={c.lineageState}
                          hairball={portfolio.lineageHairball}
                          compact
                        />
                      </TableCell>
                      <TableCell className="max-w-[200px] py-2.5">
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {c.labels.join(" + ")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </PanelCard>

        </TabsContent>
      </Tabs>

      <UndoLogDialog
        open={undoOpen}
        onOpenChange={setUndoOpen}
        onUndone={(m) => {
          toast.success(m);
          refresh();
          load();
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  subValue,
}: {
  label: string;
  value: number;
  sub?: string;
  subValue?: number;
}) {
  return (
    <div className="rounded-[4px] border-2 border-border bg-background px-3 py-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="block font-serif text-xl font-black tabular-nums">
        {fmt(value)}
      </span>
      {sub && subValue != null ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {sub} {fmt(subValue)}
        </span>
      ) : null}
    </div>
  );
}
