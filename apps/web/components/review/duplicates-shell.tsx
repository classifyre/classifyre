"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Fingerprint } from "lucide-react";
import {
  api,
  type ReviewPatternDto,
  type ReviewPortfolioResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Spinner } from "@workspace/ui/components/spinner";
import { PanelCard } from "@/components/panel-card";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { ReviewBandStrip } from "./review-band-strip";
import { ScoreHistogram } from "./score-histogram";
import { SourceBreakdown } from "./source-breakdown";
import {
  combinedBuckets,
  portfolioBands,
  type Cutoffs,
  type PortfolioBands,
} from "./review-format";

export interface DuplicatesShellContext {
  portfolio: ReviewPortfolioResponseDto;
  /** Source ids the view is narrowed to; empty means everything. */
  sourceFilter: string[];
  bands: PortfolioBands;
  cutoffs: Cutoffs;
  onCutoffs: (next: Cutoffs) => void;
  refresh: () => void;
  /** Resolved when the route carries a pattern key. */
  pattern: ReviewPatternDto | null;
}

/**
 * Chrome shared by every duplicate-review page: the portfolio fetch, the
 * cutoffs, the section nav, and the right-hand instrument rail.
 *
 * The rail is where anything you glance at while working lives — how the
 * matches stand, the score distribution, where they come from. The left column
 * is the work itself. Keeping that split constant across sections means moving
 * between them never rearranges the page under you.
 */
export function DuplicatesShell({
  active,
  patternKey,
  bare,
  children,
}: {
  active: "queue" | "decisions" | "sources" | "tune";
  patternKey?: string;
  /** Skip the instrument rail — a full-width section owns the whole page. */
  bare?: boolean;
  children: (ctx: DuplicatesShellContext) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const { namespaceSlug } = useParams<{ namespaceSlug: string }>();

  const [portfolio, setPortfolio] =
    React.useState<ReviewPortfolioResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadAt, setReloadAt] = React.useState(0);
  const [cutoffs, setCutoffs] = React.useState<Cutoffs | null>(null);
  const [savedCutoffs, setSavedCutoffs] = React.useState<Cutoffs | null>(null);
  const [savingCutoffs, setSavingCutoffs] = React.useState(false);
  const [rebuilding, setRebuilding] = React.useState(false);
  // Clicking a source in the rail narrows the queue to pairs touching it.
  // Several can be active at once: "these two systems" is a real question.
  const [sourceFilter, setSourceFilter] = React.useState<string[]>([]);
  const onToggleSource = React.useCallback((id: string) => {
    setSourceFilter((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  React.useEffect(() => {
    let active2 = true;
    setLoading(true);
    setError(null);
    api.correlationReview
      .correlationReviewControllerPortfolio(
        sourceFilter.length > 0 ? { sourceIds: sourceFilter.join(",") } : {},
      )
      .then((p) => {
        if (!active2) return;
        setPortfolio(p);
        setCutoffs((prev) => {
          if (prev) return prev;
          const next = { review: p.relatedMin, merge: p.duplicateMin };
          setSavedCutoffs(next);
          return next;
        });
      })
      .catch((e: unknown) => {
        if (active2)
          setError(e instanceof Error ? e.message : t("review.loadFailed"));
      })
      .finally(() => {
        if (active2) setLoading(false);
      });
    return () => {
      active2 = false;
    };
  }, [namespaceSlug, reloadAt, sourceFilter, t]);

  const refresh = React.useCallback(() => setReloadAt(Date.now()), []);

  const saveCutoffs = React.useCallback(async () => {
    if (!cutoffs) return;
    setSavingCutoffs(true);
    try {
      await api.correlation.correlationControllerUpdateConfig({
        updateCorrelationConfigDto: {
          relatedMin: cutoffs.review,
          duplicateMin: cutoffs.merge,
        },
      });
      setSavedCutoffs(cutoffs);
      toast.success(t("review.histogram.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setSavingCutoffs(false);
    }
  }, [cutoffs, t]);

  const rebuild = React.useCallback(async () => {
    setRebuilding(true);
    try {
      const r =
        await api.correlationReview.correlationReviewControllerRebuild();
      if (r.pairs === 0) toast.info(t("review.rebuildEmpty"));
      else
        toast.success(
          t("review.rebuildDone", { pairs: r.pairs, patterns: r.patterns }),
        );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setRebuilding(false);
    }
  }, [refresh, t]);

  const sections = [
    { key: "queue" as const, label: t("review.decisions.tabQueue"), href: "/duplicates" },
    {
      key: "decisions" as const,
      label: t("review.decisions.tabDecisions"),
      href: "/duplicates/decisions",
    },
    // Tuning is a third destination, not a button floating beside the title:
    // it is the same kind of thing as the other two, so it sits with them.
    {
      key: "tune" as const,
      label: t("fingerprints.tabTune"),
      href: "/duplicates/tune",
    },
  ];

  if (loading && !portfolio) {
    return (
      <Chrome sections={sections} active={active}>
        <PanelCard className="flex justify-center py-20">
          <Spinner />
        </PanelCard>
      </Chrome>
    );
  }

  if (!portfolio || !cutoffs) {
    return (
      <Chrome sections={sections} active={active}>
        <PanelCard className="space-y-3 py-14 text-center">
          <p className="text-[13px] text-muted-foreground">
            {error ?? t("review.loadFailed")}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            {t("review.retry")}
          </Button>
        </PanelCard>
      </Chrome>
    );
  }

  if (portfolio.totalPairs === 0 && active !== "tune") {
    return (
      <Chrome sections={sections} active={active}>
        <PanelCard className="space-y-3 py-16 text-center">
          <p className="font-serif text-lg font-black uppercase tracking-[0.06em]">
            {t("review.empty")}
          </p>
          <p className="mx-auto max-w-[46ch] text-[13px] text-muted-foreground">
            {t("review.emptyHint")}
          </p>
          <div className="space-y-1.5 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={rebuild}
              disabled={rebuilding}
            >
              {rebuilding ? t("review.rebuilding") : t("review.rebuild")}
            </Button>
            <p className="mx-auto max-w-[46ch] text-[11px] text-muted-foreground">
              {t("review.rebuildHint")}
            </p>
          </div>
        </PanelCard>
      </Chrome>
    );
  }

  const bands = portfolioBands(portfolio.patterns, cutoffs);
  const pattern =
    patternKey != null
      ? (portfolio.patterns.find((p) => p.patternKey === patternKey) ?? null)
      : null;
  const ctx: DuplicatesShellContext = {
    portfolio,
    sourceFilter,
    bands,
    cutoffs,
    onCutoffs: setCutoffs,
    refresh,
    pattern,
  };
  const cutoffsDirty =
    savedCutoffs == null ||
    savedCutoffs.review !== cutoffs.review ||
    savedCutoffs.merge !== cutoffs.merge;

  return (
    <Chrome sections={sections} active={active}>
      {bare ? (
        children(ctx)
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <div className="min-w-0">{children(ctx)}</div>

          {/* Instruments, not work. Everything here is something you check
              while deciding, never the thing you are deciding. */}
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4">
            <PanelCard className="py-4 sm:py-4">
              <ReviewBandStrip bands={bands} />
            </PanelCard>
            <PanelCard>
              <ScoreHistogram
                buckets={combinedBuckets(portfolio.patterns)}
                cutoffs={cutoffs}
                onChange={setCutoffs}
                onSave={saveCutoffs}
                saving={savingCutoffs}
                dirty={cutoffsDirty}
              />
            </PanelCard>
            <PanelCard>
              <SourceBreakdown
                graph={portfolio.sources}
                selected={sourceFilter}
                onToggle={onToggleSource}
              />
            </PanelCard>
          </aside>
        </div>
      )}
    </Chrome>
  );
}

function Chrome({
  sections,
  active,
  children,
}: {
  sections: Array<{ key: string; label: string; href: string }>;
  active: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-7 w-7 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.06em]">
            {t("review.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("review.subtitle")}
          </p>
        </div>
      </div>

      <Tabs
        value={active}
        onValueChange={(next) => {
          const section = sections.find((s) => s.key === next);
          if (section) router.push(nsPath(section.href));
        }}
      >
        <TabsList>
          {sections.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {children}
    </div>
  );
}
