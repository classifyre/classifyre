"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, FolderOpen } from "lucide-react";
import type { CaseworkSummaryDto } from "@workspace/api-client";
import { Button, SeverityBadge } from "@workspace/ui/components";
import { formatRelative } from "@/lib/date";
import { nsPath } from "@/lib/ns-path";
import { CaseStatusBadge } from "@/components/case-status-badge";
import { PanelCard, panelInsetCardClass } from "@/components/panel-card";
import { toPriorityLevel } from "@/components/discovery/busiest-assets";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * What is being investigated right now.
 *
 * This replaced a panel that ranked assets by finding count under the heading
 * "where risk clusters". Findings are evidence, not risk, and the question the
 * dashboard should answer first is which investigations are open — so the
 * asset ranking moved to the connections canvas and this took its place.
 */
export function CaseworkCard({
  summary,
  isLoading,
}: {
  summary: CaseworkSummaryDto | null;
  isLoading?: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const cases = summary?.cases;
  const inquiries = summary?.inquiries;
  const leads = summary?.leads;

  const statusTiles = [
    { key: "OPEN", value: cases?.byStatus.open ?? 0 },
    { key: "IN_PROGRESS", value: cases?.byStatus.inProgress ?? 0 },
    { key: "CLOSED", value: cases?.byStatus.closed ?? 0 },
    { key: "ARCHIVED", value: cases?.byStatus.archived ?? 0 },
  ];

  const recent = cases?.recent ?? [];

  return (
    <PanelCard className="flex flex-col overflow-hidden sm:col-span-2 xl:col-span-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em] text-foreground">
            {t("casework.title")}
          </h3>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {t("casework.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push(nsPath("/investigations"))}
          className="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border-2 border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          {t("casework.viewAll")} <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statusTiles.map(({ key, value }) => (
          <button
            key={key}
            type="button"
            onClick={() =>
              router.push(nsPath(`/investigations?tab=cases&status=${key}`))
            }
            className={`${panelInsetCardClass} min-w-0 cursor-pointer text-left transition-colors hover:bg-secondary/40`}
          >
            <span className="block font-mono text-[9px] uppercase leading-tight tracking-[0.15em] text-muted-foreground sm:text-[10px] sm:tracking-[0.2em]">
              {t(`cases.statusLabels.${key}` as TranslationKey)}
            </span>
            <span className="font-serif text-lg font-black text-foreground sm:text-xl">
              {value}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1">
        {recent.length > 0 ? (
          <>
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("casework.recentCases")}
            </span>
            <div className="grid gap-1.5">
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => router.push(nsPath(`/investigations/${c.id}`))}
                  className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-[4px] border-2 border-border bg-background px-3 py-2 text-left transition-all hover:-translate-y-px hover:bg-secondary/40"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-foreground">
                      {c.title}
                    </span>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      <span className="shrink-0">
                        {t("casework.evidenceCount", {
                          count: c.evidenceCount,
                        })}
                      </span>
                      <span className="shrink-0 text-border">·</span>
                      <span className="shrink-0">
                        {formatRelative(c.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <SeverityBadge severity={toPriorityLevel(c.severity)}>
                      {t(
                        `findings.severityLabels.${c.severity}` as TranslationKey,
                      )}
                    </SeverityBadge>
                    <CaseStatusBadge status={c.status} />
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          !isLoading && (
            <div className="flex h-full items-center justify-center rounded-[4px] border-2 border-dashed border-border/40 px-4 py-6 text-center">
              <div>
                <FolderOpen className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
                <p className="font-mono text-sm uppercase tracking-[0.15em] text-muted-foreground">
                  {t("casework.noCases")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    router.push(nsPath("/investigations/cases/new"))
                  }
                  className="mt-3 rounded-[4px] border-2 border-border font-mono uppercase tracking-[0.1em] text-foreground"
                >
                  {t("casework.newCase")}
                </Button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Inquiries and leads are counts, not a second list — the one number
          worth reading is how much appeared since you last looked. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-border pt-3">
        <button
          type="button"
          onClick={() =>
            router.push(nsPath("/investigations?tab=inquiries"))
          }
          className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="font-semibold text-foreground/70">
            {inquiries?.byStatus.active ?? 0}
          </span>{" "}
          {t("casework.inquiries", { count: inquiries?.byStatus.active ?? 0 })}
        </button>
        {(inquiries?.newMatchTotal ?? 0) > 0 && (
          <>
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            <button
              type="button"
              onClick={() =>
                router.push(nsPath("/investigations?tab=inquiries"))
              }
              className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.15em] text-accent transition-opacity hover:opacity-80"
            >
              {t("casework.newMatches", {
                count: inquiries?.newMatchTotal ?? 0,
              })}
            </button>
          </>
        )}
        {(leads?.proposed ?? 0) > 0 && (
          <>
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              {t("casework.leadsWaiting", { count: leads?.proposed ?? 0 })}
            </span>
          </>
        )}
      </div>
    </PanelCard>
  );
}
