"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { ReviewFieldRowDto, ReviewWaterfallRowDto } from "@workspace/api-client";
import {
  Badge,
  Button,
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
import { panelHeadingClass } from "@/components/panel-card";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { score2 } from "./review-format";

/**
 * The values behind the match, as a table.
 *
 * This was a disclosure wrapping a list of value cards. A list makes you read
 * every entry to answer the question you actually have — which label is doing
 * the work, and is that value distinctive or boilerplate. A table answers it by
 * scanning one column: how many values each side holds, how many are shared,
 * and how far the match reached beyond this pair.
 */
export function PairValuesTable({
  fields,
  waterfall,
  aName,
  bName,
}: {
  fields: ReviewFieldRowDto[];
  waterfall: ReviewWaterfallRowDto[];
  aName: string;
  bName: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();

  const contribution = React.useMemo(
    () => new Map(waterfall.map((r) => [r.label, r])),
    [waterfall],
  );

  const rows = React.useMemo(
    () =>
      fields
        .map((f) => ({ field: f, bar: contribution.get(f.label) ?? null }))
        .sort(
          (x, y) =>
            (y.bar?.actual ?? 0) - (x.bar?.actual ?? 0) ||
            y.field.sharedValues.length - x.field.sharedValues.length,
        ),
    [fields, contribution],
  );

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-[12px] text-muted-foreground">
        {t("review.pair.noValues")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className={panelHeadingClass}>{t("review.values.title")}</h3>
      <div className="overflow-auto rounded-[4px] bg-white dark:bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("review.values.colLabel")}</TableHead>
              <TableHead>{t("review.values.colContribution")}</TableHead>
              <TableHead className="max-w-[220px]">{t("review.values.colShared")}</TableHead>
              <TableHead>{aName}</TableHead>
              <TableHead>{bName}</TableHead>
              <TableHead className="text-right">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t("sources.columns.actions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ field, bar }) => {
              const matched = field.sharedValues.length > 0;
              return (
                <TableRow key={field.label} className="align-top">
                  <TableCell className="py-3">
                    <span className="font-mono text-[12px] font-semibold">
                      {field.label}
                    </span>
                    {bar ? (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {t("review.values.weight", { weight: bar.weight })}
                      </p>
                    ) : null}
                  </TableCell>

                  <TableCell className="py-3">
                    {bar ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-[2px] bg-muted">
                          <div
                            className={
                              bar.actual > 0 ? "h-full bg-accent" : "h-full bg-destructive"
                            }
                            style={{
                              width: `${Math.max(2, (bar.actual > 0 ? bar.actual : Math.abs(bar.penalty)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums">
                          {bar.actual > 0 ? "+" : ""}
                          {score2(bar.actual)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[220px] py-3">
                    {matched ? (
                      <span className="flex flex-wrap gap-1">
                        {field.sharedValues.slice(0, 6).map((s) => (
                          <span
                            key={s.valueHash || s.value}
                            className="max-w-full truncate rounded-[2px] bg-accent/25 px-1 py-px font-mono text-[11px]"
                          >
                            {s.value}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className="rounded-[4px] border-destructive text-[10px] text-destructive"
                      >
                        {t("review.values.noneShared")}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="py-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {field.aValues.length}
                  </TableCell>
                  <TableCell className="py-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {field.bValues.length}
                  </TableCell>

                  <TableCell className="py-3">
                    <div className="flex justify-end">
                      {/* Where else this value appears is the difference
                          between a distinctive match and shared boilerplate. */}
                      {matched && field.sharedValues[0]?.valueHash ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-[4px] border-2 border-border"
                              aria-label={t("review.values.whereElse")}
                              onClick={() =>
                                router.push(
                                  nsPath(
                                    `/findings?valueHash=${field.sharedValues[0]!.valueHash}`,
                                  ),
                                )
                              }
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("review.values.whereElse")}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
