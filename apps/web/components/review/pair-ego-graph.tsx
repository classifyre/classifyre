"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Scissors, Share2 } from "lucide-react";
import type {
  GraphEdgeDto,
  GraphNodeDto,
  ReviewEgoGraphDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { GraphExplorer } from "@/components/graph-explorer/graph-explorer";
import { ACCENT, keyOf } from "@/components/graph-explorer/graph-types";
import type {
  EdgeStyleOverride,
  NodeDecoration,
} from "@/components/graph-explorer/explorer-types";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { score2 } from "./review-format";

/** The two assets under judgement. */
const SEED_DECO: NodeDecoration = { ringColor: ACCENT };

/** Stroke width range. Unclamped, a heavy edge swallows everything around it. */
const MIN_WIDTH = 0.75;
const MAX_WIDTH = 5;

/**
 * The cluster around this pair, on the same canvas the rest of the product
 * uses — pan, zoom, drag, click a node, select an edge.
 *
 * This was a hand-drawn SVG at first, on the reasoning that twelve nodes did
 * not need a force layout. That was wrong: it bought nothing and cost every
 * interaction, and a dozen densely connected assets drawn as static lines is
 * unreadable regardless of how few nodes there are.
 *
 * Density is handled with a threshold rather than by drawing everything: below
 * the slider an edge is hidden, so the reviewer can strip the cluster back to
 * the links that are actually holding it together. The pair being judged and
 * the weakest link are always drawn, whatever the threshold says — they are
 * the two things this screen exists to show.
 */
export function PairEgoGraph({
  ego,
  aId,
  bId,
  onSplit,
  canSplit,
}: {
  ego: ReviewEgoGraphDto;
  aId: string;
  bId: string;
  onSplit?: () => void;
  canSplit?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [minWeight, setMinWeight] = React.useState(0);

  const weakest = React.useMemo(
    () => ego.edges.find((e) => e.isWeakest) ?? null,
    [ego.edges],
  );

  const nodes = React.useMemo<GraphNodeDto[]>(
    () =>
      ego.nodes.map((n) => ({
        id: n.id,
        type: "asset",
        label: n.name,
        depth: n.isSeed ? 0 : 1,
      })),
    [ego.nodes],
  );

  const edges = React.useMemo<GraphEdgeDto[]>(
    () =>
      ego.edges
        .filter(
          (e) =>
            e.weighted >= minWeight ||
            e.isWeakest ||
            (e.aId === aId && e.bId === bId) ||
            (e.aId === bId && e.bId === aId),
        )
        .map((e) => ({
          id: `${e.aId}:${e.bId}`,
          fromType: "asset",
          fromId: e.aId,
          toType: "asset",
          toId: e.bId,
          relationType: score2(e.weighted),
          confidence: e.weighted,
          origin: "INFERRED",
        })),
    [ego.edges, minWeight, aId, bId],
  );

  const nodeDecorator = React.useCallback(
    (n: GraphNodeDto): NodeDecoration | null =>
      n.id === aId || n.id === bId ? SEED_DECO : null,
    [aId, bId],
  );

  const edgeStyle = React.useCallback(
    (edge: GraphEdgeDto): EdgeStyleOverride => {
      const weight = Number(edge.confidence) || 0;
      const isPair =
        (edge.fromId === aId && edge.toId === bId) ||
        (edge.fromId === bId && edge.toId === aId);
      const isWeakest =
        weakest != null &&
        ((edge.fromId === weakest.aId && edge.toId === weakest.bId) ||
          (edge.fromId === weakest.bId && edge.toId === weakest.aId));

      if (isWeakest) {
        return {
          stroke: "var(--color-destructive)",
          dash: [5, 4],
          width: 1.6,
          // The score, not the word "weak". This is the only link joining two
          // groups, which is what makes it the place to cut — it can still be
          // a perfect match, and labelling a 1.00 edge "weak" reads as a bug.
          label: `${t("review.ego.weak")} ${score2(weight)}`,
        };
      }
      return {
        stroke: isPair ? ACCENT : undefined,
        width: MIN_WIDTH + weight * (MAX_WIDTH - MIN_WIDTH),
        label: score2(weight),
      };
    },
    [aId, bId, weakest, t],
  );

  if (ego.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={Share2}
          title={t("review.ego.title")}
          description={t("review.ego.noCluster")}
        />
      </div>
    );
  }

  return (
    <GraphExplorer
      nodes={nodes}
      edges={edges}
      nodeDecorator={nodeDecorator}
      edgeStyle={edgeStyle}
      onNodeDoubleClick={(n) => router.push(nsPath(`/assets/${n.id}`))}
      header={
        <>
          <Share2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("review.ego.title")}
          </span>
          {/* One control does more for readability here than any amount of
              styling: hide the weak edges and what is holding the cluster
              together becomes visible. */}
          <label className="ml-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {t("review.ego.minWeight")}
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={minWeight}
              onChange={(e) => setMinWeight(Number(e.target.value))}
              className="h-1 w-24 accent-[color:var(--accent)]"
            />
            <span className="w-7 text-right tabular-nums text-foreground">
              {score2(minWeight)}
            </span>
          </label>
        </>
      }
      headerRight={
        canSplit && onSplit ? (
          <Button size="sm" variant="outline" className="h-8" onClick={onSplit}>
            <Scissors className="mr-1.5 h-3.5 w-3.5" />
            {t("review.actions.split")}
          </Button>
        ) : undefined
      }
      sidebarClassName="w-[210px] shrink-0 space-y-3 overflow-y-auto border-l-2 border-border bg-background p-3"
      sidebar={({ selectedNode, selectedEdge }) =>
        selectedNode ? (
          <div className="space-y-3" key={keyOf(selectedNode)}>
            <Badge variant="outline" className="text-[10px] uppercase">
              {selectedNode.id === aId || selectedNode.id === bId
                ? t("review.ego.seed")
                : t("review.ego.member")}
            </Badge>
            <p className="break-words font-mono text-[12px] font-semibold">
              {selectedNode.label}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                router.push(nsPath(`/assets/${selectedNode.id}`))
              }
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t("review.ego.openAsset")}
            </Button>
          </div>
        ) : selectedEdge ? (
          <div className="space-y-2">
            <Badge variant="outline" className="text-[10px] uppercase">
              {t("review.ego.link")}
            </Badge>
            <p className="font-mono text-[13px] font-semibold text-foreground">
              {score2(Number(selectedEdge.confidence) || 0)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t("review.ego.linkHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-[11px] text-muted-foreground">
            <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em] text-foreground">
              {t("review.ego.title")}
            </h3>
            <p>
              {weakest
                ? t("review.ego.caption")
                : ego.nodes.length <= 2 && ego.truncated === 0
                  ? t("review.ego.single")
                  : t("review.ego.noBridge")}
            </p>
            <ul className="space-y-1.5 border-t border-border pt-2">
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full border-2 bg-muted"
                  style={{ borderColor: ACCENT }}
                />
                {t("review.ego.seed")}
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 inline-block h-0 w-6 shrink-0 border-t-2 border-dashed border-destructive" />
                <span>
                  <span className="block text-foreground">
                    {t("review.ego.weak")}
                  </span>
                  <span className="block">{t("review.ego.cutHint")}</span>
                </span>
              </li>
            </ul>
            {ego.truncated > 0 ? (
              <p className="border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                {t("review.ego.truncated", { count: ego.truncated })}
              </p>
            ) : null}
          </div>
        )
      }
    />
  );
}
