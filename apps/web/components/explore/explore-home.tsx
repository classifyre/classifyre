"use client";

import * as React from "react";
import { Bookmark, Compass, Loader2, Search } from "lucide-react";
import {
  api,
  SearchAssetsSortByEnum,
  SearchAssetsSortOrderEnum,
  type ExploreStartersResponseDto,
  type ExploreViewDto,
  type SearchAssetItemDto,
} from "@workspace/api-client";
import {
  Button,
  Checkbox,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { patternName } from "@/components/review/review-format";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { formatRelative } from "@/lib/date";
import { EXPLORE_MAX_SEEDS, type ExploreViewName } from "@/lib/explore";
import { useExploreSearch } from "./explore-drawers";

const MICRO = "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground";

type Tab = "search" | "critical" | "lineage" | "duplicates" | "links";

/** One row of the table: one asset, or a pair that opens together. */
interface Row {
  key: string;
  assetIds: string[];
  /** The view it opens on; null lets Explore pick. */
  view: ExploreViewName | null;
  name: string;
  assetType?: string | null;
  sub: string | null;
  signal: React.ReactNode;
  /** One asset: it can be ticked to explore several together. */
  pickable: boolean;
}

/** Assets with open critical and high findings, the most critical first. */
function useCriticalAssets(limit: number) {
  const [items, setItems] = React.useState<SearchAssetItemDto[] | null>(null);
  React.useEffect(() => {
    let live = true;
    api
      .searchAssets({
        findings: { severity: ["CRITICAL", "HIGH"], includeResolved: false },
        options: { excludeFindings: false, includeAssetsWithoutFindings: false },
        page: { skip: 0, limit: 60, sortBy: SearchAssetsSortByEnum.LastScannedAt, sortOrder: SearchAssetsSortOrderEnum.Desc },
      })
      .then((res) => {
        if (!live) return;
        const count = (i: SearchAssetItemDto, s: string) => i.findings.filter((f) => f.severity === s).length;
        setItems(
          [...res.items]
            .sort((a, b) => count(b, "CRITICAL") - count(a, "CRITICAL") || count(b, "HIGH") - count(a, "HIGH"))
            .slice(0, limit),
        );
      })
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [limit]);
  return items;
}

/**
 * Explore with nothing on the canvas: search, the saved views, and the
 * assets worth starting from, in one table with a tab per reason. Tick
 * several to explore them together. Also the body of the Overview's card.
 */
export function ExploreHome({
  query,
  onQuery,
  onStart,
  onOpenSaved,
  compact = false,
}: {
  query: string;
  onQuery: (q: string) => void;
  onStart: (assetIds: string[], view: ExploreViewName | null) => void;
  onOpenSaved: (id: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const rowLimit = compact ? 5 : 12;
  const search = useExploreSearch(query);
  const critical = useCriticalAssets(rowLimit);
  const [starters, setStarters] = React.useState<ExploreStartersResponseDto | null>(null);
  const [views, setViews] = React.useState<ExploreViewDto[] | null>(null);
  React.useEffect(() => {
    let live = true;
    api.explore.exploreControllerStarters().then((res) => live && setStarters(res)).catch(() => live && setStarters({ lineage: [], patterns: [], links: [] }));
    api.explore.exploreControllerListViews().then((res) => live && setViews(res)).catch(() => live && setViews([]));
    return () => {
      live = false;
    };
  }, []);

  const rows = React.useMemo<Record<Tab, Row[] | null>>(() => {
    const sev = (i: SearchAssetItemDto, s: string) => i.findings.filter((f) => f.severity === s).length;
    return {
      search: query.trim()
        ? search.results.map(({ asset, match }) => ({
            key: asset.id,
            assetIds: [asset.id],
            view: null,
            name: asset.name,
            assetType: asset.assetType,
            sub: match?.text ? `${match.page != null ? `${t("explore.page", { page: match.page })} · ` : ""}${match.text}` : null,
            signal: match?.score != null ? `${Math.round(match.score * 100)}%` : null,
            pickable: true,
          }))
        : null,
      critical:
        critical?.map((item) => ({
          key: item.asset.id,
          assetIds: [item.asset.id],
          view: null,
          name: item.asset.name,
          assetType: item.asset.assetType,
          sub: null,
          signal: (
            <span className="flex flex-wrap gap-1.5">
              {sev(item, "CRITICAL") > 0 && (
                <SeverityBadge severity="critical">
                  {t("findings.severityLabels.CRITICAL")} {sev(item, "CRITICAL")}
                </SeverityBadge>
              )}
              {sev(item, "HIGH") > 0 && (
                <SeverityBadge severity="high">
                  {t("findings.severityLabels.HIGH")} {sev(item, "HIGH")}
                </SeverityBadge>
              )}
            </span>
          ),
          pickable: true,
        })) ?? null,
      lineage:
        starters?.lineage.slice(0, rowLimit).map((s) => ({
          key: s.asset.id,
          assetIds: [s.asset.id],
          view: "lineage" as const,
          name: s.asset.name,
          sub: s.asset.sourceName ?? null,
          signal: t("explore.home.lineageLinks", { count: s.degree }),
          pickable: true,
        })) ?? null,
      duplicates:
        starters?.patterns.slice(0, rowLimit).map((p) => ({
          key: p.patternKey,
          assetIds: p.pair.map((a) => a.id),
          view: "duplicates" as const,
          name: `${p.pair[0]?.name ?? ""} ↔ ${p.pair[1]?.name ?? ""}`,
          sub: patternName(p, t(`review.patterns.family.${p.family}` as TranslationKey), t("review.patterns.miscLabel")),
          signal: t("explore.home.pairs", { count: p.pairCount }),
          pickable: false,
        })) ?? null,
      links:
        starters?.links.slice(0, rowLimit).map((l) => ({
          key: l.id,
          assetIds: [l.from.id, l.to.id],
          view: "connected" as const,
          name: `${l.from.name} → ${l.to.name}`,
          sub: l.note || l.relationType.replace(/_/g, " "),
          signal: formatRelative(l.createdAt),
          pickable: false,
        })) ?? null,
    };
  }, [critical, query, rowLimit, search.results, starters, t]);

  const counts: Record<Tab, number> = {
    search: rows.search?.length ?? 0,
    critical: rows.critical?.length ?? 0,
    lineage: rows.lineage?.length ?? 0,
    duplicates: rows.duplicates?.length ?? 0,
    links: rows.links?.length ?? 0,
  };
  const tabs: Tab[] = (["search", "critical", "lineage", "duplicates", "links"] as Tab[]).filter(
    (tab) => tab !== "search" || query.trim(),
  );
  // Searching shows the results; otherwise the first tab that has (or may
  // still get) rows, until one is chosen.
  const searching = query.trim().length > 0;
  const [chosen, setChosen] = React.useState<Tab | null>(null);
  React.useEffect(() => setChosen(searching ? "search" : null), [searching]);
  const fallback = tabs.find((tb) => rows[tb] === null || counts[tb] > 0) ?? tabs[0]!;
  const tab: Tab = chosen && tabs.includes(chosen) ? chosen : fallback;

  const [picked, setPicked] = React.useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-EXPLORE_MAX_SEEDS)));

  const list = rows[tab];
  const loading = list === null || (tab === "search" && search.searching && !list.length);

  return (
    <div className="space-y-5" data-testid="explore-home">
      <label className="flex h-11 items-center gap-2.5 rounded-[4px] border-2 border-border bg-card px-3 focus-within:border-foreground/60">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("explore.searchPlaceholder")}
          aria-label={t("explore.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoFocus={!compact}
          data-testid="explore-home-search"
        />
        {search.searching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </label>

      {views && views.length > 0 && (
        <section className="space-y-2">
          <h2 className={MICRO}>{t("explore.home.savedViews")}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {views.slice(0, compact ? 3 : undefined).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onOpenSaved(v.id)}
                className="flex w-full min-w-0 items-start gap-2 rounded-[4px] border-2 border-border bg-card px-3 py-2 text-left hover:border-foreground"
                data-testid="explore-saved-view"
              >
                <Bookmark className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{v.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {v.seeds.map((s) => s.name).join(", ") || t("explore.home.viewGone")}
                  </span>
                  <span className="block font-mono text-[10px] text-muted-foreground">{formatRelative(v.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(v) => setChosen(v as Tab)}>
            <TabsList>
              {tabs.map((tb) => (
                <TabsTrigger key={tb} value={tb} data-testid={`explore-home-tab-${tb}`}>
                  {t(`explore.home.tabs.${tb}` as TranslationKey)}
                  {rows[tb] !== null && <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">{counts[tb]}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {picked.length > 0 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                {t("explore.home.clearPicked")}
              </Button>
              <Button size="sm" onClick={() => onStart(picked, null)} data-testid="explore-home-picked">
                <Compass className="size-3.5" aria-hidden />
                {t("explore.home.explorePicked", { count: picked.length })}
              </Button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[4px] border-2 border-border bg-card">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("explore.loading")}
            </div>
          ) : !list.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t(`explore.home.empty.${tab}` as TranslationKey)}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("explore.home.columns.asset")}</TableHead>
                  <TableHead className="w-48">{t(`explore.home.columns.${tab}` as TranslationKey)}</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const Icon = getAssetKindIcon(row.assetType ?? null);
                  const id = row.assetIds[0]!;
                  return (
                    <TableRow key={row.key} data-testid="explore-home-row">
                      <TableCell>
                        {row.pickable && (
                          <Checkbox
                            checked={picked.includes(id)}
                            onCheckedChange={() => toggle(id)}
                            aria-label={t("explore.home.pick", { name: row.name })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="max-w-0">
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-center gap-2 text-left"
                          onClick={() => onStart(row.assetIds, row.view)}
                        >
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate text-sm font-semibold hover:underline">{row.name}</span>
                        </button>
                        {row.sub && <p className="mt-0.5 truncate pl-[22px] text-[11px] text-muted-foreground">{row.sub}</p>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.signal}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn("h-7 gap-1 rounded-[4px] border-2 font-mono text-[10px] uppercase tracking-[0.08em]")}
                          onClick={() => onStart(row.assetIds, row.view)}
                        >
                          <Compass className="size-3" aria-hidden />
                          {t("explore.home.explore")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
