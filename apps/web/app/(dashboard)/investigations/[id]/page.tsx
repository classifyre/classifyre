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
  Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type CaseResponseDto,
  type GraphEdgeDto,
  type GraphNodeDto,
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
import { EmptyState } from "@workspace/ui/components/empty-state";
import { EvidencePickerDialog } from "@/components/evidence-picker-dialog";
import { HypothesisPanel } from "@/components/hypothesis-panel";

const CaseGraph = dynamic(
  () => import("@/components/case-graph").then((m) => m.CaseGraph),
  { ssr: false },
);

const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const nodeKey = (type: string, id: string) => `${type}:${id}`;

export default function CaseWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;

  const [caseData, setCaseData] = React.useState<CaseResponseDto | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Graph state
  const [nodes, setNodes] = React.useState<GraphNodeDto[]>([]);
  const [edges, setEdges] = React.useState<GraphEdgeDto[]>([]);
  const [selectedNode, setSelectedNode] = React.useState<GraphNodeDto | null>(
    null,
  );
  const [graphLoading, setGraphLoading] = React.useState(false);

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
    } finally {
      setGraphLoading(false);
    }
  }, [caseId]);

  React.useEffect(() => {
    void loadCase();
    void loadGraph();
  }, [loadCase, loadGraph]);

  const evidenceKeys = React.useMemo(() => {
    const s = new Set<string>();
    caseData?.evidence?.forEach((e) => s.add(nodeKey(e.entityType, e.entityId)));
    return s;
  }, [caseData]);

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
        expandGraphDto: {
          entityType: node.type,
          entityId: node.id,
          depth: 1,
          direction: "both",
        },
      });
      mergeGraph(g.nodes, g.edges);
      toast.success(`Expanded ${node.label}`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to expand");
    }
  };

  const addNodeAsEvidence = async (node: GraphNodeDto) => {
    try {
      await api.cases.casesControllerAddEvidence({
        id: caseId,
        addEvidenceDto: { entityType: node.type, entityId: node.id },
      });
      toast.success("Added to evidence");
      await loadCase();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add evidence");
    }
  };

  const removeEvidence = async (evidenceId: string) => {
    await api.cases.casesControllerRemoveEvidence({ id: caseId, evidenceId });
    await loadCase();
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

      <Tabs defaultValue="evidence">
        <TabsList>
          <TabsTrigger value="evidence">
            Evidence ({caseData.evidenceCount})
          </TabsTrigger>
          <TabsTrigger value="graph">Graph Explorer</TabsTrigger>
          <TabsTrigger value="hypotheses">
            Hypotheses ({caseData.hypothesisCount})
          </TabsTrigger>
          <TabsTrigger value="conclusion">Conclusion</TabsTrigger>
        </TabsList>

        {/* EVIDENCE */}
        <TabsContent value="evidence" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" /> Add evidence
            </Button>
          </div>
          {caseData.evidence && caseData.evidence.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {caseData.evidence.map((e) => (
                <Card key={e.id}>
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {e.entityType === "asset" ? (
                        <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                      ) : (
                        <Fingerprint className="text-muted-foreground h-4 w-4 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {e.entity?.label ?? e.entityId}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {e.entityType}
                          {e.entity?.severity ? ` · ${e.entity.severity}` : ""}
                          {e.entity?.sourceType
                            ? ` · ${e.entity.sourceType}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeEvidence(e.id)}
                      aria-label="Remove evidence"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No evidence attached"
              description="Attach assets and findings that participate in this investigation."
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
            <Button variant="outline" size="sm" onClick={loadGraph}>
              Reset graph
            </Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            <div className="h-[560px] border border-border bg-card">
              {nodes.length > 0 ? (
                <CaseGraph
                  nodes={nodes}
                  edges={edges}
                  evidenceKeys={evidenceKeys}
                  selectedKey={
                    selectedNode
                      ? nodeKey(selectedNode.type, selectedNode.id)
                      : null
                  }
                  onSelectNode={setSelectedNode}
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
              {selectedNode ? (
                <Card>
                  <CardContent className="space-y-3 p-3">
                    <div>
                      <p className="text-muted-foreground text-[11px] font-mono uppercase">
                        {selectedNode.type}
                      </p>
                      <p className="font-medium break-words">
                        {selectedNode.label}
                      </p>
                    </div>
                    {selectedNode.severity && (
                      <SeverityBadge
                        severity={selectedNode.severity.toLowerCase() as never}
                      >
                        {selectedNode.severity}
                      </SeverityBadge>
                    )}
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => expandNode(selectedNode)}
                      >
                        <Maximize2 className="h-3.5 w-3.5" /> Expand relationships
                      </Button>
                      {!evidenceKeys.has(
                        nodeKey(selectedNode.type, selectedNode.id),
                      ) && (
                        <Button
                          size="sm"
                          onClick={() => addNodeAsEvidence(selectedNode)}
                        >
                          <Plus className="h-3.5 w-3.5" /> Add to evidence
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="text-muted-foreground p-3 text-sm">
                    Click a node to expand its relationships or add it as
                    evidence. Nodes ringed in green are already evidence.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* HYPOTHESES */}
        <TabsContent value="hypotheses">
          <HypothesisPanel caseId={caseId} evidence={caseData.evidence ?? []} />
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
    </div>
  );
}
