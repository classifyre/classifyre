"use client";

import { useEffect, useState } from "react";
import { api, type CohortWeightsPreviewDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { ToneBadge } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const BANDS = ["newest", "oldest", "random"] as const;
type Band = (typeof BANDS)[number];

type BandYield = { visited?: number; hits?: number; exhausted?: boolean };
type CohortYield = {
  bands?: Partial<Record<Band, BandYield>>;
  weightsUsed?: Partial<Record<Band, number>>;
  universeSize?: number;
};

const percent = (value: number) =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

const rate = (band: BandYield | undefined) =>
  band?.visited ? percent(((band.hits ?? 0) / band.visited) * 100) : "—";

const bandLabel = (band: Band): TranslationKey =>
  `cohorts.band.${band}` as TranslationKey;

/** Per band of each ctx.cohort() a run walked: what it visited and yielded. */
export function CohortYieldTable({ cohortYield }: { cohortYield: unknown }) {
  const { t } = useTranslation();
  if (!cohortYield || typeof cohortYield !== "object") return null;
  const cohorts = Object.entries(cohortYield as Record<string, CohortYield>);
  if (cohorts.length === 0) return null;

  return (
    <Card className="rounded-[6px]" data-testid="cohort-yield">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("cohorts.runTitle")}</CardTitle>
        <CardDescription>{t("cohorts.runDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cohorts.map(([name, cohort]) => (
          <div key={name} className="space-y-1.5">
            <p className="text-sm">
              <span className="font-mono">{name}</span>
              {cohort.universeSize ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {t("cohorts.universe", {
                    count: cohort.universeSize.toLocaleString(),
                  })}
                </span>
              ) : null}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">
                      {t("cohorts.bandColumn")}
                    </th>
                    <th className="py-1 pr-3 text-right font-medium">
                      {t("cohorts.visited")}
                    </th>
                    <th className="py-1 pr-3 text-right font-medium">
                      {t("cohorts.hits")}
                    </th>
                    <th className="py-1 pr-3 text-right font-medium">
                      {t("cohorts.rate")}
                    </th>
                    <th className="py-1 text-right font-medium">
                      {t("cohorts.weightUsed")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BANDS.filter(
                    (band) =>
                      cohort.bands?.[band] || cohort.weightsUsed?.[band],
                  ).map((band) => {
                    const observed = cohort.bands?.[band];
                    return (
                      <tr
                        key={band}
                        className="border-b border-border/20 last:border-0"
                      >
                        <td className="py-1 pr-3">
                          {t(bandLabel(band))}
                          {observed?.exhausted ? (
                            <ToneBadge tone="idle" className="ml-2">
                              {t("cohorts.exhausted")}
                            </ToneBadge>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">
                          {(observed?.visited ?? 0).toLocaleString()}
                        </td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">
                          {(observed?.hits ?? 0).toLocaleString()}
                        </td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums">
                          {rate(observed)}
                        </td>
                        <td className="py-1 text-right font-mono tabular-nums">
                          {cohort.weightsUsed?.[band] !== undefined
                            ? percent(cohort.weightsUsed[band] ?? 0)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** The split each cohort of a source will run with next, and why. */
export function CohortSelectionCard({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const [previews, setPreviews] = useState<CohortWeightsPreviewDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.sources
      .cohortControllerPreview({ id: sourceId })
      .then((result) => {
        if (!cancelled) setPreviews(result);
      })
      .catch(() => {
        // A source without cohorts, or an older API: nothing to show.
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (previews.length === 0) return null;

  return (
    <Card className="rounded-[6px]" data-testid="cohort-selection">
      <CardHeader>
        <CardTitle>{t("cohorts.sourceTitle")}</CardTitle>
        <CardDescription>{t("cohorts.sourceDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {previews.map((preview) => {
          const weights = preview.weights as Partial<Record<Band, number>>;
          const lastRun = preview.runs[0]?.bands as
            | Partial<Record<Band, BandYield>>
            | undefined;
          return (
            <div key={preview.name} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{preview.name}</span>
                <ToneBadge tone="neutral">
                  {t(`cohorts.mode.${preview.mode}` as TranslationKey)}
                </ToneBadge>
                <span className="text-muted-foreground">
                  {t(`cohorts.reason.${preview.reason}` as TranslationKey)}
                </span>
              </div>
              <div className="space-y-1.5">
                {BANDS.filter((band) => weights[band] !== undefined).map(
                  (band) => (
                    <div
                      key={band}
                      className="grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-sm"
                    >
                      <span>{t(bandLabel(band))}</span>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-muted"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={weights[band]}
                        aria-label={t(bandLabel(band))}
                      >
                        <div
                          className="h-full bg-foreground"
                          style={{ width: `${weights[band]}%` }}
                        />
                      </div>
                      <span className="text-right font-mono tabular-nums">
                        {percent(weights[band] ?? 0)}
                      </span>
                    </div>
                  ),
                )}
              </div>
              {lastRun ? (
                <p className="text-xs text-muted-foreground">
                  {t("cohorts.lastRun", {
                    bands: BANDS.filter((band) => lastRun[band])
                      .map(
                        (band) =>
                          `${t(bandLabel(band))} ${rate(lastRun[band])} (${(lastRun[band]?.hits ?? 0).toLocaleString()}/${(lastRun[band]?.visited ?? 0).toLocaleString()})`,
                      )
                      .join(" · "),
                  })}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
