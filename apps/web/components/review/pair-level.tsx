"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  api,
  type ReviewPairResponseDto,
  type ReviewSamplePairDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { PanelCard, microLabelClass } from "@/components/panel-card";
import { FingerprintsCaseDialog } from "@/components/fingerprints-case-dialog";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { LineageEvidenceChip } from "./lineage-evidence-chip";
import { MatchWeightWaterfall } from "./match-weight-waterfall";
import { PairActionBar } from "./pair-action-bar";
import { RejectDialog } from "./reject-dialog";
import { PairComparison } from "./pair-comparison";
import { PairValuesTable } from "./pair-values-table";
import { PairEgoGraph } from "./pair-ego-graph";
import {
  encodePairId,
  encodePatternKey,
  fmt,
  score2,
  type Cutoffs,
} from "./review-format";

const pairKey = (aId: string, bId: string): string =>
  aId <= bId ? `${aId}|${bId}` : `${bId}|${aId}`;

export interface PairLevelHandle {
  confirm: () => void;
  reject: () => void;
  split: () => void;
  unsure: () => void;
  openCase: () => void;
  openInquiry: () => void;
}

/**
 * Level 3: the decision.
 *
 * Decisions advance optimistically. A round trip per verdict is the difference
 * between a queue and a form — at 200ms a pair, a reviewer feels every one of
 * them, and throughput is what determines whether this is still in use after
 * the first week. If the write fails the pair comes back and the reviewer is
 * told, rather than the decision being lost quietly.
 */
export const PairLevel = React.forwardRef<
  PairLevelHandle,
  {
    aId: string;
    bId: string;
    hairball: boolean;
    cutoffs: Cutoffs;
    onDecided: () => void;
  }
>(function PairLevel({ aId, bId, hairball, cutoffs, onDecided }, ref) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [pair, setPair] = React.useState<ReviewPairResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [caseOpen, setCaseOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  // The rest of this pattern's backlog, so a decision can move to the next one.
  const [queue, setQueue] = React.useState<ReviewSamplePairDto[]>([]);
  const [remaining, setRemaining] = React.useState<number | null>(null);
  // Pairs settled in this sitting. The server does not know about them until
  // the optimistic writes land, so the queue is filtered against this instead.
  const decidedRef = React.useRef<Set<string>>(new Set());

  /** Back means the pattern this pair came from, not browser history. */
  const goBack = React.useCallback(() => {
    if (pair?.patternKey) {
      router.push(
        nsPath(`/duplicates/patterns/${encodePatternKey(pair.patternKey)}`),
      );
    } else {
      router.push(nsPath("/duplicates"));
    }
  }, [router, nsPath, pair]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.correlationReview
      .correlationReviewControllerPair({ aId, bId })
      .then((p) => {
        if (active) setPair(p);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : t("review.pair.notFound"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [aId, bId, t]);

  /**
   * The rest of the backlog this pair came from.
   *
   * Without it a "queue" was a single form: every decision left the reviewer
   * on the pair they had just settled, and the only way to the next one was
   * back out to the pattern and in again. That is the same dead end the canvas
   * had, one level down — a screen with no next step. The sample endpoint
   * already returns undecided pairs strongest-first under the same cutoffs the
   * pattern list uses, so the queue is the list the reviewer was looking at.
   */
  React.useEffect(() => {
    const patternKey = pair?.patternKey;
    if (!patternKey) return;
    let active = true;
    api.correlationReview
      .correlationReviewControllerSample({
        patternKey,
        n: "25",
        min: String(cutoffs.review),
        max: String(cutoffs.merge),
      })
      .then((s) => {
        if (!active) return;
        // Verdicts are written optimistically, so a refetch can still be
        // holding pairs this session has already settled. Filtering by what
        // was decided here is what keeps the queue from handing the same pair
        // back one step later.
        setQueue(
          s.pairs.filter((p) => !decidedRef.current.has(pairKey(p.aId, p.bId))),
        );
        setRemaining(
          Math.max(0, s.undecidedTotal - decidedRef.current.size),
        );
      })
      .catch(() => {
        // A queue we could not load is not a reason to break the pair screen;
        // the actions still work, they just stop advancing.
        if (active) setQueue([]);
      });
    return () => {
      active = false;
    };
    // Deliberately not keyed on the pair: advancing must not refetch the queue
    // it is walking, or every step reshuffles the order under the reviewer.
  }, [pair?.patternKey, cutoffs.review, cutoffs.merge]);

  /**
   * Move to the next undecided pair, or back to the pattern when there is none.
   *
   * `replace`, not `push`: the pair just decided is gone from the queue, and
   * leaving it in history means Back walks the reviewer through a trail of
   * decisions they have already made.
   */
  const advance = React.useCallback(() => {
    decidedRef.current.add(pairKey(aId, bId));
    const [next, ...rest] = queue.filter(
      (p) => !decidedRef.current.has(pairKey(p.aId, p.bId)),
    );
    if (!next) {
      toast.info(t("review.pair.queueClear"));
      goBack();
      return;
    }
    setQueue(rest);
    setRemaining((n) => (n == null ? null : Math.max(0, n - 1)));
    router.replace(nsPath(`/duplicates/pairs/${encodePairId(next.aId, next.bId)}`));
  }, [queue, aId, bId, router, nsPath, goBack, t]);

  const decide = React.useCallback(
    async (verdict: "CONFIRMED" | "REJECTED" | "UNSURE", message: string) => {
      setBusy(true);
      // Move on first; reconcile behind. The reviewer is already reading the
      // next pair by the time the write lands.
      onDecided();
      advance();
      try {
        await api.correlationReview.correlationReviewControllerRecordVerdicts({
          recordVerdictDto: { pairs: [{ aId, bId }], verdict },
        });
        toast.success(message);
      } catch {
        toast.error(t("review.actions.failed"));
      } finally {
        setBusy(false);
      }
    },
    [aId, bId, onDecided, advance, t],
  );

  const split = React.useCallback(async () => {
    setBusy(true);
    try {
      await api.correlationReview.correlationReviewControllerSplit({ aId, bId });
      toast.success(t("review.actions.splitDone"));
      onDecided();
      advance();
    } catch {
      toast.error(t("review.actions.failed"));
    } finally {
      setBusy(false);
    }
  }, [aId, bId, onDecided, advance, t]);

  const createInquiry = React.useCallback(async () => {
    if (!pair) return;
    setBusy(true);
    try {
      // Matchers derived from what actually made this pair match, so the
      // inquiry watches for the same thing rather than starting blank.
      const created = await api.inquiries.inquiriesControllerCreate({
        createInquiryDto: {
          title: t("review.actions.inquiryTitle"),
          description: t("review.actions.inquiryDescription", {
            labels: pair.labels.join(", "),
            a: pair.a.name,
            b: pair.b.name,
          }),
          matchAllSources: false,
          sourceIds: Array.from(
            new Set([pair.a.sourceId, pair.b.sourceId]),
          ),
          findingTypes: pair.labels,
        },
      });
      router.push(nsPath(`/investigations/inquiries/${created.id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  }, [pair, router, nsPath, t]);

  React.useImperativeHandle(
    ref,
    () => ({
      confirm: () => void decide("CONFIRMED", t("review.actions.confirmed")),
      reject: () => setRejectOpen(true),
      split: () => void split(),
      unsure: () => void decide("UNSURE", t("review.actions.unsureDone")),
      openCase: () => setCaseOpen(true),
      openInquiry: () => void createInquiry(),
    }),
    [decide, split, createInquiry, t],
  );

  /**
   * Keyboard actions, scoped to this screen.
   *
   * They used to be declared on the list pages too, where j/k moved an
   * invisible cursor and Enter did nothing — a legend advertising controls that
   * had no effect. Here every key maps to a button that is visible in the
   * action bar below.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") void decide("CONFIRMED", t("review.actions.confirmed"));
      else if (key === "r") setRejectOpen(true);
      else if (key === "x") void split();
      else if (key === "u") void decide("UNSURE", t("review.actions.unsureDone"));
      else if (key === "e") setCaseOpen(true);
      else if (key === "i") void createInquiry();
      else if (key === "escape") goBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, split, createInquiry, goBack, t]);

  if (loading) {
    return (
      <PanelCard className="flex justify-center py-16">
        <Spinner />
      </PanelCard>
    );
  }
  if (error || !pair) {
    return (
      <PanelCard className="space-y-3 py-10 text-center">
        <p className="text-[13px] text-muted-foreground">
          {error ?? t("review.pair.notFound")}
        </p>
        <Button variant="outline" size="sm" onClick={goBack}>
          {t("review.back")}
        </Button>
      </PanelCard>
    );
  }

  const canSplit = pair.ego.edges.some((e) => e.isWeakest);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-30 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-[4px] border-2 border-border"
          onClick={goBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t("review.backToPattern")}
        </Button>
      </div>

      <PanelCard className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className={microLabelClass}>{t("review.pair.eyebrow")}</p>
            <p
              className="pt-1 text-[clamp(2.2rem,6vw,3.2rem)] font-bold leading-[0.85] tabular-nums text-foreground"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {score2(pair.weighted)}
            </p>
            {/* Only claim a position when there is a queue to be positioned
                in. A deep link opens one pair before the sample lands, and
                "1 of 1" would imply the pattern held a single pair. */}
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {pair.patternKey}
              {remaining != null && remaining > 0 ? (
                <>
                  {" · "}
                  {t("review.pair.remaining", { count: fmt(remaining) })}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <LineageEvidenceChip
              state={pair.lineage.state}
              relation={pair.lineage.relation}
              aDegree={pair.lineage.aDegree}
              bDegree={pair.lineage.bDegree}
              hairball={hairball}
              onOpenLineage={() =>
                router.push(nsPath(`/assets/${pair.a.id}?tab=lineage`))
              }
            />
            {pair.verdict ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("review.pair.alreadyDecided", { verdict: pair.verdict })}
                {pair.verdictStale ? ` · ${t("review.pair.staleVerdict")}` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <PairComparison
          a={pair.a}
          b={pair.b}
          fields={pair.fields}
          onOpenAsset={(id) => router.push(nsPath(`/assets/${id}`))}
        />

        <PairActionBar
          onConfirm={() => void decide("CONFIRMED", t("review.actions.confirmed"))}
          onReject={() => setRejectOpen(true)}
          onSplit={() => void split()}
          onUnsure={() => void decide("UNSURE", t("review.actions.unsureDone"))}
          onCase={() => setCaseOpen(true)}
          onInquiry={() => void createInquiry()}
          canSplit={canSplit}
          busy={busy}
        />
      </PanelCard>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <PanelCard>
          <MatchWeightWaterfall waterfall={pair.waterfall} />
        </PanelCard>
        {/* The canvas brings its own toolbar and sidebar, so it gets a bare
            panel and a real height instead of being squeezed into text flow. */}
        <PanelCard className="flex min-h-[380px] flex-col overflow-hidden p-0 sm:p-0">
          <PairEgoGraph
            ego={pair.ego}
            aId={pair.a.id}
            bId={pair.b.id}
            canSplit={canSplit}
            onSplit={() => void split()}
          />
        </PanelCard>
      </div>

      <PanelCard>
        <PairValuesTable
          fields={pair.fields}
          waterfall={pair.waterfall.rows}
          aName={pair.a.name}
          bName={pair.b.name}
        />
      </PanelCard>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-border pt-2 font-mono text-[10px] text-muted-foreground">
        <span className="uppercase tracking-[0.2em]">
          {t("review.keys.legend")}
        </span>
        {(
          [
            ["c", t("review.keys.confirm")],
            ["r", t("review.keys.reject")],
            ["x", t("review.keys.split")],
            ["u", t("review.keys.unsure")],
            ["e", t("review.keys.case")],
            ["i", t("review.keys.inquiry")],
            ["esc", t("review.keys.back")],
          ] as Array<[string, string]>
        ).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <kbd className="rounded-[2px] border border-border bg-background px-1 py-px text-foreground">
              {k}
            </kbd>
            {label}
          </span>
        ))}
      </div>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        aId={pair.a.id}
        bId={pair.b.id}
        onRejected={() => {
          onDecided();
          advance();
        }}
      />

      <FingerprintsCaseDialog
        open={caseOpen}
        onOpenChange={setCaseOpen}
        assetIds={[pair.a.id, pair.b.id]}
        assetLabel={(id) => (id === pair.a.id ? pair.a.name : pair.b.name)}
      />
    </div>
  );
});
