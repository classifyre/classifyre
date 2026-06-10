"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, X, Maximize2,
  Save, Link2, Check, HelpCircle, DownloadCloud,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseResponseDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type HypothesisResponseDto,
  type ThreadResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@workspace/ui/components/dialog";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { EvidencePickerDialog } from "@/components/evidence-picker-dialog";
import { EvidenceTable } from "@/components/evidence-table";
import { HypothesisPanel } from "@/components/hypothesis-panel";
import { CaseThreadPanel } from "@/components/case-thread-panel";
import { CaseTimeline } from "@/components/case-timeline";
import { ManualEdgeDialog } from "@/components/manual-edge-dialog";
import { RenameEdgeDialog } from "@/components/rename-edge-dialog";

const CaseGraph = dynamic(() => import("@/components/case-graph").then((m) => m.CaseGraph), { ssr: false });

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const nodeKey = (type: string, id: string) => `${type}:${id}`;
const HYP_PALETTE = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#84cc16"];

/** Pick threads when adding a graph node as evidence. */
function AddEvidenceHypDialog({
  open, onOpenChange, node, caseId, onAdded,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; node: GraphNodeDto | null; caseId: string; onAdded: () => void;
}) {
  const [threadList, setThreadList] = React.useState<ThreadResponseDto[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    api.threads.threadsControllerList({ caseId }).then(setThreadList).catch(() => {});
  }, [open, caseId]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (!node) return;
    setLoading(true);
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: { entityType: node.type, entityId: node.id, hypothesisIds: Array.from(selected) },
      });
      toast.success("Added to evidence");
      onAdded();
      onOpenChange(false);
    } catch (err) { console.error(err); toast.error("Failed to add evidence"); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add evidence</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Adding <span className="font-medium">{node?.label}</span> as evidence. Optionally link to threads.
          </p>
          {threadList.length === 0 ? (
            <p className="text-muted-foreground text-sm py-2 text-center">No threads yet — add the evidence and link later.</p>
          ) : (
            <div className="space-y-2">
              {threadList.map((t) => {
                const sel = selected.has(t.id);
                return (
                  <button key={t.id} onClick={() => toggle(t.id)}
                    className={`w-full rounded border p-2.5 text-left text-sm transition-colors ${sel ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                    <span className="flex items-center gap-2">
                      <span className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center ${sel ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                        {sel && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </span>
                      {t.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>Add evidence</Button>
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
  const [threads, setThreads] = React.useState<ThreadResponseDto[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [selectedNode, setSelectedNode] = React.useState<GraphNodeDto | null>(null);
  const [graphLoading, setGraphLoading] = React.useState(false);
  const [activeEdgeTypes, setActiveEdgeTypes] = React.useState<Set<string>>(new Set());

  const [addEvidenceDialogOpen, setAddEvidenceDialogOpen] = React.useState(false);
  const [addEvidenceNode, setAddEvidenceNode] = React.useState<GraphNodeDto | null>(null);
  const [edgeDialogOpen, setEdgeDialogOpen] = React.useState(false);
  const [edgeFromNode, setEdgeFromNode] = React.useState<GraphNodeDto | null>(null);
  const [renameEdgeOpen, setRenameEdgeOpen] = React.useState(false);
  const [edgeToRename, setEdgeToRename] = React.useState<GraphEdgeDto | null>(null);

  const [conclusion, setConclusion] = React.useState("");
  const [status, setStatus] = React.useState<string>("OPEN");
  const [saving, setSaving] = React.useState(false);
  const [pulling, setPulling] = React.useState<string | null>(null);

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
      setNodes(g.nodes); setEdges(g.edges); setActiveEdgeTypes(new Set());
    } finally { setGraphLoading(false); }
  }, [caseId]);

  const loadHypotheses = React.useCallback(async () => {
    setHypotheses(await api.hypotheses.hypothesesControllerList({ caseId }));
  }, [caseId]);

  const loadThreads = React.useCallback(async () => {
    setThreads(await api.threads.threadsControllerList({ caseId }));
  }, [caseId]);

  React.useEffect(() => {
    void loadCase(); void loadGraph(); void loadHypotheses(); void loadThreads();
  }, [loadCase, loadGraph, loadHypotheses, loadThreads]);

  const reloadAll = () => { void loadCase(); void loadGraph(); };

  const evidenceKeys = React.useMemo(() => {
    const s = new Set<string>();
    caseData?.evidence?.forEach((e) => s.add(nodeKey(e.entityType, e.entityId)));
    return s;
  }, [caseData]);

  const evidenceMap = React.useMemo(() => {
    const m = new Map<string, string>();
    caseData?.evidence?.forEach((e) => m.set(nodeKey(e.entityType, e.entityId), e.id));
    return m;
  }, [caseData]);

  const hypothesisColors = React.useMemo(() => {
    const map: Record<string, string> = {};
    // Use threads (which have the same UUIDs as old hypotheses after migration)
    threads.forEach((t, i) => { map[t.id] = t.color ?? HYP_PALETTE[i % HYP_PALETTE.length] ?? "#888888"; });
    // Fallback: also include old hypothesis data in case threads haven't loaded yet
    hypotheses.forEach((h, i) => { if (!map[h.id]) map[h.id] = h.color ?? HYP_PALETTE[i % HYP_PALETTE.length] ?? "#888888"; });
    return map;
  }, [threads, hypotheses]);

  const allEdgeTypes = React.useMemo(() => Array.from(new Set(edges.map((e) => e.relationType))).sort(), [edges]);
  const visibleEdges = React.useMemo(
    () => (activeEdgeTypes.size === 0 ? edges : edges.filter((e) => activeEdgeTypes.has(e.relationType))),
    [edges, activeEdgeTypes],
  );
  const toggleEdgeType = (type: string) =>
    setActiveEdgeTypes((prev) => { const n = new Set(prev); n.has(type) ? n.delete(type) : n.add(type); return n; });

  const mergeGraph = React.useCallback((newNodes: GraphNodeDto[], newEdges: GraphEdgeDto[]) => {
    setNodes((prev) => { const m = new Map(prev.map((n) => [nodeKey(n.type, n.id), n])); newNodes.forEach((n) => m.set(nodeKey(n.type, n.id), n)); return Array.from(m.values()); });
    setEdges((prev) => { const m = new Map(prev.map((e) => [e.id, e])); newEdges.forEach((e) => m.set(e.id, e)); return Array.from(m.values()); });
  }, []);

  const expandNode = async (node: GraphNodeDto) => {
    try {
      const g = await api.graph.graphControllerExpand({ expandGraphDto: { entityType: node.type, entityId: node.id, depth: 1, direction: "both" } });
      mergeGraph(g.nodes, g.edges);
      toast.success(`Expanded — ${g.nodes.length} nodes`);
    } catch (err) { console.error(err); toast.error("Failed to expand"); }
  };

  const removeEvidence = async (evidenceId: string) => {
    await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
    await loadCase();
  };
  const removeFinding = async (caseFindingId: string) => {
    await api.cases.casesControllerRemoveFinding({ id: caseId, caseFindingId });
    await loadCase();
  };
  const addFinding = async (evidenceId: string, findingId: string) => {
    try {
      await api.cases.casesControllerAddFinding({
        id: caseId,
        evidenceId,
        addFindingDto: { findingId },
      });
    } catch (err) {
      console.error("Failed to add finding:", err);
      toast.error("Failed to add finding");
      throw err; // propagate so handleAttachFindings can track failures
    }
  };

  const updateEvidenceNote = async (evidenceId: string, note: string) => {
    try {
      await api.cases.casesControllerPatchEvidenceNote({
        id: caseId,
        evidenceId,
        updateEvidenceNoteDto: { note: note || undefined },
      });
    } catch (err) {
      console.error("Failed to save evidence note:", err);
      toast.error("Failed to save note");
    }
  };

  const updateFindingNote = async (caseFindingId: string, note: string) => {
    try {
      await api.cases.casesControllerPatchFindingNote({
        id: caseId,
        caseFindingId,
        updateCaseFindingNoteDto: { note: note || undefined },
      });
    } catch (err) {
      console.error("Failed to save finding note:", err);
      toast.error("Failed to save note");
    }
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
  const pullInquiry = async (inquiryId: string) => {
    setPulling(inquiryId);
    try {
      const res = await api.cases.casesControllerPull({ id: caseId, pullFromInquiryDto: { inquiryId } });
      toast.success(`Pulled ${res.pulled} finding${res.pulled === 1 ? "" : "s"} into evidence`);
      reloadAll();
    } catch (err) { console.error(err); toast.error("Failed to pull matches"); }
    finally { setPulling(null); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.cases.casesControllerUpdate({ id: caseId, updateCaseDto: { conclusion, status: status as never } });
      toast.success("Case updated");
      await loadCase();
    } catch (err) { console.error(err); toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  if (!caseData) return <div className="text-muted-foreground py-12 text-center text-sm">Loading case…</div>;

  const inquiries = caseData.inquiries ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => router.push("/investigations")}>
          <ArrowLeft className="h-4 w-4" /> Investigations
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-black uppercase tracking-[0.03em]">{caseData.title}</h1>
          <Badge variant="outline">{caseData.status.replace("_", " ")}</Badge>
          <SeverityBadge severity={caseData.severity.toLowerCase() as never}>{caseData.severity}</SeverityBadge>
        </div>
        {caseData.description && <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{caseData.description}</p>}
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="threads">Threads ({threads.length})</TabsTrigger>
          <TabsTrigger value="evidence">Evidence ({caseData.evidenceCount})</TabsTrigger>
          <TabsTrigger value="inquiries">Inquiries ({caseData.inquiryCount})</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="conclusion">Conclusion</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4">
          <p className="text-muted-foreground text-xs max-w-md">
            Unified activity log for this case — all evidence, findings, and thread changes in chronological order.
          </p>
          <CaseTimeline caseId={caseId} />
        </TabsContent>

        <TabsContent value="threads">
          <CaseThreadPanel caseId={caseId} evidence={caseData.evidence ?? []} />
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <p className="text-muted-foreground text-xs max-w-md">
            The real, persisted evidence for this case. Pull from an inquiry (Inquiries tab) or add manually.
          </p>
          <EvidenceTable
            evidence={caseData.evidence ?? []}
            onRemoveEvidence={removeEvidence}
            onRemoveFinding={removeFinding}
            onAddEvidence={() => setPickerOpen(true)}
            onAddFinding={addFinding}
            onNoteChange={updateEvidenceNote}
            onFindingNoteChange={updateFindingNote}
            onRefresh={() => void loadCase()}
          />
        </TabsContent>

        <TabsContent value="inquiries" className="space-y-4">
          <p className="text-muted-foreground text-xs max-w-lg">
            Linked inquiries guide this case. Pull their current matches in as evidence — the case keeps its own copy even if the query later changes.
          </p>
          {inquiries.length > 0 ? (
            <div className="space-y-2">
              {inquiries.map((q) => (
                <Card key={q.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-3">
                    <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => router.push(`/investigations/inquiries/${q.id}`)}>
                      <HelpCircle className="text-muted-foreground h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{q.title}</p>
                        <p className="text-muted-foreground text-xs">{q.matchCount} match{q.matchCount === 1 ? "" : "es"} · {q.status}</p>
                      </div>
                    </button>
                    <Button size="sm" variant="outline" disabled={pulling === q.id || q.matchCount === 0} onClick={() => pullInquiry(q.id)}>
                      <DownloadCloud className="h-3.5 w-3.5" /> Pull {q.matchCount > 0 ? `(${q.matchCount})` : ""}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title="No linked inquiries" description="Link inquiries to this case from the Inquiries list." />
          )}
        </TabsContent>

        <TabsContent value="graph" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">{graphLoading ? "Building graph…" : `${nodes.length} nodes · ${edges.length} relationships`}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEdgeFromNode(selectedNode); setEdgeDialogOpen(true); }} disabled={!selectedNode}>
                <Link2 className="h-3.5 w-3.5" /> Add edge
              </Button>
              <Button variant="outline" size="sm" onClick={loadGraph}>Reset</Button>
            </div>
          </div>
          {allEdgeTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide mr-1">Show edges:</span>
              {allEdgeTypes.map((type) => {
                const active = activeEdgeTypes.size === 0 || activeEdgeTypes.has(type);
                const count = edges.filter((e) => e.relationType === type).length;
                return (
                  <button key={type} onClick={() => toggleEdgeType(type)}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {type} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
              {activeEdgeTypes.size > 0 && <button onClick={() => setActiveEdgeTypes(new Set())} className="text-muted-foreground text-[10px] underline">clear</button>}
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
            <div className="h-[560px] border border-border bg-card">
              {nodes.length > 0 ? (
                <CaseGraph
                  caseId={caseId}
                  nodes={nodes}
                  edges={visibleEdges}
                  hypotheses={hypotheses}
                  hypothesisColors={hypothesisColors}
                  evidenceKeys={evidenceKeys}
                  evidenceMap={evidenceMap}
                  selectedKey={selectedNode ? nodeKey(selectedNode.type, selectedNode.id) : null}
                  onSelectNode={setSelectedNode}
                  onAddEdgeFrom={(node) => { setEdgeFromNode(node); setEdgeDialogOpen(true); }}
                  onRenameEdge={(edge) => { setEdgeToRename(edge); setRenameEdgeOpen(true); }}
                  onDeleteEdge={deleteEdge}
                  onGraphChanged={reloadAll}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <EmptyState title="Empty graph" description="Add evidence to seed the relationship graph." />
                </div>
              )}
            </div>
            <div className="space-y-3">
              {selectedNode ? (
                <Card>
                  <CardContent className="space-y-3 p-3">
                    <div>
                      <p className="text-muted-foreground text-[11px] font-mono uppercase">{selectedNode.type}</p>
                      <p className="break-words font-medium">{selectedNode.label}</p>
                    </div>
                    {selectedNode.severity && <SeverityBadge severity={selectedNode.severity.toLowerCase() as never}>{selectedNode.severity}</SeverityBadge>}
                    <div className="flex flex-col gap-2">
                      <Button size="sm" variant="outline" onClick={() => expandNode(selectedNode)}><Maximize2 className="h-3.5 w-3.5" /> Expand</Button>
                      {selectedNode.type === "asset" && !evidenceKeys.has(nodeKey(selectedNode.type, selectedNode.id)) && (
                        <Button size="sm" onClick={() => { setAddEvidenceNode(selectedNode); setAddEvidenceDialogOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add as evidence</Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => { setEdgeFromNode(selectedNode); setEdgeDialogOpen(true); }}><Link2 className="h-3.5 w-3.5" /> Add manual edge</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card><CardContent className="text-muted-foreground p-3 text-sm">Click a node to select it. Green ring = already evidence.</CardContent></Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="conclusion" className="space-y-4">
          <div className="max-w-3xl space-y-4">
            <div className="space-y-1.5">
              <Label>Case status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conclusion">Conclusion</Label>
              <Textarea id="conclusion" value={conclusion} onChange={(e) => setConclusion(e.target.value)}
                placeholder="Summarize which hypothesis the evidence supports, and how strongly." rows={8} />
            </div>
            <Button onClick={save} disabled={saving}><Save className="h-4 w-4" /> Save</Button>
          </div>
        </TabsContent>
      </Tabs>

      <EvidencePickerDialog caseId={caseId} open={pickerOpen} onOpenChange={setPickerOpen} existingKeys={evidenceKeys} onAdded={reloadAll} />
      <AddEvidenceHypDialog open={addEvidenceDialogOpen} onOpenChange={setAddEvidenceDialogOpen} node={addEvidenceNode} caseId={caseId} onAdded={reloadAll} />
      <ManualEdgeDialog open={edgeDialogOpen} onOpenChange={setEdgeDialogOpen} fromNode={edgeFromNode} nodes={nodes} onCreated={() => void loadGraph()} />
      <RenameEdgeDialog open={renameEdgeOpen} onOpenChange={setRenameEdgeOpen} edge={edgeToRename} onRenamed={() => void loadGraph()} />
    </div>
  );
}
