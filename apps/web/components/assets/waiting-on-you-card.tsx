"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, Flame, Inbox } from "lucide-react";
import type { GovernanceDashboardDto } from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SeverityBadge,
  Skeleton,
  ToneBadge,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import type { DashboardScope } from "@/lib/governance";
import type { TranslationKey } from "@/i18n";
import { AccessRequestsList } from "@/components/access-requests/access-requests-list";
import type { LifecycleFilter } from "./governed-assets-table";

/**
 * What needs someone now, in the order it does: access people wait for,
 * quality that fails, and — for your assets — governance not finished yet;
 * for all assets, the unowned ones people read most.
 */
export function WaitingOnYouCard({
  dashboard,
  scope,
  days,
  onShowInTable,
  onDecided,
}: {
  dashboard: GovernanceDashboardDto | null;
  scope: DashboardScope;
  days: number;
  onShowInTable: (filter: LifecycleFilter) => void;
  onDecided: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const assetHref = (assetId: string) =>
    nsPath(`/assets/${assetId}?tab=governance`);

  return (
    <Card className="panel-card rounded-[6px]" data-testid="waiting-on-you">
      <CardHeader>
        <CardTitle className="text-sm uppercase tracking-[0.08em]">
          {t("assets.governance.waiting.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Section
          icon={<Inbox className="size-4" aria-hidden />}
          title={t("assets.governance.waiting.requests")}
        >
          <AccessRequestsList
            filter={{ view: "decide" }}
            showTarget
            emptyText={t("assets.governance.waiting.noRequests")}
            onDecided={onDecided}
          />
        </Section>

        <Section
          icon={
            <AlertTriangle className="size-4 text-destructive" aria-hidden />
          }
          title={t("assets.governance.waiting.failing")}
          count={dashboard?.totals.failing}
          onSeeAll={
            dashboard?.totals.failing
              ? () => onShowInTable("failing")
              : undefined
          }
        >
          {!dashboard ? (
            <Skeleton className="h-16 w-full" />
          ) : dashboard.failing.length === 0 ? (
            <Empty>{t("assets.governance.waiting.noFailing")}</Empty>
          ) : (
            <ul className="divide-y" data-testid="failing-assets">
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
                      {t("assets.governance.waiting.rulesFailing", {
                        count: row.failing,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {scope === "mine" ? (
          <Section
            icon={<ClipboardList className="size-4" aria-hidden />}
            title={t("assets.governance.waiting.unfinished")}
            count={dashboard?.incompleteCount}
          >
            {!dashboard ? (
              <Skeleton className="h-16 w-full" />
            ) : dashboard.incomplete.length === 0 ? (
              <Empty>{t("assets.governance.waiting.noUnfinished")}</Empty>
            ) : (
              <ul className="divide-y" data-testid="unfinished-assets">
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
                          {t(
                            `assets.governance.missing.${item}` as TranslationKey,
                          )}
                        </ToneBadge>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : (
          <Section
            icon={<Flame className="size-4" aria-hidden />}
            title={t("assets.governance.waiting.governFirst")}
            onSeeAll={() => onShowInTable("ungoverned")}
          >
            {!dashboard ? (
              <Skeleton className="h-16 w-full" />
            ) : dashboard.governFirst.length === 0 ? (
              <Empty>
                {t("assets.governance.waiting.noGovernFirst", { days })}
              </Empty>
            ) : (
              <ul className="divide-y" data-testid="govern-first">
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
                      {t("assets.governance.waiting.reads", {
                        reads: row.reads,
                        readers: row.readers,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  icon,
  title,
  count,
  onSeeAll,
  children,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {count.toLocaleString()}
            </span>
          )}
        </h3>
        {onSeeAll && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={onSeeAll}
          >
            {t("assets.governance.waiting.seeAll")}
          </Button>
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
    <p className="rounded-[4px] border border-dashed p-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}
