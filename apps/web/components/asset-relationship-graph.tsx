"use client";

import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import { Grid2X2, Target, Waypoints } from "lucide-react";
import type { AssetListItemDto } from "@workspace/api-client";
import {
  Badge,
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { EChartBox } from "@/components/echart-box";

type AtlasView = "matrix" | "source_map" | "focus";
type DensityMode = "compact" | "balanced" | "expanded";

type AssetNode = {
  id: string;
  name: string;
  sourceKey: string;
  sourceLabel: string;
  sourceType: string;
  category: number;
  value: number;
  symbolSize: number;
  status?: string;
  externalUrl?: string;
  inbound: number;
  outbound: number;
  x?: number;
  y?: number;
  label?: unknown;
};

type AssetEdge = {
  source: string;
  target: string;
  value: number;
};

type SourceStat = {
  key: string;
  label: string;
  assetCount: number;
  inCount: number;
  outCount: number;
  totalDegree: number;
};

type ThemeColors = {
  chart: string[];
  foreground: string;
  mutedForeground: string;
  border: string;
};

const FALLBACK_THEME_COLORS: ThemeColors = {
  chart: ["#0a0a0a", "#ff2b2b", "#b7ff00", "#0ea5e9", "#7c7c7c"],
  foreground: "#0a0a0a",
  mutedForeground: "#7c7c7c",
  border: "#0a0a0a",
};

const OTHER_BUCKET = "OTHER";
const REFERENCED_BUCKET = "REFERENCED";
const SOURCE_LIMIT = 20;

const DENSITY = {
  compact: { focusCoreCap: 12, focusNeighborCap: 80, focusEdgeCap: 180 },
  balanced: { focusCoreCap: 22, focusNeighborCap: 180, focusEdgeCap: 540 },
  expanded: { focusCoreCap: 38, focusNeighborCap: 320, focusEdgeCap: 1200 },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortHash(value: string, size = 10) {
  if (value.length <= size) return value;
  return `${value.slice(0, size)}...`;
}

function hash01(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function orbit(index: number, total: number, radius: number, shift = 0) {
  if (total <= 0) return { x: 0, y: 0 };
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2 + shift;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function getDisplayName(asset: AssetListItemDto) {
  return (
    asset.name?.trim() || asset.externalUrl?.trim() || shortHash(asset.hash, 14)
  );
}

function getUpdatedAt(asset: AssetListItemDto) {
  const raw = asset.updatedAt ?? asset.createdAt;
  const value = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(value.getTime())) return 0;
  return value.getTime();
}

function getCssVarValue(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
) {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function resolveThemeColors(): ThemeColors {
  if (typeof window === "undefined") {
    return FALLBACK_THEME_COLORS;
  }

  const styles = getComputedStyle(document.documentElement);
  return {
    chart: [
      getCssVarValue(styles, "--chart-1", FALLBACK_THEME_COLORS.chart[0]!),
      getCssVarValue(styles, "--chart-2", FALLBACK_THEME_COLORS.chart[1]!),
      getCssVarValue(styles, "--chart-3", FALLBACK_THEME_COLORS.chart[2]!),
      getCssVarValue(styles, "--chart-4", FALLBACK_THEME_COLORS.chart[3]!),
      getCssVarValue(styles, "--chart-5", FALLBACK_THEME_COLORS.chart[4]!),
    ],
    foreground: getCssVarValue(
      styles,
      "--foreground",
      FALLBACK_THEME_COLORS.foreground,
    ),
    mutedForeground: getCssVarValue(
      styles,
      "--muted-foreground",
      FALLBACK_THEME_COLORS.mutedForeground,
    ),
    border: getCssVarValue(styles, "--border", FALLBACK_THEME_COLORS.border),
  };
}

export function AssetRelationshipGraph({
  assets,
  className,
  maxNodes = 900,
  maxReferencedNodes = 700,
}: {
  assets: AssetListItemDto[];
  className?: string;
  maxNodes?: number;
  maxReferencedNodes?: number;
}) {
  const [themeColors, setThemeColors] = useState<ThemeColors>(() =>
    resolveThemeColors(),
  );
  const [view, setView] = useState<AtlasView>("matrix");
  const [density, setDensity] = useState<DensityMode>("balanced");
  const [focusSource, setFocusSource] = useState<string>("ALL");

  useEffect(() => {
    const root = document.documentElement;
    const refreshColors = () => setThemeColors(resolveThemeColors());
    refreshColors();

    const observer = new MutationObserver(() => refreshColors());
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  const graph = useMemo(() => {
    const rankedAssets = [...assets].sort((a, b) => {
      const linkDelta = (b.links?.length ?? 0) - (a.links?.length ?? 0);
      if (linkDelta !== 0) return linkDelta;
      return getUpdatedAt(b) - getUpdatedAt(a);
    });
    const selectedAssets = rankedAssets.slice(0, Math.max(1, maxNodes));
    const selectedCount = selectedAssets.length;

    const sourceCounts = new Map<string, number>();
    for (const asset of selectedAssets) {
      const sourceId = asset.sourceId || OTHER_BUCKET;
      sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
    }
    const topSources = Array.from(sourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, SOURCE_LIMIT)
      .map(([key]) => key);
    const topSet = new Set(topSources);

    const normalizeSourceKey = (
      sourceId?: string | null,
      isReferenced = false,
    ) => {
      if (isReferenced) return REFERENCED_BUCKET;
      const key = sourceId || OTHER_BUCKET;
      if (key === OTHER_BUCKET) return OTHER_BUCKET;
      return topSet.has(key) ? key : OTHER_BUCKET;
    };

    const allByHash = new Map(assets.map((asset) => [asset.hash, asset]));
    const allByExternal = new Map(
      assets
        .filter(
          (asset) =>
            typeof asset.externalUrl === "string" &&
            asset.externalUrl.length > 0,
        )
        .map((asset) => [asset.externalUrl, asset]),
    );

    const categoryIndex = new Map<string, number>();
    const getCategory = (name: string) => {
      if (!categoryIndex.has(name)) categoryIndex.set(name, categoryIndex.size);
      return categoryIndex.get(name) ?? 0;
    };

    const nodes = new Map<string, AssetNode>();
    for (const asset of selectedAssets) {
      const sourceKey = normalizeSourceKey(asset.sourceId, false);
      const sourceLabel =
        sourceKey === OTHER_BUCKET
          ? "Other sources"
          : `${asset.sourceType || "UNKNOWN"}:${sourceKey.slice(0, 8)}`;
      nodes.set(asset.hash, {
        id: asset.hash,
        name: getDisplayName(asset),
        sourceKey,
        sourceLabel,
        sourceType: asset.sourceType || "UNKNOWN",
        category: getCategory(asset.sourceType || "UNKNOWN"),
        value: 0,
        symbolSize: 8,
        status: asset.status,
        externalUrl: asset.externalUrl,
        inbound: 0,
        outbound: 0,
      });
    }

    const edges: AssetEdge[] = [];
    const edgeKeys = new Set<string>();
    let referencedCreated = 0;

    for (const sourceAsset of selectedAssets) {
      for (const rawLink of sourceAsset.links ?? []) {
        const link = rawLink?.toString().trim();
        if (!link) continue;

        const targetAsset = allByHash.get(link) ?? allByExternal.get(link);
        const targetId = targetAsset?.hash ?? link;
        if (!targetId || targetId === sourceAsset.hash) continue;

        if (!nodes.has(targetId)) {
          if (referencedCreated >= maxReferencedNodes) continue;
          const sourceKey = normalizeSourceKey(targetAsset?.sourceId, true);
          const sourceLabel =
            sourceKey === REFERENCED_BUCKET
              ? "Referenced"
              : `${targetAsset?.sourceType || "UNKNOWN"}:${sourceKey.slice(0, 8)}`;
          nodes.set(targetId, {
            id: targetId,
            name: targetAsset
              ? getDisplayName(targetAsset)
              : `Referenced ${shortHash(targetId)}`,
            sourceKey,
            sourceLabel,
            sourceType: targetAsset?.sourceType || REFERENCED_BUCKET,
            category: getCategory(targetAsset?.sourceType || REFERENCED_BUCKET),
            value: 0,
            symbolSize: 7,
            status: targetAsset?.status,
            externalUrl: targetAsset?.externalUrl,
            inbound: 0,
            outbound: 0,
          });
          referencedCreated += 1;
        }

        const edgeKey = `${sourceAsset.hash}=>${targetId}`;
        if (edgeKeys.has(edgeKey)) continue;
        edgeKeys.add(edgeKey);
        edges.push({ source: sourceAsset.hash, target: targetId, value: 1 });

        const sourceNode = nodes.get(sourceAsset.hash);
        const targetNode = nodes.get(targetId);
        if (sourceNode) sourceNode.outbound += 1;
        if (targetNode) targetNode.inbound += 1;
      }
    }

    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    }

    for (const node of nodes.values()) {
      node.value = node.inbound + node.outbound;
      node.symbolSize =
        node.sourceKey === REFERENCED_BUCKET
          ? clamp(6 + Math.sqrt(Math.max(0, node.value)) * 1.15, 6, 13)
          : clamp(8 + Math.sqrt(Math.max(1, node.value)) * 2.9, 8, 22);
    }

    const sourceStatsMap = new Map<string, SourceStat>();
    for (const node of nodes.values()) {
      const current = sourceStatsMap.get(node.sourceKey) ?? {
        key: node.sourceKey,
        label:
          node.sourceKey === OTHER_BUCKET
            ? "Other sources"
            : node.sourceKey === REFERENCED_BUCKET
              ? "Referenced"
              : node.sourceLabel,
        assetCount: 0,
        inCount: 0,
        outCount: 0,
        totalDegree: 0,
      };
      current.assetCount += 1;
      current.inCount += node.inbound;
      current.outCount += node.outbound;
      current.totalDegree += node.value;
      sourceStatsMap.set(node.sourceKey, current);
    }

    const sourceStats = Array.from(sourceStatsMap.values()).sort(
      (a, b) => b.assetCount - a.assetCount,
    );
    const sourcePairCount = new Map<string, number>();
    for (const edge of edges) {
      const sourceKey = nodes.get(edge.source)?.sourceKey;
      const targetKey = nodes.get(edge.target)?.sourceKey;
      if (!sourceKey || !targetKey) continue;
      const key = `${sourceKey}=>${targetKey}`;
      sourcePairCount.set(key, (sourcePairCount.get(key) ?? 0) + 1);
    }

    const categories = Array.from(categoryIndex.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => ({ name }));

    const assetsWithLinks = selectedAssets.filter(
      (a) => (a.links?.length ?? 0) > 0,
    ).length;
    const hiddenAssets = Math.max(0, assets.length - selectedCount);

    return {
      nodes: Array.from(nodes.values()),
      edges,
      categories,
      sourceStats,
      sourcePairCount,
      adjacency,
      assetsWithLinks,
      hiddenAssets,
      selectedCount,
    };
  }, [assets, maxNodes, maxReferencedNodes]);

  useEffect(() => {
    if (graph.sourceStats.length === 0) {
      setFocusSource("ALL");
      return;
    }
    if (focusSource === "ALL") return;
    const exists = graph.sourceStats.some((item) => item.key === focusSource);
    if (!exists) {
      setFocusSource(graph.sourceStats[0]?.key ?? "ALL");
    }
  }, [focusSource, graph.sourceStats]);

  const matrixOption = useMemo<echarts.EChartsCoreOption>(() => {
    const labels = graph.sourceStats.map((item) => item.label);
    const keyIndex = new Map(graph.sourceStats.map((item, i) => [item.key, i]));
    const data: Array<[number, number, number]> = [];
    let maxValue = 1;

    for (const [key, count] of graph.sourcePairCount.entries()) {
      const parts = key.split("=>");
      const sourceKey = parts[0];
      const targetKey = parts[1];
      if (!sourceKey || !targetKey) continue;
      const x = keyIndex.get(sourceKey);
      const y = keyIndex.get(targetKey);
      if (x === undefined || y === undefined) continue;
      data.push([x, y, count]);
      if (count > maxValue) maxValue = count;
    }

    return {
      grid: { left: 90, right: 20, top: 44, bottom: 90 },
      tooltip: { trigger: "item" },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: themeColors.border } },
        axisLabel: {
          interval: 0,
          rotate: 34,
          fontSize: 10,
          color: themeColors.foreground,
        },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: themeColors.border } },
        axisLabel: { interval: 0, fontSize: 10, color: themeColors.foreground },
      },
      visualMap: {
        min: 0,
        max: maxValue,
        left: "center",
        bottom: 24,
        orient: "horizontal",
        calculable: true,
        inRange: {
          color: [
            themeColors.mutedForeground,
            themeColors.chart[4],
            themeColors.chart[3],
            themeColors.chart[1],
          ],
        },
        textStyle: { color: themeColors.foreground },
      },
      series: [
        {
          type: "heatmap",
          data,
          progressive: 3000,
          emphasis: {
            itemStyle: {
              borderColor: themeColors.foreground,
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [graph.sourcePairCount, graph.sourceStats, themeColors]);

  const sourceMapOption = useMemo<echarts.EChartsCoreOption>(() => {
    const sourceNodes = graph.sourceStats.map((source, index) => ({
      id: source.key,
      name: source.label,
      value: source.assetCount,
      symbolSize: clamp(16 + Math.sqrt(source.assetCount) * 8, 16, 64),
      category: index,
    }));
    const keyToLabel = new Map(
      graph.sourceStats.map((source) => [source.key, source.label]),
    );
    const rawEdges = Array.from(graph.sourcePairCount.entries())
      .map(([pairKey, count]) => {
        const pairParts = pairKey.split("=>");
        const sourceKey = pairParts[0];
        const targetKey = pairParts[1];
        if (!sourceKey || !targetKey) return null;
        const sourceLabel = keyToLabel.get(sourceKey);
        const targetLabel = keyToLabel.get(targetKey);
        if (!sourceLabel || !targetLabel) return null;
        return { source: sourceLabel, target: targetLabel, value: count };
      })
      .filter(
        (edge): edge is { source: string; target: string; value: number } =>
          Boolean(edge),
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, 400);

    const maxWeight = rawEdges.reduce(
      (acc, edge) => Math.max(acc, edge.value),
      1,
    );

    return {
      tooltip: { trigger: "item" },
      legend: {
        show: false,
      },
      series: [
        {
          type: "graph",
          layout: "force",
          roam: true,
          roamTrigger: "global",
          scaleLimit: { min: 0.3, max: 6 },
          draggable: true,
          data: sourceNodes,
          edges: rawEdges,
          force: {
            edgeLength: [60, 220],
            repulsion: 340,
            gravity: 0.12,
          },
          label: {
            show: true,
            color: themeColors.foreground,
            fontSize: 11,
            formatter: "{b}",
          },
          lineStyle: {
            color: "source",
            opacity: 0.42,
            width: 1,
            curveness: 0.2,
          },
          edgeLabel: {
            show: false,
          },
          emphasis: {
            disabled: true,
          },
          categories: sourceNodes.map((node, index) => ({
            name: node.name,
            itemStyle: {
              color: themeColors.chart[index % themeColors.chart.length],
            },
          })),
          visualMap: undefined,
        },
      ],
      graphic: rawEdges.slice(0, 1).map((edge) => ({
        type: "text",
        right: 18,
        top: 12,
        style: {
          text: `Max flow: ${edge.value}/${maxWeight}`,
          fill: themeColors.mutedForeground,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
        },
      })),
    };
  }, [graph.sourcePairCount, graph.sourceStats, themeColors]);

  const focusOption = useMemo<echarts.EChartsCoreOption>(() => {
    const cfg = DENSITY[density];
    const allNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const filteredSource =
      focusSource === "ALL" ? graph.sourceStats[0]?.key : focusSource;

    const core = graph.nodes
      .filter((node) =>
        filteredSource ? node.sourceKey === filteredSource : true,
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, cfg.focusCoreCap);

    const visible = new Set(core.map((node) => node.id));
    const neighbors: AssetNode[] = [];

    for (const coreNode of core) {
      const adjacent = Array.from(graph.adjacency.get(coreNode.id) ?? [])
        .map((id) => allNodesById.get(id))
        .filter((node): node is AssetNode => Boolean(node))
        .sort((a, b) => b.value - a.value);
      for (const node of adjacent) {
        if (visible.has(node.id)) continue;
        if (neighbors.length >= cfg.focusNeighborCap) break;
        visible.add(node.id);
        neighbors.push(node);
      }
      if (neighbors.length >= cfg.focusNeighborCap) break;
    }

    const coreNodes = core.map((node, index) => {
      const pos = orbit(
        index,
        Math.max(core.length, 1),
        120,
        hash01(node.id) * 0.2,
      );
      return {
        ...node,
        x: pos.x,
        y: pos.y,
        symbolSize: clamp(node.symbolSize + 8, 16, 34),
        label: {
          show: true,
          position: "right",
          formatter: "{b}",
          color: themeColors.foreground,
          fontSize: 10,
        },
      };
    });

    const neighborGroups = new Map<string, AssetNode[]>();
    for (const node of neighbors) {
      const key = node.sourceKey;
      if (!neighborGroups.has(key)) neighborGroups.set(key, []);
      neighborGroups.get(key)?.push(node);
    }

    const groupedKeys = Array.from(neighborGroups.keys()).sort((a, b) => {
      const ac = neighborGroups.get(a)?.length ?? 0;
      const bc = neighborGroups.get(b)?.length ?? 0;
      return bc - ac;
    });

    const outerNodes: AssetNode[] = [];
    const totalNeighbors = neighbors.length;
    const groupCount = Math.max(1, groupedKeys.length);
    let cursor = -Math.PI / 2;
    const gap = 0.08;

    for (const key of groupedKeys) {
      const group = neighborGroups.get(key) ?? [];
      const arc =
        totalNeighbors === 0
          ? 0
          : ((Math.PI * 2 - groupCount * gap) * group.length) / totalNeighbors;
      group.forEach((node, idx) => {
        const t = (idx + 0.5) / Math.max(1, group.length);
        const angle = cursor + arc * t;
        const jitter = (hash01(node.id) - 0.5) * 40;
        const radius = 320 + jitter;
        outerNodes.push({
          ...node,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          symbolSize: clamp(node.symbolSize + 3, 10, 22),
          label: {
            show: node.value > 8,
            position: "right",
            formatter: "{b}",
            color: themeColors.foreground,
            fontSize: 10,
          },
        });
      });
      cursor += arc + gap;
    }

    const nodes = [...coreNodes, ...outerNodes];
    const visibleSet = new Set(nodes.map((node) => node.id));
    const edges = graph.edges
      .filter(
        (edge) => visibleSet.has(edge.source) && visibleSet.has(edge.target),
      )
      .sort((a, b) => {
        const av =
          (allNodesById.get(a.source)?.value ?? 0) +
          (allNodesById.get(a.target)?.value ?? 0);
        const bv =
          (allNodesById.get(b.source)?.value ?? 0) +
          (allNodesById.get(b.target)?.value ?? 0);
        return bv - av;
      })
      .slice(0, cfg.focusEdgeCap);

    return {
      tooltip: { trigger: "item" },
      series: [
        {
          type: "graph",
          layout: "none",
          data: nodes,
          links: edges,
          roam: true,
          roamTrigger: "global",
          scaleLimit: { min: 0.2, max: 6 },
          lineStyle: {
            color: "source",
            width: 1,
            opacity: 0.35,
            curveness: 0.16,
          },
          labelLayout: { hideOverlap: true },
          emphasis: {
            disabled: true,
          },
          categories: graph.categories.map((category, index) => ({
            ...category,
            itemStyle: {
              color:
                category.name === REFERENCED_BUCKET
                  ? themeColors.mutedForeground
                  : themeColors.chart[index % themeColors.chart.length],
            },
          })),
        },
      ],
      graphic: [
        {
          type: "circle",
          shape: { cx: 0, cy: 0, r: 140 },
          left: "center",
          top: "middle",
          style: {
            fill: "transparent",
            stroke: themeColors.mutedForeground,
            lineWidth: 1,
            opacity: 0.2,
          },
          silent: true,
        },
        {
          type: "circle",
          shape: { cx: 0, cy: 0, r: 340 },
          left: "center",
          top: "middle",
          style: {
            fill: "transparent",
            stroke: themeColors.mutedForeground,
            lineWidth: 1,
            opacity: 0.14,
          },
          silent: true,
        },
      ],
    };
  }, [
    density,
    focusSource,
    graph.adjacency,
    graph.categories,
    graph.edges,
    graph.nodes,
    graph.sourceStats,
    themeColors,
  ]);

  const activeOption =
    view === "matrix"
      ? matrixOption
      : view === "source_map"
        ? sourceMapOption
        : focusOption;

  if (graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={Waypoints}
        title="No relationship data"
        description="Assets are available but there are no links to visualize."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[8px] border-2 border-black bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-2"
              variant={view === "matrix" ? "default" : "outline"}
              onClick={() => setView("matrix")}
            >
              <Grid2X2 className="h-4 w-4" />
              Matrix
            </Button>
            <Button
              size="sm"
              className="gap-2"
              variant={view === "source_map" ? "default" : "outline"}
              onClick={() => setView("source_map")}
            >
              <Waypoints className="h-4 w-4" />
              Source Map
            </Button>
            <Button
              size="sm"
              className="gap-2"
              variant={view === "focus" ? "default" : "outline"}
              onClick={() => setView("focus")}
            >
              <Target className="h-4 w-4" />
              Focus Ring
            </Button>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-[420px]">
            <Select
              value={density}
              onValueChange={(value) => setDensity(value as DensityMode)}
            >
              <SelectTrigger className="border-2 border-black rounded-[4px]">
                <SelectValue placeholder="Density" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="expanded">Expanded</SelectItem>
              </SelectContent>
            </Select>
            <Select value={focusSource} onValueChange={setFocusSource}>
              <SelectTrigger className="border-2 border-black rounded-[4px]">
                <SelectValue placeholder="Focus source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Auto focus</SelectItem>
                {graph.sourceStats.map((source) => (
                  <SelectItem key={source.key} value={source.key}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em]">
        <Badge variant="outline">
          Nodes: {graph.nodes.length.toLocaleString()}
        </Badge>
        <Badge variant="outline">
          Edges: {graph.edges.length.toLocaleString()}
        </Badge>
        <Badge variant="outline">
          Sources: {graph.sourceStats.length.toLocaleString()}
        </Badge>
        <Badge variant="outline">View: {view}</Badge>
        <Badge variant="outline">
          Assets with links: {graph.assetsWithLinks.toLocaleString()}
        </Badge>
        {graph.hiddenAssets > 0 && (
          <Badge variant="secondary">
            Showing top {graph.selectedCount.toLocaleString()} assets (
            {graph.hiddenAssets.toLocaleString()} hidden)
          </Badge>
        )}
      </div>

      <EChartBox
        option={activeOption}
        className={cn("h-[660px] w-full", className)}
      />
    </div>
  );
}
