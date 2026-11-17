"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Filter, Inbox, Loader2 } from "lucide-react";
import {
  api,
  SearchAssetsSortByEnum,
  SearchAssetsSortOrderEnum,
  type SearchAssetsFiltersDtoGovernanceEnum,
  type SearchAssetsResponseDto,
} from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToneBadge,
} from "@workspace/ui/components";
import { formatRelative } from "@/lib/date";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { DashboardScope } from "@/lib/governance";
import type { TranslationKey } from "@/i18n";
import { ActorChip } from "@/components/actor-chip";
import { GovernanceBadge } from "@/components/governance/governance-badge";
import { QualityChip } from "@/components/governance/quality-chip";

export const LIFECYCLE_FILTERS = [
  "governed",
  "draft",
  "active",
  "deprecated",
  "retired",
  "failing",
  "ungoverned",
] as const;
export type LifecycleFilter = (typeof LIFECYCLE_FILTERS)[number];

const PAGE_SIZE = 20;

/**
 * The Governance tab's table: the assets in scope with who answers for them,
 * how good they are, how much they are read, who waits for access, and what
 * their governance still misses.
 */
export function GovernedAssetsTable({
  scope,
  days,
  sourceId,
  lifecycle,
  onLifecycleChange,
  sourceNames,
}: {
  sourceNames: ReadonlyMap<string, string>;
  scope: DashboardScope;
  days: number;
  sourceId: string | null;
  lifecycle: LifecycleFilter;
  onLifecycleChange: (value: LifecycleFilter) => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SearchAssetsResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => setPage(0), [scope, days, sourceId, lifecycle, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .searchAssets({
        assets: {
          search: search || undefined,
          sourceId: sourceId ?? undefined,
          governance: lifecycle as SearchAssetsFiltersDtoGovernanceEnum,
          responsibleRef: scope === "mine" ? "me" : undefined,
        },
        page: {
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          sortBy: SearchAssetsSortByEnum.UpdatedAt,
          sortOrder: SearchAssetsSortOrderEnum.Desc,
        },
        options: {
          excludeFindings: true,
          includeAssetsWithoutFindings: true,
          governanceDays: days,
        },
      })
      .then((response) => {
        if (!active) return;
        setData(response);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, days, sourceId, lifecycle, search, page]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <Card className="panel-card rounded-[6px]" data-testid="governed-assets">
      <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
        <CardTitle className="text-sm uppercase tracking-[0.08em]">
          {t("assets.governance.table.title")}
          <span className="ml-2 font-normal text-muted-foreground">
            {total.toLocaleString()}
          </span>
        </CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("assets.search")}
            className="h-9 w-full sm:w-[220px]"
          />
          <Select
            value={lifecycle}
            onValueChange={(value) =>
              onLifecycleChange(value as LifecycleFilter)
            }
          >
            <SelectTrigger
              className="h-9 w-full rounded-[4px] border-2 border-border sm:w-[190px]"
              data-testid="lifecycle-filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIFECYCLE_FILTERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`governance.filter.${value}` as TranslationKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-0 pb-3">
        {error && (
          <div className="mx-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="relative min-h-[200px]">
          {loading && !data ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Filter}
              title={t("assets.noAssets")}
              description={t("assets.governance.table.empty")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("assets.columns.asset")}</TableHead>
                    <TableHead>
                      {t("assets.governance.table.lifecycle")}
                    </TableHead>
                    <TableHead>{t("assets.governance.table.owner")}</TableHead>
                    <TableHead>
                      {t("assets.governance.table.stewards")}
                    </TableHead>
                    <TableHead>{t("governance.qualityColumn")}</TableHead>
                    <TableHead className="text-right">
                      {t("assets.governance.table.reads", { days })}
                    </TableHead>
                    <TableHead>
                      {t("assets.governance.table.requests")}
                    </TableHead>
                    <TableHead>{t("assets.governance.table.gaps")}</TableHead>
                    <TableHead>{t("common.updated")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const asset = item.asset;
                    const governance = item.governance;
                    const detail = governance?.detail;
                    const stewards = detail?.stewardRefs ?? [];
                    return (
                      <TableRow key={asset.id} data-testid="governed-asset-row">
                        <TableCell className="max-w-[280px]">
                          <Link
                            href={nsPath(`/assets/${asset.id}?tab=governance`)}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {asset.name || asset.externalUrl || asset.hash}
                          </Link>
                          <Link
                            href={nsPath(`/sources/${asset.sourceId}`)}
                            className="block truncate text-xs text-muted-foreground hover:underline"
                          >
                            {sourceNames.get(asset.sourceId) ?? asset.sourceId}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <GovernanceBadge
                            status={governance?.status ?? null}
                          />
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          {governance?.ownerRef ? (
                            <ActorChip actorRef={governance.ownerRef} />
                          ) : (
                            <Dash />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          {stewards.length === 0 ? (
                            <Dash />
                          ) : (
                            <span className="flex flex-col gap-0.5">
                              {stewards.slice(0, 2).map((ref) => (
                                <ActorChip key={ref} actorRef={ref} />
                              ))}
                              {stewards.length > 2 && (
                                <span className="text-[11px] text-muted-foreground">
                                  +{stewards.length - 2}
                                </span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {governance?.quality?.rules ? (
                            <QualityChip quality={governance.quality} />
                          ) : (
                            <Dash />
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(detail?.reads ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {detail?.pendingRequests ? (
                            <ToneBadge tone="changed" className="gap-1">
                              <Inbox className="size-3" aria-hidden />
                              {detail.pendingRequests}
                            </ToneBadge>
                          ) : (
                            <Dash />
                          )}
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          {!detail ? (
                            <Dash />
                          ) : detail.missing.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-accent-ink">
                              <CheckCircle2 className="size-3.5" aria-hidden />
                              {t("assets.governance.table.complete")}
                            </span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {detail.missing.map((key) => (
                                <ToneBadge key={key} tone="idle">
                                  {t(
                                    `assets.governance.missing.${key}` as TranslationKey,
                                  )}
                                </ToneBadge>
                              ))}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatRelative(asset.updatedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {loading && data && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 border-t px-4 pt-3 text-xs text-muted-foreground">
            <span>
              {t("assets.governance.table.range", {
                from: from.toLocaleString(),
                to: to.toLocaleString(),
                total: total.toLocaleString(),
              })}
            </span>
            <span className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                {t("common.back")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={to >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                {t("common.more")}
              </Button>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Dash() {
  return <span className="text-xs text-muted-foreground">—</span>;
}
