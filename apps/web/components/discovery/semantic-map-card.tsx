"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCw, Shapes, X } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { EChartBox } from "@/components/echart-box";
import { PanelCard } from "@/components/panel-card";
import { MICRO_LABEL, useTermHref } from "@/components/glossary/glossary-ui";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useNsPath } from "@/lib/ns-path";
import {
  getSemanticMap,
  listSchemes,
  rebuildSemanticMap,
  semanticErrorMessage,
  type MapNode,
  type Scheme,
  type SemanticMap,
} from "@/lib/semantic-api";

type Layout = "taxonomy" | "network";

const FALLBACK_COLOR = "#94a3b8";

/**
 * Layered positions for the taxonomy layout: broader concepts above their
 * narrower ones. Depth is the longest BROADER chain inside the drawn set.
 */
function taxonomyPositions(nodes: MapNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.termId, node]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = byId.get(id);
    const parents = (node?.broaderIds ?? []).filter((parent) => byId.has(parent));
    const value = parents.length
      ? 1 + Math.max(...parents.map((parent) => depthOf(parent, seen)))
      : 0;
    depth.set(id, value);
    return value;
  };
  for (const node of nodes) depthOf(node.termId, new Set());
  const levels = new Map<number, MapNode[]>();
  for (const node of nodes) {
    const level = depth.get(node.termId) ?? 0;
    levels.set(level, [...(levels.get(level) ?? []), node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, members] of levels) {
    // Keep siblings together: sort by first parent, then by size.
    members.sort(
      (a, b) =>
        (a.broaderIds[0] ?? "").localeCompare(b.broaderIds[0] ?? "") ||
        b.totalAssetCount - a.totalAssetCount,
    );
    members.forEach((node, index) => {
      positions.set(node.termId, {
        x: (index - (members.length - 1) / 2) * 140,
        y: level * 120,
      });
    });
  }
  return positions;
}

/**
 * The semantic map (SL5 Part B): APPROVED concepts sized by their evidence,
 * coloured by scheme, connected by the taxonomy and — optionally — by
 * co-occurrence on the same assets.
 */
export function SemanticMapCard({ headerSlot }: { headerSlot?: React.ReactNode }) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const router = useRouter();
  const termHref = useTermHref();
  const [layout, setLayout] = React.useState<Layout>("taxonomy");
  const [schemeId, setSchemeId] = React.useState<string>("all");
  const [minAssets, setMinAssets] = React.useState(1);
  const [cooccurrence, setCooccurrence] = React.useState(false);
  const [schemes, setSchemes] = React.useState<Scheme[]>([]);
  const [map, setMap] = React.useState<SemanticMap | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<MapNode | null>(null);
  const [rebuilding, setRebuilding] = React.useState(false);

  React.useEffect(() => {
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
  }, []);

  React.useEffect(() => {
    let active = true;
    setError(null);
    getSemanticMap({
      schemeIds: schemeId === "all" ? undefined : [schemeId],
      minAssets,
      cooccurrence,
    })
      .then((result) => {
        if (active) setMap(result);
      })
      .catch((loadError) => {
        if (active) setError(semanticErrorMessage(loadError, t("semanticMap.loadFailed")));
      });
    return () => {
      active = false;
    };
  }, [schemeId, minAssets, cooccurrence, t]);

  const option = React.useMemo(() => {
    if (!map) return {};
    const nodes = map.nodes;
    const positions = layout === "taxonomy" ? taxonomyPositions(nodes) : null;
    const max = Math.max(1, ...nodes.map((node) => node.totalAssetCount));
    const ids = new Set(nodes.map((node) => node.termId));
    const top = new Set(
      [...nodes]
        .sort((a, b) => b.totalAssetCount - a.totalAssetCount)
        .slice(0, 20)
        .map((node) => node.termId),
    );
    const linkStyle = (kind: string) => {
      if (kind === "BROADER") return { type: "solid" as const, opacity: 0.7, width: 1.5 };
      if (kind === "CO_OCCURRENCE") return { type: "dotted" as const, opacity: 0.6, width: 1 };
      return { type: "dashed" as const, opacity: 0.6, width: 1 };
    };
    return {
      tooltip: {
        formatter: (params: { dataType: string; data: { name?: string; value?: number; label?: { formatter?: string } } }) =>
          params.dataType === "node"
            ? `${params.data.name ?? ""}<br/>${t("semanticMap.assets", {
                count: (params.data.value ?? 0).toLocaleString(),
              })}`
            : "",
      },
      animationDurationUpdate: 300,
      series: [
        {
          type: "graph",
          layout: positions ? "none" : "force",
          roam: true,
          draggable: !positions,
          force: { repulsion: 220, edgeLength: [60, 160], gravity: 0.08 },
          label: { show: true, position: "bottom", fontSize: 11 },
          labelLayout: { hideOverlap: true },
          emphasis: { focus: "adjacency" },
          data: nodes.map((node) => {
            const position = positions?.get(node.termId);
            return {
              id: node.termId,
              name: node.name,
              value: node.totalAssetCount,
              x: position?.x,
              y: position?.y,
              symbolSize: 12 + 38 * Math.sqrt(node.totalAssetCount / max),
              itemStyle: {
                color: node.scheme?.color ?? FALLBACK_COLOR,
                opacity: node.context ? 0.35 : 1,
                borderColor:
                  (node.severityCounts.critical ?? 0) + (node.severityCounts.high ?? 0) > 0
                    ? "#c2410c"
                    : "#1f2937",
                borderWidth: node.pendingProposals > 0 ? 3 : 1,
              },
              label: { show: top.has(node.termId) || nodes.length <= 60 },
            };
          }),
          links: map.links
            .filter((link) => ids.has(link.a) && ids.has(link.b))
            .filter((link) => cooccurrence || link.kind !== "CO_OCCURRENCE")
            .map((link) => ({
              source: link.a,
              target: link.b,
              lineStyle: linkStyle(link.kind),
              label:
                link.kind === "PART_OF" || link.kind === "CUSTOM"
                  ? { show: true, formatter: link.label, fontSize: 9 }
                  : undefined,
            })),
        },
      ],
    };
  }, [map, layout, cooccurrence, t]);

  async function rebuild() {
    setRebuilding(true);
    try {
      await rebuildSemanticMap();
      toast.success(t("semanticMap.rebuildQueued"));
    } catch (rebuildError) {
      toast.error(semanticErrorMessage(rebuildError, t("semanticMap.loadFailed")));
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <PanelCard className="flex h-[560px] flex-col overflow-hidden p-0 sm:col-span-2 sm:p-0 xl:col-span-12">
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-black uppercase leading-none tracking-[0.06em] text-foreground">
            {t("semanticMap.title")}
          </h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {map
              ? t("semanticMap.subtitle", {
                  concepts: map.nodes.length.toLocaleString(),
                  unbound: map.unbound.outputs.toLocaleString(),
                })
              : t("semanticMap.loading")}
          </p>
        </div>
        {headerSlot}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={schemeId} onValueChange={setSchemeId}>
            <SelectTrigger className="h-7 w-[160px] rounded-[4px] border-2 border-border text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("glossary.allSchemes")}</SelectItem>
              {schemes.map((scheme) => (
                <SelectItem key={scheme.id} value={scheme.id}>
                  {scheme.name}
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
              onChange={(event) => setMinAssets(Math.max(0, Number(event.target.value) || 0))}
              className="h-7 w-16 rounded-[4px] border-2 border-border text-xs"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <Switch checked={cooccurrence} onCheckedChange={setCooccurrence} />
            {t("semanticMap.cooccurrence")}
          </label>
          <div className="flex rounded-[4px] border-2 border-border" role="radiogroup">
            {(["taxonomy", "network"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                onClick={() => setLayout(value)}
                className={cn(
                  "px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                  layout === value ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                {t(`semanticMap.layouts.${value}` as TranslationKey)}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={rebuilding}
            onClick={rebuild}
            aria-label={t("semanticMap.rebuild")}
            className="h-7 rounded-[4px] border-2 border-border"
          >
            {rebuilding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {error ? (
            <p className="p-4 text-xs text-destructive">{error}</p>
          ) : !map ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : map.empty === "NO_CONCEPTS" ? (
            <EmptyState
              icon={Shapes}
              title={t("semanticMap.empty.noConcepts")}
              description={t("semanticMap.empty.noConceptsHint")}
              action={{
                label: t("semanticMap.empty.openGlossary"),
                onClick: () => router.push(nsPath("/glossary")),
              }}
            />
          ) : map.empty === "NO_LINKS" || map.nodes.length === 0 ? (
            <EmptyState
              icon={Shapes}
              title={t("semanticMap.empty.noLinks")}
              description={t("semanticMap.empty.noLinksHint")}
              action={{
                label: t("semanticMap.empty.bindOutputs"),
                onClick: () => router.push(nsPath("/glossary")),
              }}
            />
          ) : (
            <EChartBox
              option={option}
              className="h-full w-full"
              onChartClick={(params) => {
                const data = params as { dataType?: string; data?: { id?: string } };
                if (data.dataType !== "node") return;
                setSelected(map.nodes.find((node) => node.termId === data.data?.id) ?? null);
              }}
            />
          )}
          {map && map.unbound.outputs > 0 && (
            <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background/90 px-4 py-1.5 text-[11px] text-muted-foreground">
              {t("semanticMap.unbound", {
                outputs: map.unbound.outputs.toLocaleString(),
                findings: map.unbound.findings.toLocaleString(),
              })}{" "}
              <Link href={nsPath("/glossary")} className="underline">
                {t("semanticMap.review")}
              </Link>
            </div>
          )}
        </div>

        {selected && (
          <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-l-2 border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-base font-semibold">{selected.name}</h4>
                {selected.scheme && (
                  <p className="text-xs text-muted-foreground">{selected.scheme.name}</p>
                )}
              </div>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setSelected(null)}
                className="rounded-[2px] p-0.5 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {selected.definition && (
              <p className="text-xs text-muted-foreground">
                {selected.definition.slice(0, 300)}
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2">
              {(
                [
                  ["assets", selected.totalAssetCount],
                  ["findings", selected.findingCount],
                  ["sources", selected.sourceCount],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className={MICRO_LABEL}>
                    {t(`glossary.evidence.${label}` as TranslationKey)}
                  </dt>
                  <dd className="font-mono text-lg font-bold">{value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            {selected.pendingProposals > 0 && (
              <p className="text-xs">
                {t("semanticMap.pending", { count: String(selected.pendingProposals) })}
              </p>
            )}
            <Button asChild size="sm" className="w-full rounded-[4px]">
              <Link href={termHref(selected.key)}>{t("semanticMap.openTerm")}</Link>
            </Button>
          </aside>
        )}
      </div>
    </PanelCard>
  );
}
