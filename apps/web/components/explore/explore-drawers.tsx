"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Crosshair,
  ExternalLink,
  Eye,
  GitBranch,
  Loader2,
  LogIn,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  api,
  type ExploreEdgeDto,
  type ExploreFindHitDto,
  type ExploreNeighbourhoodResponseDto,
  type SearchAssetItemDto,
} from "@workspace/api-client";
import {
  KindLine,
  termNodeId,
  type ExploreGraph,
  type ExploreKind,
  type ExploreSelection,
  type ExploreWords,
} from "@workspace/case-board/explore";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTermHref } from "@/components/glossary/glossary-ui";
import { encodePairId } from "@/components/review/review-format";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import type { TranslationKey } from "@/i18n";
import type { ExploreSuggestion } from "@/lib/explore";
import { useNsPath } from "@/lib/ns-path";

const MICRO = "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground";
const ACTION = "h-8 w-full justify-start gap-2 rounded-[4px] border-2 font-mono text-[10px] uppercase tracking-[0.08em]";
const SEARCH_LIMIT = 12;

/**
 * Hybrid asset search (meaning and words), as on the Assets page; the latest
 * answer wins. On a source's page it searches that source.
 */
export function useExploreSearch(query: string, sourceId?: string) {
  const [results, setResults] = React.useState<SearchAssetItemDto[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const latest = React.useRef(0);
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setFailed(false);
      setSearching(false);
      return;
    }
    const id = ++latest.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setFailed(false);
      api
        .searchAssets({
          page: { skip: 0, limit: SEARCH_LIMIT },
          options: { excludeFindings: true, includeAssetsWithoutFindings: true },
          semantic: { query: q, mode: "hybrid" },
          ...(sourceId ? { filters: { sourceId } } : {}),
        })
        .then((res) => id === latest.current && setResults(res.items))
        .catch(() => id === latest.current && setFailed(true))
        .finally(() => id === latest.current && setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, sourceId]);
  return { results, searching, failed };
}

/** A square icon button from the shared Button: add, remove, open. */
function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="size-7 shrink-0 rounded-[4px] border-2"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}

/** On-canvas find: which of the drawn assets answer the question, by name, words or meaning. */
export function useCanvasFind(query: string, assetIds: readonly string[]) {
  const [state, setState] = React.useState<{ hits: ExploreFindHitDto[]; meaningOff: boolean; finding: boolean }>({
    hits: [],
    meaningOff: false,
    finding: false,
  });
  const idsKey = assetIds.join(",");
  React.useEffect(() => {
    const q = query.trim();
    if (!q || !idsKey) {
      setState({ hits: [], meaningOff: false, finding: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, finding: true }));
    const timer = window.setTimeout(() => {
      api.explore
        .exploreControllerFind({ exploreFindRequestDto: { assetIds: idsKey.split(","), q } }, { signal: controller.signal })
        .then((res) => setState({ hits: res.hits, meaningOff: res.meaning === "off", finding: false }))
        .catch(() => {
          if (!controller.signal.aborted) setState({ hits: [], meaningOff: false, finding: false });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [idsKey, query]);
  return state;
}

/** One row of a panel's list: an asset, what it says, and its actions. */
function AssetRow({
  label,
  detail,
  meta,
  lit,
  onOpen,
  title,
  children,
  testId,
}: {
  label: string;
  detail?: React.ReactNode;
  meta?: React.ReactNode;
  lit?: boolean;
  onOpen: () => void;
  title?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <li className="flex items-start gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        title={title}
        className={cn(
          "min-w-0 flex-1 rounded-[4px] border-2 px-2 py-1.5 text-left hover:bg-muted",
          lit ? "border-[var(--cb-select)]" : "border-transparent",
        )}
        data-testid={testId}
      >
        <span className="block truncate text-sm font-semibold">{label}</span>
        {meta && <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">{meta}</span>}
        {detail && <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{detail}</span>}
      </button>
      {children && <span className="flex shrink-0 gap-1 pt-1.5">{children}</span>}
    </li>
  );
}

/**
 * Find: one search box. What it matches on the canvas glows there (by name,
 * by the words of a passage, or closest by meaning) and is listed first;
 * what it matches in the rest of the workspace can be brought in.
 */
export function FindDrawer({
  query,
  onQuery,
  onCanvas,
  search,
  seeds,
  graph,
  onStartFrom,
  startLabel,
  onAddSeed,
  onRemoveSeed,
  onSelect,
  onAllToCase,
}: {
  query: string;
  onQuery: (q: string) => void;
  onCanvas: ReturnType<typeof useCanvasFind>;
  search: ReturnType<typeof useExploreSearch>;
  seeds: string[];
  graph: ExploreGraph | null;
  onStartFrom: (assetId: string) => void;
  /** What a click on a workspace result does: start over from it, or dive into it. */
  startLabel: string;
  onAddSeed: (assetId: string) => void;
  onRemoveSeed?: (assetId: string) => void;
  onSelect: (selection: ExploreSelection) => void;
  /** Send everything on the canvas to a case. */
  onAllToCase?: () => void;
}) {
  const { t } = useTranslation();
  const assets = React.useMemo(() => new Map((graph?.assets ?? []).map((a) => [a.id, a])), [graph]);
  const drawnCount = graph?.assets.filter((a) => !a.external).length ?? 0;
  const seedAssets = graph?.assets.filter((a) => a.side === "seed") ?? [];
  const elsewhere = search.results.filter(({ asset }) => !assets.has(asset.id));
  const how = (hit: ExploreFindHitDto) =>
    hit.how === "meaning"
      ? t("explore.find.byMeaning", { percent: Math.round((hit.score ?? 0) * 100) })
      : t(`explore.find.by_${hit.how}` as TranslationKey);
  return (
    <div className="divide-y-2 divide-border">
      <div className="p-4">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("explore.searchPlaceholder")}
            aria-label={t("explore.searchPlaceholder")}
            className="h-9 rounded-[4px] border-2 border-border pr-8 pl-9"
            autoFocus
            data-testid="explore-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label={t("explore.clearSearch")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        {!query.trim() && <p className="mt-2 text-xs leading-snug text-muted-foreground">{t("explore.searchHint")}</p>}
      </div>

      {query.trim() && (
        <section className="space-y-2 p-4" data-testid="explore-find-canvas">
          <h3 className={cn(MICRO, "flex items-center gap-2")}>
            {t("explore.find.onCanvas")}
            {onCanvas.finding && <Loader2 className="size-3 animate-spin" aria-hidden />}
          </h3>
          {!onCanvas.finding && onCanvas.hits.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("explore.find.noneOnCanvas")}</p>
          ) : (
            <ul className="space-y-1">
              {onCanvas.hits.map((hit) => {
                const a = assets.get(hit.id);
                if (!a) return null;
                return (
                  <AssetRow
                    key={hit.id}
                    label={a.label}
                    lit={hit.lit}
                    onOpen={() => onSelect({ type: "asset", id: hit.id })}
                    meta={<span className="font-mono text-[10px] text-muted-foreground">{how(hit)}</span>}
                    detail={hit.text ? `${hit.page != null ? `${t("explore.page", { page: hit.page })} · ` : ""}${hit.text}` : undefined}
                    testId="explore-find-hit"
                  />
                );
              })}
            </ul>
          )}
          {onCanvas.meaningOff && <p className="text-[11px] text-muted-foreground">{t("explore.find.meaningOff")}</p>}
        </section>
      )}

      {query.trim() && (
        <section className="space-y-2 p-4">
          <h3 className={cn(MICRO, "flex items-center gap-2")}>
            {t("explore.find.elsewhere")}
            {search.searching && <Loader2 className="size-3 animate-spin" aria-hidden />}
          </h3>
          {search.failed ? (
            <p className="text-xs text-muted-foreground">{t("explore.searchFailed")}</p>
          ) : !search.searching && elsewhere.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("explore.noResults")}</p>
          ) : (
            <ul className="space-y-1">
              {elsewhere.map(({ asset, match }) => (
                <AssetRow
                  key={asset.id}
                  label={asset.name}
                  title={startLabel}
                  onOpen={() => onStartFrom(asset.id)}
                  detail={match?.text ? `${match.page != null ? `${t("explore.page", { page: match.page })} · ` : ""}${match.text}` : undefined}
                  testId="explore-result"
                >
                  <IconAction label={t("explore.addToCanvas")} onClick={() => onAddSeed(asset.id)} disabled={seeds.includes(asset.id)}>
                    <Plus className="size-3.5" aria-hidden />
                  </IconAction>
                </AssetRow>
              ))}
            </ul>
          )}
        </section>
      )}

      {seedAssets.length > 0 && (
        <section className="space-y-2 p-4">
          <h3 className={MICRO}>{t("explore.startingPoints")}</h3>
          <ul className="space-y-1">
            {seedAssets.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded-[4px] px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => onSelect({ type: "asset", id: a.id })}
                >
                  {a.label}
                </button>
                {onRemoveSeed && (
                  <IconAction label={t("explore.removeSeed")} onClick={() => onRemoveSeed(a.id)}>
                    <X className="size-3.5" aria-hidden />
                  </IconAction>
                )}
              </li>
            ))}
          </ul>
          {onAllToCase && drawnCount > 0 && (
            <Button variant="outline" className={ACTION} onClick={onAllToCase}>
              <Briefcase className="size-3.5" aria-hidden />
              {t("explore.allToCase", { count: drawnCount })}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

/** Suggestions: the neighbours most worth adding next. */
export function SuggestionsDrawer({
  suggestions,
  words,
  onAddSeed,
  onSelect,
}: {
  suggestions: ExploreSuggestion[];
  words: ExploreWords;
  onAddSeed: (assetId: string) => void;
  onSelect: (selection: ExploreSelection) => void;
}) {
  const { t } = useTranslation();
  if (!suggestions.length) return <p className="p-4 text-xs text-muted-foreground">{t("explore.noSuggestions")}</p>;
  return (
    <section className="space-y-2 p-4" data-testid="explore-suggestions">
      <p className="text-xs leading-snug text-muted-foreground">{t("explore.suggestionsHint")}</p>
      <ul className="space-y-1">
        {suggestions.map((s) => (
          <li key={s.id} className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={() => onSelect({ type: "asset", id: s.id })}
              className="min-w-0 flex-1 rounded-[4px] px-2 py-1 text-left hover:bg-muted"
            >
              <span className="block truncate text-sm">{s.label}</span>
              {s.foreign && s.sourceName && (
                <span className="block truncate text-[11px] text-muted-foreground">{s.sourceName}</span>
              )}
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {s.kinds.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <KindLine kind={k} width={12} />
                    {words.kinds[k]}
                  </span>
                ))}
                {s.best != null && (
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(s.best * 100)}%</span>
                )}
              </span>
            </button>
            <span className="pt-1">
              <IconAction label={t("explore.addSeed")} onClick={() => onAddSeed(s.id)}>
                <Plus className="size-3.5" aria-hidden />
              </IconAction>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cases and watches: which of them hold or answer what is on the canvas. */
export function MarksDrawer({
  data,
  onSpotlight,
}: {
  data: ExploreNeighbourhoodResponseDto | null;
  onSpotlight: (what: "cases" | "watches") => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  if (!data || (!data.cases.length && !data.inquiries.length)) {
    return <p className="p-4 text-xs leading-snug text-muted-foreground">{t("explore.marksNone")}</p>;
  }
  const holding = (field: "caseIds" | "inquiryIds", id: string) =>
    data.nodes.filter((n) => n[field].includes(id)).length;
  return (
    <div className="divide-y-2 divide-border">
      {data.cases.length > 0 && (
        <section className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className={MICRO}>{t("explore.marksCases")}</h3>
            <Button size="sm" variant="ghost" className="h-6 px-2 font-mono text-[10px] uppercase" onClick={() => onSpotlight("cases")}>
              {t("explore.showOnCanvas")}
            </Button>
          </div>
          <ul className="space-y-1">
            {data.cases.map((c) => (
              <li key={c.id}>
                <Link
                  href={nsPath(`/investigations/${c.id}`)}
                  className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-sm hover:bg-muted"
                >
                  <Briefcase className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <Badge variant="outline" className="rounded-[3px] font-mono text-[10px]">
                    {holding("caseIds", c.id)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.inquiries.length > 0 && (
        <section className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className={MICRO}>{t("explore.marksWatches")}</h3>
            <Button size="sm" variant="ghost" className="h-6 px-2 font-mono text-[10px] uppercase" onClick={() => onSpotlight("watches")}>
              {t("explore.showOnCanvas")}
            </Button>
          </div>
          <ul className="space-y-1">
            {data.inquiries.map((q) => (
              <li key={q.id}>
                <Link
                  href={nsPath(`/investigations/inquiries/${q.id}`)}
                  className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-sm hover:bg-muted"
                >
                  <Eye className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{q.title}</span>
                  <Badge variant="outline" className="rounded-[3px] font-mono text-[10px]">
                    {holding("inquiryIds", q.id)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Details: what is selected and why it is on the canvas. An asset lists
 * every link it has here with its reason, and the cases and watches it is
 * part of; a link says what it rests on; a term lists who carries it.
 */
export function DetailsDrawer({
  data,
  graph,
  selection,
  words,
  onSelect,
  onAddSeed,
  onStartFrom,
  onToCase,
  onChanged,
  seedExtra,
  here,
  onDiveIn,
}: {
  /** The asset whose page this is: no links back to the same page. */
  here?: string;
  /**
   * Re-centre the canvas on an asset, where a page explores one thing (an
   * asset, a source) and diving in replaces adding starting points.
   */
  onDiveIn?: (assetId: string) => void;
  /** More about a starting point: its meaning, linked by hand. */
  seedExtra?: (assetId: string) => React.ReactNode;
  data: ExploreNeighbourhoodResponseDto;
  graph: ExploreGraph;
  selection: ExploreSelection | null;
  words: ExploreWords;
  onSelect: (selection: ExploreSelection | null) => void;
  onAddSeed: (assetId: string) => void;
  onStartFrom: (assetId: string) => void;
  onToCase: (assetId: string) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const termHref = useTermHref();
  const linkById = React.useMemo(() => new Map(graph.links.map((l) => [l.id, l])), [graph.links]);
  const assetById = React.useMemo(() => new Map(graph.assets.map((a) => [a.id, a])), [graph.assets]);
  const nodeById = React.useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const termById = React.useMemo(() => new Map(data.terms.map((term) => [term.id, term])), [data.terms]);
  const nameOf = (type: string, id: string) =>
    type === "term" ? (termById.get(id)?.name ?? id) : (assetById.get(id)?.label ?? id);

  if (!selection) {
    return (
      <section className="space-y-2 p-4 text-xs leading-snug text-muted-foreground">
        <h3 className={MICRO}>{t("explore.howToRead")}</h3>
        <p>{t("explore.howToReadLayout")}</p>
        <p>{t("explore.howToReadLinks")}</p>
        <p>{t("explore.howToReadYours")}</p>
      </section>
    );
  }

  if (selection.type === "asset") {
    const a = assetById.get(selection.id);
    if (!a) return null;
    const node = nodeById.get(a.id);
    const touching = data.edges.filter((e) => e.fromId === a.id || e.toId === a.id);
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className={MICRO}>{a.side === "seed" ? t("explore.startingPoint") : t("explore.neighbour")}</p>
          <h3 className="mt-1 text-base leading-snug font-bold break-words">{a.label}</h3>
          {a.sourceName && (
            <p className="text-xs text-muted-foreground">
              {a.foreign ? t("explore.fromSource", { name: a.sourceName }) : a.sourceName}
            </p>
          )}
          {a.kinds.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {a.kinds.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                  <KindLine kind={k} width={12} />
                  {words.kinds[k]}
                </span>
              ))}
            </p>
          )}
        </header>

        {!a.external && (
          <div className="space-y-1.5">
            {onDiveIn ? (
              !(a.side === "seed" && data.seeds.length === 1) && (
                <Button className={ACTION} onClick={() => onDiveIn(a.id)} data-testid="explore-dive-in">
                  <LogIn className="size-3.5" aria-hidden />
                  {t("explore.diveIn")}
                </Button>
              )
            ) : (
              <>
                {a.side !== "seed" && (
                  <Button variant="outline" className={ACTION} onClick={() => onAddSeed(a.id)}>
                    <Plus className="size-3.5" aria-hidden />
                    {t("explore.addSeed")}
                  </Button>
                )}
                <Button variant="outline" className={ACTION} onClick={() => onStartFrom(a.id)}>
                  <Crosshair className="size-3.5" aria-hidden />
                  {t("explore.startOver")}
                </Button>
              </>
            )}
            <Button variant="outline" className={ACTION} onClick={() => onToCase(a.id)}>
              <Briefcase className="size-3.5" aria-hidden />
              {t("explore.toCase")}
            </Button>
            {a.id !== here && (
              <>
                <Button variant="outline" className={ACTION} asChild>
                  <Link href={nsPath(`/assets/${a.id}`)}>
                    <ExternalLink className="size-3.5" aria-hidden />
                    {t("explore.openAsset")}
                  </Link>
                </Button>
                {!onDiveIn && (
                  <Button variant="outline" className={ACTION} asChild>
                    <Link href={nsPath(`/assets/${a.id}?tab=connections`)}>
                      <GitBranch className="size-3.5" aria-hidden />
                      {t("explore.openConnections")}
                    </Link>
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {!a.external && <p className="text-xs leading-snug text-muted-foreground">{t("explore.linkHint")}</p>}

        {a.side === "seed" && !a.external && seedExtra?.(a.id)}

        {node && (node.caseIds.length > 0 || node.inquiryIds.length > 0) && (
          <section className="space-y-1">
            <h4 className={MICRO}>{t("explore.partOf")}</h4>
            {node.caseIds.map((id) => {
              const c = data.cases.find((x) => x.id === id);
              return c ? (
                <Link key={id} href={nsPath(`/investigations/${id}`)} className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-sm hover:bg-muted">
                  <Briefcase className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{c.title}</span>
                </Link>
              ) : null;
            })}
            {node.inquiryIds.map((id) => {
              const q = data.inquiries.find((x) => x.id === id);
              return q ? (
                <Link
                  key={id}
                  href={nsPath(`/investigations/inquiries/${id}`)}
                  className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-sm hover:bg-muted"
                >
                  <Eye className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{q.title}</span>
                </Link>
              ) : null;
            })}
          </section>
        )}

        <section>
          <h4 className={MICRO}>{t("explore.itsLinks", { count: touching.length })}</h4>
          <ul className="mt-2 space-y-1">
            {touching.map((e) => {
              const otherType = e.fromId === a.id ? e.toType : e.fromType;
              const otherId = e.fromId === a.id ? e.toId : e.fromId;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className="w-full rounded-[4px] px-2 py-1 text-left hover:bg-muted"
                    onClick={() => onSelect({ type: "link", id: e.id })}
                  >
                    <span className="flex items-center gap-1.5 text-sm">
                      <KindLine kind={e.kind as ExploreKind} width={12} />
                      <span className="truncate">{nameOf(otherType, otherId)}</span>
                    </span>
                    <span className="block truncate pl-[18px] text-[11px] text-muted-foreground">
                      {linkById.get(e.id)?.label || words.kinds[e.kind as ExploreKind]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    );
  }

  if (selection.type === "term") {
    const term = termById.get(selection.id);
    if (!term) return null;
    const holders = data.edges.filter((e) => e.toType === "term" && e.toId === selection.id);
    const Icon = term.kind === "ENTITY" ? UserRound : BookOpen;
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className={MICRO}>{term.kind === "ENTITY" ? words.entity : words.concept}</p>
          <h3 className="mt-1 flex items-center gap-2 text-base font-bold">
            <Icon className="size-4" aria-hidden />
            {term.name}
          </h3>
        </header>
        <Button variant="outline" className={ACTION} asChild>
          <Link href={termHref(term.key)}>
            <BookOpen className="size-3.5" aria-hidden />
            {t("explore.openTerm")}
          </Link>
        </Button>
        <section>
          <h4 className={MICRO}>{t("explore.carriedBy", { count: holders.length })}</h4>
          <ul className="mt-2 space-y-1">
            {holders.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="w-full truncate rounded-[4px] px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => onSelect({ type: "asset", id: e.fromId })}
                >
                  {nameOf("asset", e.fromId)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  const e = data.edges.find((x) => x.id === selection.id);
  if (!e) return null;
  return (
    <LinkDetails
      edge={e}
      reason={linkById.get(e.id)?.label ?? ""}
      from={nameOf(e.fromType, e.fromId)}
      to={nameOf(e.toType, e.toId)}
      words={words}
      onSelect={onSelect}
      onChanged={onChanged}
      pairHref={
        e.kind === "duplicates" || e.kind === "similar" ? nsPath(`/duplicates/pairs/${encodePairId(e.fromId, e.toId)}`) : null
      }
      toTerm={e.toType === "term" ? termNodeId(e.toId) : null}
    />
  );
}

function LinkDetails({
  edge,
  reason,
  from,
  to,
  words,
  onSelect,
  onChanged,
  pairHref,
  toTerm,
}: {
  edge: ExploreEdgeDto;
  reason: string;
  from: string;
  to: string;
  words: ExploreWords;
  onSelect: (selection: ExploreSelection | null) => void;
  onChanged: () => void;
  pairHref: string | null;
  toTerm: string | null;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = React.useState(false);
  const manual = edge.origin === "MANUAL";
  const kind = edge.kind as ExploreKind;

  const remove = async () => {
    setRemoving(true);
    try {
      await api.graph.graphControllerDeleteEdge({ id: edge.id });
      toast.success(t("explore.linkRemoved"));
      onSelect(null);
      onChanged();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("explore.linkRemoveFailed")));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header>
        <p className={cn(MICRO, "flex items-center gap-1.5")}>
          <KindLine kind={kind} width={12} />
          {words.kinds[kind]}
          {manual && ` · ${words.yours}`}
        </p>
        <button
          type="button"
          className="mt-1 block w-full truncate text-left text-sm font-semibold hover:underline"
          onClick={() => onSelect({ type: "asset", id: edge.fromId })}
        >
          {from}
        </button>
        <ArrowRight className="my-0.5 size-3.5 text-muted-foreground" aria-hidden />
        <button
          type="button"
          className="block w-full truncate text-left text-sm font-semibold hover:underline"
          onClick={() => onSelect({ type: toTerm ? "term" : "asset", id: edge.toId })}
        >
          {to}
        </button>
      </header>

      <section className="space-y-1.5 text-sm">
        <h4 className={MICRO}>{t("explore.why")}</h4>
        <p className="leading-snug">{reason || t(kind === "meaning" ? "explore.whyMeaning" : "explore.whyGeneric")}</p>
        {edge.relationType && !manual && kind !== "meaning" && kind !== "alike" && (
          <p className="font-mono text-[11px] text-muted-foreground">{edge.relationType}</p>
        )}
        {edge.confidence != null && kind !== "lineage" && kind !== "links" && (
          <p className="font-mono text-[11px] text-muted-foreground">
            {t("explore.score", { percent: Math.round(edge.confidence * 100) })}
          </p>
        )}
        {edge.passage && (
          <blockquote className="border-l-2 border-border pl-2 text-xs leading-snug text-muted-foreground">{edge.passage}</blockquote>
        )}
        {manual && <p className="text-xs leading-snug text-muted-foreground">{t("explore.yoursLasts")}</p>}
      </section>

      {(kind === "duplicates" || kind === "similar") && pairHref && (
        <section className="space-y-1 text-sm" data-testid="explore-pair-review">
          <h4 className={MICRO}>{t("explore.review.title")}</h4>
          <p className="leading-snug">
            {edge.review === "CONFIRMED"
              ? t("explore.review.confirmed")
              : edge.review === "UNSURE"
                ? t("explore.review.unsure")
                : t("explore.review.open")}
          </p>
        </section>
      )}

      <div className="space-y-1.5">
        {pairHref && (
          <Button variant="outline" className={ACTION} asChild>
            <Link href={pairHref}>
              <ExternalLink className="size-3.5" aria-hidden />
              {t("explore.reviewPair")}
            </Link>
          </Button>
        )}
        {manual && (
          <Button variant="outline" className={ACTION} onClick={remove} disabled={removing}>
            {removing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
            {t("explore.removeLink")}
          </Button>
        )}
      </div>
    </div>
  );
}
