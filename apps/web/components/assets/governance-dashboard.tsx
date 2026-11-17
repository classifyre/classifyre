"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, Gauge, ShieldCheck } from "lucide-react";
import { api, type SourceListItem } from "@workspace/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useUrlParams } from "@/lib/url-filters";
import { useGovernanceDashboard, type DashboardScope } from "@/lib/governance";
import { UsageChartCard } from "./usage-chart-card";
import { QualityChartCard } from "./quality-chart-card";
import { CoverageChartCard } from "./coverage-chart-card";
import { WaitingOnYouCard } from "./waiting-on-you-card";
import {
  GovernedAssetsTable,
  LIFECYCLE_FILTERS,
  type LifecycleFilter,
} from "./governed-assets-table";

const PERIODS = [7, 30, 90] as const;
const ALL_SOURCES = "ALL";

function periodOf(value: string | null): number {
  const days = Number(value);
  return (PERIODS as readonly number[]).includes(days) ? days : 30;
}

/**
 * The Governance tab (docs/prd/GOV-governed-data-assets.md §5.7): where an
 * owner, steward or business reader starts work — who waits for access,
 * what fails quality, where usage spiked, what is still unfinished — for
 * their own assets or all of them, over a period and a source. Every
 * number leads to the assets behind it.
 */
export function GovernanceDashboard({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlParams();
  const [scope, setScope] = useState<DashboardScope>(() =>
    searchParams.get("scope") === "all" ? "all" : "mine",
  );
  const [days, setDays] = useState(() => periodOf(searchParams.get("days")));
  const [sourceId, setSourceId] = useState<string | null>(() =>
    searchParams.get("source"),
  );
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(() => {
    const value = searchParams.get("lifecycle");
    return (LIFECYCLE_FILTERS as readonly string[]).includes(value ?? "")
      ? (value as LifecycleFilter)
      : "governed";
  });
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current) {
      synced.current = true;
      return;
    }
    setParams({
      scope: scope === "mine" ? null : scope,
      days: days === 30 ? null : String(days),
      source: sourceId,
      lifecycle: lifecycle === "governed" ? null : lifecycle,
    });
  }, [scope, days, sourceId, lifecycle, setParams]);

  useEffect(() => {
    let active = true;
    api.sources
      .sourcesControllerListSources()
      .then((list) => {
        if (!active) return;
        setSources(
          ((list ?? []) as unknown as SourceListItem[])
            .filter((source): source is SourceListItem & { id: string } =>
              Boolean(source.id),
            )
            .map((source) => ({
              id: source.id,
              name: source.name || source.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => setSources([]));
    return () => {
      active = false;
    };
  }, []);

  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  );
  const dashboard = useGovernanceDashboard({ scope, days, sourceId });
  const data = dashboard.data;
  // Mine falls back to all for someone who answers for nothing.
  const effectiveScope: DashboardScope = data?.scope ?? scope;
  const filters = { scope: effectiveScope, days, sourceId };

  const showInTable = (next: LifecycleFilter) => {
    setLifecycle(next);
    requestAnimationFrame(() =>
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const totals = data?.totals;
  const percent = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  return (
    <div className="space-y-6" data-testid="governance-dashboard">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={effectiveScope}
          onValueChange={(value) => value && setScope(value as DashboardScope)}
          aria-label={t("assets.governance.scope.label")}
          data-testid="governance-scope"
        >
          <ToggleGroupItem value="mine" className="px-3">
            {t("assets.governance.scope.mine")}
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="px-3">
            {t("assets.governance.scope.all")}
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(days)}
          onValueChange={(value) => value && setDays(Number(value))}
          aria-label={t("assets.governance.period")}
          data-testid="governance-period"
        >
          {PERIODS.map((period) => (
            <ToggleGroupItem
              key={period}
              value={String(period)}
              className="px-3"
            >
              {t("assets.governance.days", { days: period })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          value={sourceId ?? ALL_SOURCES}
          onValueChange={(value) =>
            setSourceId(value === ALL_SOURCES ? null : value)
          }
        >
          <SelectTrigger
            className="h-8 w-full rounded-[4px] border-2 border-border md:w-[220px]"
            data-testid="governance-source"
          >
            <SelectValue placeholder={t("assets.allSources")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SOURCES}>
              {t("assets.allSources")}
            </SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                {source.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === "mine" && data?.scope === "all" && (
          <p className="text-xs text-muted-foreground md:ml-auto">
            {t("assets.governance.scope.nothingYours")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={ShieldCheck}
          label={t("assets.governance.kpi.governed")}
          value={totals?.governed}
          hint={
            totals
              ? t("assets.governance.kpi.governedHint", {
                  percent: percent(totals.governed, totals.assets),
                  assets: totals.assets.toLocaleString(),
                })
              : undefined
          }
          onClick={() => showInTable("governed")}
        />
        <Kpi
          icon={BadgeCheck}
          label={t("assets.governance.kpi.certified")}
          value={totals?.certified}
          hint={
            totals
              ? t("assets.governance.kpi.certifiedHint", {
                  percent: percent(totals.certified, totals.governed),
                })
              : undefined
          }
          onClick={() => showInTable("active")}
        />
        <Kpi
          icon={AlertTriangle}
          label={t("assets.governance.kpi.failing")}
          value={totals?.failing}
          tone={totals && totals.failing > 0 ? "bad" : undefined}
          hint={t("assets.governance.kpi.failingHint")}
          onClick={() => showInTable("failing")}
        />
        <Kpi
          icon={Gauge}
          label={t("assets.governance.kpi.score")}
          value={totals ? (totals.score ?? null) : undefined}
          suffix={totals?.score != null ? "%" : undefined}
          hint={t("assets.governance.kpi.scoreHint")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <UsageChartCard filters={filters} />
          <QualityChartCard
            quality={data?.quality ?? null}
            score={totals?.score ?? null}
            days={days}
            loading={dashboard.loading && !data}
          />
        </div>
        <WaitingOnYouCard
          dashboard={data}
          scope={effectiveScope}
          days={days}
          onShowInTable={showInTable}
          onDecided={() => {
            void dashboard.reload();
            onChanged?.();
          }}
        />
      </div>

      <CoverageChartCard
        coverage={data?.coverage ?? []}
        selected={sourceId}
        onSelect={setSourceId}
      />

      <div ref={tableRef} className="scroll-mt-4">
        <GovernedAssetsTable
          scope={effectiveScope}
          days={days}
          sourceId={sourceId}
          lifecycle={lifecycle}
          onLifecycleChange={setLifecycle}
          sourceNames={sourceNames}
        />
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
  tone,
  onClick,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number | null | undefined;
  suffix?: string;
  hint?: ReactNode;
  tone?: "bad";
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon
          className={cn("size-3.5", tone === "bad" && "text-destructive")}
          aria-hidden
        />
        {label}
      </span>
      <span
        className={cn(
          "mt-1 block text-2xl font-black leading-none",
          tone === "bad" && "text-destructive",
        )}
        style={{ fontFamily: "var(--font-hero)" }}
      >
        {value === undefined
          ? "—"
          : value === null
            ? "—"
            : value.toLocaleString()}
        {suffix && value != null ? (
          <span className="text-base text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
      {hint && (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </>
  );
  const className =
    "block w-full rounded-[6px] border-2 border-border bg-card p-3 text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "cursor-pointer transition-all hover:-translate-y-px hover:bg-secondary/40",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
