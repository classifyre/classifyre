"use client";

import "@xyflow/react/dist/base.css";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from "@xyflow/react";
import {
  ArrowLeftRight,
  BookOpen,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  Plus,
  ScanSearch,
  Search,
  Shapes,
  X,
} from "lucide-react";
import { api, type CaseResponseDto } from "@workspace/api-client";
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
} from "@workspace/ui/components/multi-select";
import { cn } from "@workspace/ui/lib/utils";
import { PanelCard } from "@/components/panel-card";
import { MICRO_LABEL, useTermHref } from "@/components/glossary/glossary-ui";
import { TermEditorDialog } from "@/components/glossary/term-editor-dialog";
import { useContainerSize } from "@/components/graph-explorer/use-container-size";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { CONCEPT_SIZE, taxonomyLayout } from "@/lib/meaning-map-layout";
import { networkLayout } from "@/lib/meaning-map-network";
import { useNsPath } from "@/lib/ns-path";
import {
  createRelation,
  getSemanticMap,
  getTerm,
  listSchemes,
  rebuildSemanticMap,
  semanticErrorMessage,
  type MapNode,
  type Scheme,
  type SemanticMap,
  type Term,
} from "@/lib/semantic-api";
import { AddConceptToCaseDialog } from "./add-concept-to-case-dialog";
import { MEANING_RAIL_WIDTH, MeaningMapRail, type RailEditing } from "./rail";
import { RelateDialog } from "./relate-dialog";
import {
  FALLBACK_SCHEME_COLOR,
  MEANING_EDGE_TYPES,
  MEANING_NODE_TYPES,
  MeaningMapActionsContext,
  type MeaningMapActions,
  type MeaningFlowEdge,
  type MeaningFlowNode,
  type Tone,
} from "./nodes";

type Layout = "taxonomy" | "network";

/** The URL keys this map owns (cleared when the glossary leaves the map tab). */
export const MEANING_URL_KEYS = [
  "layout",
  "concept",
  "case",
  "schemes",
  "sources",
  "min",
] as const;

const OPEN_CASE_STATUSES = ["OPEN", "IN_PROGRESS"] as const;
const REGION_LABEL = { width: 420, height: 40 };
const SEARCH_HITS = 8;

interface ViewState {
  layout: Layout;
  conceptKey: string | null;
  caseId: string | null;
  schemeIds: string[];
  sourceIds: string[];
  minAssets: number;
}

function readView(): ViewState {
  const params = new URLSearchParams(window.location.search);
  const list = (key: string) =>
    (params.get(key) ?? "").split(",").filter(Boolean);
  const min = Number(params.get("min"));
  return {
    layout: params.get("layout") === "network" ? "network" : "taxonomy",
    conceptKey: params.get("concept"),
    caseId: params.get("case"),
    schemeIds: list("schemes"),
    sourceIds: list("sources"),
    minAssets: Number.isFinite(min) && params.has("min") ? Math.max(0, min) : 0,
  };
}

function viewUrl(view: ViewState): URL {
  const url = new URL(window.location.href);
  for (const key of MEANING_URL_KEYS) url.searchParams.delete(key);
  if (view.layout !== "taxonomy") url.searchParams.set("layout", view.layout);
  if (view.conceptKey) url.searchParams.set("concept", view.conceptKey);
  if (view.caseId) url.searchParams.set("case", view.caseId);
  if (view.schemeIds.length)
    url.searchParams.set("schemes", view.schemeIds.join(","));
  if (view.sourceIds.length)
    url.searchParams.set("sources", view.sourceIds.join(","));
  if (view.minAssets !== 0) url.searchParams.set("min", String(view.minAssets));
  return url;
}

/** What the editor dialog is doing: editing a concept, or adding one. */
interface EditorState {
  term: Term | null;
  schemeId: string | null;
  /** A new concept is narrower than this one. */
  broaderOf: MapNode | null;
}

/**
 * The meaning map (SL5 Part B), the glossary's main view: every approved
 * concept as a card, grouped into its scheme, with the evidence behind it.
 * *Taxonomy* reads each scheme as an outline; *Network* lets concepts found on
 * the same assets pull together. Hovering or selecting a concept lights up
 * what it is connected to; the rail beside it explains the concept and acts
 * on it — open it, watch it, bring it into a case, go to its evidence. When
 * `editable`, the map also grows the glossary: add a concept to a scheme or
 * under another, edit one, relate two by picking them on the canvas.
 */
export function MeaningMap(props: {
  /** Bumped by the page when the glossary changed elsewhere (a dialog, an import). */
  refreshKey?: number;
  /** The map changed the glossary. */
  onChanged?: () => void;
  editable?: boolean;
  className?: string;
}) {
  return (
    <ReactFlowProvider>
      <MeaningCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MeaningCanvas({
  refreshKey = 0,
  onChanged,
  editable = false,
  className,
}: {
  refreshKey?: number;
  onChanged?: () => void;
  editable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const termHref = useTermHref();
  const { resolvedTheme } = useTheme();
  const flow = useReactFlow<MeaningFlowNode, MeaningFlowEdge>();

  const [ready, setReady] = React.useState(false);
  const [layout, setLayout] = React.useState<Layout>("taxonomy");
  const [schemeIds, setSchemeIds] = React.useState<string[]>([]);
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [minAssets, setMinAssets] = React.useState(0);
  const [caseId, setCaseId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const conceptFromUrl = React.useRef<string | null>(null);

  const [schemes, setSchemes] = React.useState<Scheme[]>([]);
  const [sources, setSources] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [cases, setCases] = React.useState<CaseResponseDto[]>([]);
  const [map, setMap] = React.useState<SemanticMap | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rebuilding, setRebuilding] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [adding, setAdding] = React.useState<MapNode | null>(null);
  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [legendOpen, setLegendOpen] = React.useState(false);
  const [dragged, setDragged] = React.useState<
    Map<string, { x: number; y: number }>
  >(new Map());
  const [reloadToken, setReloadToken] = React.useState(0);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [linkingFrom, setLinkingFrom] = React.useState<MapNode | null>(null);
  const [relating, setRelating] = React.useState<{
    from: MapNode;
    to: MapNode;
  } | null>(null);
  // After an edit the map is redrawn: keep the view, and select what changed.
  const keepView = React.useRef(false);
  const selectAfterLoad = React.useRef<string | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const size = useContainerSize(containerRef, { width: 1000, height: 560 });

  React.useEffect(() => {
    const view = readView();
    setLayout(view.layout);
    setSchemeIds(view.schemeIds);
    setSourceIds(view.sourceIds);
    setMinAssets(view.minAssets);
    setCaseId(view.caseId);
    conceptFromUrl.current = view.conceptKey;
    setReady(true);
    api.sources
      .sourcesControllerListSources()
      .then((list) =>
        setSources(
          ((list ?? []) as unknown as Array<{ id: string; name: string }>).map(
            (s) => ({ id: s.id, name: s.name }),
          ),
        ),
      )
      .catch(() => setSources([]));
    api.cases
      .casesControllerList({ status: [...OPEN_CASE_STATUSES], limit: 50 })
      .then((res) => setCases(res.items ?? []))
      .catch(() => setCases([]));
  }, []);

  React.useEffect(() => {
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
  }, [refreshKey, reloadToken]);

  const reload = React.useCallback(() => {
    keepView.current = true;
    setReloadToken((value) => value + 1);
    onChanged?.();
  }, [onChanged]);

  const schemeKey = schemeIds.join(",");
  const sourceKey = sourceIds.join(",");
  React.useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(true);
    setError(null);
    getSemanticMap({
      schemeIds: schemeKey ? schemeKey.split(",") : undefined,
      sourceIds: sourceKey ? sourceKey.split(",") : undefined,
      minAssets,
      cooccurrence: true,
      caseId: caseId ?? undefined,
    })
      .then((result) => {
        if (active) setMap(result);
      })
      .catch((loadError) => {
        if (active)
          setError(
            semanticErrorMessage(loadError, t("semanticMap.loadFailed")),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    ready,
    schemeKey,
    sourceKey,
    minAssets,
    caseId,
    refreshKey,
    reloadToken,
    t,
  ]);

  const nodesById = React.useMemo(
    () => new Map((map?.nodes ?? []).map((node) => [node.termId, node])),
    [map],
  );
  const selected = selectedId ? (nodesById.get(selectedId) ?? null) : null;

  // The URL carries the view, so a link opens the same map on the same concept.
  React.useEffect(() => {
    if (!ready || conceptFromUrl.current) return;
    const url = viewUrl({
      layout,
      conceptKey: selected?.key ?? null,
      caseId,
      schemeIds,
      sourceIds,
      minAssets,
    });
    window.history.replaceState(null, "", url.toString());
  }, [ready, layout, selected, caseId, schemeIds, sourceIds, minAssets]);

  // Packing only cares about the viewport's shape, in coarse steps.
  const viewport = React.useMemo(
    () => ({
      width: Math.round(size.width / 80) * 80,
      height: Math.round(size.height / 80) * 80,
    }),
    [size.width, size.height],
  );
  // A scheme with no concepts yet still gets a frame to add the first one to.
  const emptySchemes = React.useMemo(
    () =>
      editable && sourceIds.length === 0
        ? schemes
            .filter(
              (scheme) =>
                scheme.termCount === 0 &&
                (schemeIds.length === 0 || schemeIds.includes(scheme.id)),
            )
            .map(({ id, key, name, color }) => ({ id, key, name, color }))
        : [],
    [editable, schemes, schemeIds, sourceIds.length],
  );
  const taxonomy = React.useMemo(
    () => taxonomyLayout(map?.nodes ?? [], viewport, emptySchemes),
    [map?.nodes, viewport, emptySchemes],
  );
  const network = React.useMemo(
    () =>
      layout === "network" && map ? networkLayout(map.nodes, map.links) : null,
    [layout, map],
  );
  const layoutKey = React.useMemo(
    () =>
      `${layout}|${layout === "taxonomy" ? `${viewport.width}x${viewport.height}` : ""}|${(
        map?.nodes ?? []
      )
        .map((node) => node.termId)
        .sort()
        .join(",")}`,
    [layout, viewport, map?.nodes],
  );
  React.useEffect(() => setDragged(new Map()), [layoutKey]);

  const positions = React.useMemo(() => {
    const base: Map<string, { x: number; y: number }> =
      layout === "network" && network
        ? new Map(network)
        : new Map(
            [...taxonomy.concepts].map(([id, p]) => [id, { x: p.x, y: p.y }]),
          );
    for (const [id, at] of dragged) base.set(id, at);
    return base;
  }, [layout, network, taxonomy, dragged]);

  const adjacency = React.useMemo(() => {
    const out = new Map<string, Set<string>>();
    const add = (a: string, b: string) =>
      out.set(a, (out.get(a) ?? new Set()).add(b));
    for (const link of map?.links ?? []) {
      add(link.a, link.b);
      add(link.b, link.a);
    }
    return out;
  }, [map?.links]);

  const caseTermIds = React.useMemo(
    () => (caseId && map?.overlay ? new Set(map.overlay.termIds) : null),
    [caseId, map?.overlay],
  );
  const focusId = hoveredId ?? selectedId;
  const neighbours = React.useMemo(
    () => (focusId ? (adjacency.get(focusId) ?? new Set<string>()) : null),
    [focusId, adjacency],
  );
  const maxAssets = React.useMemo(
    () =>
      Math.max(1, ...(map?.nodes ?? []).map((node) => node.totalAssetCount)),
    [map?.nodes],
  );
  const maxLift = React.useMemo(
    () =>
      Math.max(
        Math.E,
        ...(map?.links ?? [])
          .filter((l) => l.kind === "CO_OCCURRENCE")
          .map((l) => l.lift ?? 1),
      ),
    [map?.links],
  );

  const toneOf = React.useCallback(
    (termId: string): Tone => {
      if (focusId)
        return termId === focusId
          ? "focus"
          : neighbours?.has(termId)
            ? "neighbor"
            : "dim";
      if (caseTermIds) return caseTermIds.has(termId) ? "normal" : "dim";
      return "normal";
    },
    [focusId, neighbours, caseTermIds],
  );

  const nodes = React.useMemo<MeaningFlowNode[]>(() => {
    if (!map) return [];
    const out: MeaningFlowNode[] = [];
    if (layout === "taxonomy") {
      for (const frame of taxonomy.frames) {
        out.push({
          id: frame.id,
          type: "scheme",
          position: { x: frame.x, y: frame.y },
          width: frame.width,
          height: frame.height,
          measured: { width: frame.width, height: frame.height },
          data: {
            frame,
            dim: frame.conceptIds.every((id) => toneOf(id) === "dim"),
          },
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: -1,
        });
      }
    }
    if (layout === "network") {
      for (const frame of taxonomy.frames) {
        const placed = frame.conceptIds
          .map((id) => positions.get(id))
          .filter((p) => !!p);
        if (placed.length === 0) continue;
        const left = Math.min(...placed.map((p) => p.x));
        const right = Math.max(...placed.map((p) => p.x)) + CONCEPT_SIZE.width;
        const top = Math.min(...placed.map((p) => p.y));
        out.push({
          id: `region:${frame.id}`,
          type: "region",
          position: {
            x: (left + right) / 2 - REGION_LABEL.width / 2,
            y: top - REGION_LABEL.height,
          },
          width: REGION_LABEL.width,
          height: REGION_LABEL.height,
          measured: REGION_LABEL,
          data: {
            name: frame.scheme?.name ?? t("semanticMap.noScheme"),
            color: frame.scheme?.color ?? FALLBACK_SCHEME_COLOR,
            dim: frame.conceptIds.every((id) => toneOf(id) === "dim"),
          },
          draggable: false,
          selectable: false,
          focusable: false,
          zIndex: -1,
        });
      }
    }
    for (const concept of map.nodes) {
      const at = positions.get(concept.termId);
      if (!at) continue;
      out.push({
        id: concept.termId,
        type: "concept",
        position: at,
        width: CONCEPT_SIZE.width,
        height: CONCEPT_SIZE.height,
        measured: { width: CONCEPT_SIZE.width, height: CONCEPT_SIZE.height },
        data: {
          concept,
          maxAssets,
          tone: toneOf(concept.termId),
          inCase: caseTermIds?.has(concept.termId) ?? false,
        },
        ariaLabel: concept.name,
        selected: concept.termId === selectedId,
        draggable: layout === "network",
        zIndex: 2,
      });
    }
    return out;
  }, [
    map,
    layout,
    taxonomy,
    positions,
    maxAssets,
    toneOf,
    caseTermIds,
    selectedId,
    t,
  ]);

  const edges = React.useMemo<MeaningFlowEdge[]>(() => {
    if (!map) return [];
    const out: MeaningFlowEdge[] = [];
    const edgeTone = (a: string, b: string): Tone =>
      !focusId ? "normal" : a === focusId || b === focusId ? "focus" : "dim";
    if (layout === "taxonomy") {
      for (const [id, placed] of taxonomy.concepts) {
        if (!placed.parentId) continue;
        out.push({
          id: `tree:${placed.parentId}>${id}`,
          type: "tree",
          source: placed.parentId,
          target: id,
          data: { tone: edgeTone(placed.parentId, id) },
          selectable: false,
          focusable: false,
          zIndex: 1,
        });
      }
    }
    for (const link of map.links) {
      if (!positions.has(link.a) || !positions.has(link.b)) continue;
      const touchesFocus =
        !!focusId && (link.a === focusId || link.b === focusId);
      if (layout === "taxonomy") {
        // The outline already draws a concept's own parent.
        if (
          link.kind === "BROADER" &&
          taxonomy.concepts.get(link.a)?.parentId === link.b
        )
          continue;
        // Across frames, "found together" lines would be a web: only the focused concept's.
        if (link.kind === "CO_OCCURRENCE" && !touchesFocus) continue;
      }
      const coOccurrence = link.kind === "CO_OCCURRENCE";
      out.push({
        id: `${link.kind}:${link.a}:${link.b}:${link.label}`,
        type: "link",
        source: link.a,
        target: link.b,
        data: {
          kind: link.kind,
          tone: edgeTone(link.a, link.b),
          curved: layout === "taxonomy",
          weight: coOccurrence
            ? Math.min(
                1,
                Math.log(Math.max(1, link.lift ?? 1)) / Math.log(maxLift),
              )
            : 0,
          // Counts only while hovering: a selection lists them in the rail.
          label: coOccurrence
            ? hoveredId && touchesFocus
              ? t("semanticMap.together", {
                  count: link.assetCount.toLocaleString(),
                  lift: link.lift === null ? "–" : link.lift.toFixed(1),
                })
              : null
            : link.label || null,
        },
        selectable: false,
        focusable: false,
        zIndex: touchesFocus ? 3 : 1,
      });
    }
    return out;
  }, [map, layout, taxonomy, positions, focusId, hoveredId, maxLift, t]);

  // Fit the whole map whenever what is drawn (or how) changes — not when
  // only the case overlay or a selection does.
  const hasNodes = (map?.nodes.length ?? 0) > 0;
  React.useEffect(() => {
    if (keepView.current) {
      keepView.current = false;
      return;
    }
    if (!hasNodes || conceptFromUrl.current) return;
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.06, duration: 250, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, expanded, flow, hasNodes]);

  /**
   * Bring a concept into the part of the map the rail leaves visible: centred
   * and zoomed in when asked for by name, otherwise only if it is hidden.
   */
  const reveal = React.useCallback(
    (termId: string, centre: boolean) => {
      const at = positions.get(termId);
      const box = containerRef.current;
      if (!at || !box) return;
      const view = flow.getViewport();
      const zoom = centre ? Math.max(view.zoom, 0.95) : view.zoom;
      const width = Math.max(200, box.clientWidth - MEANING_RAIL_WIDTH);
      const height = box.clientHeight;
      const margin = 24;
      const left = at.x * zoom + view.x;
      const top = at.y * zoom + view.y;
      const inView =
        left >= margin &&
        top >= margin &&
        left + CONCEPT_SIZE.width * zoom <= width - margin &&
        top + CONCEPT_SIZE.height * zoom <= height - margin;
      if (!centre && inView) return;
      void flow.setViewport(
        {
          x: width / 2 - (at.x + CONCEPT_SIZE.width / 2) * zoom,
          y: height / 2 - (at.y + CONCEPT_SIZE.height / 2) * zoom,
          zoom,
        },
        { duration: 350 },
      );
    },
    [flow, positions],
  );

  const select = React.useCallback(
    (termId: string | null, centre = false) => {
      conceptFromUrl.current = null;
      setSelectedId(termId);
      if (termId) reveal(termId, centre);
    },
    [reveal],
  );

  // A concept named in the URL, or just added, is selected and centred once drawn.
  React.useEffect(() => {
    const key = conceptFromUrl.current ?? selectAfterLoad.current;
    if (!map || !key) return;
    const match = map.nodes.find((node) => node.key === key);
    // A concept just added shows up with the next map, not this one.
    if (!match && key === selectAfterLoad.current) return;
    selectAfterLoad.current = null;
    const frame = requestAnimationFrame(() =>
      select(match?.termId ?? null, !!match),
    );
    return () => cancelAnimationFrame(frame);
  }, [map, select]);

  const focusFrame = React.useCallback(
    (frameId: string) => {
      const frame = taxonomy.frames.find((f) => f.id === frameId);
      if (!frame) return;
      if (layout === "taxonomy") {
        void flow.fitBounds(
          { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          { padding: 0.12, duration: 350 },
        );
      } else {
        void flow.fitView({
          nodes: frame.conceptIds.map((id) => ({ id })),
          padding: 0.2,
          duration: 350,
        });
      }
    },
    [flow, layout, taxonomy.frames],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (adding || editor || relating) return;
      if (linkingFrom) setLinkingFrom(null);
      else if (selectedId) setSelectedId(null);
      else if (legendOpen) setLegendOpen(false);
      else if (expanded) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, legendOpen, expanded, adding, editor, relating, linkingFrom]);

  const onNodesChange = React.useCallback(
    (changes: NodeChange<MeaningFlowNode>[]) => {
      const moved = changes.filter(
        (
          change,
        ): change is Extract<
          NodeChange<MeaningFlowNode>,
          { type: "position" }
        > => change.type === "position" && !!change.position,
      );
      if (moved.length === 0) return;
      setDragged((previous) => {
        const next = new Map(previous);
        for (const change of moved) next.set(change.id, change.position!);
        return next;
      });
    },
    [],
  );

  const hits = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !map) return [];
    return map.nodes
      .filter(
        (node) =>
          node.name.toLowerCase().includes(needle) || node.key.includes(needle),
      )
      .sort((a, b) => b.totalAssetCount - a.totalAssetCount)
      .slice(0, SEARCH_HITS);
  }, [query, map]);

  // While relating, a concept found by name is the other end of the relation.
  const pick = (node: MapNode) => {
    if (linkingFrom) {
      if (node.termId !== linkingFrom.termId) setRelating({ from: linkingFrom, to: node });
      setLinkingFrom(null);
    } else {
      select(node.termId, true);
    }
    setQuery("");
    setSearchOpen(false);
  };

  async function rebuild() {
    setRebuilding(true);
    try {
      await rebuildSemanticMap();
      toast.success(t("semanticMap.rebuildQueued"));
    } catch (rebuildError) {
      toast.error(
        semanticErrorMessage(rebuildError, t("semanticMap.loadFailed")),
      );
    } finally {
      setRebuilding(false);
    }
  }

  /** "All …", the one picked by name, or how many are picked. */
  const chosenLabel = (
    ids: string[],
    options: Array<{ id: string; name: string }>,
    all: string,
    many: TranslationKey,
  ) =>
    ids.length === 0
      ? all
      : ids.length === 1
        ? (options.find((option) => option.id === ids[0])?.name ?? all)
        : t(many, { count: String(ids.length) });

  const actions = React.useMemo<MeaningMapActions>(
    () => ({
      editable,
      addConcept: (schemeId) =>
        setEditor({ term: null, schemeId, broaderOf: null }),
    }),
    [editable],
  );

  const railEditing = React.useMemo<RailEditing | null>(
    () =>
      editable
        ? {
            onEdit: (concept) => {
              getTerm(concept.key)
                .then((term) =>
                  setEditor({ term, schemeId: term.schemeId, broaderOf: null }),
                )
                .catch((loadError) =>
                  toast.error(
                    semanticErrorMessage(loadError, t("glossary.saveFailed")),
                  ),
                );
            },
            onAddNarrower: (concept) =>
              setEditor({
                term: null,
                schemeId: concept.scheme?.id ?? null,
                broaderOf: concept,
              }),
            onRelate: (concept) => setLinkingFrom(concept),
            onChanged: reload,
          }
        : null,
    [editable, reload, t],
  );

  async function saved(term: Term) {
    const broaderOf = editor?.broaderOf;
    if (broaderOf) {
      try {
        await createRelation({
          fromTermId: term.id,
          toTermId: broaderOf.termId,
          type: "BROADER",
        });
      } catch (relationError) {
        toast.error(
          semanticErrorMessage(relationError, t("glossary.relations.failed")),
        );
      }
    }
    toast.success(t("glossary.saved"));
    // A concept outside the current filters would not be drawn: show it anyway.
    if (minAssets > 0) setMinAssets(0);
    if (
      schemeIds.length > 0 &&
      term.schemeId &&
      !schemeIds.includes(term.schemeId)
    )
      setSchemeIds([]);
    selectAfterLoad.current = term.key;
    reload();
  }

  const lensCase = caseId ? (cases.find((c) => c.id === caseId) ?? null) : null;
  const shareUrl =
    typeof window === "undefined" || !selected
      ? ""
      : viewUrl({
          layout,
          conceptKey: selected.key,
          caseId,
          schemeIds,
          sourceIds,
          minAssets,
        }).toString();
  const schemeCount = taxonomy.frames.length;
  const showCanvas = !!map && (map.nodes.length > 0 || emptySchemes.length > 0);
  const railOpen = showCanvas && (!!selected || legendOpen);

  return (
    <>
      {expanded && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        />
      )}
      <PanelCard
        className={cn(
          "flex flex-col overflow-hidden p-0 sm:p-0",
          expanded
            ? "fixed inset-3 z-50 sm:inset-6"
            : (className ?? "h-[720px]"),
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-4 py-2.5">
          <p className="min-w-0 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {map
              ? t("semanticMap.subtitle", {
                  concepts: map.nodes.length.toLocaleString(),
                  schemes: String(schemeCount),
                })
              : t("semanticMap.loading")}
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hits[0]) pick(hits[0]);
                if (event.key === "Escape") {
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder={t("semanticMap.search")}
              aria-label={t("semanticMap.search")}
              className="h-7 w-[200px] rounded-[4px] border-2 border-border pl-7 text-xs"
              data-testid="meaning-search"
            />
            {searchOpen && hits.length > 0 && (
              <ul className="absolute left-0 top-full z-30 mt-1 w-[280px] overflow-hidden rounded-[4px] border-2 border-border bg-popover py-1 shadow-lg">
                {hits.map((node) => (
                  <li key={node.termId}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pick(node)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{
                          backgroundColor:
                            node.scheme?.color ?? FALLBACK_SCHEME_COLOR,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {node.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {node.totalAssetCount.toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <MultiSelect values={schemeIds} onValuesChange={setSchemeIds}>
              <MultiSelectTrigger className="h-7 w-[170px] rounded-[4px] border-2 border-border bg-background text-xs">
                <span className="min-w-0 truncate text-foreground">
                  {chosenLabel(
                    schemeIds,
                    schemes,
                    t("glossary.allSchemes"),
                    "semanticMap.schemesChosen",
                  )}
                </span>
              </MultiSelectTrigger>
              <MultiSelectContent
                search={{
                  placeholder: t("semanticMap.searchSchemes"),
                  emptyMessage: t("semanticMap.noMatches"),
                }}
              >
                <MultiSelectGroup>
                  {schemes.map((scheme) => (
                    <MultiSelectItem
                      key={scheme.id}
                      value={scheme.id}
                      badgeLabel={scheme.name}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2.5 rounded-[2px]"
                          style={{
                            backgroundColor:
                              scheme.color ?? FALLBACK_SCHEME_COLOR,
                          }}
                        />
                        {scheme.name}
                      </span>
                    </MultiSelectItem>
                  ))}
                </MultiSelectGroup>
              </MultiSelectContent>
            </MultiSelect>
            <MultiSelect values={sourceIds} onValuesChange={setSourceIds}>
              <MultiSelectTrigger className="h-7 w-[170px] rounded-[4px] border-2 border-border bg-background text-xs">
                <span className="min-w-0 truncate text-foreground">
                  {chosenLabel(
                    sourceIds,
                    sources,
                    t("semanticMap.allSources"),
                    "semanticMap.sourcesChosen",
                  )}
                </span>
              </MultiSelectTrigger>
              <MultiSelectContent
                search={{
                  placeholder: t("semanticMap.searchSources"),
                  emptyMessage: t("semanticMap.noMatches"),
                }}
              >
                <MultiSelectGroup>
                  {sources.map((source) => (
                    <MultiSelectItem
                      key={source.id}
                      value={source.id}
                      badgeLabel={source.name}
                    >
                      {source.name}
                    </MultiSelectItem>
                  ))}
                </MultiSelectGroup>
              </MultiSelectContent>
            </MultiSelect>
            <Select
              value={caseId ?? "none"}
              onValueChange={(value) =>
                setCaseId(value === "none" ? null : value)
              }
            >
              <SelectTrigger
                className={cn(
                  "h-7 w-[180px] rounded-[4px] border-2 text-xs",
                  caseId ? "border-[var(--accent)]" : "border-border",
                )}
                aria-label={t("semanticMap.highlightCase")}
              >
                <SelectValue placeholder={t("semanticMap.highlightCase")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("semanticMap.noCase")}</SelectItem>
                {cases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-[11px]">
              <span className={MICRO_LABEL}>{t("semanticMap.minAssets")}</span>
              <Input
                type="number"
                min={0}
                value={minAssets}
                onChange={(event) =>
                  setMinAssets(Math.max(0, Number(event.target.value) || 0))
                }
                className="h-7 w-16 rounded-[4px] border-2 border-border text-xs"
              />
            </label>
            <div
              className="flex rounded-[4px] border-2 border-border"
              role="radiogroup"
              aria-label={t("semanticMap.layout")}
            >
              {(["taxonomy", "network"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={layout === value}
                  onClick={() => setLayout(value)}
                  className={cn(
                    "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                    layout === value
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {t(`semanticMap.layouts.${value}` as TranslationKey)}
                </button>
              ))}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={
                expanded ? t("semanticMap.collapse") : t("semanticMap.expand")
              }
              title={
                expanded ? t("semanticMap.collapse") : t("semanticMap.expand")
              }
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <Minimize className="h-3.5 w-3.5" />
              ) : (
                <Maximize className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div
            ref={containerRef}
            className="relative min-w-0 flex-1"
            data-testid="meaning-canvas"
          >
            {error ? (
              <p className="p-4 text-xs text-destructive">{error}</p>
            ) : !map ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : map.empty === "NO_CONCEPTS" && !showCanvas ? (
              <EmptyState
                icon={Shapes}
                title={t("semanticMap.empty.noConcepts")}
                description={t("semanticMap.empty.noConceptsHint")}
                action={
                  editable
                    ? {
                        label: t("semanticMap.edit.addConcept"),
                        onClick: () => actions.addConcept(null),
                      }
                    : {
                        label: t("semanticMap.empty.openGlossary"),
                        onClick: () => router.push(nsPath("/glossary")),
                      }
                }
              />
            ) : !showCanvas ? (
              <EmptyState
                icon={Shapes}
                title={t("semanticMap.empty.noLinks")}
                description={t("semanticMap.empty.noLinksHint")}
                action={{
                  label: t("semanticMap.empty.bindOutputs"),
                  onClick: () =>
                    router.push(nsPath("/glossary?tab=vocabulary")),
                }}
              />
            ) : (
              <MeaningMapActionsContext.Provider value={actions}>
                <ReactFlow<MeaningFlowNode, MeaningFlowEdge>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={MEANING_NODE_TYPES}
                  edgeTypes={MEANING_EDGE_TYPES}
                  onNodesChange={onNodesChange}
                  onNodeClick={(_, node) => {
                    if (node.type === "concept" && linkingFrom) {
                      if (node.id !== linkingFrom.termId)
                        setRelating({
                          from: linkingFrom,
                          to: node.data.concept,
                        });
                      setLinkingFrom(null);
                    } else if (node.type === "concept")
                      select(node.id === selectedId ? null : node.id);
                    else if (node.type === "scheme") focusFrame(node.id);
                  }}
                  onNodeDoubleClick={(_, node) => {
                    if (node.type === "concept")
                      router.push(termHref(node.data.concept.key));
                  }}
                  onNodeMouseEnter={(_, node) =>
                    node.type === "concept" && setHoveredId(node.id)
                  }
                  onNodeMouseLeave={(_, node) =>
                    node.type === "concept" &&
                    setHoveredId((id) => (id === node.id ? null : id))
                  }
                  onPaneClick={() =>
                    linkingFrom ? setLinkingFrom(null) : select(null)
                  }
                  nodesConnectable={false}
                  nodesFocusable
                  edgesFocusable={false}
                  elementsSelectable
                  selectNodesOnDrag={false}
                  deleteKeyCode={null}
                  onlyRenderVisibleElements
                  minZoom={0.12}
                  maxZoom={2}
                  proOptions={{ hideAttribution: true }}
                  colorMode={resolvedTheme === "dark" ? "dark" : "light"}
                  aria-label={t("semanticMap.title")}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={24}
                    size={1}
                  />
                  {lensCase && caseTermIds && (
                    <Panel position="top-left">
                      <div className="flex items-center gap-2 rounded-[4px] border-2 border-[var(--accent)] bg-card px-2.5 py-1 text-xs shadow-sm">
                        <span
                          className="size-2 rounded-full bg-[var(--accent)]"
                          aria-hidden
                        />
                        <span className="max-w-[260px] truncate">
                          {t("semanticMap.caseLens", {
                            title: lensCase.title,
                            count: String(caseTermIds.size),
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              nsPath(`/investigations/${lensCase.id}`),
                            )
                          }
                          className="font-mono text-[10px] uppercase tracking-[0.1em] underline"
                        >
                          {t("caseTarget.openCase")}
                        </button>
                        <button
                          type="button"
                          aria-label={t("common.close")}
                          onClick={() => setCaseId(null)}
                          className="rounded-[2px] p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </Panel>
                  )}
                  {linkingFrom && (
                    <Panel position="top-center">
                      <div
                        className="flex items-center gap-2 rounded-[4px] border-2 border-foreground bg-card px-3 py-1.5 text-xs shadow-sm"
                        data-testid="meaning-linking"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        {t("semanticMap.edit.pickOther", {
                          concept: linkingFrom.name,
                        })}
                        <button
                          type="button"
                          aria-label={t("common.cancel")}
                          onClick={() => setLinkingFrom(null)}
                          className="rounded-[2px] p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </Panel>
                  )}
                  {loading && !linkingFrom && (
                    <Panel position="top-center">
                      <span className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("semanticMap.loading")}
                      </span>
                    </Panel>
                  )}
                  <Panel position="bottom-left">
                    <div className="flex overflow-hidden rounded-[4px] border-2 border-border bg-card">
                      {(
                        [
                          [
                            Plus,
                            "semanticMap.zoomIn",
                            () => void flow.zoomIn({ duration: 200 }),
                          ],
                          [
                            Minus,
                            "semanticMap.zoomOut",
                            () => void flow.zoomOut({ duration: 200 }),
                          ],
                          [
                            ScanSearch,
                            "semanticMap.fit",
                            () =>
                              void flow.fitView({
                                padding: 0.06,
                                duration: 300,
                                maxZoom: 1.1,
                              }),
                          ],
                          [
                            BookOpen,
                            "semanticMap.legend",
                            () => setLegendOpen((open) => !open),
                          ],
                        ] as const
                      ).map(([Icon, label, onClick]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={onClick}
                          aria-label={t(label)}
                          title={t(label)}
                          className="border-r border-border p-1.5 last:border-r-0 hover:bg-muted"
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </div>
                  </Panel>
                  {map.nodes.length > 30 && !railOpen && (
                    <MiniMap<MeaningFlowNode>
                      pannable
                      zoomable
                      position="bottom-right"
                      className="!h-[96px] !w-[150px] !border-2 !border-border !bg-card"
                      style={{ width: 150, height: 96 }}
                      nodeColor={(node) =>
                        node.type === "concept"
                          ? (node.data.concept.scheme?.color ??
                            FALLBACK_SCHEME_COLOR)
                          : "transparent"
                      }
                      nodeStrokeWidth={3}
                      nodeStrokeColor={(node) =>
                        node.type === "scheme" ? "var(--border)" : "transparent"
                      }
                      maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
                    />
                  )}
                </ReactFlow>
              </MeaningMapActionsContext.Provider>
            )}
            {map && map.empty === "NO_LINKS" && showCanvas && (
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-2">
                <span className="pointer-events-auto rounded-[4px] border border-border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground">
                  {t("semanticMap.empty.noLinks")}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(nsPath("/glossary?tab=vocabulary"))
                    }
                    className="text-foreground underline"
                  >
                    {t("semanticMap.empty.bindOutputs")}
                  </button>
                </span>
              </div>
            )}
            {map && map.unbound.outputs > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
                <span className="pointer-events-auto rounded-[4px] border border-border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground">
                  {t("semanticMap.unbound", {
                    outputs: map.unbound.outputs.toLocaleString(),
                    findings: map.unbound.findings.toLocaleString(),
                  })}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(nsPath("/glossary?tab=vocabulary"))
                    }
                    className="text-foreground underline"
                  >
                    {t("semanticMap.review")}
                  </button>
                </span>
              </div>
            )}
          </div>

          {map && railOpen && (
            <MeaningMapRail
              map={map}
              frames={taxonomy.frames}
              selected={selected}
              nodesById={nodesById}
              caseId={caseId}
              onSelect={(termId) => select(termId, !!termId)}
              onFocusFrame={focusFrame}
              onAddToCase={setAdding}
              onRebuild={() => void rebuild()}
              rebuilding={rebuilding}
              shareUrl={shareUrl}
              onCloseLegend={() => setLegendOpen(false)}
              editing={railEditing}
            />
          )}
        </div>
      </PanelCard>
      <TermEditorDialog
        open={!!editor}
        onOpenChange={(open) => !open && setEditor(null)}
        term={editor?.term ?? null}
        defaultSchemeId={editor?.schemeId ?? null}
        onSaved={(term) => void saved(term)}
      />
      <RelateDialog
        from={relating?.from ?? null}
        to={relating?.to ?? null}
        onOpenChange={(open) => !open && setRelating(null)}
        onRelated={reload}
      />
      <AddConceptToCaseDialog
        open={!!adding}
        onOpenChange={(open) => !open && setAdding(null)}
        concept={
          adding
            ? { id: adding.termId, key: adding.key, name: adding.name }
            : null
        }
        defaultCase={lensCase}
      />
    </>
  );
}
