"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Flame,
  Inbox,
} from "lucide-react";
import type { GovernanceDashboardDto } from "@workspace/api-client";
import { SeverityBadge, Skeleton, ToneBadge } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import type { DashboardScope } from "@/lib/governance";
import type { AssetsLink } from "@/lib/dashboard-links";
import type { TranslationKey } from "@/i18n";
import { AccessRequestsList } from "@/components/access-requests/access-requests-list";
import {
  PanelCard,
  microLabelClass,
  panelHeadingClass,
} from "@/components/panel-card";

/**
 * What needs someone now, in the order it does: access people wait for,
 * quality that fails, governance not finished yet on your assets, and the
 * unowned assets people read most (govern those first). Only what has
 * something in it is shown; with nothing at all, one all-clear line.
 */
export function WaitingOnYouCard({
  dashboard,
  scope,
  link,
  requestsForMe,
  onDecided,
  className,
}: {
  dashboard: GovernanceDashboardDto | null;
  scope: DashboardScope;
  link: AssetsLink;
  /** Access requests waiting for this person; the section shows only then. */
  requestsForMe: number | undefined;
  onDecided: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const assetHref = (assetId: string) =>
    nsPath(`/assets/${assetId}?tab=governance`);

  // Only what needs someone: a section with nothing in it is not shown.
  const hasRequests = (requestsForMe ?? 0) > 0;
  const hasFailing = (dashboard?.failing.length ?? 0) > 0;
  const hasUnfinished =
    scope === "mine" && (dashboard?.incomplete.length ?? 0) > 0;
  const hasGovernFirst = (dashboard?.governFirst.length ?? 0) > 0;
  const allClear =
    dashboard !== null &&
    requestsForMe !== undefined &&
    !hasRequests &&
    !hasFailing &&
    !hasUnfinished &&
    !hasGovernFirst;

  return (
    <PanelCard className={cn("flex flex-col", className)}>
      <div
        className="mb-4 min-w-0 scroll-mt-4"
        id="waiting-on-you"
        data-testid="waiting-on-you"
      >
        <h3 className={panelHeadingClass}>{t("dashboard.waiting.title")}</h3>
        <p className={microLabelClass}>
          {scope === "mine"
            ? t("dashboard.waiting.leadMine")
            : t("dashboard.waiting.leadAll")}
        </p>
      </div>
      <div className="space-y-6">
        {!dashboard && <Skeleton className="h-24 w-full" />}
        {allClear && (
          <Empty>
            <CheckCircle2
              className="mr-1.5 inline size-3.5 text-accent-ink"
              aria-hidden
            />
            {t("dashboard.waiting.allClear")}
          </Empty>
        )}

        {hasRequests && (
          <Section
            icon={<Inbox className="size-4" aria-hidden />}
            title={t("dashboard.waiting.requests")}
            count={requestsForMe}
          >
            <AccessRequestsList
              filter={{ view: "decide" }}
              showTarget
              emptyText={t("dashboard.waiting.noRequests")}
              onDecided={onDecided}
            />
          </Section>
        )}

        {dashboard && hasFailing && (
          <Section
            icon={
              <AlertTriangle className="size-4 text-destructive" aria-hidden />
            }
            title={t("dashboard.waiting.failing")}
            count={dashboard?.totals.failing}
            seeAllHref={dashboard?.totals.failing ? link("failing") : undefined}
          >
            <ul
              className="divide-y divide-border/20"
              data-testid="failing-assets"
            >
              {dashboard.failing.map((row) => (
                <li
                  key={row.assetId}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <AssetLine
                    href={assetHref(row.assetId)}
                    name={row.name}
                    source={row.sourceName}
                  />
                  <span className="flex shrink-0 items-center gap-1.5">
                    <SeverityBadge
                      severity={
                        row.severity.toLowerCase() as
                          | "critical"
                          | "high"
                          | "medium"
                          | "low"
                          | "info"
                      }
                    >
                      {t(
                        `findings.severityLabels.${row.severity}` as TranslationKey,
                      )}
                    </SeverityBadge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {t("dashboard.waiting.rulesFailing", {
                        count: row.failing,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {dashboard && hasUnfinished && (
          <Section
            icon={<ClipboardList className="size-4" aria-hidden />}
            title={t("dashboard.waiting.unfinished")}
            count={dashboard?.incompleteCount}
          >
            <ul
              className="divide-y divide-border/20"
              data-testid="unfinished-assets"
            >
              {dashboard.incomplete.map((row) => (
                <li key={row.assetId} className="space-y-1 py-2">
                  <AssetLine
                    href={assetHref(row.assetId)}
                    name={row.name}
                    source={row.sourceName}
                  />
                  <span className="flex flex-wrap gap-1">
                    {row.missing.map((item) => (
                      <ToneBadge key={item} tone="changed">
                        {t(`dashboard.missing.${item}` as TranslationKey)}
                      </ToneBadge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {dashboard && hasGovernFirst && (
          <Section
            icon={<Flame className="size-4" aria-hidden />}
            title={t("dashboard.waiting.governFirst")}
            seeAllHref={link("ungoverned")}
          >
            <ul
              className="divide-y divide-border/20"
              data-testid="govern-first"
            >
              {dashboard.governFirst.map((row) => (
                <li
                  key={row.assetId}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <AssetLine
                    href={assetHref(row.assetId)}
                    name={row.name}
                    source={row.sourceName}
                  />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t("dashboard.waiting.reads", {
                      reads: row.reads,
                      readers: row.readers,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </PanelCard>
  );
}

function Section({
  icon,
  title,
  count,
  seeAllHref,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  seeAllHref?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
          {icon}
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {count.toLocaleString()}
            </span>
          )}
        </h4>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border-2 border-border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
          >
            {t("dashboard.waiting.seeAll")}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function AssetLine({
  href,
  name,
  source,
}: {
  href: string;
  name: string;
  source: string;
}) {
  return (
    <span className="block min-w-0">
      <Link
        href={href}
        className="block truncate text-sm font-medium hover:underline"
      >
        {name}
      </Link>
      <span className="block truncate text-xs text-muted-foreground">
        {source}
      </span>
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[4px] border-2 border-dashed border-border/30 p-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
