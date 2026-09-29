"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Radar, UserRound } from "lucide-react";
import type { CaseResponseDto } from "@workspace/api-client";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { SeverityBadge, Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { CaseStatusBadge } from "@/components/case-status-badge";
import { OpenedBadge } from "@/components/opened-badge";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { formatDate, formatRelative } from "@/lib/date";
import { useNsPath } from "@/lib/ns-path";
import { STATUS_TONE, statusBadgeClass } from "@/lib/status-tone";
import { BoardSketchCanvas } from "./board-sketch-canvas";
import { EscalatedPill } from "./escalated-pill";
import { pickSketch } from "./sketch-cache";

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";

/** The board's canvas ground: its dot grid, in whichever theme is on. */
const DOT_GRID: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle, color-mix(in oklab, var(--foreground) 16%, transparent) 1px, transparent 1.4px)",
  backgroundSize: "14px 14px",
  backgroundPosition: "7px 7px",
};

/**
 * One case on the investigations page: its board drawn small on top, then
 * what decides whether to open it now — priority and status, what it is
 * about, how much it holds, what is waiting in it, who has it and how fresh
 * it is. The whole card opens the case.
 */
export function CaseCard({
  item,
  openedAt,
}: {
  item: CaseResponseDto;
  /** When this browser last opened the case (`lib/recently-opened.ts`). */
  openedAt?: number;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const id = React.useId();
  const sketch = React.useMemo(() => pickSketch(item.id, item.thumbnail), [item.id, item.thumbnail]);
  const closed = item.status === "CLOSED" || item.status === "ARCHIVED";
  const summary = (closed && item.conclusion?.trim()) || item.description?.trim();
  const newMatches = item.newMatchCount ?? 0;

  const stats: Array<{ key: string; label: string; value: number | undefined }> = [
    { key: "assets", label: t("cases.card.stats.assets"), value: item.evidenceCount },
    { key: "findings", label: t("cases.card.stats.findings"), value: item.findingCount },
    { key: "hypotheses", label: t("cases.card.stats.hypotheses"), value: item.hypothesisCount },
    { key: "watches", label: t("cases.card.stats.watches"), value: item.inquiryCount },
  ];

  return (
    <Link
      href={nsPath(`/investigations/${item.id}`)}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-summary`}
      className="group block h-full rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid="case-card"
    >
      <Card className="h-full gap-0 overflow-hidden py-0 shadow-none">
        <div
          className="relative aspect-[16/9] overflow-hidden border-b-2 border-border bg-background"
          style={DOT_GRID}
        >
          {sketch && sketch.nodes.length > 0 ? (
            <BoardSketchCanvas
              sketch={sketch}
              label={t("cases.card.boardAlt", { title: item.title })}
              className="transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : (
            <SketchPlaceholder
              drawn={!!sketch}
              evidenceCount={item.evidenceCount}
              hypothesisCount={item.hypothesisCount}
            />
          )}
          {openedAt !== undefined && <OpenedBadge at={openedAt} className="absolute top-2.5 left-2.5" />}
        </div>

        <CardContent className="@container flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center gap-1.5">
            <SeverityBadge severity={item.severity.toLowerCase() as SeverityLevel}>
              {t(`cases.severityLabels.${item.severity}` as TranslationKey)}
            </SeverityBadge>
            {isAiActor(item.createdBy) && <AiActorBadge />}
            <CaseStatusBadge status={item.status} className="ml-auto" />
          </div>

          <div className="min-w-0">
            <h3
              id={`${id}-title`}
              className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-[0.05em] uppercase break-words decoration-2 underline-offset-[3px] group-hover:underline"
            >
              {item.title}
            </h3>
            <p
              id={`${id}-summary`}
              className={cn(
                "mt-1.5 line-clamp-2 min-h-10 text-sm leading-relaxed break-words",
                summary ? "text-muted-foreground" : "text-muted-foreground/70 italic",
              )}
            >
              {summary || t("cases.card.noDescription")}
            </p>
          </div>

          {/* The rules between cells are the gaps showing the border colour
              through, so they hold whether the strip is one row or two. */}
          <dl className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-[4px] border-2 border-border bg-border @xs:grid-cols-4">
            {stats.map(({ key, label, value }) => (
              <div key={key} className="flex min-w-0 flex-col-reverse bg-card px-2 py-1.5">
                <dt className="truncate font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
                  {label}
                </dt>
                <dd
                  className={cn(
                    "font-mono text-base leading-tight font-semibold tabular-nums",
                    !value && "text-muted-foreground/60",
                  )}
                >
                  {value === undefined ? "—" : value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>

          {(newMatches > 0 || item.escalatedCount > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {newMatches > 0 && (
                <span
                  className={cn(statusBadgeClass, STATUS_TONE.fresh, "inline-flex items-center gap-1 px-1.5 py-0.5")}
                  title={t("cases.card.newMatchesHint")}
                >
                  <Radar className="size-3" aria-hidden />
                  {t("cases.card.newMatches", { count: newMatches.toLocaleString() })}
                </span>
              )}
              {item.escalatedCount > 0 && <EscalatedPill count={item.escalatedCount} at={item.lastEscalatedAt} />}
            </div>
          )}

          <div className="mt-auto flex items-center gap-2 border-t-2 border-border pt-3 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserRound className="size-3.5 shrink-0" aria-hidden />
              <span className={cn("truncate", item.assignee && "text-foreground")}>
                {item.assignee || t("cases.card.unassigned")}
              </span>
            </span>
            <span aria-hidden>·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 cursor-default">{formatRelative(item.updatedAt)}</span>
              </TooltipTrigger>
              <TooltipContent>
                {t("cases.card.updatedAt", { when: formatDate(item.updatedAt) })}
              </TooltipContent>
            </Tooltip>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-foreground/70 transition-colors group-hover:text-foreground">
              {t("common.open")}
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden
              />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The thumbnail before there is a sketch: the board has never been opened
 * (it is drawn on the first visit), or there is nothing on it.
 */
function SketchPlaceholder({
  drawn,
  evidenceCount,
  hypothesisCount,
}: {
  /** A sketch exists and is empty. */
  drawn: boolean;
  evidenceCount: number;
  hypothesisCount: number;
}) {
  const { t } = useTranslation();
  const empty = drawn || evidenceCount + hypothesisCount === 0;
  const rings = Math.min(evidenceCount, 5);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      {!empty && rings > 0 && (
        <div className="flex items-center gap-2" aria-hidden>
          {Array.from({ length: rings }, (_, i) => (
            <span key={i} className="size-5 rounded-full border-2 border-dashed border-muted-foreground/45 bg-background" />
          ))}
          {evidenceCount > rings && (
            <span className="font-mono text-[10px] text-muted-foreground">+{evidenceCount - rings}</span>
          )}
        </div>
      )}
      <p className="rounded-[3px] bg-background/80 px-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {empty ? t("cases.card.emptyBoard") : t("cases.card.notDrawn")}
      </p>
    </div>
  );
}

/** The card's loading twin, so a grid of them keeps its rhythm while data lands. */
export function CaseCardSkeleton() {
  return (
    <Card aria-hidden="true" className="h-full gap-0 overflow-hidden py-0 shadow-none">
      <Skeleton className="aspect-[16/9] w-full rounded-none border-b-2 border-border bg-muted" />
      <CardContent className="space-y-3 p-4">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-16 bg-muted" />
          <Skeleton className="h-5 w-20 bg-muted" />
        </div>
        <Skeleton className="h-5 w-3/4 bg-muted" />
        <Skeleton className="h-10 w-full bg-muted" />
        <Skeleton className="h-12 w-full bg-muted" />
        <Skeleton className="h-4 w-1/2 bg-muted" />
      </CardContent>
    </Card>
  );
}
