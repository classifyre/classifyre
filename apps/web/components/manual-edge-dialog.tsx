"use client";

import * as React from "react";
import { api, type GraphNodeDto, type RelationTypesResponseDto } from "@workspace/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/ui/components/dialog";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { toast } from "sonner";

interface ManualEdgeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fromNode: GraphNodeDto | null;
  /** When set (connect mode), the target select is prefilled with this node. */
  toNode?: GraphNodeDto | null;
  nodes: GraphNodeDto[];
  onCreated: () => void;
}

export function ManualEdgeDialog({
  open,
  onOpenChange,
  fromNode,
  toNode,
  nodes,
  onCreated,
}: ManualEdgeDialogProps) {
  const [toNodeId, setToNodeId] = React.useState("");
  const [relationType, setRelationType] = React.useState("");
  const [customType, setCustomType] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  const CUSTOM_SENTINEL = "__custom__";

  React.useEffect(() => {
    if (!open) return;
    api.graph.graphControllerRelationTypes()
      .then((r: RelationTypesResponseDto) => setSuggestions(r.suggestions))
      .catch(() => {});
    setToNodeId(toNode ? `${toNode.type}:${toNode.id}` : "");
    setRelationType("");
    setCustomType("");
  }, [open, toNode]);

  const effectiveType = relationType === CUSTOM_SENTINEL ? customType.trim() : relationType;

  const toNodes = nodes.filter(
    (n) => !(n.type === fromNode?.type && n.id === fromNode?.id),
  );

  const handleSubmit = async () => {
    if (!fromNode || !toNodeId || !effectiveType) return;
    const [toType, toId] = toNodeId.split(":");
    if (!toType || !toId) return;
    setLoading(true);
    try {
      await api.graph.graphControllerCreateManualEdge({
        createManualEdgeDto: {
          fromType: fromNode.type,
          fromId: fromNode.id,
          toType,
          toId,
          relationType: effectiveType,
        },
      });
      toast.success(`Edge "${effectiveType}" created`);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to create edge");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add manual edge</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>From</Label>
            <div className="rounded-md border border-border px-3 py-2 text-sm bg-muted/40">
              {fromNode ? (
                <span className="font-medium">{fromNode.label}</span>
              ) : (
                <span className="text-muted-foreground">No source selected</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Relation type</Label>
            <Select value={relationType} onValueChange={setRelationType}>
              <SelectTrigger>
                <SelectValue placeholder="Choose or type a relation…" />
              </SelectTrigger>
              <SelectContent>
                {suggestions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SENTINEL}>Custom…</SelectItem>
              </SelectContent>
            </Select>
            {relationType === CUSTOM_SENTINEL && (
              <Input
                placeholder="e.g. DEPENDS_ON, reviewed_by, my link…"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                autoFocus
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Select value={toNodeId} onValueChange={setToNodeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select target node…" />
              </SelectTrigger>
              <SelectContent>
                {toNodes.map((n) => (
                  <SelectItem key={`${n.type}:${n.id}`} value={`${n.type}:${n.id}`}>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground mr-1.5">
                      {n.type}
                    </span>
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!fromNode || !toNodeId || !effectiveType || loading}
          >
            Create edge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
