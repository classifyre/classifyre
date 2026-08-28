"use client";

import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { microLabelClass, panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import {
  BUCKET_COUNT,
  bucketForScore,
  scoreForBucket,
  score2,
  type Cutoffs,
} from "./review-format";

/**
 * The distribution, with both cutoffs draggable.
 *
 * Dragging recomputes every count on the page from bucket arrays already in
 * memory — no request. That is deliberate: the histogram's whole purpose is to
 * let someone try a cutoff and see the consequence, and a round trip per pixel
 * makes that impossible.
 *
 * Saving is a separate, explicit button because persisting a cutoff re-scores
 * the entire corpus. Conflating the two would mean a drag kicks off a full
 * recompute, which is exactly the kind of hidden cost that makes people stop
 * touching a control.
 *
 * The shape matters as much as the counts: a clean valley between two modes
 * means a threshold can separate duplicates from non-duplicates, and no valley
 * at all means the features do not carry the signal and no cutoff will rescue
 * it.
 */
export function ScoreHistogram({
  buckets,
  cutoffs,
  onChange,
  onSave,
  saving,
  dirty,
}: {
  buckets: number[];
  cutoffs: Cutoffs;
  onChange: (next: Cutoffs) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const peak = Math.max(1, ...buckets);
  const lo = bucketForScore(cutoffs.review);
  const hi = bucketForScore(cutoffs.merge);

  const setReview = (bucket: number) => {
    // The bands must stay ordered, or "needs review" silently inverts.
    const next = Math.min(bucket, hi - 1);
    onChange({ ...cutoffs, review: scoreForBucket(Math.max(0, next)) });
  };
  const setMerge = (bucket: number) => {
    const next = Math.max(bucket, lo + 1);
    onChange({
      ...cutoffs,
      merge: scoreForBucket(Math.min(BUCKET_COUNT - 1, next)),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={panelHeadingClass}>{t("review.histogram.title")}</h3>
        {dirty ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {t("review.histogram.unsaved")}
          </span>
        ) : null}
      </div>

      <div className="flex h-20 items-end gap-[2px]" aria-hidden>
        {buckets.map((value, i) => (
          <span
            key={i}
            className={`min-h-[2px] flex-1 rounded-t-[2px] ${
              i < lo ? "bg-muted" : i < hi ? "bg-accent" : "bg-foreground"
            }`}
            style={{ height: `${Math.max(2, (value / peak) * 80)}px` }}
            title={`${score2(scoreForBucket(i))} – ${value}`}
          />
        ))}
      </div>

      <div className="space-y-2">
        <CutoffSlider
          id="review-cutoff"
          label={t("review.histogram.reviewCutoff")}
          value={lo}
          min={0}
          max={BUCKET_COUNT - 2}
          onChange={setReview}
        />
        <CutoffSlider
          id="merge-cutoff"
          label={t("review.histogram.mergeCutoff")}
          value={hi}
          min={1}
          max={BUCKET_COUNT - 1}
          onChange={setMerge}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {t("review.histogram.hint")}
        </p>
        {dirty ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={saving}
            title={t("review.histogram.saveHint")}
          >
            {saving ? t("review.histogram.saving") : t("review.histogram.save")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CutoffSlider({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (bucket: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={id}
        className={`${microLabelClass} w-[74px] shrink-0`}
      >
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-[color:var(--accent)]"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-foreground">
        {score2(scoreForBucket(value))}
      </span>
    </div>
  );
}
