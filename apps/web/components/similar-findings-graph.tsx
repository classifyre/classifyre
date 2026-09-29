"use client";

import * as React from "react";
import { ExternalLink, FileText, Layers } from "lucide-react";
import type {
  GraphEdgeDto,
  GraphNodeDto,
  SimilarFindingDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { GraphExplorer } from "./graph-explorer/graph-explorer";
import {
  ACCENT,
  keyOf,
  STRENGTH_GRADIENT,
  strengthColor,
} from "./graph-explorer/graph-types";
import type {
  EdgeStyleOverride,
  NodeDecoration,
} from "./graph-explorer/explorer-types";
import { useDetailLink } from "@/hooks/use-detail-link";
import { useTranslation } from "@/hooks/use-translation";
import { DropdownMenuItem, DropdownMenuSeparator } from "@workspace/ui/components/dropdown-menu";
import { useAddToCase } from "./case-target/case-target";
import { AddToCaseButton, AddToCaseMenuItem, nodeCandidate, useCaseDecorator } from "./case-target/case-target-menu";

/** Prefix marking the finding the page is about (it anchors the graph). */
const ANCHOR = "anchor";
/** Similarity edges carry a percentage label; document edges stay unlabelled. */
const DOCUMENT_EDGE_CONFIDENCE = 0.05;

/** The anchor gets a ring so it never gets lost among its own neighbours. */
const ANCHOR_DECO: NodeDecoration = {
  ringColor: ACCENT,
  findingGlyph: "icon",
};

const DOCUMENT_EDGE_STYLE: EdgeStyleOverride = {
  dash: [3, 3],
  width: 1,
  arrow: false,
};

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * "Similar findings" as a graph instead of a ranked list.
 *
 * The finding being viewed sits at the centre, each semantic neighbour hangs
 * off it on an edge labelled with the similarity score, and every neighbour is
 * also tied to the document it came from — so the force layout pulls findings
 * that share a document into the same visual lane, which is the grouping that
 * actually matters when you are deciding whether a hit is boilerplate or a
 * real second occurrence.
 */
export function SimilarFindingsGraph({
  findingId,
  items,
  anchorLabel,
  anchorAssetId,
  anchorAssetName,
  className = "h-[420px]",
}: {
  findingId: string;
  items: SimilarFindingDto[];
  /** Matched content of the finding being viewed, for the centre node. */
  anchorLabel: string;
  anchorAssetId?: string;
  anchorAssetName?: string;
  /** The graph's height (a fixed one by default). */
  className?: string;
}) {
  const { t } = useTranslation();
  const detailLink = useDetailLink();
  // Inside a case board, adds go to that case; elsewhere the person picks one.
  const { target: caseTarget, dialog: caseDialog } = useAddToCase();

  const { nodes, edges, similarityById } = React.useMemo(() => {
    const nodes: GraphNodeDto[] = [];
    const edges: GraphEdgeDto[] = [];
    const similarityById = new Map<string, number>();

    nodes.push({
      id: findingId,
      type: "finding",
      label: truncate(anchorLabel) || t("findings.detail.similarFindings.thisFinding"),
      depth: 0,
      detectorType: ANCHOR,
    });

    // One document node per distinct parent asset — this is what turns the
    // flat neighbour list into per-document groups.
    const documents = new Map<string, string>();
    if (anchorAssetId) documents.set(anchorAssetId, anchorAssetName ?? anchorAssetId);

    for (const item of items) {
      similarityById.set(item.id, item.similarity);
      nodes.push({
        id: item.id,
        type: "finding",
        label: truncate(item.matchedContent),
        depth: 1,
        severity: item.severity,
        detectorType: item.findingType,
        matchedContent: item.matchedContent,
        assetId: item.assetId,
        assetName: item.asset?.name,
      });
      edges.push({
        id: `sim:${findingId}->${item.id}`,
        fromType: "finding",
        fromId: findingId,
        toType: "finding",
        toId: item.id,
        relationType: `${Math.round(item.similarity * 100)}%`,
        confidence: item.similarity,
        origin: "INFERRED",
      });
      if (item.assetId && !documents.has(item.assetId)) {
        documents.set(item.assetId, item.asset?.name ?? item.assetId);
      }
    }

    for (const [assetId, name] of documents) {
      nodes.push({
        id: assetId,
        type: "asset",
        label: truncate(name, 40),
        depth: 1,
      });
    }

    const memberships: Array<[findingId: string, assetId: string]> = items
      .filter((item) => Boolean(item.assetId))
      .map((item) => [item.id, item.assetId]);
    if (anchorAssetId) memberships.unshift([findingId, anchorAssetId]);
    for (const [member, assetId] of memberships) {
      edges.push({
        id: `doc:${member}->${assetId}`,
        fromType: "asset",
        fromId: assetId,
        toType: "finding",
        toId: member,
        relationType: "",
        confidence: DOCUMENT_EDGE_CONFIDENCE,
        origin: "INFERRED",
      });
    }

    return { nodes, edges, similarityById };
  }, [findingId, items, anchorLabel, anchorAssetId, anchorAssetName, t]);

  const heatDecorator = React.useCallback(
    (n: GraphNodeDto): NodeDecoration | null => {
      if (n.type !== "finding") return null;
      if (n.id === findingId) return ANCHOR_DECO;
      return {
        fillOverride: strengthColor(similarityById.get(n.id) ?? 0),
        findingGlyph: "icon",
      };
    },
    [findingId, similarityById],
  );
  const nodeDecorator = useCaseDecorator(caseTarget, heatDecorator) ?? heatDecorator;

  const nodeMenu = React.useCallback(
    (node: GraphNodeDto, close: () => void) => {
      const candidate = nodeCandidate(node);
      if (!candidate) return null;
      return (
        <>
          <AddToCaseMenuItem target={caseTarget} candidates={[candidate]} onDone={close} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              window.open(detailLink(node.type === "asset" ? `/assets/${node.id}` : `/findings/${node.id}`).href, "_blank", "noopener")
            }
          >
            <ExternalLink className="size-4" />
            {t(node.type === "asset" ? "graphExplorer.openDocument" : "graphExplorer.openFinding")}
          </DropdownMenuItem>
        </>
      );
    },
    [caseTarget, detailLink, t],
  );

  const edgeStyle = React.useCallback(
    (e: GraphEdgeDto): EdgeStyleOverride =>
      e.id.startsWith("doc:")
        ? DOCUMENT_EDGE_STYLE
        : {
            stroke: strengthColor(Number(e.confidence ?? 0)),
            dash: [],
            width: 1 + Number(e.confidence ?? 0) * 2.5,
            arrow: false,
          },
    [],
  );

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t("findings.detail.similarFindings.graphEmpty")}
        description=""
      />
    );
  }

  return (
    <div className={className}>
      <GraphExplorer
        nodes={nodes}
        edges={edges}
        nodeDecorator={nodeDecorator}
        edgeStyle={edgeStyle}
        // Neighbour sets are small and already grouped by document; collapsing
        // them into Louvain meta-nodes would hide the very structure the graph
        // exists to show.
        clustering={{ enabled: false }}
        nodeMenu={nodeMenu}
        header={
          <>
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("findings.detail.similarFindings.title")}
            </span>
          </>
        }
        sidebar={({ selectedNode }) =>
          selectedNode ? (
            <div className="space-y-3" key={keyOf(selectedNode)}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {selectedNode.type === "asset"
                    ? t("graphExplorer.membersDocuments")
                    : t("graphExplorer.membersFindings")}
                </Badge>
                {selectedNode.id === findingId && (
                  <Badge className="text-[10px]">
                    {t("findings.detail.similarFindings.thisFinding")}
                  </Badge>
                )}
                {similarityById.has(selectedNode.id) && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("findings.detail.similarFindings.similarity")}{" "}
                    {Math.round(similarityById.get(selectedNode.id)! * 100)}%
                  </Badge>
                )}
              </div>
              <p className="break-words font-mono text-xs">{selectedNode.label}</p>
              {selectedNode.assetName && (
                <p className="flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-3 w-3 shrink-0" />
                  {selectedNode.assetName}
                </p>
              )}
              {nodeCandidate(selectedNode) && (
                <AddToCaseButton
                  target={caseTarget}
                  candidate={nodeCandidate(selectedNode)!}
                  className="h-8 w-full gap-1.5 text-xs"
                />
              )}
              {selectedNode.id !== findingId && (
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a
                    {...detailLink(
                      selectedNode.type === "asset"
                        ? `/assets/${selectedNode.id}`
                        : `/findings/${selectedNode.id}`,
                    )}
                  >
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    {t(
                      selectedNode.type === "asset"
                        ? "graphExplorer.openDocument"
                        : "graphExplorer.openFinding",
                    )}
                  </a>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="font-serif text-sm font-black uppercase tracking-[0.06em]">
                {t("correlation.fingerprints.legend")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("findings.detail.similarFindings.graphHint")}
              </p>
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{t("correlation.fingerprints.strengthWeak")}</span>
                  <span>{t("correlation.fingerprints.strengthStrong")}</span>
                </div>
                <div
                  className="h-2 w-full rounded-full"
                  style={{ background: STRENGTH_GRADIENT }}
                />
              </div>
            </div>
          )
        }
      >
        {caseDialog}
      </GraphExplorer>
    </div>
  );
}
