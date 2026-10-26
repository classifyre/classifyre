"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { ExploreDuplicatesFilterDto, ReviewPortfolioResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { patternName } from "./review-format";

// The canvas measures the DOM: client-only.
const ExploreWorkspace = dynamic(
  () => import("@/components/explore/explore-workspace").then((m) => m.ExploreWorkspace),
  { ssr: false },
);

const FAMILIES = ["SHARED_LABELS", "PHONETIC", "IDENTICAL_CONTENT", "NEAR_DUPLICATE_TEXT"] as const;
const REVIEW_STATES = ["any", "open", "confirmed"] as const;
const SCORES = ["any", "review", "merge"] as const;
/** Radix Select takes no empty value: "all" stands for no filter. */
const ALL = "all";

const MICRO = "font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground";

/** The filter, in the address: a pattern page links straight to its own (`?pattern=`). */
function useDuplicateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const get = (key: string) => params.get(key) || null;
  const set = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value && value !== ALL) next.set(key, value);
      else next.delete(key);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const clear = () => router.replace(pathname, { scroll: false });
  return { get, set, clear, any: ["pattern", "family", "score", "review", "source"].some((k) => params.has(k)) };
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  testId: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={MICRO}>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full min-w-[11rem] rounded-[4px] border-2 sm:w-auto" data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * Duplicate review's Explore: the pairs a filter picks, on the Explore
 * canvas, around the assets in the most of them. The queue is for deciding
 * pairs one pattern at a time; this is for seeing them: which documents
 * gather the most copies, which sources they cross, what else ties them.
 * Dive into any asset to see everything it is connected to.
 */
export function DuplicatesExplore({ portfolio }: { portfolio: ReviewPortfolioResponseDto }) {
  const { t } = useTranslation();
  const filter = useDuplicateFilter();
  const familyLabel = (family: string) => t(`review.patterns.family.${family}` as TranslationKey);
  const percent = (score: number) => `${Math.round(score * 100)}%`;

  const patternKey = filter.get("pattern");
  const family = filter.get("family");
  const score = filter.get("score");
  const review = filter.get("review");
  const sourceId = filter.get("source");
  const pattern = portfolio.patterns.find((p) => p.patternKey === patternKey) ?? null;
  const nameOf = (p: (typeof portfolio.patterns)[number]) =>
    patternName(p, familyLabel(p.family), t("review.patterns.miscLabel"));

  const duplicates = React.useMemo<ExploreDuplicatesFilterDto>(
    () => ({
      patternKey: patternKey ?? undefined,
      family: (FAMILIES as readonly string[]).includes(family ?? "")
        ? (family as ExploreDuplicatesFilterDto["family"])
        : undefined,
      minScore: score === "merge" ? portfolio.duplicateMin : score === "review" ? portfolio.relatedMin : undefined,
      review: (REVIEW_STATES as readonly string[]).includes(review ?? "")
        ? (review as ExploreDuplicatesFilterDto["review"])
        : undefined,
      sourceId: sourceId ?? undefined,
    }),
    [family, patternKey, portfolio.duplicateMin, portfolio.relatedMin, review, score, sourceId],
  );

  return (
    <div className="space-y-3" data-testid="duplicates-explore">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label={t("review.explore.pattern")}
          value={patternKey ?? ALL}
          onChange={(v) => filter.set("pattern", v)}
          testId="duplicates-explore-pattern"
          options={[
            { value: ALL, label: t("review.explore.allPatterns") },
            ...portfolio.patterns.map((p) => ({
              value: p.patternKey,
              label: t("review.explore.patternOption", { name: nameOf(p), count: p.pairCount }),
            })),
          ]}
        />
        <FilterSelect
          label={t("review.explore.family")}
          value={family ?? ALL}
          onChange={(v) => filter.set("family", v)}
          testId="duplicates-explore-family"
          options={[
            { value: ALL, label: t("review.explore.allFamilies") },
            ...FAMILIES.map((f) => ({ value: f, label: familyLabel(f) })),
          ]}
        />
        <FilterSelect
          label={t("review.explore.score")}
          value={score ?? "any"}
          onChange={(v) => filter.set("score", v === "any" ? null : v)}
          testId="duplicates-explore-score"
          options={SCORES.map((s) => ({
            value: s,
            label:
              s === "any"
                ? t("review.explore.scoreAny")
                : t(`review.explore.score_${s}` as TranslationKey, {
                    score: percent(s === "merge" ? portfolio.duplicateMin : portfolio.relatedMin),
                  }),
          }))}
        />
        <FilterSelect
          label={t("review.explore.review")}
          value={review ?? "any"}
          onChange={(v) => filter.set("review", v === "any" ? null : v)}
          testId="duplicates-explore-review"
          options={REVIEW_STATES.map((r) => ({ value: r, label: t(`review.explore.review_${r}` as TranslationKey) }))}
        />
        {portfolio.sources.nodes.length > 1 && (
          <FilterSelect
            label={t("review.explore.source")}
            value={sourceId ?? ALL}
            onChange={(v) => filter.set("source", v)}
            testId="duplicates-explore-source"
            options={[
              { value: ALL, label: t("review.explore.allSources") },
              ...portfolio.sources.nodes.map((n) => ({ value: n.id, label: `${n.name} · ${n.pairCount}` })),
            ]}
          />
        )}
        {filter.any && (
          <Button variant="outline" className="h-9 gap-1.5 rounded-[4px] border-2" onClick={filter.clear}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t("review.explore.reset")}
          </Button>
        )}
      </div>
      <ExploreWorkspace
        mode="duplicates"
        duplicates={duplicates}
        rootLabel={pattern ? nameOf(pattern) : t("review.explore.allDuplicates")}
      />
    </div>
  );
}
