"use client";

import "@xyflow/react/dist/base.css";
import "@workspace/case-board/board.css";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Panel } from "@xyflow/react";
import { toast } from "sonner";
import {
  Bookmark,
  BookmarkCheck,
  Compass,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  api,
  type ExploreNeighbourhoodResponseDto,
  type ExploreDuplicatesFilterDto,
  type ExploreViewDto,
} from "@workspace/api-client";
import {
  ExploreCanvas,
  EXPLORE_KINDS,
  type ExploreKind,
  type ExploreMenuTarget,
  type ExploreSelection,
  type ExploreSpotlight,
  type ExploreWords,
} from "@workspace/case-board/explore";
import { Button, EmptyState } from "@workspace/ui/components";
import { ContextMenu, ContextMenuTrigger } from "@workspace/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { AddToCaseDialog } from "@/components/case-target/add-to-case-dialog";
import type { CaseCandidate } from "@/components/case-target/case-target";
import { AssetMeaningPanel } from "@/components/glossary/meaning-card";
import { useFullBleedHeight } from "@/hooks/use-full-bleed-height";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import {
  EMPTY_VIEW,
  EXPLORE_MAX_SEEDS,
  EXPLORE_VIEWS,
  exploreViewQuery,
  kindsOf,
  pickView,
  rankSuggestions,
  readExploreView,
  sameNeighbours,
  toExploreGraph,
  viewCount,
  type ExploreView,
  type ExploreViewName,
} from "@/lib/explore";
import {
  DrawerFrame,
  ExploreGuide,
  ExploreRail,
  ExploreTopBar,
  ExploreTrail,
  ExploreViewPopover,
  type ExploreDrawer,
} from "./explore-chrome";
import { ExploreContextMenuContent } from "./explore-context-menu";
import { DetailsDrawer, FindDrawer, MarksDrawer, SuggestionsDrawer, useCanvasFind, useExploreSearch } from "./explore-drawers";
import { ExploreHome } from "./explore-home";
import { LinkAssetsDialog } from "./link-assets-dialog";
import { SaveViewDialog } from "./save-view-dialog";

type XY = { x: number; y: number };
type Positions = Record<string, XY>;

/**
 * The Explore page, or the Connections of an asset, a source or a glossary
 * term, or duplicate review's Explore section.
 */
export type ExploreMode = "page" | "asset" | "source" | "term" | "duplicates";

/** A level dived in from: the view there, and what the trail calls it. */
type Level = { view: ExploreView; label: string };

/**
 * Where the view lives. On the Explore page it is the address, so back and
 * forward walk the history and a view can be shared. On an asset's or a
 * source's page it is the page's own state, starting from that asset (or
 * from the source's most connected assets), and diving into a neighbour
 * keeps the way back out as a trail.
 */
function useViewState(mode: ExploreMode, assetId?: string, rootKey?: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = React.useMemo(() => readExploreView(new URLSearchParams(searchParams.toString())), [searchParams]);
  const root = React.useCallback((): ExploreView => ({ ...EMPTY_VIEW, seeds: assetId ? [assetId] : [] }), [assetId]);
  const [local, setLocal] = React.useState<ExploreView>(root);
  const [trail, setTrail] = React.useState<Level[]>([]);
  React.useEffect(() => {
    if (mode === "page") return;
    setLocal(root());
    setTrail([]);
  }, [mode, root, rootKey]);
  const view = mode === "page" ? fromUrl : local;
  const go = React.useCallback(
    (next: Partial<ExploreView>, how: "push" | "replace" = "push") => {
      if (mode !== "page") {
        setLocal((current) => ({ ...current, ...next }));
        return;
      }
      const query = exploreViewQuery({ ...fromUrl, ...next });
      const url = query ? `${pathname}?${query}` : pathname;
      if (how === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [fromUrl, mode, pathname, router],
  );
  // Diving in keeps how far, which way and which connections; the view is picked again.
  const diveIn = React.useCallback(
    (id: string, here: string) => {
      setTrail((levels) => [...levels, { view: local, label: here }]);
      setLocal({ ...EMPTY_VIEW, depth: local.depth, direction: local.direction, scope: local.scope, seeds: [id] });
    },
    [local],
  );
  // Back out to a level as it was, seen the way it is seen now.
  const diveOut = React.useCallback(
    (index: number) => {
      const level = trail[index];
      if (!level) return;
      setLocal({ ...level.view, depth: local.depth, direction: local.direction, scope: local.scope });
      setTrail(trail.slice(0, index));
    },
    [local, trail],
  );
  return { view, go, trail, diveIn, diveOut };
}

const samePositions = (a: Positions, b: Positions) => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k]?.x === a[k]?.x && b[k]?.y === a[k]?.y);
};

/**
 * Explore: start from assets, see what they are connected to and why, and
 * walk on. Laid out like a case board: the canvas is the page, the ledger
 * on top lights each kind of connection, one rail on the right opens the
 * panels, and the View in the corner picks what to trace and how far. A
 * guide says what the view shows and what the other views have. A view can
 * be saved with a name, the positions people gave things included.
 *
 * On an asset's page (`mode="asset"`) the same canvas starts from that
 * asset; on a source's (`mode="source"`), from the source's most connected
 * assets; on a glossary term's (`mode="term"`), from the assets that carry
 * it, with the term pinned between them; in duplicate review
 * (`mode="duplicates"`), from the pairs a filter matches. There, a double
 * click dives into an asset and the trail leads back out, and the scope
 * keeps all connections, those inside the source, or those leaving it.
 */
export function ExploreWorkspace({
  mode = "page",
  assetId,
  sourceId,
  sourceName,
  termId,
  duplicates,
  rootLabel,
}: {
  mode?: ExploreMode;
  assetId?: string;
  /** The source explored (`mode="source"`). */
  sourceId?: string;
  sourceName?: string;
  /** The glossary term explored (`mode="term"`). */
  termId?: string;
  /** Which of duplicate review's pairs to draw (`mode="duplicates"`). */
  duplicates?: ExploreDuplicatesFilterDto;
  /** What the trail calls the level a dive starts from. */
  rootLabel?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const onPage = mode === "page";
  const onSource = mode === "source";
  const rootRef = React.useRef<HTMLDivElement>(null);
  const noRef = React.useRef<HTMLDivElement>(null);
  useFullBleedHeight(onPage ? rootRef : noRef);
  const duplicatesKey = duplicates ? JSON.stringify(duplicates) : "";
  const rootKey = `${sourceId ?? ""}|${termId ?? ""}|${duplicatesKey}`;
  const { view, go, trail, diveIn, diveOut } = useViewState(mode, assetId, rootKey);
  // The level a source, a term or duplicate review is explored from: no assets asked for.
  const atRoot = !view.seeds.length && ((onSource && !!sourceId) || (mode === "term" && !!termId) || mode === "duplicates");

  const [data, setData] = React.useState<ExploreNeighbourhoodResponseDto | null>(null);
  // What `data` answers: the view is picked only from an answer to the current question.
  const [dataKey, setDataKey] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  const seedKey = view.seeds.join(",");
  const fetchKey = `${seedKey}|${view.depth}|${view.direction}|${view.scope}|${mode}|${rootKey}`;

  React.useEffect(() => {
    // A source, a term or duplicate review needs no seeds: the API picks them.
    if (!view.seeds.length && !atRoot) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // Every kind at once: switching views is then instant, and the counters
    // and the guide know what every view would show.
    api.explore
      .exploreControllerNeighbourhood(
        {
          exploreNeighbourhoodRequestDto: {
            assetIds: view.seeds,
            sourceId: onSource ? sourceId : undefined,
            termId: atRoot && mode === "term" ? termId : undefined,
            duplicates: atRoot && mode === "duplicates" ? (duplicates ?? {}) : undefined,
            // A term's carriers come from everywhere: no source to be inside of.
            scope: atRoot && mode === "term" ? "all" : view.scope,
            depth: view.depth,
            direction: view.direction,
          },
        },
        { signal: controller.signal },
      )
      .then((res) => {
        setData(res);
        setDataKey(fetchKey);
      })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(await extractApiErrorMessage(err, t("explore.error")));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // fetchKey stands for the seeds, the depth, the direction, the scope and the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, reload]);

  // ── Saved views ───────────────────────────────────────────────────────
  const [savedView, setSavedView] = React.useState<ExploreViewDto | null>(null);
  const [positions, setPositions] = React.useState<Positions>({});
  const [saveDialog, setSaveDialog] = React.useState<"new" | "rename" | null>(null);

  // Opening a saved view puts its starting points, view and positions back.
  React.useEffect(() => {
    if (!onPage || !view.saved || savedView?.id === view.saved) return;
    let live = true;
    api.explore
      .exploreControllerGetView({ id: view.saved })
      .then((v) => {
        if (!live) return;
        setSavedView(v);
        setPositions(v.positions as Positions);
        go(
          {
            seeds: v.seedIds.slice(0, EXPLORE_MAX_SEEDS),
            view: (v.view as ExploreViewName | null) ?? null,
            kinds: v.kinds.length ? (v.kinds as ExploreKind[]) : null,
            depth: v.depth,
            direction: v.direction as ExploreView["direction"],
            saved: v.id,
          },
          "replace",
        );
      })
      .catch(() => {
        if (!live) return;
        toast.error(t("explore.saved.gone"));
        go({ saved: null }, "replace");
      });
    return () => {
      live = false;
    };
  }, [go, onPage, savedView?.id, t, view.saved]);
  React.useEffect(() => {
    if (!view.saved && savedView) setSavedView(null);
  }, [savedView, view.saved]);

  const current = {
    seedIds: view.seeds,
    view: view.view,
    kinds: view.kinds ?? [],
    depth: view.depth,
    direction: view.direction,
    positions,
  };
  const dirty =
    !!savedView &&
    (savedView.seedIds.join(",") !== view.seeds.join(",") ||
      (savedView.view ?? null) !== view.view ||
      savedView.kinds.join(",") !== (view.kinds ?? []).join(",") ||
      savedView.depth !== view.depth ||
      savedView.direction !== view.direction ||
      !samePositions(savedView.positions as Positions, positions));

  const saveCurrent = async () => {
    if (!savedView) {
      setSaveDialog("new");
      return;
    }
    try {
      const updated = await api.explore.exploreControllerUpdateView({ id: savedView.id, saveExploreViewDto: current });
      setSavedView(updated);
      toast.success(t("explore.saved.saved"));
    } catch (err) {
      toast.error(await extractApiErrorMessage(err, t("explore.saved.failed")));
    }
  };
  const saveAs = async ({ name, description }: { name: string; description: string }) => {
    try {
      if (saveDialog === "rename" && savedView) {
        const updated = await api.explore.exploreControllerUpdateView({
          id: savedView.id,
          saveExploreViewDto: { name, description: description || null },
        });
        setSavedView(updated);
      } else {
        const created = await api.explore.exploreControllerCreateView({
          saveExploreViewDto: { ...current, name, description: description || null },
        });
        setSavedView(created);
        go({ saved: created.id }, "replace");
      }
      setSaveDialog(null);
      toast.success(t("explore.saved.saved"));
    } catch (err) {
      toast.error(await extractApiErrorMessage(err, t("explore.saved.failed")));
    }
  };
  const deleteView = async () => {
    if (!savedView) return;
    try {
      await api.explore.exploreControllerDeleteView({ id: savedView.id });
      setSavedView(null);
      go({ saved: null }, "replace");
      toast.success(t("explore.saved.deleted"));
    } catch (err) {
      toast.error(await extractApiErrorMessage(err, t("explore.saved.failed")));
    }
  };

  // No view chosen yet: open on the one these starting points have most to show in.
  React.useEffect(() => {
    if (!data || view.view || view.kinds || !data.seeds.length || dataKey !== fetchKey) return;
    go({ view: pickView(data.counts) }, "replace");
  }, [data, dataKey, fetchKey, go, view.kinds, view.view]);

  const kindList = kindsOf(view);
  const kinds = React.useMemo<ReadonlySet<ExploreKind>>(() => new Set(kindList), [kindList.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  // On a term's page the term stays on the canvas whatever is shown, until a dive leaves it.
  const anchor = atRoot && mode === "term" ? (termId ?? null) : null;
  const graph = React.useMemo(() => (data ? { ...toExploreGraph(data, t), anchor } : null), [anchor, data, t]);
  const suggestions = React.useMemo(() => (data ? rankSuggestions(data, kinds) : []), [data, kinds]);
  const canvasIds = React.useMemo(() => graph?.assets.filter((a) => !a.external).map((a) => a.id) ?? [], [graph]);
  const viewCounts = React.useMemo(
    () => (data ? (Object.fromEntries(EXPLORE_VIEWS.map((v) => [v, viewCount(v, data)])) as Record<ExploreViewName, number>) : null),
    [data],
  );

  const [selection, setSelection] = React.useState<ExploreSelection | null>(null);
  const [spotlight, setSpotlight] = React.useState<ExploreSpotlight | null>(null);
  // Only the Explore page has a start of its own; a source starts from its assets.
  const empty = onPage && !view.seeds.length;
  // On an asset's page the canvas is small: panels open when asked for.
  const [drawer, setDrawer] = React.useState<ExploreDrawer | null>(empty || !onPage ? null : "suggestions");
  React.useEffect(() => {
    setSelection(null);
    setSpotlight(null);
    setPeek(false);
    if (!empty && onPage) setDrawer((d) => d ?? "suggestions");
  }, [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The search box: typed here, answered in the Find panel (or on the
  // home's table), kept in the address.
  const [query, setQuery] = React.useState(view.q);
  const search = useExploreSearch(empty ? "" : query, onSource ? sourceId : undefined);
  const onCanvas = useCanvasFind(empty ? "" : query, canvasIds);
  // What the search matched on the canvas glows while Find is open.
  const highlight = React.useMemo(
    () => (drawer === "find" && query.trim() ? new Set(onCanvas.hits.filter((h) => h.lit).map((h) => h.id)) : null),
    [drawer, onCanvas.hits, query],
  );
  React.useEffect(() => {
    if (!onPage) return;
    const timer = window.setTimeout(() => {
      if (query !== view.q) go({ q: query }, "replace");
    }, 600);
    return () => window.clearTimeout(timer);
  }, [go, onPage, query, view.q]);

  // Linking: pull a line from one asset's edge to another's.
  const [linkPair, setLinkPair] = React.useState<{ from: string; to: string } | null>(null);
  const [caseCandidates, setCaseCandidates] = React.useState<CaseCandidate[] | null>(null);
  const [menuTarget, setMenuTarget] = React.useState<ExploreMenuTarget | null>(null);
  // "Fit to view" from the menu: refits the canvas.
  const [fitNonce, setFitNonce] = React.useState(0);
  // A detail opened from a panel's list shows in that panel, with a way back.
  const [peek, setPeek] = React.useState(false);

  // From the canvas: Details shows it.
  const select = React.useCallback((next: ExploreSelection | null) => {
    setSelection(next);
    setPeek(false);
    if (next) {
      setSpotlight(null);
      setDrawer("details");
    }
  }, []);
  // From a panel's list: the panel shows it, and the canvas lights it.
  const selectInPanel = React.useCallback(
    (next: ExploreSelection | null) => {
      if (!next || drawer === "details" || !drawer) return select(next);
      setSelection(next);
      setSpotlight(null);
      setPeek(true);
    },
    [drawer, select],
  );

  // A source's own starting points are the ones it was explored from.
  const seedsNow = React.useMemo(
    () => (view.seeds.length ? view.seeds : (data?.seeds ?? [])),
    [data?.seeds, view.seeds],
  );
  const addSeed = React.useCallback(
    (id: string) => {
      if (seedsNow.includes(id)) return;
      go({ seeds: [...seedsNow, id].slice(-EXPLORE_MAX_SEEDS) });
    },
    [go, seedsNow],
  );
  // A new start leaves the saved view and picks its view again, unless one is asked for.
  const startFrom = React.useCallback(
    (assetIds: string[], next: ExploreViewName | null = null) => {
      setPositions({});
      go({ seeds: assetIds.slice(0, EXPLORE_MAX_SEEDS), view: next, kinds: null, saved: null });
    },
    [go],
  );
  const removeSeed = React.useCallback(
    (id: string) => go({ seeds: seedsNow.filter((x) => x !== id) }),
    [go, seedsNow],
  );

  const words = React.useMemo<ExploreWords>(
    () => ({
      kinds: Object.fromEntries(EXPLORE_KINDS.map((k) => [k, t(`explore.kind.${k}` as TranslationKey)])) as ExploreWords["kinds"],
      lanes: {
        duplicates: t("explore.lane.duplicates"),
        similar: t("explore.lane.similar"),
        terms: t("explore.lane.terms"),
        meaning: t("explore.lane.meaning"),
        alike: t("explore.lane.alike"),
        links: t("explore.lane.links"),
      },
      where: (side, depth) => t(side === "up" ? "explore.where.up" : "explore.where.down", { count: depth }),
      walk: onPage ? t("explore.walk") : t("explore.walkDive"),
      elsewhere: t("explore.elsewhere"),
      caseMark: t("explore.caseMark"),
      inCase: t("explore.inCase"),
      watchMark: t("explore.watchMark"),
      watched: t("explore.watchedLead"),
      concept: t("explore.concept"),
      entity: t("explore.entity"),
      yours: t("explore.yours"),
      zoomIn: t("explore.zoomIn"),
      zoomOut: t("explore.zoomOut"),
      zoomReset: t("explore.zoomReset"),
      fit: t("explore.fit"),
      zoomSelection: t("explore.zoomSelection"),
      minimap: t("explore.minimap"),
    }),
    [onPage, t],
  );

  const sendToCase = (ids: string[]) =>
    setCaseCandidates(
      ids.flatMap((id) => {
        const a = graph?.assets.find((x) => x.id === id);
        return a ? [{ kind: "asset" as const, id: a.id, assetId: a.id, label: a.label, assetType: a.assetType ?? null }] : [];
      }),
    );

  const seedsShown = graph?.assets.filter((a) => a.side === "seed") ?? [];
  const title = savedView
    ? savedView.name
    : seedsShown.length
      ? seedsShown.length > 1
        ? t("explore.titleMany", { name: seedsShown[0]!.label, count: seedsShown.length - 1 })
        : seedsShown[0]!.label
      : t("explore.title");
  // What this level is called in the trail, once a dive leaves it.
  const here = !view.seeds.length
    ? (rootLabel ?? t("explore.sourceLevel", { name: sourceName ?? "" }))
    : seedsShown.length > 1
      ? t("explore.titleMany", { name: seedsShown[0]!.label, count: seedsShown.length - 1 })
      : (seedsShown[0]?.label ?? "");
  const dive = React.useCallback(
    (id: string) => {
      if (view.seeds.length === 1 && view.seeds[0] === id) return;
      setPositions({});
      diveIn(id, here);
    },
    [diveIn, here, view.seeds],
  );

  // Counted over what this view draws, as every other counter is.
  const drawn = graph?.assets.filter((a) => a.side === "seed" || a.kinds.some((k) => kinds.has(k))) ?? [];
  const casedCount = drawn.filter((a) => a.cases?.length).length;
  const watchedCount = drawn.filter((a) => a.watches?.length).length;

  // What the guide says about the view, and which other views have something.
  const guide = React.useMemo(() => {
    if (!data || !graph || !viewCounts) return null;
    const currentView: ExploreViewName = view.view ?? pickView(data.counts);
    let text: string;
    if (view.kinds) {
      text = t("explore.guide.custom", { count: graph.assets.filter((a) => a.side !== "seed" && a.kinds.some((k) => kinds.has(k))).length });
    } else if (currentView === "lineage") {
      const up = graph.assets.filter((a) => a.side === "up").length;
      const down = graph.assets.filter((a) => a.side === "down").length;
      text = up + down > 0 ? t("explore.guide.lineage", { up, down }) : t("explore.guide.noLineage");
    } else if (currentView === "meaning" && view.scope !== "all" && viewCounts.meaning === 0) {
      // Not "nothing links these": the switch is what left the canvas empty.
      text = `${t(`explore.scopeEmpty.${view.scope}` as TranslationKey)}.`;
    } else if (currentView === "meaning") {
      // On a term's page shared meaning is the point, not a sign nothing links them.
      text =
        viewCounts.connected === 0 && !(atRoot && mode === "term")
          ? t("explore.guide.unlinked", { count: viewCounts.meaning })
          : t("explore.guide.meaning", { count: viewCounts.meaning });
    } else {
      text = t(`explore.guide.${currentView}` as TranslationKey, { count: viewCounts[currentView] });
    }
    if (atRoot) {
      const lead =
        mode === "term" ? "explore.guide.carriers" : mode === "duplicates" ? "explore.guide.duplicateHubs" : "explore.guide.mostConnected";
      text = `${t(lead as TranslationKey, { count: data.seeds.length })} ${text}`;
    }
    if (data.truncated) text = `${text} ${t("explore.guide.truncated")}`;
    // A view that would draw what this one draws adds nothing.
    const offers = EXPLORE_VIEWS.filter(
      (v) => (view.kinds || v !== currentView) && viewCounts[v] > 0 && (!!view.kinds || !sameNeighbours(v, currentView, data)),
    ).map((v) => ({ view: v, count: viewCounts[v] }));
    return { text, offers };
  }, [atRoot, data, graph, kinds, mode, t, view.kinds, view.scope, view.view, viewCounts]);

  const actions = onPage ? (
    !empty && (
      <>
        <Button
          size="sm"
          variant={dirty || !savedView ? "default" : "outline"}
          className="h-9 gap-1.5 rounded-[4px] border-2"
          onClick={() => void saveCurrent()}
          disabled={!!savedView && !dirty}
          data-testid="explore-save"
        >
          {savedView && !dirty ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
          {savedView ? (dirty ? t("explore.saved.saveChanges") : t("explore.saved.isSaved")) : t("explore.saved.saveView")}
        </Button>
        {/* Not modal, for the same reason: its items open dialogs. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("explore.saved.more")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-[4px] border-2 border-transparent hover:border-border"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setSaveDialog("new")}>
              <Bookmark className="size-4" /> {t("explore.saved.saveAs")}
            </DropdownMenuItem>
            {savedView && (
              <DropdownMenuItem onSelect={() => setSaveDialog("rename")}>
                <Pencil className="size-4" /> {t("explore.saved.rename")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!Object.keys(positions).length} onSelect={() => setPositions({})}>
              <RotateCcw className="size-4" /> {t("explore.saved.resetLayout")}
            </DropdownMenuItem>
            {savedView && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void deleteView()}>
                  <Trash2 className="size-4" /> {t("explore.saved.delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  ) : null;

  const details =
    data && graph ? (
      <DetailsDrawer
        data={data}
        graph={graph}
        selection={selection}
        words={words}
        onSelect={peek ? selectInPanel : select}
        onAddSeed={addSeed}
        onStartFrom={(id) => startFrom([id])}
        onToCase={(id) => sendToCase([id])}
        onChanged={() => setReload((n) => n + 1)}
        seedExtra={(id) => <AssetMeaningPanel assetId={id} onChanged={() => setReload((n) => n + 1)} />}
        here={onPage ? undefined : assetId}
        onDiveIn={onPage ? undefined : dive}
      />
    ) : null;

  const removeLink = async (edgeId: string) => {
    try {
      await api.graph.graphControllerDeleteEdge({ id: edgeId });
      toast.success(t("explore.linkRemoved"));
      setSelection(null);
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(await extractApiErrorMessage(err, t("explore.linkRemoveFailed")));
    }
  };

  return (
    <div
      ref={onPage ? rootRef : undefined}
      className={cn(
        "case-board relative flex flex-col overflow-hidden bg-background",
        // The canvas is the page's main thing wherever it is drawn: like the
        // case board, a screen tall, no box around it (a rule above and below
        // only). It keeps to its page's width; pages pad differently.
        onPage ? "-mx-4 -mt-2 -mb-4 min-h-[480px]" : "h-[calc(100dvh-7rem)] min-h-[560px] border-y-2 border-border",
      )}
      data-testid="explore"
    >
      <ExploreTopBar
        title={onPage ? title : undefined}
        trail={
          trail.length ? (
            <ExploreTrail
              levels={trail.map((l) => l.label)}
              current={here}
              onBack={(i) => {
                setPositions({});
                diveOut(i);
              }}
            />
          ) : undefined
        }
        scope={atRoot && mode === "term" ? undefined : view.scope}
        onScope={(scope) => go({ scope }, "replace")}
        kinds={EXPLORE_KINDS.filter((k) => kinds.has(k))}
        counts={data ? data.counts : null}
        cases={casedCount}
        watches={watchedCount}
        spotlight={spotlight}
        onSpotlight={(next) => {
          setSelection(null);
          setSpotlight(next);
        }}
        words={words}
        actions={actions}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {empty ? (
            <div className="h-full overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-5xl">
                <ExploreHome
                  query={query}
                  onQuery={setQuery}
                  onStart={(ids, next) => startFrom(ids, next)}
                  onOpenSaved={(id) => go({ saved: id })}
                />
              </div>
            </div>
          ) : error ? (
            <EmptyState
              icon={Compass}
              title={t("explore.error")}
              description={error}
              action={{ label: t("explore.retry"), onClick: () => setReload((n) => n + 1) }}
            />
          ) : graph && graph.assets.length > 0 ? (
            <ContextMenu modal={false} onOpenChange={(open) => !open && setMenuTarget(null)}>
              {/* Not modal: a modal menu leaves the page unclickable (pointer-events on
                  the body) when one of its items opens a dialog, such as Add to a case. */}
              <ContextMenuTrigger asChild>
                <div className="h-full">
                  <ExploreCanvas
                    graph={graph}
                    kinds={kinds}
                    selection={selection}
                    onSelect={select}
                    spotlight={spotlight}
                    highlight={highlight}
                    onMenuTarget={setMenuTarget}
                    onWalk={onPage ? addSeed : dive}
                    onLink={(from, to) => setLinkPair({ from, to })}
                    iconFor={getAssetKindIcon}
                    words={words}
                    fitKey={`${data?.seeds.join(",")}|${dataKey}|${kindList.join(",")}|${savedView?.id ?? ""}|${fitNonce}`}
                    positions={positions}
                    onPositionsChange={setPositions}
                    className="h-full"
                    style={{ height: "100%" }}
                    overlay={
                      <>
                        {loading && (
                          <Panel position="top-left">
                            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t("explore.loading")} />
                          </Panel>
                        )}
                        <Panel position="bottom-left">
                          <ExploreViewPopover
                            view={view.view}
                            kinds={kinds}
                            custom={!!view.kinds}
                            counts={viewCounts}
                            depth={view.depth}
                            direction={view.direction}
                            words={words}
                            onView={(next) => go({ view: next, kinds: null }, "replace")}
                            onKinds={(next) => go({ kinds: next }, "replace")}
                            onDepth={(depth) => go({ depth })}
                            onDirection={(direction) => go({ direction })}
                          />
                        </Panel>
                      </>
                    }
                  />
                </div>
              </ContextMenuTrigger>
              <ExploreContextMenuContent
                target={menuTarget}
                data={data}
                graph={graph}
                words={words}
                here={onPage ? undefined : assetId}
                actions={{
                  onDetails: select,
                  onDiveIn: onPage ? undefined : dive,
                  onAddSeed: onPage ? addSeed : undefined,
                  onStartFrom: onPage ? (id) => startFrom([id]) : undefined,
                  onToCase: (id) => sendToCase([id]),
                  onRemoveLink: (id) => void removeLink(id),
                  onOpen: (href) => router.push(href),
                  onFit: () => setFitNonce((n) => n + 1),
                  onResetLayout: onPage ? () => setPositions({}) : undefined,
                }}
              />
            </ContextMenu>
          ) : data && !loading ? (
            view.scope !== "all" ? (
              <EmptyState
                icon={Compass}
                title={t(`explore.scopeEmpty.${view.scope}` as TranslationKey)}
                description={t(`explore.scopeEmpty.${view.scope}Hint` as TranslationKey)}
                action={{ label: t("explore.scope.showAll"), onClick: () => go({ scope: "all" }, "replace") }}
              />
            ) : atRoot ? (
              <EmptyState
                icon={Compass}
                title={t(`explore.rootEmpty.${mode}` as TranslationKey)}
                description={t(`explore.rootEmpty.${mode}Hint` as TranslationKey)}
              />
            ) : (
              <EmptyState icon={Compass} title={t("explore.gone")} description={t("explore.goneHint")} />
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("explore.loading")} />
            </div>
          )}
          {/* Over the canvas, not inside it, so it wraps to the canvas's width. */}
          {guide && !empty && !error && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4">
              <ExploreGuide text={guide.text} offers={guide.offers} onView={(next) => go({ view: next, kinds: null }, "replace")} />
            </div>
          )}
        </div>

        {!empty && drawer && (
          <DrawerFrame
            title={t(`explore.drawer.${drawer}` as TranslationKey)}
            onClose={() => {
              setDrawer(null);
              setPeek(false);
            }}
            onBack={
              peek
                ? () => {
                    setPeek(false);
                    setSelection(null);
                  }
                : undefined
            }
            backLabel={t("explore.backTo", { name: t(`explore.drawer.${drawer}` as TranslationKey) })}
          >
            {peek && data && graph ? (
              details
            ) : drawer === "find" ? (
              <FindDrawer
                query={query}
                onQuery={setQuery}
                onCanvas={onCanvas}
                search={search}
                seeds={seedsNow}
                graph={graph}
                onStartFrom={onPage ? (id) => startFrom([id]) : dive}
                startLabel={onPage ? t("explore.startFrom") : t("explore.diveIn")}
                onAddSeed={addSeed}
                onRemoveSeed={seedsNow.length > 1 ? removeSeed : undefined}
                onSelect={selectInPanel}
                onAllToCase={() => sendToCase(graph?.assets.filter((a) => !a.external).map((a) => a.id) ?? [])}
              />
            ) : drawer === "suggestions" ? (
              <SuggestionsDrawer suggestions={suggestions} words={words} onAddSeed={addSeed} onSelect={selectInPanel} />
            ) : drawer === "marks" ? (
              <MarksDrawer
                data={data}
                onSpotlight={(what) => {
                  setSelection(null);
                  setSpotlight(what);
                }}
              />
            ) : data && graph ? (
              details
            ) : (
              <p className="p-4 text-xs text-muted-foreground">{t("explore.nothingSelected")}</p>
            )}
          </DrawerFrame>
        )}
        {!empty && (
          <ExploreRail
            drawer={drawer}
            onDrawer={setDrawer}
            suggestions={suggestions.length}
            marks={(data?.cases.length ?? 0) + (data?.inquiries.length ?? 0)}
            hide={[]}
          />
        )}
      </div>

      {linkPair && graph && (
        <LinkAssetsDialog
          open
          onOpenChange={(open) => !open && setLinkPair(null)}
          from={graph.assets.find((a) => a.id === linkPair.from) ?? null}
          to={graph.assets.find((a) => a.id === linkPair.to) ?? null}
          onLinked={() => {
            setLinkPair(null);
            setReload((n) => n + 1);
          }}
        />
      )}
      {caseCandidates && (
        <AddToCaseDialog open onOpenChange={(open) => !open && setCaseCandidates(null)} candidates={caseCandidates} />
      )}
      <SaveViewDialog
        open={saveDialog !== null}
        onOpenChange={(open) => !open && setSaveDialog(null)}
        title={saveDialog === "rename" ? t("explore.saved.renameTitle") : t("explore.saved.saveTitle")}
        initialName={saveDialog === "rename" ? (savedView?.name ?? "") : ""}
        initialDescription={saveDialog === "rename" ? (savedView?.description ?? "") : ""}
        onSave={saveAs}
      />
    </div>
  );
}
