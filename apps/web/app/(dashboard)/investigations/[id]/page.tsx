"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  X,
  Maximize2,
  FileText,
  Fingerprint,
  ChevronDown,
  ChevronRight,
  Save,
  Link2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseResponseDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type HypothesisResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/dialog";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { EvidencePickerDialog } from "@/components/evidence-picker-dialog";
import { HypothesisPanel } from "@/components/hypothesis-panel";
import { ManualEdgeDialog } from "@/components/manual-edge-dialog";
import { RenameEdgeDialog } from "@/components/rename-edge-dialog";

const CaseGraph = dynamic(
  () => import("@/components/case-graph").then((m) => m.CaseGraph),
  { ssr: false },
);

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const nodeKey = (type: string, id: string) => `${type}:${id}`;

const HYP_PALETTE = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function abbrevDetector(dt: string | undefined): string {
  if (!dt) return "";
  // UNSTRUCTURED_API_GLINER → gliner, PRESIDIO → presidio, etc.
  return dt.replace(/^UNSTRUCTURED_API_/, "").replace(/_/g, " ").toLowerCase();
}

/** Small dialog to pick hypothesis when adding a graph node as evidence. */
function AddEvidenceHypDialog({
  open,
  onOpenChange,
  node,
  caseId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  node: GraphNodeDto | null;
  caseId: string;
  onAdded: () => void;
}) {
  const [hypotheses, setHypotheses] = React.useState<HypothesisResponseDto[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    api.hypotheses.hypothesesControllerList({ caseId })
      .then(setHypotheses)
      .catch(() => {});
  }, [open, caseId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!node || selected.size === 0) return;
    setLoading(true);
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: {
          entityType: node.type,
          entityId: node.id,
          hypothesisIds: Array.from(selected),
        },
      });
      toast.success("Added to evidence and linked to hypothesis");
      onAdded();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to add evidence");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link evidence to hypothesis</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Adding <span className="font-medium">{node?.label}</span> as evidence.
            Select at least one hypothesis it relates to.
          </p>
          {hypotheses.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">
              No hypotheses yet — create one in the Hypotheses tab first.
            </p>
          ) : (
            <div className="space-y-2">
              {hypotheses.map((h) => {
                const sel = selected.has(h.id);
                return (
                  <button
                    key={h.id}
                    onClick={() => toggle(h.id)}
                    className={`w-full rounded border p-2.5 text-left text-sm transition-colors ${
                      sel ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center ${
                          sel ? "border-primary bg-primary" : "border-muted-foreground"
                        }`}
                      >
                        {sel && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </span>
                      {h.statement}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={selected.size === 0 || loading}>
            Add evidence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CaseWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [hypotheses, setHypotheses] = React.useState<HypothesisResponseDto[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [expandedEvidence, setExpandedEvidence] = React.useState<Set<string>>(new Set());

  // Graph state
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [selectedNode, setSelectedNode] = React.useState<GraphNodeDto | null>(null);
  const [graphLoading, setGraphLoading] = React.useState(false);

  // Edge type filter (empty = show all)
  const [activeEdgeTypes, setActiveEdgeTypes] = React.useState<Set<string>>(new Set());

  // "Add to evidence" from graph node (requires hypothesis selection)
  const [addEvidenceDialogOpen, setAddEvidenceDialogOpen] = React.useState(false);
  const [addEvidenceNode, setAddEvidenceNode] = React.useState<GraphNodeDto | null>(null);

  // Manual edge dialog
  const [edgeDialogOpen, setEdgeDialogOpen] = React.useState(false);
  const [edgeFromNode, setEdgeFromNode] = React.useState<GraphNodeDto | null>(null);

  // Rename edge dialog
  const [renameEdgeOpen, setRenameEdgeOpen] = React.useState(false);
  const [edgeToRename, setEdgeToRename] = React.useState<GraphEdgeDto | null>(null);

  // Conclusion editor
  const [conclusion, setConclusion] = React.useState("");
  const [status, setStatus] = React.useState<string>("OPEN");
  const [savingConclusion, setSavingConclusion] = React.useState(false);

  const loadCase = React.useCallback(async () => {
    const data = await api.cases.casesControllerFindOne({ id: caseId });
    setCaseData(data);
    setConclusion(data.conclusion ?? "");
    setStatus(data.status);
  }, [caseId]);

  const loadGraph = React.useCallback(async () => {
    setGraphLoading(true);
    try {
      const g = await api.cases.casesControllerGraph({ id: caseId, depth: 1 });
      setNodes(g.nodes);
      setEdges(g.edges);
      setActiveEdgeTypes(new Set());
    } finally {
      setGraphLoading(false);
    }
  }, [caseId]);

  const loadHypotheses = React.useCallback(async () => {
    const hyps = await api.hypotheses.hypothesesControllerList({ caseId });
    setHypotheses(hyps);
  }, [caseId]);

  React.useEffect(() => {
    void loadCase();
    void loadGraph();
    void loadHypotheses();
  }, [loadCase, loadGraph, loadHypotheses]);

  const evidenceKeys = React.useMemo(() => {
    const s = new Set<string>();
    caseData?.evidence?.forEach((e) => s.add(nodeKey(e.entityType, e.entityId)));
    return s;
  }, [caseData]);

  // hypothesisId → color from fixed palette
  const hypothesisColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    hypotheses.forEach((h, i) => {
      map[h.id] = HYP_PALETTE[i % HYP_PALETTE.length] ?? "#888888";
    });
    return map;
  }, [hypotheses]);

  // All distinct edge types in the current graph
  const allEdgeTypes = React.useMemo(
    () => Array.from(new Set(edges.map((e) => e.relationType))).sort(),
    [edges],
  );

  // Filtered edges based on active type selection
  const visibleEdges = React.useMemo(() => {
    if (activeEdgeTypes.size === 0) return edges;
    return edges.filter((e) => activeEdgeTypes.has(e.relationType));
  }, [edges, activeEdgeTypes]);

  const toggleEdgeType = (type: string) => {
    setActiveEdgeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const mergeGraph = React.useCallback(
    (newNodes: GraphNodeDto[], newEdges: GraphEdgeDto[]) => {
      setNodes((prev) => {
        const map = new Map(prev.map((n) => [nodeKey(n.type, n.id), n]));
        newNodes.forEach((n) => map.set(nodeKey(n.type, n.id), n));
        return Array.from(map.values());
      });
      setEdges((prev) => {
        const map = new Map(prev.map((e) => [e.id, e]));
        newEdges.forEach((e) => map.set(e.id, e));
        return Array.from(map.values());
      });
    },
    [],
  );

  const expandNode = async (node: GraphNodeDto) => {
    try {
      const g = await api.graph.graphControllerExpand({
        expandGraphDto: { entityType: node.type, entityId: node.id, depth: 1, direction: "both" },
      });
      mergeGraph(g.nodes, g.edges);
      toast.success(`Expanded — ${g.nodes.length} nodes`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to expand");
    }
  };

  const removeEvidence = async (evidenceId: string) => {
    await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
    await loadCase();
  };

  const removeFinding = async (caseFindingId: string) => {
    await api.cases.casesControllerRemoveFinding({ id: caseId, caseFindingId });
    await loadCase();
  };

  const deleteEdge = async (edge: GraphEdgeDto) => {
    try {
      await api.graph.graphControllerDeleteEdge({ id: edge.id });
      setEdges((prev) => prev.filter((e) => e.id !== edge.id));
      toast.success("Edge deleted");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg.includes("Inferred") ? "Inferred edges cannot be deleted." : "Failed to delete edge");
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveConclusion = async () => {
    setSavingConclusion(true);
    try {
      await api.cases.casesControllerUpdate({
        id: caseId,
        updateCaseDto: { conclusion, status: status as never },
      });
      toast.success("Case updated");
      await loadCase();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save");
    } finally {
      setSavingConclusion(false);
    }
  };

  if (!caseData) {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        Loading case…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => router.push("/investigations")}
        >
          <ArrowLeft className="h-4 w-4" /> Investigations
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">
            {caseData.title}
          </h1>
          <Badge variant="outline">{caseData.status.replace("_", " ")}</Badge>
          <SeverityBadge severity={caseData.severity.toLowerCase() as never}>
            {caseData.severity}
          </SeverityBadge>
        </div>
        {caseData.description && (
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
            {caseData.description}
          </p>
        )}
      </div>

      <Tabs defaultValue="hypotheses">
        <TabsList>
          <TabsTrigger value="hypotheses">
            Hypotheses ({caseData.hypothesisCount})
          </TabsTrigger>
          <TabsTrigger value="evidence">
            Evidence ({caseData.evidenceCount})
          </TabsTrigger>
          <TabsTrigger value="graph">Graph Explorer</TabsTrigger>
          <TabsTrigger value="conclusion">Conclusion</TabsTrigger>
        </TabsList>

        {/* HYPOTHESES */}
        <TabsContent value="hypotheses">
          <HypothesisPanel caseId={caseId} evidence={caseData.evidence ?? []} />
        </TabsContent>

        {/* EVIDENCE */}
        <TabsContent value="evidence" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs max-w-md">
              Evidence must be linked to a hypothesis. Use the Add button to select which hypothesis first.
            </p>
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" /> Add evidence
            </Button>
          </div>
          {caseData.evidence && caseData.evidence.length > 0 ? (
            <div className="space-y-2">
              {caseData.evidence.map((e) => {
                const isExpanded = expandedEvidence.has(e.id);
                const findings = e.findings ?? [];
                return (
                  <Card key={e.id}>
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between gap-2 p-3">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => findings.length > 0 && toggleExpanded(e.id)}
                        >
                          <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {e.entity?.label ?? e.entityId}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              asset{e.entity?.sourceType ? ` · ${e.entity.sourceType}` : ""}
                              {findings.length > 0
                                ? ` · ${findings.length} finding${findings.length !== 1 ? "s" : ""}`
                                : ""}
                            </p>
                          </div>
                          {findings.length > 0 && (
                            <span className="text-muted-foreground ml-1 shrink-0">
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Add manual edge from this asset"
                            onClick={() => {
                              const node = nodes.find((n) => n.type === "asset" && n.id === e.entityId);
                              if (node) {
                                setEdgeFromNode(node);
                                setEdgeDialogOpen(true);
                              } else {
                                toast.info("Open the Graph Explorer tab first to load this node.");
                              }
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeEvidence(e.id)}
                            aria-label="Remove evidence"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {isExpanded && findings.length > 0 && (
                        <div className="border-t border-border/50 px-3 pb-2 pt-1">
                          <p className="text-muted-foreground mb-1.5 font-mono text-[10px] uppercase tracking-wide">
                            Findings
                          </p>
                          <div className="space-y-1">
                            {findings.map((f) => (
                              <div
                                key={f.id}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <Fingerprint className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate font-medium">{f.findingLabel}</span>
                                  {f.detectorType && (
                                    <span className="text-muted-foreground text-[10px] shrink-0">
                                      {abbrevDetector(f.detectorType)}
                                    </span>
                                  )}
                                  {f.severity && (
                                    <SeverityBadge
                                      severity={f.severity.toLowerCase() as never}
                                      className="shrink-0"
                                    >
                                      {f.severity}
                                    </SeverityBadge>
                                  )}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => removeFinding(f.id)}
                                  aria-label="Remove finding"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No evidence attached"
              description="Attach assets that participate in this investigation. Their findings will be auto-imported."
            />
          )}
        </TabsContent>

        {/* GRAPH */}
        <TabsContent value="graph" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              {graphLoading
                ? "Building graph…"
                : `${nodes.length} nodes · ${edges.length} relationships`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEdgeFromNode(selectedNode);
                  setEdgeDialogOpen(true);
                }}
                disabled={!selectedNode}
              >
                <Link2 className="h-3.5 w-3.5" /> Add edge
              </Button>
              <Button variant="outline" size="sm" onClick={loadGraph}>
                Reset
              </Button>
            </div>
          </div>

          {/* Hypothesis legend */}
          {hypotheses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide mr-1">
                Hypotheses:
              </span>
              {hypotheses.map((h, i) => (
                <span key={h.id} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: HYP_PALETTE[i % HYP_PALETTE.length] }}
                  />
                  <span className="max-w-[160px] truncate text-muted-foreground" title={h.statement}>
                    {h.statement}
                  </span>
                </span>
              ))}
              <span className="text-muted-foreground text-[10px]">
                · dashed border = multiple hypotheses · <span className="text-[#a855f7]">purple dashed edge</span> = cross-hypothesis lineage
              </span>
            </div>
          )}

          {/* Edge type filter */}
          {allEdgeTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide mr-1">
                Show edges:
              </span>
              {allEdgeTypes.map((type) => {
                const active = activeEdgeTypes.size === 0 || activeEdgeTypes.has(type);
                const count = edges.filter((e) => e.relationType === type).length;
                return (
                  <button
                    key={type}
                    onClick={() => toggleEdgeType(type)}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {type} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
              {activeEdgeTypes.size > 0 && (
                <button
                  onClick={() => setActiveEdgeTypes(new Set())}
                  className="text-muted-foreground text-[10px] underline"
                >
                  clear
                </button>
              )}
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
            <div className="h-[560px] border border-border bg-card">
              {nodes.length > 0 ? (
                <CaseGraph
                  nodes={nodes}
                  edges={visibleEdges}
                  evidenceKeys={evidenceKeys}
                  hypothesisColors={hypothesisColors}
                  selectedKey={selectedNode ? nodeKey(selectedNode.type, selectedNode.id) : null}
                  onSelectNode={setSelectedNode}
                  onAddEdgeFrom={(node) => {
                    setEdgeFromNode(node);
                    setEdgeDialogOpen(true);
                  }}
                  onRenameEdge={(edge) => {
                    setEdgeToRename(edge);
                    setRenameEdgeOpen(true);
                  }}
                  onDeleteEdge={deleteEdge}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    title="Empty graph"
                    description="Add evidence to seed the relationship graph."
                  />
                </div>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-muted-foreground text-[11px]">
                Right-click a node to add a manual edge.
                Right-click an edge to rename or delete it (manual edges only).
              </p>
              {selectedNode ? (
                <Card>
                  <CardContent className="space-y-3 p-3">
                    <div>
                      <p className="text-muted-foreground text-[11px] font-mono uppercase">
                        {selectedNode.type}
                      </p>
                      <p className="break-words font-medium">{selectedNode.label}</p>
                    </div>
                    {selectedNode.severity && (
                      <SeverityBadge severity={selectedNode.severity.toLowerCase() as never}>
                        {selectedNode.severity}
                      </SeverityBadge>
                    )}
                    {/* Hypothesis affiliation chips */}
                    {(selectedNode.hypothesisIds ?? []).length > 0 && (
                      <div>
                        <p className="text-muted-foreground text-[10px] font-mono uppercase mb-1">Hypothesis</p>
                        <div className="flex flex-wrap gap-1">
                          {(selectedNode.hypothesisIds ?? []).map((hId) => {
                            const h = hypotheses.find((x) => x.id === hId);
                            const color = hypothesisColors[hId] ?? "#888888";
                            return (
                              <span
                                key={hId}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                                style={{ backgroundColor: `${color}22`, border: `1px solid ${color}` }}
                                title={h?.statement}
                              >
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                <span className="max-w-[120px] truncate">{h?.statement ?? hId}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedNode.type === "finding" && (
                      <>
                        {selectedNode.assetName && (
                          <div>
                            <p className="text-muted-foreground text-[10px] font-mono uppercase">Source asset</p>
                            <p className="text-xs break-words">{selectedNode.assetName}</p>
                          </div>
                        )}
                        {selectedNode.detectorType && (
                          <div>
                            <p className="text-muted-foreground text-[10px] font-mono uppercase">Detector</p>
                            <p className="text-xs">{abbrevDetector(selectedNode.detectorType)}</p>
                          </div>
                        )}
                        {selectedNode.matchedContent && (
                          <div>
                            <p className="text-muted-foreground text-[10px] font-mono uppercase">Matched value</p>
                            <p className="break-all rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
                              {selectedNode.matchedContent}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    <div className="flex flex-col gap-2">
                      <Button size="sm" variant="outline" onClick={() => expandNode(selectedNode)}>
                        <Maximize2 className="h-3.5 w-3.5" /> Expand
                      </Button>
                      {selectedNode.type === "asset" &&
                        !evidenceKeys.has(nodeKey(selectedNode.type, selectedNode.id)) && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setAddEvidenceNode(selectedNode);
                              setAddEvidenceDialogOpen(true);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add as evidence
                          </Button>
                        )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEdgeFromNode(selectedNode);
                          setEdgeDialogOpen(true);
                        }}
                      >
                        <Link2 className="h-3.5 w-3.5" /> Add manual edge
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="text-muted-foreground p-3 text-sm">
                    Click a node to select it. Green ring = already evidence. Only asset nodes can be added as evidence.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* CONCLUSION */}
        <TabsContent value="conclusion" className="space-y-4">
          <div className="max-w-3xl space-y-4">
            <div className="space-y-1.5">
              <Label>Case status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conclusion">Conclusion</Label>
              <Textarea
                id="conclusion"
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                placeholder="Summarize findings and the supported hypotheses with confidence."
                rows={8}
              />
            </div>
            <Button onClick={saveConclusion} disabled={savingConclusion}>
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      <EvidencePickerDialog
        caseId={caseId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingKeys={evidenceKeys}
        onAdded={() => {
          void loadCase();
          void loadGraph();
        }}
      />

      <AddEvidenceHypDialog
        open={addEvidenceDialogOpen}
        onOpenChange={setAddEvidenceDialogOpen}
        node={addEvidenceNode}
        caseId={caseId}
        onAdded={() => {
          void loadCase();
          void loadGraph();
        }}
      />

      <ManualEdgeDialog
        open={edgeDialogOpen}
        onOpenChange={setEdgeDialogOpen}
        fromNode={edgeFromNode}
        nodes={nodes}
        onCreated={() => void loadGraph()}
      />

      <RenameEdgeDialog
        open={renameEdgeOpen}
        onOpenChange={setRenameEdgeOpen}
        edge={edgeToRename}
        onRenamed={() => void loadGraph()}
      />
    </div>
  );
}
