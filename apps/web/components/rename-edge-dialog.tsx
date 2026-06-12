"use client";

import * as React from "react";
import { api, type GraphEdgeDto, type RelationTypesResponseDto } from "@workspace/api-client";
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
import { toast } from "sonner";

interface RenameEdgeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  edge: GraphEdgeDto | null;
  onRenamed: () => void;
}

export function RenameEdgeDialog({
  open,
  onOpenChange,
  edge,
  onRenamed,
}: RenameEdgeDialogProps) {
  const [value, setValue] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !edge) return;
    setValue(edge.relationType);
    api.graph.graphControllerRelationTypes()
      .then((r: RelationTypesResponseDto) => setSuggestions(r.suggestions))
      .catch(() => {});
  }, [open, edge]);

  const handleSubmit = async () => {
    if (!edge || !value.trim()) return;
    setLoading(true);
    try {
      await api.graph.graphControllerUpdateEdge({
        id: edge.id,
        updateEdgeDto: { relationType: value.trim() },
      });
      toast.success(`Edge renamed to "${value.trim()}"`);
      onRenamed();
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to rename edge");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename edge</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Relation type</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. READS, SENT_TO, my custom link…"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && void handleSubmit()}
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {suggestions.slice(0, 12).map((s) => (
                  <button
                    key={s}
                    className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide hover:bg-accent transition-colors"
                    onClick={() => setValue(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!value.trim() || loading}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
